import { apiGet, apiPost, apiPatch } from "../apiClient.js";
import { escapeHtml } from "./utils.js";
import { renderMarkdown } from "./markdown.js";
import { renderBreadcrumbs, wireBreadcrumbs } from "./workspace/ui/breadcrumbs.js";
import { CRM_TYPE_LABELS } from "./workspace/helpers.js";
import { CHANNEL_LABELS, labelOf } from "./uiLabels.js";

const CHAT_KEY = "bitrixChatId";
const SESSION_KEY = "bitrixChatSessionId";

const CARD_TYPE_LABELS = {
  deal: "Сделка",
  lead: "Лид",
  task: "Задача",
  contact: "Контакт",
  company: "Компания",
  report: "Отчёт",
  document: "Документ",
};

let chatId = localStorage.getItem(CHAT_KEY) || null;
let sessionId = localStorage.getItem(SESSION_KEY);
if (!sessionId) {
  sessionId = `session-${Date.now()}`;
  localStorage.setItem(SESSION_KEY, sessionId);
}

let pendingConfirmation = null;
let thinkingEl = null;
let isBusy = false;
let currentChat = null;
let onChatChanged = null;
let pendingAttachments = [];

const ATTACH_EXT = new Set([".txt", ".md", ".csv", ".tsv", ".xlsx", ".xls"]);
const ATTACH_MAX_COUNT = 5;
const ATTACH_MAX_BYTES = 2 * 1024 * 1024;
const FILES_ONLY_PREFIX = "Пользователь прикрепил файлы без комментария.";

const els = {};

export function initChat(elements, hooks = {}) {
  Object.assign(els, elements);
  onChatChanged = hooks.onChatChanged || null;

  els.chatForm.addEventListener("submit", handleSubmit);
  els.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      els.chatForm.requestSubmit();
    }
  });
  els.confirmBtn.addEventListener("click", () => handleConfirm(true));
  els.cancelBtn.addEventListener("click", () => handleConfirm(false));

  wireChatExtras();
  wireChatAttachments();

  const ready = chatId
    ? loadChat(chatId).catch(() => {
        appendWelcome();
        updateMeta(null);
      })
    : Promise.resolve().then(() => {
        appendWelcome();
        updateMeta(null);
      });
  return Promise.resolve(ready).finally(() => els.messageInput?.focus());
}

let mediaRecorder = null;
let mediaChunks = [];
let voiceStartedAt = 0;

function wireChatExtras() {
  const modelSelect = document.getElementById("chatModelSelect");
  const modelBtn = document.getElementById("chatModelBtn");
  const modelMenu = document.getElementById("chatModelMenu");
  const modelLabel = document.getElementById("chatModelLabel");
  const micBtn = document.getElementById("voiceMicBtn");
  const voiceStatus = document.getElementById("voiceStatus");
  const extBtn = document.getElementById("chatExtMenuBtn");
  const extMenu = document.getElementById("chatExtMenu");

  loadAvailableModels(modelSelect);
  modelSelect?.addEventListener("change", async () => {
    syncModelLabel(modelSelect, modelLabel);
    if (!chatId) return;
    const val = modelSelect.value;
    const opt = modelSelect.selectedOptions[0];
    const apiModelName = opt?.dataset?.apiModel || "";
    try {
      await apiPatch(`/chats/${chatId}`, {
        aiModelId: val || null,
        modelName: val ? apiModelName || opt?.textContent || null : null,
        aiProviderId: val && !String(val).startsWith("system:") ? undefined : null,
      });
    } catch (e) {
      alert(e.message || "Не удалось сохранить модель");
    }
  });

  modelBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = modelMenu?.classList.toggle("hidden") === false;
    modelBtn.setAttribute("aria-expanded", open ? "true" : "false");
    extMenu?.classList.add("hidden");
    extBtn?.setAttribute("aria-expanded", "false");
  });

  modelMenu?.addEventListener("click", (e) => {
    e.stopPropagation();
    const opt = e.target.closest("[data-model-id]");
    if (!opt || !modelSelect) return;
    modelSelect.value = opt.dataset.modelId;
    modelSelect.dispatchEvent(new Event("change"));
    modelMenu.classList.add("hidden");
    modelBtn?.setAttribute("aria-expanded", "false");
    renderModelMenuActive(modelMenu, modelSelect.value);
  });

  micBtn?.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaChunks = [];
      voiceStartedAt = Date.now();
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size) mediaChunks.push(e.data);
      };
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const durationSec = Math.round((Date.now() - voiceStartedAt) / 1000);
        if (voiceStatus) voiceStatus.textContent = "Обработка…";
        setMicRecording(micBtn, false);
        try {
          const blob = new Blob(mediaChunks, { type: "audio/webm" });
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = "";
          const chunk = 0x8000;
          for (let i = 0; i < bytes.length; i += chunk) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
          }
          const b64 = btoa(binary);
          const result = await apiPost("/voice/transcribe", {
            audioBase64: b64,
            mimeType: "audio/webm",
            durationSec,
          });
          if (result.text) {
            els.messageInput.value = result.text;
            els.messageInput.focus();
          }
          if (voiceStatus) voiceStatus.textContent = result.text ? "Текст готов" : "Пустой результат";
        } catch (e) {
          if (voiceStatus) voiceStatus.textContent = e.message || "Ошибка распознавания";
        }
      };
      mediaRecorder.start();
      setMicRecording(micBtn, true);
      if (voiceStatus) voiceStatus.textContent = "Запись…";
    } catch (e) {
      if (voiceStatus) {
        voiceStatus.textContent =
          e.name === "NotAllowedError" ? "Разрешение отклонено" : "Микрофон недоступен";
      }
    }
  });

  extBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = extMenu?.classList.toggle("hidden") === false;
    extBtn.setAttribute("aria-expanded", open ? "true" : "false");
    modelMenu?.classList.add("hidden");
    modelBtn?.setAttribute("aria-expanded", "false");
  });
  extMenu?.querySelectorAll("[data-ext-send]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      extMenu.classList.add("hidden");
      extBtn?.setAttribute("aria-expanded", "false");
      const channel = btn.dataset.extSend;
      const body = els.messageInput.value.trim();
      if (!body) {
        alert("Сначала введите текст сообщения");
        return;
      }
      try {
        const prepared = await apiPost("/chat/external-send/prepare", {
          channel,
          body,
          chatId,
        });
        alert(
          `Черновик внешней отправки подготовлен (${channel === "email" ? "электронная почта" : "Wazzup"}). Требуется подтверждение операции. Пробный режим: ${prepared.dryRun ? "да" : "нет"}.\n\nИспользуйте подтверждение в чате или раздел «Коммуникации».`
        );
      } catch (e) {
        alert(e.message || "Не удалось подготовить отправку");
      }
    });
  });

  document.addEventListener("click", () => {
    modelMenu?.classList.add("hidden");
    modelBtn?.setAttribute("aria-expanded", "false");
    extMenu?.classList.add("hidden");
    extBtn?.setAttribute("aria-expanded", "false");
  });
}

