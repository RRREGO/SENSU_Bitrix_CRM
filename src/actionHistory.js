const MAX_HISTORY = 500;
const history = [];

/**
 * Записать выполненное действие в историю.
 */
export function logAction({ sessionId, action, params, status, error = null }) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    sessionId: sessionId || "default",
    action,
    params,
    status,
    error,
    timestamp: new Date().toISOString(),
  };

  history.unshift(entry);
  if (history.length > MAX_HISTORY) {
    history.length = MAX_HISTORY;
  }

  return entry;
}

/**
 * Получить историю действий.
 */
export function getActionHistory({ sessionId, limit = 50 } = {}) {
  let items = history;

  if (sessionId) {
    items = items.filter((item) => item.sessionId === sessionId);
  }

  return items.slice(0, Math.min(limit, 200));
}
