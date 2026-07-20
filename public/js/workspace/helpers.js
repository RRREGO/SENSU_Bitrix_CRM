import { escapeHtml } from "../utils.js";

export function escAttr(value) {
  return escapeHtml(String(value ?? ""));
}

export function formatRelativeDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((startToday - startDay) / 86400000);
  const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 0) return `Сегодня, ${time}`;
  if (diffDays === 1) return `Вчера, ${time}`;
  if (diffDays < 7) {
    return d.toLocaleDateString("ru-RU", { weekday: "short", day: "numeric", month: "short" });
  }
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

export function formatBytes(n) {
  if (!n && n !== 0) return "—";
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} КБ`;
  return `${(n / (1024 * 1024)).toFixed(1)} МБ`;
}

export const CRM_TYPE_LABELS = {
  deal: "Сделка",
  lead: "Лид",
  contact: "Контакт",
  company: "Компания",
  task: "Задача",
  funnel: "Воронка",
};

export const CRM_BINDING_TYPES = [
  { value: "deal", label: "Сделка" },
  { value: "lead", label: "Лид" },
  { value: "contact", label: "Контакт" },
  { value: "company", label: "Компания" },
  { value: "funnel", label: "Воронка" },
  { value: "task", label: "Задача" },
];

export function formatCrmBinding(binding) {
  if (!binding) return "";
  const typeLabel = CRM_TYPE_LABELS[binding.type] || binding.type || "CRM";
  if (binding.title) return `${typeLabel}: ${binding.title}`;
  return typeLabel;
}

export function renderPinMark(pinned) {
  return pinned ? `<span class="sidebar-pin-mark" title="Закреплено" aria-hidden="true"></span>` : "";
}

export const PROJECT_COLORS = [
  { key: "violet", label: "Фиолетовый" },
  { key: "teal", label: "Бирюзовый" },
  { key: "slate", label: "Серый" },
  { key: "amber", label: "Янтарный" },
  { key: "rose", label: "Розовый" },
];
