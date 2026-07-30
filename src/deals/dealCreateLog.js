import crypto from "crypto";
import { redactObject } from "../safety/redact.js";

export function newDealCreateActionId() {
  return crypto.randomUUID();
}

export function maskUserQuery(query) {
  if (!query || typeof query !== "string") return "[empty]";
  const trimmed = query.trim();
  if (trimmed.length <= 2) return "[masked]";
  return `${trimmed.slice(0, 1)}***${trimmed.slice(-1)}`;
}

export function logBeforeBitrixDealAdd(actionId, fields) {
  logDealCreateStep({
    actionId,
    step: "before_bitrix_write",
    method: "crm.deal.add",
    payloadSafe: {
      TITLE: fields.TITLE,
      ASSIGNED_BY_ID: fields.ASSIGNED_BY_ID,
      CATEGORY_ID: fields.CATEGORY_ID,
      STAGE_ID: fields.STAGE_ID,
    },
  });
}

export function logDealCreateStep(payload) {
  const safe = redactObject({
    ...payload,
    userQuery: payload.userQuery != null ? maskUserQuery(payload.userQuery) : undefined,
  });
  console.log(JSON.stringify({ operation: "deal.create", ...safe }));
}

export function logDealCreateError(payload) {
  const safe = redactObject({
    ...payload,
    userQuery: payload.userQuery != null ? maskUserQuery(payload.userQuery) : undefined,
    stack: payload.stack ? String(payload.stack).split("\n").slice(0, 8).join("\n") : undefined,
  });
  console.error(JSON.stringify({ operation: "deal.create", level: "error", ...safe }));
}
