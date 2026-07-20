/**
 * Communications analytics aggregates.
 * Does not invent read rates when channel does not provide read status.
 */

import { getDatabase } from "../database/index.js";
import * as repo from "./communicationRepository.js";

function countMessages({ status, direction, since } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    if (Array.isArray(status)) {
      clauses.push(`status IN (${status.map(() => "?").join(",")})`);
      params.push(...status);
    } else {
      clauses.push("status = ?");
      params.push(status);
    }
  }
  if (direction) {
    clauses.push("direction = ?");
    params.push(direction);
  }
  if (since) {
    clauses.push("created_at >= ?");
    params.push(since);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return (
    getDatabase()
      .prepare(`SELECT COUNT(*) AS c FROM communication_messages ${where}`)
      .get(...params)?.c || 0
  );
}

function channelSupportsRead(transport) {
  const t = String(transport || "").toLowerCase();
  return t === "wapi" || t === "whatsapp";
}

export function getDeliveryReport({ sinceDays = 30 } = {}) {
  const since = new Date(Date.now() - sinceDays * 86400000).toISOString();
  const outbox = repo.countOutboxByStatus();

  const scheduled = (outbox.pending || 0) + (outbox.retry || 0) + (outbox.processing || 0);
  const accepted = (outbox.accepted || 0) + countMessages({ status: ["sent", "accepted"], since });
  const delivered = countMessages({ status: "delivered", since });
  const read = countMessages({ status: "read", since });
  const inbound = countMessages({ direction: "inbound", since });
  const errors =
    (outbox.failed || 0) +
    (outbox.dead_letter || 0) +
    countMessages({ status: ["error", "failed"], since });
  const dryRun = outbox.dry_run || 0;
  const policyBlocked = outbox.policy_blocked || 0;

  const transports = getDatabase()
    .prepare(
      `SELECT transport, status, COUNT(*) AS c
       FROM communication_messages
       WHERE created_at >= ? AND direction = 'outbound'
       GROUP BY transport, status`
    )
    .all(since);

  const byChannel = {};
  for (const row of transports) {
    const key = row.transport || "unknown";
    if (!byChannel[key]) {
      byChannel[key] = {
        transport: key,
        sent: 0,
        delivered: 0,
        read: channelSupportsRead(key) ? 0 : null,
        readAvailable: channelSupportsRead(key),
        errors: 0,
        dryRun: 0,
      };
    }
    if (row.status === "read") {
      if (byChannel[key].readAvailable) byChannel[key].read += row.c;
    } else if (row.status === "delivered") byChannel[key].delivered += row.c;
    else if (["sent", "accepted"].includes(row.status)) byChannel[key].sent += row.c;
    else if (["error", "failed"].includes(row.status)) byChannel[key].errors += row.c;
    else if (row.status === "dry_run") byChannel[key].dryRun += row.c;
  }

  // Mark read as "Нет данных" for channels without receipts
  for (const ch of Object.values(byChannel)) {
    if (!ch.readAvailable) ch.read = "Нет данных";
  }

  const suppressions =
    getDatabase()
      .prepare(`SELECT COUNT(*) AS c FROM communication_suppressions WHERE active = 1`)
      .get()?.c || 0;

  const stoppedSequences =
    getDatabase()
      .prepare(
        `SELECT COUNT(*) AS c FROM communication_sequence_enrollments
         WHERE status LIKE 'stopped_%' AND stopped_at >= ?`
      )
      .get(since)?.c || 0;

  return {
    success: true,
    periodDays: sinceDays,
    funnel: {
      scheduled,
      sent: accepted,
      delivered,
      read: read > 0 ? read : "см. разбивку по каналам",
      reply: inbound,
      meetingAssigned: "только при реальном CRM-событии — не вычисляется автоматически",
    },
    totals: {
      accepted,
      delivered,
      read,
      inboundReplies: inbound,
      errors,
      dryRun,
      policyBlocked,
      suppressions,
      stoppedSequences,
    },
    byChannel: Object.values(byChannel),
    note: "Показатель «прочитано» только для транспортов, которые реально отдают read (например WABA/WhatsApp). Иначе — «Нет данных», не 0.",
  };
}

export function getUnansweredReport({ limit = 50 } = {}) {
  const threads = repo.listThreads({ unanswered: true, limit });
  return {
    success: true,
    count: threads.length,
    threads: threads.map((t) => ({
      id: t.id,
      contactId: t.contactId,
      channel: t.chatType || t.transport,
      lastInboundAt: t.lastInboundAt,
      preview: t.lastMessagePreview,
    })),
  };
}

export function getCommunicationsMetricsSummary() {
  const queue = repo.countOutboxByStatus();
  return {
    outbox: queue,
    templates: repo.listTemplates().length,
    campaignsRunning: repo.listCampaigns({ status: "running" }).length,
    sequencesActive: repo.listSequences({ status: "active" }).length,
  };
}
