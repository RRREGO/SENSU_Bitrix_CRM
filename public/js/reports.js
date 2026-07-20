import { apiFetch, apiGet, apiPost } from "../apiClient.js";
import {
  formatRuDate,
  parseRuDate,
  getPeriodRange,
  PERIOD_PRESETS,
} from "./dateUtils.js";
import { getDocumentStyle } from "./settings.js";
import { saveReportHistoryEntry, loadReportHistory } from "./reportHistory.js";
import { escapeHtml, reportToCopyText, reportToMarkdown, openPrintWindow, downloadBlob } from "./utils.js";

let funnels = [];
let selectedPeriodPreset = "7days";
let currentReport = null;
let currentReportHtml = "";
let currentReportText = "";
let currentReportId = null;

const els = {};

export function initReports(elements, { onOpenDocument, onSwitchTab }) {
  Object.assign(els, elements);
  els.periodPresets.innerHTML = PERIOD_PRESETS.map(
    (p) => `<button type="button" class="period-btn" data-preset="${p.id}">${escapeHtml(p.label)}</button>`
  ).join("");

  applyPeriodPreset("7days");
  bindEvents({ onOpenDocument, onSwitchTab });
}

function bindEvents({ onOpenDocument, onSwitchTab }) {
  els.periodPresets.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-preset]");
    if (!btn) return;
    applyPeriodPreset(btn.dataset.preset);
  });

  els.reportDateFrom.addEventListener("change", () => {
    selectedPeriodPreset = "";
    updatePeriodButtons();
    syncIsoFromRu();
  });
  els.reportDateTo.addEventListener("change", () => {
    selectedPeriodPreset = "";
    updatePeriodButtons();
    syncIsoFromRu();
  });

  els.quickReportsGrid.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-id]");
    if (!btn || btn.disabled) return;
    const reportId = btn.dataset.id;
    const asDocument = btn.dataset.action === "document";
    await runReport(reportId, asDocument, { onOpenDocument, onSwitchTab });
  });

  els.reportOpenDocBtn?.addEventListener("click", () => openAsDocument({ onOpenDocument, onSwitchTab }));
  els.reportExportHtmlBtn?.addEventListener("click", () => exportReportHtml());
  els.reportPrintPdfBtn?.addEventListener("click", () => printReportPdf());
  els.reportExportMdBtn?.addEventListener("click", () => exportReportMarkdown());
  els.reportCopyBtn?.addEventListener("click", () => copyReportText());
  els.reportBitrixBtn?.addEventListener("click", () => {
    alert("Добавление в Bitrix24 доступно для отчётов по конкретной сделке или лиду.");
  });
}

export async function onReportsTabOpen() {
  await loadFunnels();
  await loadQuickReports();
  setResultState("empty");
}