function fileExt(name) {
  const base = String(name || "").split(".").pop() || "";
  return `.${base.toLowerCase()}`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} Б`;
  if (n < 1024 * 1024) return `${Math.round(n / 102.4) / 10} КБ`;
  return `${Math.round(n / 1024 / 102.4) / 10} МБ`;
}

function setAttachError(text) {
  const el = document.getElementById("composerAttachError");
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.classList.add("hidden");
    return;
  }
  el.textContent = text;
  el.classList.remove("hidden");
}

function renderPendingAttachments() {
  const wrap = document.getElementById("composerAttachments");
  if (!wrap) return;
  if (!pendingAttachments.length) {
    wrap.innerHTML = "";
    wrap.classList.add("hidden");
    return;
  }
  wrap.classList.remove("hidden");
  wrap.innerHTML = pendingAttachments
    .map(
      (item, index) =>
        `<span class="composer-file-chip">
          <span class="composer-file-name">${escapeHtml(item.file.name)}</span>
          <span class="composer-file-size">${escapeHtml(formatBytes(item.file.size))}</span>
          <button type="button" class="composer-file-remove" data-remove-attach="${index}" aria-label="Убрать файл">×</button>
        </span>`
    )
    .join("");
  wrap.querySelectorAll("[data-remove-attach]").forEach((btn) => {
    btn.addEventListener("click", () => {
      pendingAttachments.splice(Number(btn.dataset.removeAttach), 1);
      setAttachError("");
      renderPendingAttachments();
    });
  });
}

function addPendingFiles(fileList) {
  const incoming = [...(fileList || [])].filter(Boolean);
  if (!incoming.length) return;
  setAttachError("");
  for (const file of incoming) {
    const ext = fileExt(file.name);
    if (!ATTACH_EXT.has(ext)) {
      setAttachError("Можно прикрепить txt, md, csv, tsv, xlsx или xls.");
      continue;
    }
    if (file.size > ATTACH_MAX_BYTES) {
      setAttachError(`Файл «${file.name}» больше 2 МБ.`);
      continue;
    }
    if (pendingAttachments.length >= ATTACH_MAX_COUNT) {
      setAttachError(`Можно прикрепить не больше ${ATTACH_MAX_COUNT} файлов.`);
      break;
    }
    const duplicate = pendingAttachments.some(
      (item) => item.file.name === file.name && item.file.size === file.size
    );
    if (duplicate) continue;
    pendingAttachments.push({ file });
  }
  renderPendingAttachments();
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Не удалось прочитать файл"));
    reader.readAsDataURL(file);
  });
}

async function serializePendingAttachments(list = pendingAttachments) {
  const out = [];
  for (const item of list) {
    out.push({
      filename: item.file.name,
      mimeType: item.file.type || "",
      contentBase64: await fileToBase64(item.file),
    });
  }
  return out;
}

function visibleUserText(content, metadata) {
  if (Array.isArray(metadata?.attachments) && metadata.attachments.length) {
    if (typeof metadata.displayText === "string" && !metadata.displayText.includes("[truncated]")) {
      return metadata.displayText;
    }
    const text = String(content || "");
    const marker = "---\nПрикреплённые файлы";
    const idx = text.indexOf(marker);
    if (idx >= 0) {
      const before = text.slice(0, idx).trim();
      if (before === FILES_ONLY_PREFIX) return "";
      return before;
    }
  }
  return content;
}

function renderAttachmentChips(attachments, { composer = false } = {}) {
  if (!attachments?.length) return null;
  const wrap = document.createElement("div");
  wrap.className = composer ? "composer-attachments" : "message-attachments";
  for (const file of attachments) {
    const chip = document.createElement("span");
    chip.className = composer ? "composer-file-chip" : "message-file-chip";
    const rows = file.rowCount ? ` · ${file.rowCount} строк` : "";
    const truncated = file.truncated ? " · обрезано" : "";
    chip.textContent = `${file.filename || "файл"}${rows}${truncated}`;
    wrap.appendChild(chip);
  }
  return wrap;
}

function wireChatAttachments() {
  const form = els.chatForm;
  const attachBtn = document.getElementById("chatAttachBtn");
  const attachInput = document.getElementById("chatAttachInput");
  const dropHint = document.getElementById("composerDropHint");

  attachBtn?.addEventListener("click", () => attachInput?.click());
  attachInput?.addEventListener("change", () => {
    addPendingFiles(attachInput.files);
    attachInput.value = "";
  });

  els.messageInput?.addEventListener("paste", (event) => {
    const files = [...(event.clipboardData?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    addPendingFiles(files);
  });

  if (!form) return;
  const setDrag = (on) => {
    form.classList.toggle("is-dragover", on);
    dropHint?.classList.toggle("hidden", !on);
  };
  form.addEventListener("dragenter", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    setDrag(true);
  });
  form.addEventListener("dragover", (event) => {
    if (![...event.dataTransfer.types].includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDrag(true);
  });
  form.addEventListener("dragleave", (event) => {
    if (event.target === form || !form.contains(event.relatedTarget)) setDrag(false);
  });
  form.addEventListener("drop", (event) => {
    event.preventDefault();
    setDrag(false);
    addPendingFiles(event.dataTransfer?.files);
  });
}

function setMicRecording(micBtn, recording) {
  if (!micBtn) return;
  micBtn.classList.toggle("is-recording", recording);
  micBtn.setAttribute("aria-label", recording ? "Остановить запись" : "Голосовой ввод");
  micBtn.title = recording ? "Стоп" : "Голосовой ввод";
}

function syncModelLabel(select, labelEl) {
  if (!labelEl || !select) return;
  const text = select.selectedOptions[0]?.textContent?.trim() || "Системная";
  labelEl.textContent = text;
}

function renderModelMenuActive(menu, value) {
  if (!menu) return;
  menu.querySelectorAll("[data-model-id]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.modelId === String(value || ""));
  });
}

function rebuildModelMenu(select) {
  const menu = document.getElementById("chatModelMenu");
  const label = document.getElementById("chatModelLabel");
  if (!menu || !select) return;
  menu.innerHTML = "";
  const options = [...select.querySelectorAll("option")];
  const groups = [...select.querySelectorAll("optgroup")];

  const addOption = (value, text) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "composer-model-option";
    btn.setAttribute("role", "option");
    btn.dataset.modelId = value;
    btn.textContent = text;
    menu.appendChild(btn);
  };

  addOption("", "Системная");
  if (groups.length) {
    for (const g of groups) {
      const header = document.createElement("div");
      header.className = "composer-model-group";
      header.textContent = g.label || "Модели";
      menu.appendChild(header);
      for (const opt of g.querySelectorAll("option")) {
        addOption(opt.value, opt.textContent);
      }
    }
  } else {
    for (const opt of options) {
      if (opt.value === "") continue;
      addOption(opt.value, opt.textContent);
    }
  }
  renderModelMenuActive(menu, select.value);
  syncModelLabel(select, label);
}

async function loadAvailableModels(select) {
  if (!select) return;
  try {
    const data = await apiGet("/settings/ai/models/available");
    const groups = data.groups || [];
    select.innerHTML = "";
    const sys = document.createElement("option");
    sys.value = "";
    sys.textContent = "Системная";
    select.appendChild(sys);
    for (const g of groups) {
      const og = document.createElement("optgroup");
      og.label = g.providerName || g.providerType;
      for (const m of g.models || []) {
        if (!m.id) continue;
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.displayName || m.apiModelName;
        if (m.apiModelName) opt.dataset.apiModel = m.apiModelName;
        og.appendChild(opt);
      }
      if (og.children.length) select.appendChild(og);
    }
  } catch {
    /* selector optional */
  }
  rebuildModelMenu(select);
}

async function refreshAiResolution() {
  if (!chatId) return;
  try {
    const data = await apiGet(`/chats/${chatId}/ai-resolution`);
    const ind = document.getElementById("chatPromptIndicator");
    if (ind) {
      ind.textContent = data.promptProfile
        ? `Промпт: ${data.promptProfile.name}`
        : data.resolved?.providerName
          ? `Провайдер: ${data.resolved.providerName}`
          : "";
    }
    const select = document.getElementById("chatModelSelect");
    const label = document.getElementById("chatModelLabel");
    const menu = document.getElementById("chatModelMenu");
    if (select) {
      const selectionId =
        data.resolved?.selectionId != null
          ? data.resolved.selectionId
          : data.resolved?.modelId || "";
      if ([...select.options].some((o) => o.value === selectionId)) {
        select.value = selectionId;
      }
    }
    syncModelLabel(select, label);
    renderModelMenuActive(menu, select?.value);
  } catch {
    /* ignore */
  }
}

const WELCOME_PROMPTS = [
  "Что ты умеешь?",
  "Сколько сделок по стадиям?",
  "Покажи сделки в работе",
  "Сформируй краткую сводку по воронке",
];

function appendWelcome() {
  els.messagesEl.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "chat-welcome";
  wrap.innerHTML = `
    <h3>CRM-ассистент</h3>
    <p>Работайте со сделками, лидами, задачами, отчётами и документами Bitrix24. Выберите подсказку или напишите свой запрос.</p>
    <div class="chat-welcome-prompts">
      ${WELCOME_PROMPTS.map(
        (t) => `<button type="button" class="chat-prompt" data-prompt="${escapeHtml(t)}">${escapeHtml(t)}</button>`
      ).join("")}
    </div>`;
  els.messagesEl.appendChild(wrap);
  wrap.querySelectorAll("[data-prompt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!els.messageInput || !els.chatForm) return;
      els.messageInput.value = btn.dataset.prompt || "";
      els.messageInput.focus();
      els.chatForm.requestSubmit();
    });
  });
}

export function getSessionId() {
  return chatId || sessionId;
}

export function getChatId() {
  return chatId;
}

export function getCurrentChat() {
  return currentChat;
}

export async function createNewChat(projectId = null) {
  const data = await apiPost("/chats", { projectId, sessionId: `session-${Date.now()}` });
  if (!data.success) throw new Error(data.error?.message || "Не удалось создать чат");
  await selectChat(data.chat.id);
  return data.chat;
}

export async function resetSession() {
  const data = await apiPost("/chat/reset", { sessionId, projectId: currentChat?.projectId || null });
  if (!data.success && !data.ok) throw new Error(data.error?.message || "Сброс не выполнен");
  sessionId = data.sessionId || `session-${Date.now()}`;
  localStorage.setItem(SESSION_KEY, sessionId);
  chatId = data.chatId;
  localStorage.setItem(CHAT_KEY, chatId);
  pendingConfirmation = null;
  els.confirmationEl?.classList.add("hidden");
  appendWelcome();
  updateMeta({ title: data.title || "Новый диалог", id: chatId });
  onChatChanged?.(chatId);
  return chatId;
}

export async function selectChat(id) {
  chatId = id;
  localStorage.setItem(CHAT_KEY, id);
  document.getElementById("projectOverview")?.classList.add("hidden");
  document.getElementById("chatConversation")?.classList.remove("hidden");
  await loadChat(id);
  onChatChanged?.(id);
}

async function loadChat(id) {
  const [metaData, msgData] = await Promise.all([
    apiGet(`/chats/${id}`),
    apiGet(`/chats/${id}/messages?limit=80`),
  ]);
  if (!metaData.success) throw new Error("Чат не найден");

  currentChat = metaData.chat;
  sessionId = currentChat.sessionId || sessionId;
  els.messagesEl.innerHTML = "";
  updateMeta(currentChat);

  for (const msg of msgData.messages || []) {
    const role = msg.role === "system_note" ? "assistant" : msg.role === "user" ? "user" : "assistant";
    const text =
      role === "user" ? visibleUserText(msg.content, msg.metadata) : msg.content;
    appendMessage(role, text, {
      attachments: role === "user" ? msg.metadata?.attachments : null,
    });
  }

  if (!(msgData.messages || []).length) {
    appendWelcome();
  }
}

function updateMeta(chat) {
  if (!els.chatTitle) return;
  const link = els.crmCardLink || document.getElementById("crmCardLink");
  const refreshBtn = els.refreshCrmContextBtn || document.getElementById("refreshCrmContextBtn");
  const cards = els.crmContextCards || document.getElementById("crmContextCards");
  const crumbsEl = document.getElementById("chatBreadcrumbs");
  const menuBtn = document.getElementById("chatMetaMenuBtn");
  const menu = document.getElementById("chatMetaMenu");

  if (!chat) {
    els.chatTitle.textContent = "Новый чат";
    if (els.chatMetaLine) els.chatMetaLine.textContent = "";
    if (crumbsEl) crumbsEl.innerHTML = "";
    menuBtn?.classList.add("hidden");
    menu?.classList.add("hidden");
    link?.classList.add("hidden");
    refreshBtn?.classList.add("hidden");
    cards?.classList.add("hidden");
    if (cards) cards.innerHTML = "";
    return;
  }

  els.chatTitle.textContent = chat.title || "Диалог";
  const typeLabel = CARD_TYPE_LABELS[chat.crmEntityType] || CRM_TYPE_LABELS[chat.crmEntityType] || chat.crmEntityType;
  const parts = [];
  if (chat.projectName) parts.push(chat.projectName);
  if (chat.crmEntityType) parts.push(typeLabel);
  if (els.chatMetaLine) els.chatMetaLine.textContent = parts.join(" · ");
  refreshAiResolution();

  const compact = window.matchMedia("(max-width: 860px)").matches;
  if (crumbsEl) {
    let items;
    if (chat.projectId && chat.projectName) {
      items = [
        { label: "Проекты", action: "projects" },
        { label: chat.projectName, action: "project", id: chat.projectId },
        { label: chat.title || "Диалог", current: true },
      ];
    } else {
      items = [
        { label: "Чаты", action: "chats" },
        { label: chat.title || "Диалог", current: true },
      ];
    }
    crumbsEl.innerHTML = renderBreadcrumbs({ items, compact });
    wireBreadcrumbs(crumbsEl, {
      projects: async () => {
        const { openProjectOverview } = await import("./workspace/projectOverview.js");
        if (chat.projectId) await openProjectOverview(chat.projectId);
      },
      project: async (id) => {
        const { openProjectOverview } = await import("./workspace/projectOverview.js");
        if (id) await openProjectOverview(id);
      },
      chats: () => {
        document.getElementById("projectOverview")?.classList.add("hidden");
        document.getElementById("chatConversation")?.classList.remove("hidden");
      },
    });
  }

  if (menuBtn && menu) {
    menuBtn.classList.remove("hidden");
    const archived = chat.status === "archived";
    menu.innerHTML = `
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="rename" data-chat-id="${escapeHtml(chat.id)}">Переименовать</button>
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-open-move data-chat-id="${escapeHtml(chat.id)}">Переместить в проект</button>
      ${
        chat.projectId
          ? `<button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="move-project" data-chat-id="${escapeHtml(chat.id)}" data-project-id="">Убрать из проекта</button>`
          : ""
      }
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="duplicate" data-chat-id="${escapeHtml(chat.id)}">Дублировать</button>
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="${archived ? "restore" : "archive"}" data-chat-id="${escapeHtml(chat.id)}">${archived ? "Вернуть из архива" : "Архивировать"}</button>
      <button type="button" class="sidebar-dropdown-item sidebar-dropdown-item-danger" role="menuitem" data-chat-action="delete" data-chat-id="${escapeHtml(chat.id)}">Удалить</button>`;

    if (!menuBtn.dataset.wired) {
      menuBtn.dataset.wired = "1";
      menuBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = !menu.classList.contains("hidden");
        menu.classList.toggle("hidden", open);
        menuBtn.setAttribute("aria-expanded", open ? "false" : "true");
      });
    }

    menu.querySelectorAll("[data-chat-action], [data-open-move]").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        menu.classList.add("hidden");
        menuBtn.setAttribute("aria-expanded", "false");
        if (btn.hasAttribute("data-open-move")) {
          await openMoveProjectPicker(chat.id);
          return;
        }
        const { handleChatAction } = await import("./workspace/sidebar.js");
        await handleChatAction(btn.dataset.chatAction, btn.dataset.chatId, {
          projectId: btn.dataset.projectId,
        });
      };
    });
  }

  if (chat.crmEntityType && chat.crmEntityId) {
    const path = `/crm/${chat.crmEntityType}/details/${chat.crmEntityId}/`;
    if (link) {
      link.href = path;
      link.classList.remove("hidden");
      link.textContent = `Открыть: ${typeLabel}`;
    }
    refreshBtn?.classList.remove("hidden");
    if (refreshBtn && !refreshBtn.dataset.wired) {
      refreshBtn.dataset.wired = "1";
      refreshBtn.addEventListener("click", () => refreshCrmContext(chat));
    }
  } else {
    link?.classList.add("hidden");
    refreshBtn?.classList.add("hidden");
    cards?.classList.add("hidden");
  }
}

async function openMoveProjectPicker(chatId) {
  const { apiGet, apiPatch } = await import("../apiClient.js");
  const data = await apiGet("/projects");
  const projects = data.projects || [];
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-dialog" role="dialog" aria-modal="true">
      <h3 class="modal-title">Переместить в проект</h3>
      <div class="modal-list">
        <button type="button" class="sidebar-dropdown-item" data-project-id="">Без проекта</button>
        ${projects.map((p) => `<button type="button" class="sidebar-dropdown-item" data-project-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`).join("")}
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-secondary" data-cancel>Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  await new Promise((resolve) => {
    overlay.querySelector("[data-cancel]")?.addEventListener("click", () => {
      overlay.remove();
      resolve();
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        overlay.remove();
        resolve();
      }
    });
    overlay.querySelectorAll("[data-project-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const projectId = btn.dataset.projectId || null;
        await apiPatch(`/chats/${chatId}`, { projectId: projectId || null });
        overlay.remove();
        await selectChat(chatId);
        const { refreshSidebar } = await import("./workspace/sidebar.js");
        await refreshSidebar();
        resolve();
      });
    });
  });
}

async function refreshCrmContext(chat) {
  const cards = document.getElementById("crmContextCards");
  if (!cards || !chat?.crmEntityType || !chat?.crmEntityId) return;
  cards.classList.remove("hidden");
  cards.innerHTML = `<div class="crm-context-card"><span class="label">Загрузка…</span></div>`;
  try {
    const [ctx, sum] = await Promise.all([
      apiGet(
        `/crm/context/${chat.crmEntityType}/${chat.crmEntityId}?mode=compact&include=fields,relations,activities,timeline,communications`
      ),
      apiPost("/crm/context/summary", {
        entityType: chat.crmEntityType,
        entityId: Number(chat.crmEntityId),
        mode: "compact",
      }),
    ]);
    if (ctx.error) {
      cards.innerHTML = `<div class="crm-context-card"><span class="label">Ошибка</span><div>${escapeHtml(ctx.error.message || "")}</div></div>`;
      return;
    }
    const e = ctx.entity || {};
    if (els.chatMetaLine) {
      const stage = e.stage?.name ? ` · ${e.stage.name}` : "";
      const resp = e.responsible?.name ? ` · ${e.responsible.name}` : "";
      const typeLabel = CARD_TYPE_LABELS[e.type || chat.crmEntityType] || e.type || chat.crmEntityType;
      els.chatMetaLine.textContent = [
        chat.projectName || null,
        `${typeLabel}${stage}${resp}`,
      ]
        .filter(Boolean)
        .join(" · ");
    }
    const link = document.getElementById("crmCardLink");
    if (link && e.url) {
      link.href = e.url;
      link.classList.remove("hidden");
    }
    const overdue = e.state?.overdueActivities ?? ctx.state?.overdueActivities ?? 0;
    const commHtml = renderCommunicationsContextBlock(ctx.communications, ctx.warnings);
    cards.innerHTML = [
      card("Состояние", sum.currentState || e.title || "—"),
      card("Последняя коммуникация", sum.lastInteraction || ctx.state?.lastMeaningfulInteractionAt || "нет данных"),
      card("Следующее дело", ctx.state?.nextActivity?.title || sum.nextPlannedAction?.title || "не запланировано"),
      card("Просрочки", String(overdue)),
      card("Договорённости", (sum.agreements || []).map((a) => a.text || a).join("; ") || "не зафиксированы"),
      card("Риски", (sum.risks || []).map((r) => r.text || r).join("; ") || "не выявлены"),
      card(
        "Следующие шаги",
        (sum.recommendedNextSteps || []).map((s) => s.text || s.action || s).join("; ") || "—"
      ),
      commHtml,
    ].join("");
  } catch (err) {
    cards.innerHTML = `<div class="crm-context-card"><span class="label">Ошибка</span><div>${escapeHtml(err.message)}</div></div>`;
  }
}

function card(label, value) {
  return `<div class="crm-context-card"><span class="label">${escapeHtml(label)}</span><div>${escapeHtml(String(value ?? "—"))}</div></div>`;
}

/** Compact «Коммуникации» hook when context API includes communications data. */
function renderCommunicationsContextBlock(communications, warnings) {
  const list = Array.isArray(communications) ? communications : [];
  const hubUnavailable = (warnings || []).some((w) => w.code === "COMMUNICATIONS_SOURCE_UNAVAILABLE");
  const hubCtx = communications && !Array.isArray(communications) ? communications : null;

  if (hubCtx && (hubCtx.threads || hubCtx.recentMessages || hubCtx.preferredChannel)) {
    const unanswered = hubCtx.unanswered ? "да" : "нет";
    const seq = (hubCtx.activeSequences || []).length;
    const channel = labelOf(CHANNEL_LABELS, hubCtx.preferredChannel);
    const lastIn = hubCtx.lastInbound?.at || "—";
    return `<div class="crm-context-card crm-context-comms">
      <span class="label">Коммуникации</span>
      <div>канал: ${escapeHtml(String(channel))} · без ответа: ${escapeHtml(unanswered)} · цепочки: ${escapeHtml(String(seq))}</div>
      <div class="panel-desc">последний входящий: ${escapeHtml(String(lastIn))}</div>
    </div>`;
  }

  if (list.length) {
    const last = list[0];
    return `<div class="crm-context-card crm-context-comms">
      <span class="label">Коммуникации</span>
      <div>${escapeHtml(String(list.length))} записей · ${escapeHtml(labelOf(CHANNEL_LABELS, last.channel || last.type, "канал"))} · ${escapeHtml(last.status || "")}</div>
    </div>`;
  }

  if (hubUnavailable) {
    return `<div class="crm-context-card crm-context-comms">
      <span class="label">Коммуникации</span>
      <div class="panel-desc">История каналов пока недоступна. Полный раздел — вкладка «Коммуникации → Хаб».</div>
    </div>`;
  }

  return `<div class="crm-context-card crm-context-comms">
    <span class="label">Коммуникации</span>
    <div class="panel-desc">Нет данных переписки для этой сущности. Откройте «Хаб» для диалогов и каналов.</div>
  </div>`;
}

function setMessageContent(el, role, text) {
  if (role === "assistant") {
    el.classList.add("message-markdown");
    el.innerHTML = renderMarkdown(text);
    return;
  }
  el.textContent = text;
}

function appendMessage(role, text, options = {}) {
  const el = document.createElement("div");
  el.className = `message ${role}`;
  const body = document.createElement("div");
  body.className = "message-body";
  if (text) setMessageContent(body, role, text);
  el.appendChild(body);
  const chips = renderAttachmentChips(options.attachments);
  if (chips) el.appendChild(chips);
  els.messagesEl.appendChild(el);
  els.messagesEl.scrollTop = els.messagesEl.scrollHeight;
  return el;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (/[;"\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadBlob(filename, mimeType, data) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadCardTable(card) {
  const file = card?.download;
  if (file?.contentBase64) {
    const binary = atob(file.contentBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    downloadBlob(
      file.filename || "sverka-crm.xlsx",
      file.mimeType || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      bytes
    );
    return;
  }
  const columns = card?.table?.columns || [];
  const rows = card?.table?.rows || [];
  if (!columns.length) return;
  const lines = [columns.map(csvEscape).join(";"), ...rows.map((row) => row.map(csvEscape).join(";"))];
  downloadBlob(
    `sverka-crm-${new Date().toISOString().slice(0, 10)}.csv`,
    "text/csv;charset=utf-8",
    `\uFEFF${lines.join("\n")}`
  );
}

function renderResultCards(cards) {
  if (!cards?.length) return;
  const container = document.createElement("div");
  container.className = "result-cards";

  for (const card of cards) {
    const skipListTable = ["contact", "deal", "lead", "company", "task"].includes(card.type);
    const showTable = Boolean(card.table?.rows?.length) && !skipListTable;
    if (!card.fields?.length && !showTable) continue;

    const cardEl = document.createElement("div");
    cardEl.className = "result-card";
    cardEl.innerHTML = `
      <div class="result-card-header">
        <span class="result-card-title">${escapeHtml(card.title || "Результат")}</span>
        <div class="result-card-header-actions">
          ${
            showTable
              ? `<button type="button" class="result-card-download" data-export-card>Скачать Excel</button>`
              : ""
          }
          <span class="result-card-type">${escapeHtml(CARD_TYPE_LABELS[card.type] || card.type)}</span>
        </div>
      </div>
      <div class="result-card-body" data-card-body></div>
    `;
    const body = cardEl.querySelector("[data-card-body]");

    if (card.fields?.length) {
      const fieldsEl = document.createElement("div");
      fieldsEl.className = "result-card-fields";
      for (const field of card.fields) {
        fieldsEl.innerHTML += `
          <div class="result-card-field">
            <div class="label">${escapeHtml(field.label)}</div>
            <div class="value">${escapeHtml(String(field.value ?? "—"))}</div>
          </div>`;
      }
      body.appendChild(fieldsEl);
    }

    if (showTable) {
      const table = document.createElement("table");
      table.className = "result-card-table";
      table.innerHTML = `<thead><tr>${card.table.columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
      const tbody = document.createElement("tbody");
      for (const row of card.table.rows) {
        tbody.innerHTML += `<tr>${row.map((c) => `<td>${escapeHtml(String(c ?? "—"))}</td>`).join("")}</tr>`;
      }
      table.appendChild(tbody);
      body.appendChild(table);
      cardEl.querySelector("[data-export-card]")?.addEventListener("click", () => {
        downloadCardTable(card);
      });
    }

    container.appendChild(cardEl);
  }

  if (!container.childElementCount) return;
  els.messagesEl.appendChild(container);
  els.messagesEl.scrollTop = els.messagesEl.scrollHeight;
}

