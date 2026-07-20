import crypto from "crypto";
import { getDatabase } from "../index.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function mapNotification(row) {
  if (!row) return null;
  return {
    id: row.id,
    reportRunId: row.report_run_id,
    scheduleId: row.schedule_id,
    type: row.type,
    severity: row.severity,
    title: row.title,
    message: row.message,
    data: row.data_json ? JSON.parse(row.data_json) : null,
    isRead: Boolean(row.is_read ?? row.recipient_is_read),
    createdAt: row.created_at,
    readAt: row.read_at ?? row.recipient_read_at ?? null,
  };
}

export function listActiveUserIdsByRoles(roleCodes = []) {
  if (!roleCodes.length) return [];
  const placeholders = roleCodes.map(() => "?").join(",");
  return getDatabase()
    .prepare(
      `SELECT u.id FROM app_users u
       JOIN app_roles r ON r.id = u.role_id
       WHERE u.is_active = 1 AND u.disabled_at IS NULL
         AND r.code IN (${placeholders})`
    )
    .all(...roleCodes)
    .map((r) => r.id);
}

export function listActiveUserIdsWithPermission(permission) {
  return getDatabase()
    .prepare(
      `SELECT DISTINCT u.id FROM app_users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       WHERE u.is_active = 1 AND u.disabled_at IS NULL AND rp.permission = ?`
    )
    .all(permission)
    .map((r) => r.id);
}

export function findUserIdByBitrixUserId(bitrixUserId) {
  if (bitrixUserId == null || bitrixUserId === "") return null;
  const row = getDatabase()
    .prepare(
      `SELECT id FROM app_users
       WHERE bitrix_user_id = ? AND is_active = 1 AND disabled_at IS NULL
       LIMIT 1`
    )
    .get(String(bitrixUserId));
  return row?.id || null;
}

function uniqueIds(ids) {
  return [...new Set((ids || []).filter(Boolean))];
}

/**
 * Create notification + recipients in one transaction.
 * Legacy notifications.is_read is left 0 and unused for UI.
 */
