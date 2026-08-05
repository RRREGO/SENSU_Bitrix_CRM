const CONFIRM_REPLIES = new Set([
  "да",
  "ага",
  "угу",
  "ок",
  "окей",
  "okay",
  "ok",
  "yes",
  "yep",
  "y",
  "создавай",
  "создать",
  "создай",
  "подтверждаю",
  "подтвердить",
  "выполняй",
  "выполни",
  "давай",
  "верно",
  "всё верно",
  "все верно",
  "согласен",
  "+",
  "ладно",
]);

const CANCEL_REPLIES = new Set([
  "нет",
  "не надо",
  "отмена",
  "отменить",
  "cancel",
  "стоп",
  "отказ",
  "не подтверждаю",
]);

/** Короткий ответ на Safety-preview: confirm | cancel | null. */
export function classifyConfirmationReply(text) {
  const t = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[.!?…]+$/g, "")
    .trim();
  if (!t) return null;
  if (CONFIRM_REPLIES.has(t)) return "confirm";
  if (CANCEL_REPLIES.has(t)) return "cancel";
  return null;
}
