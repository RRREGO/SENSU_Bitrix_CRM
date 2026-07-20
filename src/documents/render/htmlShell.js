import { formatBusinessText } from "../../textFormatters.js";

const REPORT_CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 24px 16px;
    font-family: "Rubik", "Segoe UI", sans-serif;
    font-size: 14px;
    line-height: 1.6;
    color: #444444;
    background: #f0f0f0;
  }
  .doc-page {
    max-width: 820px;
    margin: 0 auto;
    background: #ffffff;
    padding: 40px 48px;
    border: 1px solid #e4e0ec;
    border-radius: 8px;
  }
  .doc-header {
    border-bottom: 2px solid #7a6aad;
    padding-bottom: 16px;
    margin-bottom: 24px;
  }
  .doc-title {
    margin: 0 0 8px;
    font-size: 22px;
    font-weight: 600;
    color: #5c4f8a;
    letter-spacing: 0.01em;
  }
  .doc-meta {
    margin: 0;
    font-size: 12px;
    color: #6e6e6e;
  }
  .doc-meta p { margin: 2px 0; }
  .doc-section { margin-bottom: 24px; }
  .doc-section h2 {
    margin: 0 0 12px;
    font-size: 15px;
    font-weight: 600;
    color: #5c4f8a;
    border-bottom: 1px solid #e4e0ec;
    padding-bottom: 6px;
  }
  .doc-section h3 {
    margin: 16px 0 8px;
    font-size: 14px;
    font-weight: 600;
    color: #444444;
  }
  .doc-section p { margin: 0 0 10px; }
  .doc-notice {
    color: #6e6e6e;
    font-style: italic;
  }
  table.doc-table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
  }
  table.doc-table th,
  table.doc-table td {
    border: 1px solid #e0dce8;
    padding: 8px 10px;
    text-align: left;
    vertical-align: top;
  }
  table.doc-table th {
    background: #f0f0f0;
    font-weight: 600;
    color: #5c4f8a;
  }
  table.doc-table tr:nth-child(even) td { background: #fafafa; }
  .doc-summary {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 12px;
    margin: 12px 0;
  }
  .doc-summary-item {
    border: 1px solid #e4e0ec;
    padding: 12px;
    background: #f8f8f8;
    border-radius: 6px;
  }
  .doc-summary-item .label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #7a6aad;
    margin-bottom: 4px;
  }
  .doc-summary-item .value {
    font-size: 17px;
    font-weight: 600;
    color: #444444;
  }
  .doc-footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #e4e0ec;
    font-size: 11px;
    color: #6e6e6e;
  }
  ul.doc-list { margin: 8px 0; padding-left: 20px; }
  ul.doc-list li { margin-bottom: 4px; }
`;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(value) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatPeriod(dateFrom, dateTo) {
  if (!dateFrom && !dateTo) return "не указан";
  const fmt = (d) => {
    if (!d) return "";
    const [y, m, day] = String(d).split("-");
    return day && m && y ? `${day}.${m}.${y}` : d;
  };
  const from = fmt(dateFrom);
  const to = fmt(dateTo);
  if (from && to) return `${from} — ${to}`;
  if (from) return `с ${from}`;
  return `по ${to}`;
}

/**
 * Оборачивает контент документа в строгий HTML-шаблон.
 */
export function wrapDocumentHtml({ title, bodyHtml, meta = {} }) {
  const safeTitle = escapeHtml(formatBusinessText(title));
  const generatedAt = formatDate(meta.generatedAt || new Date());
  const period = formatPeriod(meta.dateFrom, meta.dateTo);
  const source = formatBusinessText(meta.source || "Bitrix24");
  const funnelLine = meta.funnelName
    ? `<p>Воронка: ${escapeHtml(formatBusinessText(meta.funnelName))}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/print.css" media="print">
  <style>${REPORT_CSS}</style>
</head>
<body>
  <div class="doc-page">
  <header class="doc-header">
    <h1 class="doc-title">${safeTitle}</h1>
    <div class="doc-meta">
      <p>Дата формирования: ${escapeHtml(generatedAt)}</p>
      <p>Период отчёта: ${escapeHtml(period)}</p>
      ${funnelLine}
      <p>Источник данных: ${escapeHtml(source)}</p>
    </div>
  </header>
  <main>${bodyHtml}</main>
  <footer class="doc-footer">
    Документ сформирован автоматически. Источник: ${escapeHtml(source)}.
  </footer>
  </div>
</body>
</html>`;
}

export function renderSummaryGrid(items) {
  return `<div class="doc-summary">${items
    .map(
      (item) => `
    <div class="doc-summary-item">
      <div class="label">${escapeHtml(formatBusinessText(item.label))}</div>
      <div class="value">${escapeHtml(formatBusinessText(String(item.value)))}</div>
    </div>`
    )
    .join("")}</div>`;
}

export function renderTable(columns, rows) {
  const head = columns.map((col) => `<th>${escapeHtml(formatBusinessText(col.label))}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns
        .map((col) => {
          const raw = typeof col.render === "function" ? col.render(row) : row[col.key];
          return `<td>${escapeHtml(formatBusinessText(String(raw ?? "—")))}</td>`;
        })
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return `<table class="doc-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

export function renderSection(title, content) {
  return `<section class="doc-section"><h2>${escapeHtml(formatBusinessText(title))}</h2>${content}</section>`;
}

export function htmlToPlainText(html) {
  return formatBusinessText(
    html
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n")
      .replace(/<\/tr>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
  );
}
