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
  const alertText = (s.alertRules || [])
    .map((r) => `${r.metric} ${r.operator} ${r.value} ${r.severity}`)
    .join("\n");
  const nextRun = formatScheduleTime(s.nextRunAt);
  const lastRun = formatScheduleTime(s.lastRunAt);
  const runRows = (runs.runs || [])
    .map(
      (r) => `<tr>
        <td><span class="sched-run-status sched-run-status--${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
        <td>${escapeHtml(formatScheduleTime(r.scheduledFor))}</td>
        <td>${r.durationMs != null ? `${r.durationMs} мс` : "—"}</td>
        <td>${
          r.status === "failed"
            ? `<button type="button" class="btn btn-secondary btn-sm" data-retry-run="${escapeHtml(r.id)}">Повтор</button>`
            : ""
        }</td>
      </tr>`
    )
    .join("");

  detail.innerHTML = `
    <div class="sched-detail">
      <header class="sched-detail-head">
        <div class="sched-detail-title-row">
          <h3 class="sched-detail-title">${escapeHtml(s.name)}</h3>
          <span class="sched-pill ${s.isEnabled ? "sched-pill--on" : "sched-pill--off"}">${s.isEnabled ? "Вкл" : "Выкл"}</span>
        </div>
        <p class="sched-detail-desc">${escapeHtml(s.description || "")}</p>
        <div class="sched-meta-bar">
          <span class="sched-meta-item"><em>Тип</em> ${escapeHtml(s.reportType)}</span>
          <span class="sched-meta-item"><em>След.</em> ${escapeHtml(nextRun)}</span>
          <span class="sched-meta-item"><em>Посл.</em> ${escapeHtml(lastRun)}</span>
        </div>
      </header>

      <div class="sched-form-bar">
        <label class="sched-inline-field">
          <span>Час</span>
          <input type="number" id="schedHour" min="0" max="23" value="${Number(s.params?.hour ?? 8)}">
        </label>
        <label class="sched-inline-field">
          <span>Мин</span>
          <input type="number" id="schedMinute" min="0" max="59" value="${Number(s.params?.minute ?? 0)}">
        </label>
        <label class="sched-inline-field sched-inline-field--grow">
          <span>TZ</span>
          <input type="text" id="schedTz" value="${escapeHtml(s.timezone)}">
        </label>
        <label class="sched-check">
          <input type="checkbox" id="schedNarrative" ${s.narrativeEnabled ? "checked" : ""}>
          <span>Резюме Claude</span>
        </label>
      </div>

      <details class="sched-alerts" ${alertText ? "open" : ""}>
        <summary>Пороги алертов <span class="sched-alerts-hint">metric operator value severity</span></summary>
        <textarea id="schedAlerts" rows="4" spellcheck="false">${escapeHtml(alertText)}</textarea>
      </details>

      <div class="sched-actions">
        <button type="button" class="btn btn-primary" id="saveScheduleBtn">Сохранить</button>
        <button type="button" class="btn btn-secondary" id="toggleScheduleBtn">${s.isEnabled ? "Отключить" : "Включить"}</button>
        <button type="button" class="btn btn-secondary" id="runNowScheduleBtn">Выполнить сейчас</button>
        <p id="scheduleStatus" class="sched-status" aria-live="polite"></p>
      </div>

      <section class="sched-runs">
        <h4 class="sched-runs-title">История запусков</h4>
        ${
          runRows
            ? `<div class="sched-runs-table-wrap"><table class="sched-runs-table">
                <thead><tr><th>Статус</th><th>Назначено</th><th>Длительность</th><th></th></tr></thead>
                <tbody>${runRows}</tbody>
              </table></div>`
            : `<p class="sched-runs-empty">Запусков пока нет</p>`
        }
      </section>
    </div>
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

function formatScheduleTime(value) {
  if (!value) return "—";
  const raw = String(value);
  // Keep readable local-ish form without huge ISO when possible
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    return raw.replace("T", " ").replace(/\+\d{2}:\d{2}$/, "").slice(0, 16);
  }
  return raw;
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