async function loadFunnels() {
  els.funnelSelect.innerHTML = '<option value="">Загрузка...</option>';
  els.funnelError?.classList.add("hidden");

  try {
    const { ok, data } = await apiFetch("/bitrix/action", {
      method: "POST",
      body: { action: "deal_category_list", params: {} },
    });
    if (!ok || !data.ok) {
      const errMsg =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || "Ошибка загрузки";
      throw new Error(errMsg);
    }

    const list = Array.isArray(data.result) ? data.result : data.result?.categories || [];
    funnels = list.map((item) => ({
      id: Number(item.id ?? item.ID ?? 0),
      name: item.name || item.NAME || `Воронка ${item.id ?? item.ID}`,
    }));

    if (!funnels.length) {
      funnels = [{ id: 0, name: "Общая воронка" }];
    }

    els.funnelSelect.innerHTML = funnels
      .map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`)
      .join("");

    const defaultFunnel = funnels.find((f) => f.id === 0) || funnels[0];
    els.funnelSelect.value = String(defaultFunnel.id);
  } catch (error) {
    els.funnelSelect.innerHTML = '<option value="0">Общая воронка</option>';
    els.funnelError?.classList.remove("hidden");
    if (els.funnelErrorText) els.funnelErrorText.textContent = "Не удалось загрузить список воронок";
    funnels = [{ id: 0, name: "Общая воронка" }];
  }
}

function getSelectedFunnel() {
  const manualId = els.funnelManualId?.value?.trim();
  const advancedOpen = els.advancedBlock?.open || els.advancedBlock?.classList?.contains("open");
  if (manualId && advancedOpen) {
    const found = funnels.find((f) => String(f.id) === manualId);
    return { id: Number(manualId), name: found?.name || `Воронка ${manualId}` };
  }
  const id = Number(els.funnelSelect.value);
  const found = funnels.find((f) => f.id === id);
  return { id, name: found?.name || `Воронка ${id}` };
}

function syncIsoFromRu() {
  els.reportDateFromIso.value = parseRuDate(els.reportDateFrom.value) || "";
  els.reportDateToIso.value = parseRuDate(els.reportDateTo.value) || "";
}

function setRuDates(dateFrom, dateTo) {
  els.reportDateFrom.value = formatRuDate(dateFrom);
  els.reportDateTo.value = formatRuDate(dateTo);
  els.reportDateFromIso.value = dateFrom;
  els.reportDateToIso.value = dateTo;
}

function applyPeriodPreset(preset) {
  selectedPeriodPreset = preset;
  const range = getPeriodRange(preset);
  setRuDates(range.dateFrom, range.dateTo);
  updatePeriodButtons();
}

function updatePeriodButtons() {
  els.periodPresets.querySelectorAll(".period-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === selectedPeriodPreset);
  });
}

export function getReportParams() {
  syncIsoFromRu();
  const funnel = getSelectedFunnel();
  return {
    params: {
      categoryId: funnel.id,
      dateFrom: els.reportDateFromIso.value || undefined,
      dateTo: els.reportDateToIso.value || undefined,
      daysAhead: 30,
      inactiveDays: 14,
    },
    funnel,
  };
}

async function loadQuickReports() {
  try {
    const data = await apiGet("/reports/quick");
    if (!data.ok) throw new Error(data.error);

    els.quickReportsGrid.innerHTML = "";
    for (const report of data.reports) {
      const card = document.createElement("div");
      card.className = "report-card";
      const stubNote = report.implemented === false
        ? '<p class="report-card-stub">Этот отчёт зарегистрирован, но пока не реализован.</p>'
        : "";
      card.innerHTML = `
        <h3>${escapeHtml(report.title)}</h3>
        <p>${escapeHtml(report.description)}</p>
        ${stubNote}
        <div class="report-card-actions">
          <button type="button" class="btn btn-primary" data-action="run" data-id="${escapeHtml(report.id)}">Сформировать</button>
          <button type="button" class="btn btn-secondary" data-action="document" data-id="${escapeHtml(report.id)}" ${report.documentType ? "" : ""}>Документ</button>
        </div>
      `;
      els.quickReportsGrid.appendChild(card);
    }
  } catch (error) {
    els.quickReportsGrid.innerHTML = `<p class="status-text">Ошибка загрузки: ${escapeHtml(error.message)}</p>`;
  }
}

async function runReport(reportId, asDocument, { onOpenDocument, onSwitchTab }) {
  setResultState("loading");
  currentReportId = reportId;

  try {
    const { params, funnel } = getReportParams();
    const data = await apiPost(`/reports/quick/${reportId}/run`, {
      params,
      funnel,
      asDocument,
      documentStyle: getDocumentStyle(),
    });
    if (!data.ok) throw new Error(data.error);

    if (asDocument && data.document) {
      saveReportHistoryEntry({
        id: data.report?.id,
        type: data.report?.type,
        title: data.report?.title,
        period: data.report?.period,
        funnel: data.report?.funnel,
        status: "success",
        documentUrl: data.document.download?.html,
      });
      onOpenDocument(data.document, reportId);
      onSwitchTab("documents");
      return;
    }

    currentReport = data.report;
    currentReportHtml = data.html || "";
    currentReportText = data.text || reportToCopyText(data.report);

    saveReportHistoryEntry({
      id: data.report.id,
      type: data.report.type,
      title: data.report.title,
      period: data.report.period,
      funnel: data.report.funnel,
      status: "success",
      documentUrl: null,
    });

    renderReportResult(data.report);
    setResultState("success");
    updateResultActions(data.report);
  } catch (error) {
    setResultState("error", error.message);
  }
}

function setResultState(state, message) {
  els.reportResultEmpty?.classList.toggle("hidden", state !== "empty");
  els.reportResultLoading?.classList.toggle("hidden", state !== "loading");
  els.reportResultError?.classList.toggle("hidden", state !== "error");
  els.reportResultSuccess?.classList.toggle("hidden", state !== "success");

  if (state === "error" && els.reportResultErrorText) {
    els.reportResultErrorText.textContent = message || "Ошибка формирования отчёта";
  }
}

function renderReportResult(report) {
  els.reportResultTitle.textContent = report.title;

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

  const metaHtml = `
    <div class="report-result-meta">
      <p><span>Период:</span> ${escapeHtml(formatRuDate(report.period?.dateFrom))} — ${escapeHtml(formatRuDate(report.period?.dateTo))}</p>
      ${report.funnel?.name ? `<p><span>Воронка:</span> ${escapeHtml(report.funnel.name)}</p>` : ""}
      <p><span>Источник:</span> ${escapeHtml(report.source || "Bitrix24")}</p>
    </div>`;

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
    ? `<div class="report-section"><h4>Рекомендации</h4><ul class="report-recs">${report.recommendations
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ul></div>`
    : "";

  els.reportResultBody.innerHTML = metaHtml + summaryHtml + sectionsHtml + tablesHtml + recsHtml;
}

function updateResultActions(report) {
  const hasEntity = false;
  els.reportBitrixBtn.disabled = !hasEntity;
  els.reportBitrixBtn.title = hasEntity ? "" : "Доступно для отчётов по конкретной сделке или лиду";
}

async function openAsDocument({ onOpenDocument, onSwitchTab }) {
  if (!currentReportId) return;
  await runReport(currentReportId, true, { onOpenDocument, onSwitchTab });
}

async function exportReportHtml() {
  if (!currentReport) return;
  try {
    const data = await apiPost("/documents/export-html", {
      report: currentReport,
      documentStyle: getDocumentStyle(),
    });
    if (!data.ok) throw new Error(data.error);
    window.open(data.file, "_blank");
    saveReportHistoryEntry({
      ...currentReport,
      documentUrl: data.file,
      status: "exported",
    });
  } catch (error) {
    if (currentReportHtml) {
      downloadBlob(currentReportHtml, `report-${currentReport.type}.html`, "text/html");
    } else {
      alert(`Ошибка экспорта: ${error.message}`);
    }
  }
}

function printReportPdf() {
  if (!currentReportHtml) return;
  openPrintWindow(currentReportHtml, currentReport?.title);
}

function exportReportMarkdown() {
  if (!currentReport) return;
  const md = reportToMarkdown(currentReport);
  const slug = String(currentReport.type || currentReport.id || "report").replace(/[^\w.-]+/g, "-");
  downloadBlob(md, `report-${slug}.md`, "text/markdown;charset=utf-8");
}

async function copyReportText() {
  const text = currentReportText || (currentReport ? reportToCopyText(currentReport) : "");
  if (!text) return;
  await navigator.clipboard.writeText(text);
  els.reportCopyBtn.textContent = "Скопировано";
  setTimeout(() => { els.reportCopyBtn.textContent = "Скопировать текст"; }, 1500);
}

export function getCurrentReport() {
  return currentReport;
}

export { loadReportHistory };
