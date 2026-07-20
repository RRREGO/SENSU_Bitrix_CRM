const HISTORY_KEY = "bitrixReportHistory";
const MAX_ITEMS = 100;

export function loadReportHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveReportHistoryEntry(entry) {
  const history = loadReportHistory();
  history.unshift({
    id: entry.id || `hist-${Date.now()}`,
    type: entry.type,
    title: entry.title,
    period: entry.period || {},
    funnel: entry.funnel || null,
    status: entry.status || "success",
    documentUrl: entry.documentUrl || null,
    createdAt: entry.createdAt || new Date().toISOString(),
  });
  if (history.length > MAX_ITEMS) history.length = MAX_ITEMS;
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  return history;
}

export function clearReportHistory() {
  localStorage.removeItem(HISTORY_KEY);
}
