import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { getTemplate, listTemplates } from "./templates/index.js";
import { htmlToPlainText } from "./render/htmlShell.js";
import { formatBusinessHtml, formatBusinessText } from "../textFormatters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = path.resolve(__dirname, "../../reports");

async function ensureReportsDir() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
}

function createDocumentId(type) {
  const stamp = new Date().toISOString().slice(0, 10);
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${type}-${stamp}-${suffix}`;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Генерирует документ, сохраняет HTML и PDF в reports/.
 */
export async function generateDocument({ type, params = {} }) {
  const template = getTemplate(type);
  if (!template) {
    throw new Error(`Unknown document type: ${type}`);
  }

  const built = await template.build(params);
  const html = formatBusinessHtml(template.toHtml(built));
  const text = formatBusinessText(htmlToPlainText(html));
  const documentId = createDocumentId(type);
  const fileBase = `${slugify(type)}-${documentId}`;

  await ensureReportsDir();

  const htmlFileName = `${fileBase}.html`;
  const htmlPath = path.join(REPORTS_DIR, htmlFileName);

  await fs.writeFile(htmlPath, html, "utf8");

  return {
    documentId,
    title: formatBusinessText(built.title),
    html,
    text,
    download: {
      html: `/reports/${htmlFileName}`,
      pdf: null,
    },
    savedAt: new Date().toISOString(),
    type,
  };
}

export async function listSavedDocuments() {
  await ensureReportsDir();
  const files = await fs.readdir(REPORTS_DIR);
  const documents = [];

  for (const file of files) {
    if (!file.endsWith(".html")) continue;
    const stat = await fs.stat(path.join(REPORTS_DIR, file));
    const base = file.replace(/\.html$/, "");
    documents.push({
      id: base,
      fileName: file,
      title: file.replace(/\.html$/, "").replace(/-/g, " "),
      htmlUrl: `/reports/${file}`,
      pdfUrl: `/reports/${base}.pdf`,
      updatedAt: stat.mtime.toISOString(),
      size: stat.size,
    });
  }

  return documents.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export { listTemplates };