function showThinking() {
  thinkingEl = appendMessage("thinking", "Обработка запроса...");
}

function hideThinking() {
  thinkingEl?.remove();
  thinkingEl = null;
}

function setBusy(busy) {
  isBusy = busy;
  els.messageInput.disabled = busy;
  els.sendBtn.disabled = busy;
  els.confirmBtn.disabled = busy;
  els.cancelBtn.disabled = busy;
  const attachBtn = document.getElementById("chatAttachBtn");
  if (attachBtn) attachBtn.disabled = busy;
}

async function handleSubmit(event) {
  event.preventDefault();
  if (isBusy) return;
  const message = els.messageInput.value.trim();
  if (!message && !pendingAttachments.length) return;

  const filesSnapshot = pendingAttachments.slice();
  const attachmentPreview = pendingAttachments.map((item) => ({
    filename: item.file.name,
    sizeBytes: item.file.size,
  }));

  els.confirmationEl.classList.add("hidden");
  appendMessage("user", message, { attachments: attachmentPreview });
  els.messageInput.value = "";
  pendingAttachments = [];
  renderPendingAttachments();
  setAttachError("");
  setBusy(true);
  showThinking();

  try {
    const attachments = await serializePendingAttachments(filesSnapshot);
    const data = await sendChatMessage(message, attachments);
    hideThinking();
    if (data.chatId && data.chatId !== chatId) {
      chatId = data.chatId;
      localStorage.setItem(CHAT_KEY, chatId);
      onChatChanged?.(chatId);
    }
    appendMessage("assistant", data.answer || data.reply || "Готово.");
    // При подготовке write-операции детали уже в блоке подтверждения —
    // карточки поиска (таблица «Лиды» и т.п.) только дублируют и шумят.
    const hasConfirmation = Boolean(data.pendingConfirmation || data.confirmation);
    if (data.resultCards?.length && !hasConfirmation) {
      renderResultCards(data.resultCards);
    }
    if (hasConfirmation) {
      showConfirmation(data);
    }
    if (chatId) {
      const meta = await apiGet(`/chats/${chatId}`);
      if (meta.success) updateMeta(meta.chat);
    }
  } catch (error) {
    hideThinking();
    pendingAttachments = filesSnapshot;
    renderPendingAttachments();
    appendMessage("error", error.message || "Ошибка запроса");
  } finally {
    setBusy(false);
    els.messageInput.focus();
  }
}

