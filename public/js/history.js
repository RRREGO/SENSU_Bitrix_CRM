import { apiGet, apiPost } from "../apiClient.js";
import { escapeHtml } from "./utils.js";
import { loadReportHistory } from "./reportHistory.js";

const els = {};

export function initHistory(elements) {
  Object.assign(els, elements);
  els.refreshHistoryBtn?.addEventListener("click", () => loadHistory());
  els.refreshReportHistoryBtn?.addEventListener("click", () => loadReportHistoryTable());
}

function entityLabel(entity) {
  if (!entity) return "—";
  const name = entity.name || "";
  const id = entity.id != null ? `#${entity.id}` : "";
  const type = entity.type || "";
  return [type, name, id].filter(Boolean).join(" ");
}

function rollbackCell(op) {
  if (op.rollbackAvailable) {
    const until = op.rollbackExpiresAt
      ? `до ${new Date(op.rollbackExpiresAt).toLocaleString("ru-RU")}`
      : "доступен";
    return `<span class="status-ok">Доступен (${escapeHtml(until)})</span>`;
  }
  return `<span class="muted">${escapeHtml(op.rollbackUnavailableReason || "Недоступен")}</span>`;
}

export async function loadHistory() {
  try {
    const data = await apiGet("/operations?limit=100");
    if (!data.ok) throw new Error(data.error || "Ошибка загрузки");

    els.historyTableBody.innerHTML = "";
    if (els.operationDetails) {
      els.operationDetails.hidden = true;
      els.operationDetails.innerHTML = "";
    }

    if (!data.operations?.length) {
      els.historyTableBody.innerHTML = '<tr><td colspan="8">История операций пуста</td></tr>';
      return;
    }

    for (const op of data.operations) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(new Date(op.createdAt).toLocaleString("ru-RU"))}</td>
        <td>${escapeHtml(op.title || op.action)}</td>
        <td>${escapeHtml(entityLabel(op.entity))}</td>
        <td class="${op.status === "failed" || op.status === "rollback_conflict" ? "status-error" : "status-ok"}">${escapeHtml(op.statusLabel || op.status)}</td>
        <td>${escapeHtml(op.source || "—")}</td>
        <td>${escapeHtml(String(op.affectedCount ?? 0))}</td>
        <td>${rollbackCell(op)}</td>
        <td><button type="button" class="link-btn op-details-btn" data-id="${escapeHtml(op.id)}">Детали</button></td>
      `;
      els.historyTableBody.appendChild(tr);
    }

    els.historyTableBody.querySelectorAll(".op-details-btn").forEach((btn) => {
      btn.addEventListener("click", () => showOperationDetails(btn.dataset.id));
    });
  } catch (error) {
    els.historyTableBody.innerHTML = `<tr><td colspan="8">Ошибка: ${escapeHtml(error.message)}</td></tr>`;
  }
}

async function showOperationDetails(id) {
  if (!els.operationDetails) return;
  try {
    const data = await apiGet(`/operations/${encodeURIComponent(id)}`);
    if (!data.ok) throw new Error(data.error || "Не найдено");
    const op = data.operation;

    const changes = (op.changes || [])
      .map(
        (c) =>
          `<li><strong>${escapeHtml(c.fieldName || c.field)}</strong>: ${escapeHtml(String(c.before ?? "—"))} → ${escapeHtml(String(c.after ?? "—"))}</li>`
      )
      .join("");

    els.operationDetails.hidden = false;
    els.operationDetails.innerHTML = `
      <h4>${escapeHtml(op.title || op.action)}</h4>
      <p>Статус: <strong>${escapeHtml(op.statusLabel || op.status)}</strong>
         · Риск: ${escapeHtml(op.riskLevel || "—")}
         · Откат: ${escapeHtml(op.rollbackAvailable ? "доступен" : op.rollbackUnavailableReason || "нет")}</p>
      ${changes ? `<ul>${changes}</ul>` : "<p>Нет детальных изменений для отображения.</p>"}
      ${
        op.rollbackAvailable
          ? `<button type="button" class="btn btn-secondary" id="prepareRollbackBtn" data-id="${escapeHtml(op.id)}">Подготовить откат</button>`
          : ""
      }
    `;

    const rb = document.getElementById("prepareRollbackBtn");
    rb?.addEventListener("click", async () => {
      const prepData = await apiPost(
        `/operations/${encodeURIComponent(op.id)}/rollback/prepare`,
        {},
        { throwOnError: false }
      );
      if (!prepData.ok && prepData.success === false) {
        alert(prepData.error?.message || prepData.reason || "Откат недоступен");
        return;
      }
      const ok = confirm(
        `${prepData.preview?.title || "Откат"}\n\nПодтвердить откат операции?`
      );
      if (!ok) {
        await apiPost(
          `/operations/${encodeURIComponent(prepData.operation?.id || "")}/cancel`,
          {},
          { throwOnError: false }
        ).catch(() => {});
        return;
      }
      const commitData = await apiPost("/operations/rollback/commit", {
        confirmationId: prepData.confirmationId,
      }, { throwOnError: false });
      alert(commitData.success ? "Откат выполнен" : commitData.error?.message || "Ошибка отката");
      loadHistory();
    });
  } catch (error) {
    els.operationDetails.hidden = false;
    els.operationDetails.innerHTML = `<p class="status-error">${escapeHtml(error.message)}</p>`;
  }
}

export function loadReportHistoryTable() {
  const history = loadReportHistory();
  els.reportHistoryBody.innerHTML = "";

  if (!history.length) {
    els.reportHistoryBody.innerHTML = '<tr><td colspan="6">Сформированных отчётов пока нет</td></tr>';
    return;
  }

  for (const entry of history) {
    const tr = document.createElement("tr");
    const period = `${entry.period?.dateFrom || "—"} — ${entry.period?.dateTo || "—"}`;
    const docBtn = entry.documentUrl
      ? `<a href="${escapeHtml(entry.documentUrl)}" target="_blank" class="link-btn">Открыть документ</a>`
      : "—";
    tr.innerHTML = `
      <td>${escapeHtml(new Date(entry.createdAt).toLocaleString("ru-RU"))}</td>
      <td>${escapeHtml(entry.title || entry.type)}</td>
      <td>${escapeHtml(period)}</td>
      <td>${escapeHtml(entry.funnel?.name || "—")}</td>
      <td class="${entry.status === "error" ? "status-error" : "status-ok"}">${escapeHtml(entry.status)}</td>
      <td>${docBtn}</td>
    `;
    els.reportHistoryBody.appendChild(tr);
  }
}

export function onHistoryTabOpen(sessionId) {
  if (els.sessionId) els.sessionId.value = sessionId;
  loadHistory();
  loadReportHistoryTable();
}
