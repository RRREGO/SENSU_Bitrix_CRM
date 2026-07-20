import { apiGet, apiPost } from "../apiClient.js";
import { escapeHtml, reportToCopyText, openPrintWindow, downloadBlob } from "./utils.js";
import { parseRuDate } from "./dateUtils.js";

let currentDocument = null;
let sourceReportId = null;

const els = {};

export function initDocuments(elements, { onSwitchTab }) {
  Object.assign(els, elements);
  bindEvents({ onSwitchTab });
}

function bindEvents({ onSwitchTab }) {
  els.generateDocumentBtn?.addEventListener("click", () => generateDocument());
  els.docCopyBtn?.addEventListener("click", () => copyDocumentText());
  els.docExportHtmlBtn?.addEventListener("click", () => exportDocumentHtml());
  els.docPrintPdfBtn?.addEventListener("click", () => printDocumentPdf());
  els.docBackToReportBtn?.addEventListener("click", () => onSwitchTab("reports"));
}

export function showDocumentPreview(doc, reportId = null) {
  currentDocument = doc;
  sourceReportId = reportId;

  els.documentPreviewTitle.textContent = doc.title || "Документ";
  els.documentPreviewFrame.srcdoc = doc.html || "";
  els.documentStatus.textContent = doc.download?.html
    ? `Документ сохранён: ${doc.download.html}`
    : "Документ сформирован";

  els.docCopyBtn.disabled = !(doc.text || doc.html);
  els.docExportHtmlBtn.disabled = !doc.html;
  els.docPrintPdfBtn.disabled = !doc.html;
  els.docBackToReportBtn.disabled = !sourceReportId;
}

async function generateDocument() {
  els.generateDocumentBtn.disabled = true;
  els.documentStatus.textContent = "Формирование документа...";

  try {
    const type = els.documentType.value;
    const params = {
      categoryId: Number(els.documentCategoryId?.value) || 0,
      dateFrom: parseRuDate(els.documentDateFrom?.value) || undefined,
      dateTo: parseRuDate(els.documentDateTo?.value) || undefined,
    };

    const entityId = els.documentEntityId?.value?.trim();
    if (entityId) {
      if (type === "deal_summary" || type === "commercial_proposal") params.dealId = Number(entityId);
      else if (type === "meeting_protocol") {
        params.dealId = Number(entityId);
        params.entityId = Number(entityId);
        params.entityType = "deal";
      } else if (type === "task_report") params.taskId = Number(entityId);
    }

    const data = await apiPost("/documents/generate", { type, params });
    if (!data.ok) throw new Error(data.error);

    showDocumentPreview(data);
    loadSavedDocuments();
  } catch (error) {
    els.documentStatus.textContent = `Ошибка: ${error.message}`;
  } finally {
    els.generateDocumentBtn.disabled = false;
  }
}

async function copyDocumentText() {
  const text = currentDocument?.text || "";
  if (!text) return;
  await navigator.clipboard.writeText(text);
  els.docCopyBtn.textContent = "Скопировано";
  setTimeout(() => { els.docCopyBtn.textContent = "Скопировать текст"; }, 1500);
}

function exportDocumentHtml() {
  if (!currentDocument?.html) return;
  if (currentDocument.download?.html) {
    window.open(currentDocument.download.html, "_blank");
    return;
  }
  downloadBlob(currentDocument.html, `${currentDocument.documentId || "document"}.html`, "text/html");
}

function printDocumentPdf() {
  if (!currentDocument?.html) return;
  openPrintWindow(currentDocument.html, currentDocument.title);
}

export async function loadSavedDocuments() {
  try {
    const data = await apiGet("/documents/list");
    if (!data.ok) throw new Error(data.error);

    els.savedDocumentsList.innerHTML = "";
    if (!data.documents.length) {
      els.savedDocumentsList.innerHTML = '<p class="status-text">Сохранённых документов пока нет.</p>';
      return;
    }

    for (const doc of data.documents) {
      const item = document.createElement("div");
      item.className = "saved-item";
      item.innerHTML = `
        <span>${escapeHtml(doc.fileName)} <small>${escapeHtml(new Date(doc.updatedAt).toLocaleString("ru-RU"))}</small></span>
        <div class="saved-item-actions">
          <a href="${escapeHtml(doc.htmlUrl)}" target="_blank">Открыть HTML</a>
        </div>
      `;
      els.savedDocumentsList.appendChild(item);
    }
  } catch (error) {
    els.savedDocumentsList.innerHTML = `<p class="status-text">Ошибка: ${escapeHtml(error.message)}</p>`;
  }
}

export function onDocumentsTabOpen() {
  loadSavedDocuments();
}

export function getCurrentDocument() {
  return currentDocument;
}
