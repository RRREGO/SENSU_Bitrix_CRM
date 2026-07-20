import { apiPost } from "../apiClient.js";
import { getChatId } from "./chat.js";

let currentTranscriptId = null;
let currentProtocolId = null;
let pendingOperationId = null;
let pendingHubConfirmationId = null;
let pendingHubOperationId = null;
let pendingHubRequiredPhrase = null;
let setActiveMessageDraft = null;
let lastHubDraftBody = "";

export function initMeetings(hooks = {}) {
  setActiveMessageDraft = hooks.setActiveMessageDraft || null;
  document.getElementById("meetingTranscriptFile")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const ta = document.getElementById("meetingTranscriptText");
    if (ta) ta.value = text;
    if (!document.getElementById("meetingTitle")?.value) {
      document.getElementById("meetingTitle").value = file.name.replace(/\.(md|txt)$/i, "");
    }
  });

  document.getElementById("saveTranscriptBtn")?.addEventListener("click", saveTranscript);
  document.getElementById("generateProtocolBtn")?.addEventListener("click", generateProtocol);
  document.getElementById("copyProtocolBtn")?.addEventListener("click", () => {
    const text = document.getElementById("protocolPreview")?.textContent || "";
    navigator.clipboard?.writeText(text);
    setStatus("Протокол скопирован.");
  });
  document.getElementById("saveProtocolToCrmBtn")?.addEventListener("click", prepareSaveToCrm);
  document.getElementById("draftClientMessageBtn")?.addEventListener("click", draftMessage);
  document.getElementById("prepareHubSendBtn")?.addEventListener("click", prepareHubSend);
  document.getElementById("protocolConfirmBtn")?.addEventListener("click", () => commitSave(true));
  document.getElementById("protocolCancelBtn")?.addEventListener("click", () => commitSave(false));
  document.getElementById("hubSendConfirmBtn")?.addEventListener("click", () => commitHubSend(true));
  document.getElementById("hubSendCancelBtn")?.addEventListener("click", () => commitHubSend(false));
}

function setStatus(text) {
  const el = document.getElementById("meetingStatus");
  if (el) el.textContent = text || "";
}

function setSendPolicy(text) {
  const el = document.getElementById("meetingSendPolicy");
  if (el) el.textContent = text || "";
}

function showConfirm(text) {
  const box = document.getElementById("protocolConfirmBox");
  const t = document.getElementById("protocolConfirmText");
  if (t) t.textContent = text;
  box?.classList.remove("hidden");
}

function hideConfirm() {
  document.getElementById("protocolConfirmBox")?.classList.add("hidden");
  pendingOperationId = null;
}

function showHubConfirm(text, { phraseRequired } = {}) {
  const box = document.getElementById("hubSendConfirmBox");
  const t = document.getElementById("hubSendConfirmText");
  if (t) t.textContent = text;
  const phraseRow = document.getElementById("hubSendPhraseRow");
  if (phraseRequired) phraseRow?.classList.remove("hidden");
  else phraseRow?.classList.add("hidden");
  box?.classList.remove("hidden");
}

function hideHubConfirm() {
  document.getElementById("hubSendConfirmBox")?.classList.add("hidden");
  pendingHubConfirmationId = null;
  pendingHubOperationId = null;
  pendingHubRequiredPhrase = null;
  const phrase = document.getElementById("hubSendConfirmPhrase");
  if (phrase) phrase.value = "";
}

function resolveContactId() {
  const manual = document.getElementById("meetingSendContactId")?.value?.trim();
  if (manual) return manual;
  const entityType = document.getElementById("meetingEntityType")?.value;
  const entityId = document.getElementById("meetingEntityId")?.value;
  if (entityType === "contact" && entityId) return String(entityId);
  return null;
}

function selectedChannel() {
  return document.getElementById("meetingSendChannel")?.value || "whatsapp";
}

