import crypto from "crypto";
import { getDatabase } from "../index.js";
import {
  calculateNextRunAt,
  describeSchedule,
  validateCronExpression,
} from "../../scheduler/scheduleCalculator.js";
import { getSchedulerConfig, SchedulerError } from "../../scheduler/config.js";
import { assertKnownReportType, getScheduledReportDef } from "../../scheduler/reportRegistry.js";
import { DEFAULT_ALERT_RULES } from "../../scheduler/alertEvaluator.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function mapSchedule(row) {
  if (!row) return null;
  const s = {
    id: row.id,
    name: row.name,
    reportType: row.report_type,
    scheduleType: row.schedule_type,
    cronExpression: row.cron_expression,
    timezone: row.timezone,
    params: JSON.parse(row.params_json || "{}"),
    alertRules: JSON.parse(row.alert_rules_json || "[]"),
    narrativeEnabled: Boolean(row.narrative_enabled),
    isEnabled: Boolean(row.is_enabled),
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdByUserId: row.created_by_user_id || null,
    updatedByUserId: row.updated_by_user_id || null,
    scopeType: row.scope_type || null,
    scopeUserId: row.scope_user_id || null,
    audience: row.audience_json ? JSON.parse(row.audience_json) : null,
  };
  s.description = describeSchedule(s);
  return s;
}

export function listSchedules({ enabledOnly = false } = {}) {
  const rows = enabledOnly
    ? getDatabase()
        .prepare("SELECT * FROM report_schedules WHERE is_enabled = 1 ORDER BY next_run_at ASC")
        .all()
    : getDatabase().prepare("SELECT * FROM report_schedules ORDER BY updated_at DESC").all();
  return rows.map(mapSchedule);
}

export function getScheduleById(id) {
  return mapSchedule(getDatabase().prepare("SELECT * FROM report_schedules WHERE id = ?").get(id));
}

