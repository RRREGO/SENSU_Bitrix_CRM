import { apiGet, apiPost } from "../apiClient.js";
import { escapeHtml } from "./utils.js";

let pollTimer = null;

export function initNotifications() {
  document.getElementById("refreshNotificationsBtn")?.addEventListener("click", () => loadNotifications());
  document.getElementById("readAllNotificationsBtn")?.addEventListener("click", async () => {
    await apiPost("/notifications/read-all", {}, { throwOnError: false });
    loadNotifications();
    refreshBadge();
  });
  document.getElementById("notifFilter")?.addEventListener("change", () => loadNotifications());
  document.getElementById("closeNotificationDetailBtn")?.addEventListener("click", () => {
    document.getElementById("notificationDetail")?.classList.add("hidden");
  });
  refreshBadge();
  if (!pollTimer) {
    pollTimer = setInterval(refreshBadge, 30000);
  }
}

export function onNotificationsTabOpen() {
  loadNotifications();
  refreshBadge();
}

export async function refreshBadge() {
  try {
    const data = await apiGet("/notifications/unread-count");
    const badge = document.getElementById("notifBadge");
    if (!badge) return;
    const n = data.unread || 0;
    badge.textContent = String(n);
    badge.classList.toggle("hidden", n === 0);
  } catch {
    /* ignore */
  }
}

async function loadNotifications() {
  const filter = document.getElementById("notifFilter")?.value || "";
  const params = new URLSearchParams();
  if (filter === "unread") params.set("isRead", "false");
  if (filter === "critical") params.set("severity", "critical");
  if (filter === "warning") params.set("severity", "warning");
  const data = await apiGet(`/notifications?${params}`);
  const root = document.getElementById("notificationsList");
  if (!root) return;
  const items = data.notifications || [];
  if (!items.length) {
    root.innerHTML = `<div class="empty-state empty-state--xl"><p class="empty-state-title">Нет уведомлений</p><p class="empty-state-text">Новые события появятся здесь.</p></div>`;
    return;
  }
  root.innerHTML = items
    .map(
      (n) => `
    <article class="notif-card ${n.isRead ? "" : "unread"} severity-${escapeHtml(n.severity)}">
      <div class="notif-meta">${escapeHtml(new Date(n.createdAt).toLocaleString("ru-RU"))} · ${escapeHtml(n.severity)} · ${escapeHtml(n.type)}</div>
      <div class="notif-title">${escapeHtml(n.title)}</div>
      <div class="notif-message">${escapeHtml(n.message)}</div>
      <div class="confirmation-actions">
        <button type="button" class="btn btn-secondary" data-open-notif="${escapeHtml(n.id)}">Открыть</button>
        ${n.isRead ? "" : `<button type="button" class="btn btn-secondary" data-read-notif="${escapeHtml(n.id)}">Отметить прочитанным</button>`}
      </div>
    </article>`
    )
    .join("");

  root.querySelectorAll("[data-read-notif]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiPost(`/notifications/${btn.dataset.readNotif}/read`, {}, { throwOnError: false });
      loadNotifications();
      refreshBadge();
    });
  });
  root.querySelectorAll("[data-open-notif]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.openNotif;
      await apiPost(`/notifications/${id}/read`, {}, { throwOnError: false });
      const n = items.find((x) => x.id === id);
      const detail = document.getElementById("notificationDetail");
      document.getElementById("notificationDetailTitle").textContent = n?.title || "";
      const runId = n?.data?.runId || n?.reportRunId;
      let body = n?.message || "";
      if (runId) {
        const run = await apiGet(`/scheduled-report-runs/${runId}`);
        body += `\n\n${run.run?.summaryText || ""}\n\n${JSON.stringify(run.run?.report?.summary || {}, null, 2)}`;
      }
      document.getElementById("notificationDetailBody").textContent = body;
      detail?.classList.remove("hidden");
      refreshBadge();
      loadNotifications();
    });
  });
}
