import { escapeHtml } from "../../utils.js";

/**
 * @param {{ tabs: Array<{ id: string, label: string }>, active: string, name?: string }} opts
 */
export function renderFilterTabs({ tabs = [], active = "", name = "filter" } = {}) {
  return `<div class="filter-tabs" role="tablist" data-filter-name="${escapeHtml(name)}">
    ${tabs
      .map(
        (t) =>
          `<button type="button" class="filter-tab${t.id === active ? " active" : ""}" role="tab" aria-selected="${t.id === active ? "true" : "false"}" data-filter="${escapeHtml(t.id)}">${escapeHtml(t.label)}</button>`
      )
      .join("")}
  </div>`;
}

export function wireFilterTabs(root, onChange) {
  root?.querySelectorAll("[data-filter]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.filter;
      root.querySelectorAll("[data-filter]").forEach((el) => {
        const on = el.dataset.filter === id;
        el.classList.toggle("active", on);
        el.setAttribute("aria-selected", on ? "true" : "false");
      });
      onChange?.(id);
    });
  });
}
