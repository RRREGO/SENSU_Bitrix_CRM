/**
 * Нормализация единой хронологии клиента.
 */

import { getClientContextConfig } from "./config.js";
import { getField } from "./fieldAllowlists.js";

const LOW_VALUE_SYSTEM = /автоматическ|система изменила|workflow|bizproc|робот/i;

function activityTypeLabel(typeId) {
  const t = String(typeId || "");
  if (t === "1" || /call/i.test(t)) return "call";
  if (t === "2" || /meeting|visit/i.test(t)) return "meeting";
  if (t === "3" || /task/i.test(t)) return "task";
  if (t === "4" || /email/i.test(t)) return "email";
  return "activity";
}

function trimText(text, max = 500) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * @param {object} context — результат crm_context_get (сырые части до финальной сборки)
 * @param {{ mode?: 'compact'|'standard'|'full', userMap?: Map }} options
 */
export function buildClientTimeline(context, options = {}) {
  const cfg = getClientContextConfig();
  const mode = options.mode || "standard";
  const userMap = options.userMap || new Map();
  const maxEvents =
    mode === "compact" ? 15 : mode === "full" ? cfg.timelineMaxEvents : Math.min(80, cfg.timelineMaxEvents);

  const events = [];

  for (const a of context._rawActivities || []) {
    const id = getField(a, "ID", "id");
    const type = activityTypeLabel(getField(a, "TYPE_ID", "typeId", "PROVIDER_TYPE_ID"));
    const completed = String(getField(a, "COMPLETED", "completed") || "").toUpperCase();
    events.push({
      id: `crm_activity:${id}`,
      source: "crm_activity",
      type,
      direction: "unknown",
      occurredAt: getField(a, "START_TIME", "startTime", "CREATED", "created") || null,
      author: mapAuthor(getField(a, "RESPONSIBLE_ID", "responsibleId", "AUTHOR_ID"), userMap),
      title: trimText(getField(a, "SUBJECT", "subject") || "Дело CRM", 120),
      text: trimText(getField(a, "DESCRIPTION", "description") || "", 400),
      status: completed === "Y" || completed === "1" ? "completed" : "open",
      sensitive: false,
    });
  }

  for (const c of context._rawComments || []) {
    const id = getField(c, "ID", "id");
    const text = getField(c, "COMMENT", "comment", "TEXT", "text") || "";
    if (LOW_VALUE_SYSTEM.test(text)) continue;
    events.push({
      id: `timeline_comment:${id}`,
      source: "timeline_comment",
      type: "timeline_comment",
      direction: "internal",
      occurredAt: getField(c, "CREATED", "created", "DATE_CREATE") || null,
      author: mapAuthor(getField(c, "AUTHOR_ID", "authorId"), userMap),
      title: "Комментарий",
      text: trimText(text, 400),
      status: "completed",
      sensitive: false,
    });
  }

  for (const t of context._rawTasks || []) {
    const task = t.task || t;
    const id = getField(task, "id", "ID");
    events.push({
      id: `task:${id}`,
      source: "task",
      type: "task",
      direction: "internal",
      occurredAt: getField(task, "createdDate", "CREATED_DATE", "changedDate") || null,
      author: mapAuthor(getField(task, "responsibleId", "RESPONSIBLE_ID", "createdBy"), userMap),
      title: trimText(getField(task, "title", "TITLE") || "Задача", 120),
      text: trimText(getField(task, "description", "DESCRIPTION") || "", 300),
      status: String(getField(task, "status", "STATUS") || "") === "5" ? "completed" : "open",
      sensitive: false,
    });
  }

  for (const p of context._rawProtocols || []) {
    events.push({
      id: `meeting_protocol:${p.id}`,
      source: "meeting_protocol",
      type: "document",
      direction: "internal",
      occurredAt: p.createdAt || p.meetingDate || null,
      author: null,
      title: p.title || "Протокол встречи",
      text: trimText(p.summary || "", 300),
      status: "completed",
      sensitive: false,
    });
  }

  // Dedup by id + near-duplicate title/time
  const seen = new Set();
  let deduped = [];
  for (const ev of events) {
    if (!ev.id || seen.has(ev.id)) continue;
    seen.add(ev.id);
    deduped.push(ev);
  }

  deduped.sort((a, b) => String(b.occurredAt || "").localeCompare(String(a.occurredAt || "")));

  if (mode === "compact") {
    deduped = deduped.filter((e) =>
      ["meeting", "message", "email", "call", "timeline_comment", "document"].includes(e.type)
    );
  } else if (mode !== "full") {
    deduped = deduped.filter((e) => e.type !== "system");
  }

  const truncated = deduped.length > maxEvents;
  const timeline = deduped.slice(0, maxEvents);

  const lastMeaningful = timeline.find((e) =>
    ["meeting", "message", "email", "call", "timeline_comment"].includes(e.type)
  );

  return {
    timeline,
    truncated,
    lastMeaningfulInteractionAt: lastMeaningful?.occurredAt || null,
    lastMeaningfulInteraction: lastMeaningful || null,
  };
}

function mapAuthor(userId, userMap) {
  if (userId == null) return null;
  const id = Number(userId);
  const name = userMap.get(id) || userMap.get(String(userId)) || null;
  return { id, name };
}
