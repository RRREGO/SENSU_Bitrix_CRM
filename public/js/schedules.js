import { apiGet, apiPatch, apiPost } from "../apiClient.js";
import { escapeHtml } from "./utils.js";

export function initSchedules() {
  /* lazy load on tab open */
}

export function onSchedulesTabOpen() {
  loadSchedules();
}

async function loadSchedules() {
  const data = await apiGet("/scheduled-reports");
  const list = document.getElementById("schedulesList");
  if (!list) return;
  list.innerHTML = (data.schedules || [])
    .map(
      (s) => `<li>
      <button type="button" class="sidebar-item" data-schedule-id="${escapeHtml(s.id)}">
        <span class="sidebar-item-title">${escapeHtml(s.name)}</span>
        <span class="sidebar-item-meta">${s.isEnabled ? "вкл" : "выкл"} · ${escapeHtml(s.description || "")}</span>
      </button>
    </li>`
    )
    .join("");
  list.querySelectorAll("[data-schedule-id]").forEach((btn) => {
    btn.addEventListener("click", () => openSchedule(btn.dataset.scheduleId));
  });
}

async function openSchedule(id) {
  const [meta, runs] = await Promise.all([
    apiGet(`/scheduled-reports/${id}`),
    apiGet(`/scheduled-reports/${id}/runs?limit=10`),
  ]);
  const s = meta.schedule;
  if (!s) return;
  const detail = document.getElementById("scheduleDetail");
  const thresholds = (s.alertRules || [])
    .map(
      (r) =>
        `${r.metric} ${r.operator} ${r.value} (${r.severity})`
    )
    .join("\n");

  detail.innerHTML = `
    <h3>${escapeHtml(s.name)}</h3>
    <p class="panel-desc">${escapeHtml(s.description || "")}</p>
    <p class="panel-desc">Тип: ${escapeHtml(s.reportType)} · TZ: ${escapeHtml(s.timezone)}</p>
    <p class="panel-desc">Следующий запуск: ${escapeHtml(s.nextRunAt || "—")}</p>
    <p class="panel-desc">Последний запуск: ${escapeHtml(s.lastRunAt || "—")}</p>
    <label class="setting-row"><span>Час</span>
      <input type="number" id="schedHour" min="0" max="23" value="${Number(s.params?.hour ?? 8)}">
    </label>
    <label class="setting-row"><span>Минута</span>
      <input type="number" id="schedMinute" min="0" max="59" value="${Number(s.params?.minute ?? 0)}">
    </label>
    <label class="setting-row"><span>Timezone</span>
      <input type="text" id="schedTz" value="${escapeHtml(s.timezone)}">
    </label>
    <label class="setting-row"><span><input type="checkbox" id="schedNarrative" ${s.narrativeEnabled ? "checked" : ""}> Текстовое резюме Claude</span></label>
    <label class="setting-row"><span>Пороги алертов (по одной строке: metric operator value severity)</span>
      <textarea id="schedAlerts" rows="6">${escapeHtml(
        (s.alertRules || [])
          .map((r) => `${r.metric} ${r.operator} ${r.value} ${r.severity}`)
          .join("\n")
      )}</textarea>
    </label>
    <div class="confirmation-actions">
      <button type="button" class="btn btn-primary" id="saveScheduleBtn">Сохранить</button>
      <button type="button" class="btn btn-secondary" id="toggleScheduleBtn">${s.isEnabled ? "Отключить" : "Включить"}</button>
      <button type="button" class="btn btn-primary" id="runNowScheduleBtn">Выполнить сейчас</button>
    </div>
    <p id="scheduleStatus" class="panel-desc"></p>
    <h4>История запусков</h4>
    <ul>${(runs.runs || [])
      .map(
        (r) =>
          `<li>${escapeHtml(r.status)} · ${escapeHtml(r.scheduledFor)} · ${r.durationMs ?? "—"} мс
          <button type="button" data-retry-run="${escapeHtml(r.id)}">Повтор</button></li>`
      )
      .join("")}</ul>
  `;

  detail.querySelector("#saveScheduleBtn")?.addEventListener("click", async () => {
    const alertRules = parseAlertLines(detail.querySelector("#schedAlerts").value);
    await apiPatch(`/scheduled-reports/${id}`, {
      timezone: detail.querySelector("#schedTz").value,
      narrativeEnabled: detail.querySelector("#schedNarrative").checked,
      params: {
        ...s.params,
        hour: Number(detail.querySelector("#schedHour").value),
        minute: Number(detail.querySelector("#schedMinute").value),
      },
      alertRules,
    });
    detail.querySelector("#scheduleStatus").textContent = "Сохранено.";
    loadSchedules();
    openSchedule(id);
  });

  detail.querySelector("#toggleScheduleBtn")?.addEventListener("click", async () => {
    await apiPost(`/scheduled-reports/${id}/${s.isEnabled ? "disable" : "enable"}`, {}, { throwOnError: false });
    loadSchedules();
    openSchedule(id);
  });

  detail.querySelector("#runNowScheduleBtn")?.addEventListener("click", async () => {
    detail.querySelector("#scheduleStatus").textContent = "Запуск…";
    const data = await apiPost(`/scheduled-reports/${id}/run-now`, {}, { throwOnError: false });
    detail.querySelector("#scheduleStatus").textContent = data.success
      ? `Готово: ${data.run?.status || "ok"}`
      : data.error?.message || "Ошибка";
    openSchedule(id);
  });

  detail.querySelectorAll("[data-retry-run]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiPost(`/scheduled-report-runs/${btn.dataset.retryRun}/retry`, {}, { throwOnError: false });
      openSchedule(id);
    });
  });
}

function parseAlertLines(text) {
  return String(text || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const [metric, operator, value, severity] = line.split(/\s+/);
      return {
        metric,
        operator,
        value: Number(value),
        severity: severity || "warning",
        code: `ALERT_${metric}`.toUpperCase(),
      };
    })
    .filter((r) => r.metric && r.operator && Number.isFinite(r.value));
}
