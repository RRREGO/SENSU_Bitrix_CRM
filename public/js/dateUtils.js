export function formatIsoDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function formatRuDate(iso) {
  if (!iso) return "";
  const parts = String(iso).split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}.${parts[1]}.${parts[0]}`;
}

export function parseRuDate(ru) {
  if (!ru) return "";
  const trimmed = String(ru).trim();
  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return "";
  const day = match[1].padStart(2, "0");
  const month = match[2].padStart(2, "0");
  const year = match[3];
  return `${year}-${month}-${day}`;
}

export function todayIso() {
  return formatIsoDate(new Date());
}

export function addDaysIso(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return formatIsoDate(d);
}

export function getPeriodRange(preset) {
  const today = new Date();
  const todayStr = formatIsoDate(today);

  switch (preset) {
    case "today":
      return { dateFrom: todayStr, dateTo: todayStr };
    case "7days":
      return { dateFrom: addDaysIso(today, -6), dateTo: todayStr };
    case "30days":
      return { dateFrom: addDaysIso(today, -29), dateTo: todayStr };
    case "this_month": {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      return { dateFrom: formatIsoDate(first), dateTo: todayStr };
    }
    case "last_month": {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { dateFrom: formatIsoDate(first), dateTo: formatIsoDate(last) };
    }
    default:
      return { dateFrom: todayStr, dateTo: todayStr };
  }
}

export const PERIOD_PRESETS = [
  { id: "today", label: "Сегодня" },
  { id: "7days", label: "7 дней" },
  { id: "30days", label: "30 дней" },
  { id: "this_month", label: "Этот месяц" },
  { id: "last_month", label: "Прошлый месяц" },
];
