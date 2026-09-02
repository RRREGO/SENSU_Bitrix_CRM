import { escapeHtml } from "./utils.js";

export function labelOf(map, key, fallback = "—") {
  if (key == null || key === "") return fallback;
  const k = String(key);
  return map[k] ?? map[k.toLowerCase()] ?? k;
}

export function optionList(values, labels, selected) {
  return values
    .map((v) => {
      const sel = String(v) === String(selected ?? "") ? " selected" : "";
      return `<option value="${escapeHtml(String(v))}"${sel}>${escapeHtml(labels[v] || String(v))}</option>`;
    })
    .join("");
}

export const ROLE_LABELS = {
  manager: "Менеджер",
  director: "Директор",
  analyst: "Аналитик",
  viewer: "Наблюдатель",
  administrator: "Администратор",
};

export const SCOPE_LABELS = {
  own: "Только свои данные",
  all: "Все данные",
};

export const CHANNEL_LABELS = {
  whatsapp: "WhatsApp",
  waba: "WhatsApp Business",
  wapi: "WhatsApp Business",
  telegram: "Telegram",
  tgapi: "Telegram",
  max: "MAX",
  viber: "Viber",
  instagram: "Instagram",
  email: "Электронная почта",
  wazzup: "Wazzup",
};

export const TEMPLATE_CATEGORY_LABELS = {
  warmup: "Прогрев",
  cycle: "Цикл",
  follow_up: "Повторное касание",
  meeting_summary: "Итоги встречи",
  birthday: "День рождения",
  holiday: "Праздник",
  personal_congratulation: "Личное поздравление",
  meeting_invitation: "Приглашение на встречу",
  newsletter: "Рассылка",
  service: "Сервисное",
};

export const DELAY_UNIT_LABELS = {
  minutes: "минуты",
  hours: "часы",
  days: "дни",
};

export const TEMPLATE_STATUS_LABELS = {
  draft: "черновик",
  active: "активен",
  archived: "в архиве",
};

export const CERT_STEP_LABELS = {
  connection: "соединение",
  webhook: "вебхук",
  single_send: "одиночная отправка",
  campaign: "кампания",
  sequence: "цепочка",
};

export const OPERATION_STATUS_LABELS = {
  pending: "ожидает",
  prepared: "подготовлено",
  confirmed: "подтверждено",
  committed: "выполнено",
  success: "успешно",
  failed: "ошибка",
  cancelled: "отменено",
  canceled: "отменено",
  rollback_conflict: "конфликт отката",
  error: "ошибка",
};

export const SEVERITY_LABELS = {
  critical: "критическое",
  warning: "предупреждение",
  info: "информация",
  error: "ошибка",
};

export const SCHEDULE_RUN_STATUS_LABELS = {
  queued: "в очереди",
  running: "выполняется",
  success: "успешно",
  failed: "ошибка",
  skipped: "пропущено",
};