async function saveTranscript() {
  const text = document.getElementById("meetingTranscriptText")?.value || "";
  const title = document.getElementById("meetingTitle")?.value || "Транскрипт встречи";
  const entityType = document.getElementById("meetingEntityType")?.value;
  const entityId = document.getElementById("meetingEntityId")?.value;
  if (!text.trim()) {
    setStatus("Вставьте текст транскрипта.");
    return;
  }
  setStatus("Сохранение транскрипта…");
  const data = await apiPost(
    "/meeting-transcripts",
    {
      chatId: getChatId(),
      entityType,
      entityId: entityId ? Number(entityId) : null,
      title,
      text,
    },
    { throwOnError: false }
  );
  if (!data.success) {
    setStatus(data.error?.message || "Ошибка сохранения");
    return;
  }
  currentTranscriptId = data.transcript.id;
  setStatus(
    `Транскрипт сохранён (${data.transcript.sizeChars || "—"} символов). В Bitrix24 не записан.`
  );
}

async function generateProtocol() {
  if (!currentTranscriptId) {
    await saveTranscript();
    if (!currentTranscriptId) return;
  }
  setStatus("Формирование протокола…");
  const entityType = document.getElementById("meetingEntityType")?.value;
  const entityId = document.getElementById("meetingEntityId")?.value;
  const data = await apiPost(
    "/meeting-protocols/generate",
    {
      transcriptId: currentTranscriptId,
      entityType,
      entityId: entityId ? Number(entityId) : null,
      chatId: getChatId(),
      title: document.getElementById("meetingTitle")?.value || "Протокол встречи",
    },
    { throwOnError: false }
  );
  if (!data.ok && !data.success) {
    setStatus(data.error?.message || "Ошибка генерации");
    return;
  }
  currentProtocolId = data.protocolId || data.protocol?.id;
  const preview = document.getElementById("protocolPreview");
  const protocolText =
    data.protocol?.protocolText || JSON.stringify(data.protocol?.protocol, null, 2);
  if (preview) {
    preview.textContent = protocolText;
  }
  lastHubDraftBody = String(protocolText || "").slice(0, 3500);
  const actions = (data.recommendedActions || [])
    .map((a) => `• ${a.type}: ${a.title}`)
    .join("\n");
  setStatus(
    `Протокол готов (черновик). Не записан в CRM. Сохранение в CRM и отправка клиенту — раздельно.${
      actions ? `\nРекомендации:\n${actions}` : ""
    }`
  );
}

async function prepareSaveToCrm() {
  if (!currentProtocolId) {
    setStatus("Сначала сформируйте протокол.");
    return;
  }
  setStatus("Подготовка Safety-операции…");
  const data = await apiPost(
    `/meeting-protocols/${currentProtocolId}/save-to-crm/prepare`,
    { chatId: getChatId(), source: "meeting_protocol_ui" },
    { throwOnError: false }
  );
  if (!data.ok && !data.success) {
    setStatus(data.error?.message || data.message || "Prepare не выполнен");
    return;
  }
  pendingOperationId = data.operationId || data.operation?.id;
  const p = data.preview || {};
  showConfirm(
    [
      `Сохранить протокол в таймлайн ${p.entityType || ""} #${p.entityId || ""}?`,
      `Объём: ${p.commentLength || "—"} символов.`,
      p.commentPreview ? `Фрагмент:\n${p.commentPreview}` : "",
      p.note || "Комментарий добавится после подтверждения. Операция необратима.",
      "Это НЕ отправка клиенту — только CRM.",
    ]
      .filter(Boolean)
      .join("\n\n")
  );
}

async function commitSave(confirmed) {
  if (!pendingOperationId) {
    hideConfirm();
    return;
  }
  const opId = pendingOperationId;
  hideConfirm();
  if (!confirmed) {
    await apiPost(`/operations/${opId}/cancel`, {}, { throwOnError: false }).catch(() => {});
    setStatus("Сохранение отменено.");
    return;
  }
  setStatus("Запись в CRM…");
  const data = await apiPost(
    `/operations/${opId}/commit`,
    { confirmed: true },
    { throwOnError: false }
  );
  setStatus(
    data.ok || data.success
      ? "Протокол сохранён в CRM (timeline comment). Клиенту не отправлено."
      : data.error?.message || "Commit не выполнен"
  );
}

