/**
 * Расчёт next_run_at в IANA timezone без внешних зависимостей.
 */

import { getSchedulerConfig, SchedulerError } from "./config.js";

const DOW_MAP = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/** Части даты/времени в заданной TZ */
export function getZonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(date).filter((p) => p.type !== "literal").map((p) => [p.type, p.value])
  );
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: weekdayMap[parts.weekday] ?? 0,
  };
}

/** Примерный UTC Date для локальных Y-M-D H:M в TZ (итеративная коррекция) */
export function zonedLocalToUtc(y, m, d, h, min, timeZone) {
  let guess = new Date(Date.UTC(y, m - 1, d, h, min, 0));
  for (let i = 0; i < 3; i++) {
    const p = getZonedParts(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const want = Date.UTC(y, m - 1, d, h, min, 0);
    guess = new Date(guess.getTime() + (want - asUtc));
  }
  return guess;
}

export function formatIsoInZone(date, timeZone) {
  const p = getZonedParts(date, timeZone);
  // offset via difference vs UTC parts
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMin = Math.round((asUtc - date.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}:${String(p.second).padStart(2, "0")}${sign}${oh}:${om}`;
}

function addDaysYmd(y, m, d, days) {
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() };
}

/**
 * @param {{ scheduleType, timezone, cronExpression?, params?: { hour?, minute?, dayOfWeek?, dayOfMonth? } }} schedule
 * @param {Date} [from]
 */
export function calculateNextRunAt(schedule, from = new Date()) {
  const cfg = getSchedulerConfig();
  const tz = schedule.timezone || cfg.timezone;
  const params = schedule.params || {};
  const hour = Number(params.hour ?? 8);
  const minute = Number(params.minute ?? 0);
  const type = schedule.scheduleType || schedule.schedule_type;

  if (type === "cron") {
    return nextFromCron(schedule.cronExpression || schedule.cron_expression, tz, from, cfg.minIntervalMinutes);
  }

  const now = getZonedParts(from, tz);

  if (type === "daily") {
    let cand = zonedLocalToUtc(now.year, now.month, now.day, hour, minute, tz);
    if (cand.getTime() <= from.getTime()) {
      const n = addDaysYmd(now.year, now.month, now.day, 1);
      cand = zonedLocalToUtc(n.year, n.month, n.day, hour, minute, tz);
    }
    return formatIsoInZone(cand, tz);
  }

  if (type === "weekly") {
    let targetDow = params.dayOfWeek;
    if (typeof targetDow === "string") targetDow = DOW_MAP[targetDow.toLowerCase()] ?? 1;
    targetDow = Number(targetDow ?? 1);
    let delta = (targetDow - now.weekday + 7) % 7;
    let cand = zonedLocalToUtc(now.year, now.month, now.day, hour, minute, tz);
    if (delta === 0 && cand.getTime() <= from.getTime()) delta = 7;
    if (delta > 0) {
      const n = addDaysYmd(now.year, now.month, now.day, delta);
      cand = zonedLocalToUtc(n.year, n.month, n.day, hour, minute, tz);
    }
    return formatIsoInZone(cand, tz);
  }

  if (type === "monthly") {
    const dom = Math.min(28, Math.max(1, Number(params.dayOfMonth ?? 1)));
    let y = now.year;
    let m = now.month;
    let cand = zonedLocalToUtc(y, m, dom, hour, minute, tz);
    if (cand.getTime() <= from.getTime()) {
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
      cand = zonedLocalToUtc(y, m, dom, hour, minute, tz);
    }
    return formatIsoInZone(cand, tz);
  }

  throw new SchedulerError("INVALID_SCHEDULE_TYPE", `Неизвестный schedule_type: ${type}`);
}

/** Ограниченный cron: "m h * * dow" или "m h * * *" */
export function validateCronExpression(expr, minIntervalMinutes = 15) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new SchedulerError("INVALID_CRON", "Ожидается 5 полей cron: m h dom mon dow");
  }
  const [m, h, dom, mon, dow] = parts;
  if (dom !== "*" || mon !== "*") {
    throw new SchedulerError("INVALID_CRON", "Поддерживается только * в полях дня месяца и месяца");
  }
  if (m === "*" || h === "*") {
    throw new SchedulerError(
      "INVALID_CRON",
      `Cron чаще ${minIntervalMinutes} минут запрещён: укажите конкретные минуту и час`
    );
  }
  const minute = Number(m);
  const hour = Number(h);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new SchedulerError("INVALID_CRON", "Некорректная минута");
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new SchedulerError("INVALID_CRON", "Некорректный час");
  }
  if (dow !== "*" && !/^([0-6](,[0-6])*)$/.test(dow)) {
    throw new SchedulerError("INVALID_CRON", "dow: * или список 0-6");
  }
  return { minute, hour, dow };
}

function nextFromCron(expr, tz, from, minInterval) {
  const { minute, hour, dow } = validateCronExpression(expr, minInterval);
  const allowed =
    dow === "*"
      ? null
      : new Set(dow.split(",").map((x) => Number(x)));
  let cursor = new Date(from.getTime());
  for (let i = 0; i < 400; i++) {
    const p = getZonedParts(cursor, tz);
    const cand = zonedLocalToUtc(p.year, p.month, p.day, hour, minute, tz);
    const okDow = !allowed || allowed.has(p.weekday);
    if (okDow && cand.getTime() > from.getTime()) {
      return formatIsoInZone(cand, tz);
    }
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  throw new SchedulerError("INVALID_CRON", "Не удалось рассчитать next_run_at");
}

export function describeSchedule(schedule) {
  const type = schedule.scheduleType || schedule.schedule_type;
  const p = schedule.params || {};
  const tz = schedule.timezone || getSchedulerConfig().timezone;
  const hm = `${String(p.hour ?? 8).padStart(2, "0")}:${String(p.minute ?? 0).padStart(2, "0")}`;
  if (type === "daily") return `Ежедневно в ${hm} (${tz})`;
  if (type === "weekly") return `Еженедельно (день ${p.dayOfWeek ?? 1}) в ${hm} (${tz})`;
  if (type === "monthly") return `Ежемесячно (день ${p.dayOfMonth ?? 1}) в ${hm} (${tz})`;
  if (type === "cron") return `Cron: ${schedule.cronExpression || schedule.cron_expression} (${tz})`;
  return type;
}

export function buildIdempotencyKey(scheduleId, scheduledFor) {
  return `${scheduleId}:${scheduledFor}`;
}

/** Просроченный запуск в пределах grace — вернуть scheduledFor, иначе null */
export function resolveMisfire(schedule, now = new Date()) {
  const cfg = getSchedulerConfig();
  const next = schedule.nextRunAt || schedule.next_run_at;
  if (!next) return { action: "skip", reason: "no_next" };
  const due = new Date(next);
  if (Number.isNaN(due.getTime())) return { action: "skip", reason: "invalid_next" };
  if (due.getTime() > now.getTime()) return { action: "wait" };
  const delayMin = (now.getTime() - due.getTime()) / 60000;
  if (delayMin <= cfg.misfireGraceMinutes) {
    return { action: "run", scheduledFor: next };
  }
  return { action: "skip_old", scheduledFor: next, delayMin };
}