export function createSchedule(data = {}) {
  assertKnownReportType(data.reportType);
  const def = getScheduledReportDef(data.reportType);
  const cfg = getSchedulerConfig();
  const tz = data.timezone || cfg.timezone;
  const scheduleType = data.scheduleType || def.defaultScheduleType;
  const params = { ...def.defaultParams, ...(data.params || {}) };
  const alertRules = data.alertRules || def.defaultAlertRules || DEFAULT_ALERT_RULES;
  const cronExpression = data.cronExpression || null;

  if (scheduleType === "cron") {
    validateCronExpression(cronExpression, cfg.minIntervalMinutes);
  }

  const id = data.id || uid();
  const ts = now();
  const nextRunAt = calculateNextRunAt({
    scheduleType,
    timezone: tz,
    cronExpression,
    params,
  });

  getDatabase()
    .prepare(
      `INSERT INTO report_schedules (
        id, name, report_type, schedule_type, cron_expression, timezone,
        params_json, alert_rules_json, narrative_enabled, is_enabled,
        next_run_at, last_run_at, created_at, updated_at,
        created_by_user_id, updated_by_user_id, scope_type, scope_user_id, audience_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      data.name || def.name,
      data.reportType,
      scheduleType,
      cronExpression,
      tz,
      JSON.stringify(params),
      JSON.stringify(alertRules),
      data.narrativeEnabled ? 1 : 0,
      data.isEnabled === false ? 0 : 1,
      nextRunAt,
      ts,
      ts,
      data.createdByUserId || null,
      data.updatedByUserId || data.createdByUserId || null,
      data.scopeType || "company",
      data.scopeUserId || null,
      data.audience ? JSON.stringify(data.audience) : null
    );

  return getScheduleById(id);
}

export function updateSchedule(id, patch = {}) {
  const current = getScheduleById(id);
  if (!current) return null;
  if (patch.reportType) assertKnownReportType(patch.reportType);

  const cfg = getSchedulerConfig();
  const scheduleType = patch.scheduleType || current.scheduleType;
  const timezone = patch.timezone || current.timezone;
  const params = { ...current.params, ...(patch.params || {}) };
  const cronExpression =
    patch.cronExpression !== undefined ? patch.cronExpression : current.cronExpression;
  const alertRules = patch.alertRules || current.alertRules;
  const narrativeEnabled =
    patch.narrativeEnabled !== undefined ? Boolean(patch.narrativeEnabled) : current.narrativeEnabled;
  const isEnabled = patch.isEnabled !== undefined ? Boolean(patch.isEnabled) : current.isEnabled;
  const name = patch.name || current.name;
  const reportType = patch.reportType || current.reportType;

  if (scheduleType === "cron") {
    validateCronExpression(cronExpression, cfg.minIntervalMinutes);
  }

  const nextRunAt =
    patch.skipNextRecalc
      ? current.nextRunAt
      : calculateNextRunAt({ scheduleType, timezone, cronExpression, params });

  getDatabase()
    .prepare(
      `UPDATE report_schedules SET
        name = ?, report_type = ?, schedule_type = ?, cron_expression = ?, timezone = ?,
        params_json = ?, alert_rules_json = ?, narrative_enabled = ?, is_enabled = ?,
        next_run_at = ?, updated_at = ?,
        updated_by_user_id = COALESCE(?, updated_by_user_id),
        scope_type = COALESCE(?, scope_type),
        scope_user_id = COALESCE(?, scope_user_id),
        audience_json = COALESCE(?, audience_json)
       WHERE id = ?`
    )
    .run(
      name,
      reportType,
      scheduleType,
      cronExpression,
      timezone,
      JSON.stringify(params),
      JSON.stringify(alertRules),
      narrativeEnabled ? 1 : 0,
      isEnabled ? 1 : 0,
      nextRunAt,
      now(),
      patch.updatedByUserId || null,
      patch.scopeType !== undefined ? patch.scopeType : null,
      patch.scopeUserId !== undefined ? patch.scopeUserId : null,
      patch.audience !== undefined ? JSON.stringify(patch.audience) : null,
      id
    );

  return getScheduleById(id);
}

export function setScheduleEnabled(id, enabled) {
  return updateSchedule(id, { isEnabled: enabled });
}

export function touchScheduleRun(id, { lastRunAt, nextRunAt }) {
  getDatabase()
    .prepare(
      `UPDATE report_schedules SET last_run_at = ?, next_run_at = ?, updated_at = ? WHERE id = ?`
    )
    .run(lastRunAt || null, nextRunAt || null, now(), id);
}

export function seedDefaultSchedules() {
  try {
    const existing = getDatabase().prepare("SELECT COUNT(*) AS c FROM report_schedules").get().c;
    if (existing > 0) return listSchedules();
  } catch (error) {
    if (/no such table/i.test(error.message)) return [];
    throw error;
  }

  const cfg = getSchedulerConfig();
  const presets = [
    {
      id: "daily-director-brief",
      reportType: "daily_director_brief",
      name: "Ежедневная сводка руководителя",
      scheduleType: "daily",
      params: { hour: 8, minute: 0 },
    },
    {
      id: "weekly-sales-summary",
      reportType: "weekly_sales_summary",
      name: "Еженедельная сводка",
      scheduleType: "weekly",
      params: { hour: 8, minute: 0, dayOfWeek: 1 },
    },
    {
      id: "daily-birthday-control",
      reportType: "birthday_control",
      name: "Контроль дней рождения",
      scheduleType: "daily",
      params: { hour: 8, minute: 0, daysAhead: 7 },
    },
    {
      id: "daily-crm-discipline",
      reportType: "crm_discipline",
      name: "Дисциплина CRM",
      scheduleType: "daily",
      params: { hour: 8, minute: 0 },
    },
  ];

  for (const p of presets) {
    try {
      createSchedule({ ...p, timezone: cfg.timezone, narrativeEnabled: false });
    } catch (error) {
      if (error instanceof SchedulerError && error.code === "UNKNOWN_SCHEDULED_REPORT") throw error;
      console.warn("[Scheduler] seed skip:", error.message);
    }
  }
  return listSchedules();
}