async function draftMessage() {
  const entityType = document.getElementById("meetingEntityType")?.value;
  const entityId = document.getElementById("meetingEntityId")?.value;
  const channel = selectedChannel();
  const contactId = resolveContactId();

  setStatus("Черновик / проверка политики…");
  setSendPolicy("");

  // Prefer Hub draft/prepare preview when contactId known; fallback to legacy message-drafts
  if (contactId) {
    const body =
      lastHubDraftBody ||
      document.getElementById("protocolPreview")?.textContent ||
      "Краткое продолжение по итогам встречи.";
    const data = await apiPost(
      "/communications/messages/prepare",
      {
        contactId,
        channel,
        chatType: channel === "waba" ? "whatsapp" : channel,
        transport: channel === "waba" ? "wapi" : channel,
        body: String(body).slice(0, 3500),
        category: "meeting_summary",
        chatId: getChatId(),
      },
      { throwOnError: false }
    );

    if (data.blocked || data.success === false) {
      const policy = data.policy || data.error || {};
      setSendPolicy(
        `Политика: ${policy.code || data.error?.code || "blocked"} — ${
          policy.message || data.error?.message || "отправка недоступна"
        }`
      );
      setStatus("Коммуникация запрещена политикой (черновик не для отправки).");
      return;
    }

    const p = data.preview || {};
    setSendPolicy(
      [
        `Канал: ${p.channel || channel}`,
        `Политика: ${p.policyAllowed === false ? "нет" : "ок"}`,
        p.policyMessage || "",
        p.dryRun ? "Dry-run: реальной отправки не будет." : "",
        p.recipientMasked ? `Получатель: ${p.recipientMasked}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    );
    const preview = document.getElementById("protocolPreview");
    if (preview && p.bodyPreview) {
      // Keep protocol; policy notice is enough — don't overwrite protocol text
    }
    if (setActiveMessageDraft) {
      setActiveMessageDraft({
        hub: true,
        confirmationId: data.confirmationId,
        preview: p,
        channel,
        contactId,
      });
    }
    setStatus(
      data.confirmationId
        ? "Подготовка Safety готова — подтвердите отправку отдельно (не путать с «Сохранить в CRM»)."
        : "Черновик Hub готов. Сообщение не отправлено."
    );
    if (data.confirmationId) {
      pendingHubConfirmationId = data.confirmationId;
      pendingHubOperationId = data.operationId || data.operation?.id || null;
      pendingHubRequiredPhrase = p.requiredConfirmationPhrase || data.preview?.requiredConfirmationPhrase || null;
      showHubConfirm(
        [
          `Подтвердить отправку клиенту (${channel})?`,
          p.bodyPreview ? `Фрагмент:\n${p.bodyPreview}` : "",
          p.dryRun ? "Режим dry-run." : "",
          "CRM не изменяется этой операцией.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        { phraseRequired: Boolean(pendingHubRequiredPhrase) }
      );
    }
    return;
  }

  if (!entityId) {
    setStatus("Укажите ID сущности CRM или ID контакта для Hub-отправки.");
    return;
  }
  const data = await apiPost(
    "/message-drafts",
    {
      entityType,
      entityId: Number(entityId),
      channel: channel === "waba" ? "whatsapp" : channel,
      purpose: "follow_up",
      tone: "business",
    },
    { throwOnError: false }
  );
  if (data.error?.code === "CLIENT_COMMUNICATION_BLOCKED" || data.success === false) {
    setSendPolicy(data.error?.message || "Коммуникация запрещена.");
    setStatus(data.error?.message || "Коммуникация запрещена.");
    return;
  }
  setSendPolicy(
    `Legacy draft ${data.draftId || "—"} · канал ${data.channel} · sendAvailable=${
      data.sendAvailable ? "да" : "нет"
    }`
  );
  if (setActiveMessageDraft) setActiveMessageDraft(data);
  setStatus("Черновик готов (legacy). Сообщение не отправлено. Для Hub укажите contactId.");
}

async function prepareHubSend() {
  const contactId = resolveContactId();
  if (!contactId) {
    setStatus("Для Hub-отправки укажите ID контакта (или выберите сущность contact).");
    return;
  }
  const channel = selectedChannel();
  const body =
    lastHubDraftBody ||
    document.getElementById("protocolPreview")?.textContent ||
    "";
  if (!String(body).trim()) {
    setStatus("Сначала сформируйте протокол — текст для отправки пуст.");
    return;
  }
  setStatus("Подготовка Hub Safety…");
  const data = await apiPost(
    "/communications/messages/prepare",
    {
      contactId,
      channel,
      chatType: channel === "waba" ? "whatsapp" : channel,
      transport: channel === "waba" ? "wapi" : channel,
      body: String(body).slice(0, 3500),
      category: "meeting_summary",
      chatId: getChatId(),
    },
    { throwOnError: false }
  );
  if (data.blocked || data.success === false) {
    setSendPolicy(
      `Блок: ${data.policy?.code || data.error?.code || "?"} — ${
        data.policy?.message || data.error?.message || "политика"
      }`
    );
    setStatus("Prepare отклонён политикой.");
    return;
  }
  pendingHubConfirmationId = data.confirmationId || data.operation?.confirmationId;
  pendingHubOperationId = data.operationId || data.operation?.id || null;
  pendingHubRequiredPhrase =
    data.preview?.requiredConfirmationPhrase || data.requiredConfirmationPhrase || null;
  const p = data.preview || {};
  setSendPolicy(
    [
      `Подготовлено · ${channel}`,
      p.policyCode || "ok",
      p.dryRun ? "dry-run" : "live-capable",
      p.recipientMasked || "",
    ]
      .filter(Boolean)
      .join(" · ")
  );
  showHubConfirm(
    [
      `Отправить протокол клиенту через ${channel}?`,
      "Отдельно от сохранения в CRM.",
      p.bodyPreview ? `Превью:\n${String(p.bodyPreview).slice(0, 400)}` : "",
      pendingHubRequiredPhrase
        ? `Требуется фраза: ${pendingHubRequiredPhrase}`
        : "Подтвердите commit.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    { phraseRequired: Boolean(pendingHubRequiredPhrase) }
  );
  setStatus("Ожидание подтверждения отправки (Hub). CRM не трогаем.");
}

async function commitHubSend(confirmed) {
  if (!pendingHubConfirmationId) {
    hideHubConfirm();
    return;
  }
  const confirmationId = pendingHubConfirmationId;
  const operationId = pendingHubOperationId;
  const required = pendingHubRequiredPhrase;
  const typedPhrase = document.getElementById("hubSendConfirmPhrase")?.value || "";
  hideHubConfirm();
  if (!confirmed) {
    if (operationId) {
      await apiPost(`/operations/${operationId}/cancel`, {}, { throwOnError: false }).catch(
        () => {}
      );
    }
    setStatus("Отправка отменена.");
    return;
  }
  const phrase = typedPhrase || required || undefined;
  setStatus("Commit отправки…");
  const data = await apiPost(
    "/communications/messages/commit",
    {
      confirmationId,
      confirmed: true,
      confirmationPhrase: phrase || undefined,
    },
    { throwOnError: false }
  );
  if (data.ok || data.success) {
    setStatus(
      data.result?.enqueued
        ? `Сообщение в outbox (${data.result.outboxId || "ok"})${
            data.result.dryRun ? " · dry-run" : ""
          }. CRM не изменён.`
        : "Commit выполнен."
    );
  } else {
    setStatus(data.error?.message || "Commit отправки не выполнен");
  }
}

export function syncMeetingEntityFromChat(chat) {
  if (!chat?.crmEntityType || !chat?.crmEntityId) return;
  const typeEl = document.getElementById("meetingEntityType");
  const idEl = document.getElementById("meetingEntityId");
  if (typeEl) typeEl.value = chat.crmEntityType;
  if (idEl) idEl.value = String(chat.crmEntityId);
  if (chat.crmEntityType === "contact") {
    const contactEl = document.getElementById("meetingSendContactId");
    if (contactEl && !contactEl.value) contactEl.value = String(chat.crmEntityId);
  }
}
