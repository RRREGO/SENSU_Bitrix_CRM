import { escapeHtml } from "../../utils.js";

/**
 * @param {{ items: Array<{ label: string, href?: string, onClick?: string, current?: boolean }> }} opts
 */
export function renderBreadcrumbs({ items = [], compact = false } = {}) {
  if (!items.length) return "";
  const visible = compact && items.length > 2
    ? [items[0], { label: "…", current: false }, items[items.length - 1]]
    : items;

  return `<nav class="breadcrumbs" aria-label="Навигация">
    <ol class="breadcrumbs-list">
      ${visible
        .map((item, i) => {
          const isLast = i === visible.length - 1 || item.current;
          if (isLast || item.label === "…") {
            return `<li class="breadcrumbs-item${isLast ? " is-current" : ""}" ${isLast ? 'aria-current="page"' : ""}>
              <span>${escapeHtml(item.label)}</span>
            </li>`;
          }
          return `<li class="breadcrumbs-item">
            <button type="button" class="breadcrumbs-link" data-crumb="${escapeHtml(item.action || "")}" data-crumb-id="${escapeHtml(item.id || "")}">
              ${escapeHtml(item.label)}
            </button>
          </li>`;
        })
        .join('<li class="breadcrumbs-sep" aria-hidden="true">/</li>')}
    </ol>
  </nav>`;
}

export function wireBreadcrumbs(root, handlers = {}) {
  root?.querySelectorAll("[data-crumb]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.crumb;
      const id = btn.dataset.crumbId || null;
      if (action && typeof handlers[action] === "function") {
        handlers[action](id);
      }
    });
  });
}
