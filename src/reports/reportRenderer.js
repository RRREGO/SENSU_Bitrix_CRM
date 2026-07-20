import {
  wrapDocumentHtml,
  renderSummaryGrid,
  renderSection,
} from "../documents/render/htmlShell.js";
import { formatBusinessText } from "../textFormatters.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderTableBlock(table) {
  const head = table.columns.map((col) => `<th>${escapeHtml(formatBusinessText(col))}</th>`).join("");
  const body = table.rows
    .map((row) => {
      const cells = row
        .map((cell) => `<td>${escapeHtml(formatBusinessText(String(cell ?? "—")))}</td>`)
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `${renderSection(
    table.title,
    `<table class="doc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  )}`;
}

/**
 * Рендер единого отчёта в HTML-документ.
 */
export function renderReportHtml(report, options = {}) {
  const style = options.documentStyle || "strict";
  const parts = [];

  if (report.funnel?.name) {
    parts.push(
      renderSection("Воронка", `<p>${escapeHtml(formatBusinessText(report.funnel.name))}</p>`)
    );
  }

  if (report.summary?.length) {
    parts.push(
      renderSection(
        "Краткая сводка",
        renderSummaryGrid(
          report.summary.map((item) => ({
            label: item.label,
            value: item.value,
          }))
        )
      )
    );
  }

  for (const section of report.sections || []) {
    const content =
      style === "brief"
        ? `<p>${escapeHtml(formatBusinessText(section.content)).slice(0, 280)}</p>`
        : `<p>${escapeHtml(formatBusinessText(section.content))}</p>`;
    parts.push(renderSection(section.title, content));
  }

  for (const table of report.tables || []) {
    parts.push(renderTableBlock(table));
  }

  if (report.recommendations?.length && style !== "brief") {
    const list = report.recommendations
      .map((item) => `<li>${escapeHtml(formatBusinessText(item))}</li>`)
      .join("");
    parts.push(renderSection("Рекомендации", `<ul class="doc-list">${list}</ul>`));
  }

  if (!report.implemented) {
    parts.push(
      renderSection(
        "Статус",
        `<p class="doc-notice">${escapeHtml(formatBusinessText("Этот отчёт зарегистрирован, но пока не реализован."))}</p>`
      )
    );
  }

  return wrapDocumentHtml({
    title: report.title,
    bodyHtml: parts.join(""),
    meta: {
      generatedAt: report.createdAt,
      dateFrom: report.period?.dateFrom,
      dateTo: report.period?.dateTo,
      source: report.source || "Bitrix24",
      funnelName: report.funnel?.name,
    },
  });
}

/**
 * Фрагмент HTML для встроенного предпросмотра на странице отчётов.
 */
export function renderReportPreviewFragment(report) {
  const summaryHtml = report.summary?.length
    ? `<div class="report-summary-grid">${report.summary
        .map(
          (item) => `
        <div class="report-summary-item">
          <div class="report-summary-label">${escapeHtml(item.label)}</div>
          <div class="report-summary-value">${escapeHtml(String(item.value))}</div>
        </div>`
        )
        .join("")}</div>`
    : "";

  const sectionsHtml = (report.sections || [])
    .map(
      (s) => `
      <div class="report-section">
        <h4>${escapeHtml(s.title)}</h4>
        <p>${escapeHtml(s.content)}</p>
      </div>`
    )
    .join("");

  const tablesHtml = (report.tables || [])
    .map((table) => {
      const head = table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("");
      const rows = table.rows
        .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`)
        .join("");
      return `
        <div class="report-table-block">
          <h4>${escapeHtml(table.title)}</h4>
          <table class="data-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
        </div>`;
    })
    .join("");

  const recsHtml = report.recommendations?.length
    ? `<div class="report-section"><h4>Рекомендации</h4><ul>${report.recommendations
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ul></div>`
    : "";

  return `
    <div class="report-result-meta">
      <p><strong>Период:</strong> ${escapeHtml(report.period?.dateFrom || "—")} — ${escapeHtml(report.period?.dateTo || "—")}</p>
      ${report.funnel?.name ? `<p><strong>Воронка:</strong> ${escapeHtml(report.funnel.name)}</p>` : ""}
      <p><strong>Источник:</strong> ${escapeHtml(report.source || "Bitrix24")}</p>
    </div>
    ${summaryHtml}
    ${sectionsHtml}
    ${tablesHtml}
    ${recsHtml}
  `;
}