function showConfirmation(data) {
  pendingConfirmation = data.pendingConfirmation || data.confirmation || data;
  if (els.confirmationTextEl) {
    els.confirmationTextEl.innerHTML = renderMarkdown(
      data.answer || data.reply || "Подтвердить действие?"
    );
    els.confirmationTextEl.classList.add("message-markdown");
  }
  const preview = pendingConfirmation?.preview || data.preview || {};
  const phrase = preview.requiredConfirmationPhrase || pendingConfirmation?.requiredConfirmationPhrase;
  const phraseWrap = document.getElementById("confirmationPhraseWrap");
  const phraseInput = document.getElementById("confirmationPhraseInput");
  const irrev = document.getElementById("confirmationIrreversible");
  if (phraseWrap && phraseInput) {
    if (phrase) {
      phraseWrap.classList.remove("hidden");
      phraseInput.value = "";
      phraseInput.placeholder = phrase;
    } else {
      phraseWrap.classList.add("hidden");
      phraseInput.value = "";
    }
  }
  if (irrev) {
    if (preview.reversible === false || preview.rollbackAvailable === false) {
      irrev.classList.remove("hidden");
    } else {
      irrev.classList.add("hidden");
    }
  }
  els.confirmationEl.classList.remove("hidden");
}

async function handleConfirm(confirm) {
  if (isBusy || !pendingConfirmation) return;
  setBusy(true);
  showThinking();
  try {
    const phraseInput = document.getElementById("confirmationPhraseInput");
    const data = await sendConfirmation(confirm, phraseInput?.value || null);
    hideThinking();
    els.confirmationEl.classList.add("hidden");
    pendingConfirmation = null;
    appendMessage(
      "assistant",
      data.answer || data.reply || (confirm ? "Готово." : "Действие отменено.")
    );
    if (data.resultCards?.length) renderResultCards(data.resultCards);
    if (data.pendingConfirmation || data.confirmation) showConfirmation(data);
  } catch (error) {
    hideThinking();
    appendMessage("error", error.message || "Ошибка подтверждения");
  } finally {
    setBusy(false);
    els.messageInput.focus();
  }
}

async function sendChatMessage(message, attachments = []) {
  try {
    const data = await apiPost("/chat", {
      message,
      sessionId,
      chatId,
      ...(attachments.length ? { attachments } : {}),
    });
    if (data.success === false) {
      throw new Error(data.error?.message || data.error || "Ошибка запроса");
    }
    return data;
  } catch (error) {
    throw new Error(error.data?.error?.message || error.message || "Ошибка запроса");
  }
}

async function sendConfirmation(confirm, confirmationPhrase = null) {
  try {
    const data = await apiPost("/chat/confirm", {
      sessionId,
      chatId,
      confirmationId: pendingConfirmation.confirmationId,
      confirm,
      confirmationPhrase,
    });
    if (data.success === false) {
      throw new Error(data.error?.message || data.error || "Ошибка подтверждения");
    }
    return data;
  } catch (error) {
    throw new Error(error.data?.error?.message || error.message || "Ошибка подтверждения");
  }
}
