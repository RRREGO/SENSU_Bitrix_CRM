import { apiGet, apiPost } from "../apiClient.js";

let currentDraftId = null;

function setOutboundStatus(text) {
  const el = document.getElementById("outboundStatus");
  if (el) el.textContent = text || "";
}

async function loadOutbound() {
  const list = document.getElementById("outboundList");
  if (!list) return;
  const data = await apiGet("/outbound-messages?limit=40");
  const messages = data.messages || [];
  list.innerHTML = messages.length
    ? messages
        .map(
          (m) => `<div class="notification-item">
            <div><strong>${escape(m.channel)}</strong> · ${escape(m.status)} · ${escape(m.verificationStatus || "—")}</div>
            <div class="panel-desc">${escape(m.createdAt || "")} · draft ${escape((m.draftId || "").slice(0, 8))} · op ${escape((m.operationId || "").slice(0, 8))}</div>
            ${m.error ? `<div class="panel-desc">${escape(m.error.message || JSON.stringify(m.error))}</div>` : ""}
          </div>`
        )
        .join("")
    : `<p class="panel-desc">Пока нет исходящих сообщений.</p>`;
}

async function detectChannels() {
  setOutboundStatus("Обнаружение каналов…");
  const data = await apiPost("/communication-channels/detect", {}, { throwOnError: false });
  const summary = document.getElementById("channelsSummary");
  if (summary) {
    summary.textContent = (data.channels || [])
      .map((c) => `${c.channel}: ${c.status}${c.capabilities?.canSend ? " (send)" : ""}`)
      .join(" · ");
  }
  setOutboundStatus(data.success ? "Каналы обновлены (без тестовой отправки)." : "Ошибка detect");
}

function showDraft(draft) {
  currentDraftId = draft.draftId || draft.id;
  const preview = document.getElementById("messageDraftPreview");
  if (!preview) return;
  preview.textContent = [
    `ID: ${currentDraftId}`,
    `Канал: ${draft.channel}`,
    `Получатель: ${draft.recipient?.name || "—"} (${draft.recipient?.maskedAddress || "—"})`,
    draft.subject ? `Тема: ${draft.subject}` : "",
    `Отправка доступна: ${draft.sendAvailable ? "да" : "нет"}`,
    "",
    draft.body || "",
    "",
    ...(draft.warnings || []).map((w) => `⚠ ${w.message || w}`),
  ]
    .filter((x) => x !== "")
    .join("\n");
}

async function prepareSend() {
  if (!currentDraftId) {
    setOutboundStatus("Нет черновика.");
    return;
  }
  setOutboundStatus("Prepare…");
  const data = await apiPost(`/message-drafts/${currentDraftId}/send/prepare`, {}, { throwOnError: false });
  if (data.success === false) {
    setOutboundStatus(data.error?.message || "Prepare отклонён");
    return;
  }
  const phrase = data.preview?.requiredConfirmationPhrase;
  const irrev = data.preview?.reversible === false;
  setOutboundStatus(
    [
      `ConfirmationId: ${data.confirmationId}`,
      irrev ? "Откат невозможен после отправки." : "",
      phrase ? `Фраза: ${phrase}` : "Обычное подтверждение (внутренний чат).",
      "Commit через /bitrix/action с confirmationId (+ confirmationPhrase при необходимости).",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

function escape(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function initOutbound() {
  document.getElementById("refreshOutboundBtn")?.addEventListener("click", () => loadOutbound());
  document.getElementById("detectChannelsBtn")?.addEventListener("click", () => detectChannels());
  document.getElementById("copyDraftBtn")?.addEventListener("click", async () => {
    const text = document.getElementById("messageDraftPreview")?.textContent || "";
    try {
      await navigator.clipboard.writeText(text);
      setOutboundStatus("Скопировано.");
    } catch {
      setOutboundStatus("Не удалось скопировать.");
    }
  });
  document.getElementById("prepareSendDraftBtn")?.addEventListener("click", () => prepareSend());
  document.getElementById("cancelDraftBtn")?.addEventListener("click", async () => {
    if (!currentDraftId) return;
    await apiPost(`/message-drafts/${currentDraftId}/cancel`, {}, { throwOnError: false });
    setOutboundStatus("Черновик отменён.");
    currentDraftId = null;
  });
}

export function onOutboundTabOpen() {
  loadOutbound();
}

export function setActiveMessageDraft(draft) {
  showDraft(draft);
}
