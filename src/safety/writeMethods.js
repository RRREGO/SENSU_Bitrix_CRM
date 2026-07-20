/**
 * Классификация REST-методов Bitrix24: read vs write.
 * Неизвестный метод считается потенциально изменяющим.
 */

export const WRITE_METHOD_PATTERNS = [
  /\.add$/i,
  /\.update$/i,
  /\.delete$/i,
  /\.set$/i,
  /\.move$/i,
];

/** Явные write-методы вне шаблона суффиксов. */
export const EXPLICIT_WRITE_METHODS = new Set([
  "crm.deal.productrows.set",
  "crm.lead.productrows.set",
  "crm.item.update",
  "crm.item.add",
  "crm.item.delete",
  "tasks.task.complete",
  "tasks.task.approve",
  "tasks.task.disapprove",
  "tasks.task.defer",
  "tasks.task.start",
  "tasks.task.renew",
  "tasks.task.mute",
  "tasks.task.unmute",
  "task.checklistitem.complete",
  "task.checklistitem.renew",
  "im.message.update",
  "im.message.delete",
  "batch", // batch может содержать write — проверяется отдельно
]);

/** Явные read-методы (whitelist), даже если имя похоже на write. */
export const EXPLICIT_READ_METHODS = new Set([
  "crm.deal.get",
  "crm.lead.get",
  "crm.contact.get",
  "crm.company.get",
  "crm.item.get",
  "crm.item.list",
  "crm.item.fields",
  "crm.deal.list",
  "crm.lead.list",
  "crm.contact.list",
  "crm.company.list",
  "crm.deal.fields",
  "crm.lead.fields",
  "crm.contact.fields",
  "crm.company.fields",
  "crm.deal.productrows.get",
  "crm.lead.productrows.get",
  "crm.status.list",
  "crm.category.list",
  "crm.activity.list",
  "crm.activity.get",
  "crm.timeline.comment.list",
  "crm.timeline.list",
  "tasks.task.list",
  "tasks.task.get",
  "tasks.task.getFields",
  "user.get",
  "user.search",
  "department.get",
  "department.get.tree",
]);

/**
 * @returns {"read"|"write"|"unknown"}
 */
export function classifyBitrixMethod(method) {
  if (!method || typeof method !== "string") return "unknown";
  const name = method.trim();

  if (EXPLICIT_READ_METHODS.has(name)) return "read";
  if (EXPLICIT_WRITE_METHODS.has(name)) return "write";

  for (const pattern of WRITE_METHOD_PATTERNS) {
    if (pattern.test(name)) return "write";
  }

  // list/get/fields/search — обычно read
  if (/\.(list|get|fields|search)$/i.test(name)) return "read";

  return "unknown";
}

export function isWriteMethod(method) {
  const kind = classifyBitrixMethod(method);
  return kind === "write" || kind === "unknown";
}

export function isReadMethod(method) {
  return classifyBitrixMethod(method) === "read";
}

/**
 * Batch считается write, если хотя бы одна команда — write/unknown.
 * @param {Record<string, string>|Array} cmd
 */
export function batchContainsWrite(cmd) {
  const values = Array.isArray(cmd) ? cmd : Object.values(cmd || {});
  for (const entry of values) {
    const method = String(entry).split("?")[0].trim();
    if (isWriteMethod(method)) return true;
  }
  return false;
}