export function createNotification({
  reportRunId = null,
  scheduleId = null,
  type,
  severity = "info",
  title,
  message,
  data = null,
  recipientUserIds = [],
}) {
  const recipients = uniqueIds(recipientUserIds);
  if (!recipients.length) {
    // fallback: all active admins
    recipients.push(...listActiveUserIdsByRoles(["administrator"]));
  }

  const id = uid();
  const ts = now();
  const db = getDatabase();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO notifications (
        id, report_run_id, schedule_id, type, severity, title, message, data_json, is_read, created_at, read_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL)`
    ).run(
      id,
      reportRunId,
      scheduleId,
      type,
      severity,
      title,
      message,
      data ? JSON.stringify(data) : null,
      ts
    );
    if (!recipients.length) {
      // Empty DB / pre-bootstrap: leave orphan for later backfill
      return;
    }
    const insertRecipient = db.prepare(
      `INSERT OR IGNORE INTO notification_recipients (
        notification_id, user_id, is_read, read_at, created_at
      ) VALUES (?, ?, 0, NULL, ?)`
    );
    for (const userId of recipients) {
      insertRecipient.run(id, userId, ts);
    }
  });
  tx();
  return getNotificationById(id, recipients[0] || null);
}

export function getNotificationById(id, forUserId = null) {
  if (forUserId) {
    const row = getDatabase()
      .prepare(
        `SELECT n.*, nr.is_read AS recipient_is_read, nr.read_at AS recipient_read_at
         FROM notifications n
         JOIN notification_recipients nr ON nr.notification_id = n.id
         WHERE n.id = ? AND nr.user_id = ?`
      )
      .get(id, forUserId);
    return mapNotification(row);
  }
  return mapNotification(
    getDatabase().prepare("SELECT * FROM notifications WHERE id = ?").get(id)
  );
}

export function listNotificationsForUser(
  userId,
  { severity, isRead, type, scheduleId, dateFrom, dateTo, limit = 50 } = {}
) {
  const where = ["nr.user_id = ?"];
  const args = [userId];
  if (severity) {
    where.push("n.severity = ?");
    args.push(severity);
  }
  if (isRead === true || isRead === false || isRead === 0 || isRead === 1) {
    where.push("nr.is_read = ?");
    args.push(isRead ? 1 : 0);
  }
  if (type) {
    where.push("n.type = ?");
    args.push(type);
  }
  if (scheduleId) {
    where.push("n.schedule_id = ?");
    args.push(scheduleId);
  }
  if (dateFrom) {
    where.push("n.created_at >= ?");
    args.push(dateFrom);
  }
  if (dateTo) {
    where.push("n.created_at <= ?");
    args.push(dateTo);
  }
  const sql = `SELECT n.*, nr.is_read AS recipient_is_read, nr.read_at AS recipient_read_at
    FROM notifications n
    JOIN notification_recipients nr ON nr.notification_id = n.id
    WHERE ${where.join(" AND ")}
    ORDER BY n.created_at DESC LIMIT ?`;
  args.push(Number(limit) || 50);
  return getDatabase().prepare(sql).all(...args).map(mapNotification);
}

/** @deprecated prefer listNotificationsForUser */
export function listNotifications(opts = {}) {
  if (opts.userId) return listNotificationsForUser(opts.userId, opts);
  return getDatabase()
    .prepare(`SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?`)
    .all(Number(opts.limit) || 50)
    .map(mapNotification);
}

export function getUnreadCountForUser(userId) {
  const total = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS c FROM notification_recipients nr
       JOIN notifications n ON n.id = nr.notification_id
       WHERE nr.user_id = ? AND nr.is_read = 0`
    )
    .get(userId).c;
  const critical = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS c FROM notification_recipients nr
       JOIN notifications n ON n.id = nr.notification_id
       WHERE nr.user_id = ? AND nr.is_read = 0 AND n.severity = 'critical'`
    )
    .get(userId).c;
  return { unread: total, unreadCritical: critical };
}

/** @deprecated prefer getUnreadCountForUser */
export function getUnreadCount() {
  const total = getDatabase()
    .prepare(`SELECT COUNT(*) AS c FROM notification_recipients WHERE is_read = 0`)
    .get().c;
  const critical = getDatabase()
    .prepare(
      `SELECT COUNT(*) AS c FROM notification_recipients nr
       JOIN notifications n ON n.id = nr.notification_id
       WHERE nr.is_read = 0 AND n.severity = 'critical'`
    )
    .get().c;
  return { unread: total, unreadCritical: critical };
}

export function markNotificationReadForUser(notificationId, userId) {
  const ts = now();
  const info = getDatabase()
    .prepare(
      `UPDATE notification_recipients SET is_read = 1, read_at = ?
       WHERE notification_id = ? AND user_id = ? AND is_read = 0`
    )
    .run(ts, notificationId, userId);
  if (!info.changes) {
    const exists = getDatabase()
      .prepare(
        `SELECT 1 FROM notification_recipients WHERE notification_id = ? AND user_id = ?`
      )
      .get(notificationId, userId);
    if (!exists) return null;
  }
  return getNotificationById(notificationId, userId);
}

/** @deprecated */
export function markNotificationRead(id) {
  getDatabase()
    .prepare(`UPDATE notifications SET is_read = 1, read_at = ? WHERE id = ?`)
    .run(now(), id);
  return getNotificationById(id);
}

export function markAllNotificationsReadForUser(userId) {
  const ts = now();
  const info = getDatabase()
    .prepare(
      `UPDATE notification_recipients SET is_read = 1, read_at = ?
       WHERE user_id = ? AND is_read = 0`
    )
    .run(ts, userId);
  return { updated: info.changes };
}

/** @deprecated */
export function markAllNotificationsRead() {
  const ts = now();
  const info = getDatabase()
    .prepare(`UPDATE notifications SET is_read = 1, read_at = ? WHERE is_read = 0`)
    .run(ts);
  return { updated: info.changes };
}

/**
 * Backfill notification_recipients for legacy rows without recipients.
 * Does not create duplicates.
 */
export function backfillNotificationRecipients() {
  const db = getDatabase();
  const orphaned = db
    .prepare(
      `SELECT n.* FROM notifications n
       WHERE NOT EXISTS (
         SELECT 1 FROM notification_recipients nr WHERE nr.notification_id = n.id
       )`
    )
    .all();
  const adminIds = listActiveUserIdsByRoles(["administrator"]);
  const directorIds = listActiveUserIdsByRoles(["director", "administrator"]);
  let created = 0;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO notification_recipients (
      notification_id, user_id, is_read, read_at, created_at
    ) VALUES (?, ?, ?, ?, ?)`
  );
  const tx = db.transaction(() => {
    for (const n of orphaned) {
      const targets = new Set();
      const data = n.data_json ? JSON.parse(n.data_json) : {};
      if (n.type === "schedule_failed" || n.severity === "critical") {
        for (const id of adminIds) targets.add(id);
      }
      if (n.schedule_id) {
        const schedule = db
          .prepare("SELECT created_by_user_id FROM report_schedules WHERE id = ?")
          .get(n.schedule_id);
        if (schedule?.created_by_user_id) targets.add(schedule.created_by_user_id);
      }
      if (data?.bitrixUserId || data?.responsibleId || data?.managerBitrixId) {
        const mid = findUserIdByBitrixUserId(
          data.bitrixUserId || data.responsibleId || data.managerBitrixId
        );
        if (mid) targets.add(mid);
        for (const id of directorIds) targets.add(id);
      }
      if (!targets.size) {
        for (const id of adminIds) targets.add(id);
      }
      const ts = n.created_at || now();
      const isRead = n.is_read ? 1 : 0;
      const readAt = n.read_at || null;
      for (const userId of targets) {
        const info = insert.run(n.id, userId, isRead, readAt, ts);
        if (info.changes) created += 1;
      }
    }
    db.prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    ).run(
      "notification_recipients_backfill_at",
      JSON.stringify(new Date().toISOString()),
      new Date().toISOString()
    );
  });
  tx();
  return { orphaned: orphaned.length, recipientsCreated: created };
}
