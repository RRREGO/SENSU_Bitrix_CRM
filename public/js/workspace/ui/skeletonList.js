/**
 * @param {{ rows?: number }} opts
 */
export function renderSkeletonList({ rows = 5 } = {}) {
  const items = Array.from({ length: rows }, () =>
    `<li class="skeleton-row" aria-hidden="true">
      <span class="skeleton-line skeleton-line--title"></span>
      <span class="skeleton-line skeleton-line--meta"></span>
    </li>`
  ).join("");
  return `<ul class="skeleton-list" role="status" aria-label="Загрузка">${items}</ul>`;
}
