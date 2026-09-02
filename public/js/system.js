import { apiGet } from "../apiClient.js";
import { escapeHtml } from "./utils.js";

function renderKv(container, rows) {
  if (!container) return;
  container.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="system-kv"><span class="system-kv-label">${escapeHtml(label)}</span><span class="system-kv-value">${escapeHtml(value)}</span></div>`
    )
    .join("");
}

export async function loadSystemPanel() {
  const statusEl = document.getElementById("systemStatus");
  const metricsEl = document.getElementById("systemMetrics");
  const errorsEl = document.getElementById("systemErrors");

  try {
    const status = await apiGet("/admin/system/status");
    renderKv(statusEl, [
      ["Версия", `${status.release?.version || "—"} (${status.release?.releaseId || "—"})`],
      ["Время работы (с)", String(status.uptimeSeconds ?? "—")],
      ["Обслуживание", status.modes?.maintenanceMode ? "да" : "нет"],
      ["Только чтение", status.modes?.readOnlyMode ? "да" : "нет"],
      ["Запись в Bitrix24", status.modes?.bitrixWriteEnabled ? "вкл" : "выкл"],
      ["Языковая модель", status.llm?.enabled ? "вкл" : "выкл"],
      ["Планировщик", status.scheduler?.running ? "работает" : "остановлен"],
      ["Миграция БД", String(status.database?.migrationVersion ?? "—")],
      ["Готовность", status.readiness?.ready ? "готов" : "не готов"],
      ["Диск", status.disk?.status || "—"],
    ]);

    const metricRows = [
      ["Ожидают подтверждения", String(status.safety?.pending ?? "—")],
      ["Требуется восстановление", String(status.safety?.recoveryRequired ?? "—")],
      ["Отправлено сообщений", String(status.communications?.sent ?? "—")],
      ["Размер БД (МБ)", String(status.database?.fileSizeMb ?? "—")],
      ["Последняя копия", status.database?.lastBackup || "—"],
    ];

    try {
      const metrics = await apiGet("/admin/system/metrics");
      const m = metrics.metrics;
      if (m && typeof m === "object") {
        for (const [key, value] of Object.entries(m)) {
          if (value !== null && typeof value === "object") continue;
          const label = String(key).replace(/([A-Z])/g, " $1").replace(/[_-]/g, " ").trim();
          metricRows.push([label, String(value ?? "—")]);
        }
      }
    } catch {
      /* optional */
    }

    renderKv(metricsEl, metricRows);
  } catch {
    if (statusEl) statusEl.innerHTML = `<p class="panel-desc">Не удалось загрузить статус.</p>`;
  }

  try {
    const errData = await apiGet("/admin/errors?limit=30&unresolved=true");
    const items = errData.errors || [];
    if (!errorsEl) return;
    if (!items.length) {
      errorsEl.innerHTML = `<p class="panel-desc">Нет неразрешённых ошибок.</p>`;
      return;
    }
    errorsEl.innerHTML = items
      .map(
        (e) => `
      <article class="notif-card severity-${escapeHtml(e.severity)}">
        <div class="notif-meta">${escapeHtml(new Date(e.createdAt).toLocaleString("ru-RU"))} · ${escapeHtml(e.severity)} · ${escapeHtml(e.source)} · ${escapeHtml(e.errorCode)}</div>
        <div class="notif-title">${escapeHtml(e.messageSafe)}</div>
        ${e.requestId ? `<div class="panel-desc">код запроса: ${escapeHtml(e.requestId)}</div>` : ""}
        ${
          e.details?.path
            ? `<div class="panel-desc">${escapeHtml(e.details.method || "")} ${escapeHtml(e.details.path)}${e.details.stack ? ` · ${escapeHtml(String(e.details.stack).slice(0, 240))}` : ""}</div>`
            : ""
        }
      </article>`
      )
      .join("");
  } catch {
    if (errorsEl) errorsEl.innerHTML = `<p class="panel-desc">Журнал ошибок недоступен.</p>`;
  }
}

export function initSystem() {
  document.getElementById("refreshSystemBtn")?.addEventListener("click", () => loadSystemPanel());
}

export function onSystemTabOpen() {
  loadSystemPanel();
}
