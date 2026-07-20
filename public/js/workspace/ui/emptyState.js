import { escapeHtml } from "../../utils.js";

/**
 * @param {{ title: string, text?: string, actionsHtml?: string, size?: 'sm'|'md'|'xl', flush?: boolean, inset?: boolean }} opts
 */
export function renderEmptyState({
  title,
  text = "",
  actionsHtml = "",
  size = "md",
  flush = false,
  inset = false,
} = {}) {
  const sizeClass = size ? ` empty-state--${size}` : "";
  const flushClass = flush ? " empty-state--flush" : "";
  const insetClass = inset ? " empty-state--inset" : "";
  return `<div class="empty-state${sizeClass}${flushClass}${insetClass}">
    <p class="empty-state-title">${escapeHtml(title)}</p>
    ${text ? `<p class="empty-state-text">${escapeHtml(text)}</p>` : ""}
    ${actionsHtml ? `<div class="empty-state-actions">${actionsHtml}</div>` : ""}
  </div>`;
}

/**
 * @param {{ title: string, text?: string, onRetry?: () => void }} opts
 */
export function renderErrorState({ title = "Не удалось загрузить", text = "", onRetry } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state empty-state--md";
  wrap.innerHTML = `
    <p class="empty-state-title">${escapeHtml(title)}</p>
    ${text ? `<p class="empty-state-text">${escapeHtml(text)}</p>` : ""}
    <div class="empty-state-actions">
      <button type="button" class="btn btn-secondary" data-retry>Повторить</button>
    </div>`;
  if (onRetry) {
    wrap.querySelector("[data-retry]")?.addEventListener("click", onRetry);
  }
  return wrap;
}
