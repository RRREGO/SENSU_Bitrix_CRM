import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { formatBusinessHtml, formatBusinessText } from "../textFormatters.js";
import { renderReportHtml } from "../reports/reportRenderer.js";
import { reportToPlainText } from "../reports/reportNormalizer.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, "../../reports");

async function ensureReportsDir() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
}

function buildFileName(type) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}`;
  return `report-${stamp}-${type || "custom"}.html`;
}

/**
 * Сохраняет HTML-отчёт в reports/.
 */
export async function exportReportHtml({ report, html, prefix }) {
  await ensureReportsDir();

  const fileName = buildFileName(prefix || report?.type || "custom");
  const filePath = path.join(REPORTS_DIR, fileName);
  const content = html || formatBusinessHtml(renderReportHtml(report));

  await fs.writeFile(filePath, content, "utf8");

  return {
    fileName,
    file: `/reports/${fileName}`,
    path: filePath,
  };
}

/**
 * Экспорт из объекта report: генерирует HTML и сохраняет.
 */
export async function exportReportFromObject(report, options = {}) {
  const html = formatBusinessHtml(renderReportHtml(report, options));
  const saved = await exportReportHtml({ report, html, prefix: report.type });
  const text = reportToPlainText(report);

  return {
    ...saved,
    html,
    text,
  };
}
