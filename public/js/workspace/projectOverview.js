import { apiGet } from "../../apiClient.js";
import { escapeHtml } from "../utils.js";
import { createNewChat, selectChat } from "../chat.js";
import {
  escAttr,
  formatCrmBinding,
  formatRelativeDate,
} from "./helpers.js";
import { renderEmptyState } from "./ui/emptyState.js";
import { renderSkeletonList } from "./ui/skeletonList.js";
import {
  setMainView,
  setSelectedProjectId,
  getSelectedProjectId,
} from "./state.js";

let hooks = {};

export function initProjectOverview(workspaceHooks) {
  hooks = workspaceHooks || {};
}

export function showChatView() {
  setMainView("chat");
  const overview = document.getElementById("projectOverview");
  const conversation = document.getElementById("chatConversation");
  overview?.classList.add("hidden");
  conversation?.classList.remove("hidden");
}

export function showOverviewView() {
  setMainView("overview");
  const overview = document.getElementById("projectOverview");
  const conversation = document.getElementById("chatConversation");
  overview?.classList.remove("hidden");
  conversation?.classList.add("hidden");
}

export async function openProjectOverview(projectId) {
  if (!projectId) return;
  setSelectedProjectId(projectId);
  showOverviewView();
  hooks.onOpenChatTab?.();

  const root = document.getElementById("projectOverview");
  if (!root) return;
  root.innerHTML = renderSkeletonList({ rows: 5 });

  try {
    const data = await apiGet(`/projects/${projectId}`);
    if (!data.success || !data.project) {
      root.innerHTML = renderEmptyState({
        title: "Проект не найден",
        text: "Выберите другой проект в боковой панели.",
        actionsHtml: `<button type="button" class="btn btn-secondary" data-back-chats>К чатам</button>`,
      });
      root.querySelector("[data-back-chats]")?.addEventListener("click", () => {
        showChatView();
      });
      return;
    }

    const p = data.project;
    const files = data.files || [];
    const chats = data.chats || [];
    const bindings = (p.crmBindings || []).length
      ? p.crmBindings
      : collectBindingsFromChats(chats);

    const colorClass = p.colorKey ? ` project-color--${escAttr(p.colorKey)}` : "";

    root.innerHTML = `
      <div class="project-overview${colorClass}">
        <aside class="project-overview-side" aria-label="Параметры проекта">
          <h3 class="project-overview-panel-title">Проект</h3>
          <div class="project-overview-side-body">
            <h2 class="project-overview-title">${escapeHtml(p.name)}</h2>
            ${p.description ? `<p class="project-overview-desc">${escapeHtml(p.description)}</p>` : ""}
            <dl class="project-overview-meta">
              <div class="project-overview-meta-row">
                <dt>Файлы</dt>
                <dd>${files.length}</dd>
              </div>
              <div class="project-overview-meta-row">
                <dt>Чаты</dt>
                <dd>${chats.length}</dd>
              </div>
              <div class="project-overview-meta-row">
                <dt>Активность</dt>
                <dd>${escapeHtml(formatRelativeDate(p.lastActivityAt || p.updatedAt) || "Нет")}</dd>
              </div>
            </dl>
            ${
              bindings.length
                ? `<div class="project-overview-bindings">
                    <span class="project-overview-bindings-label">CRM</span>
                    <div class="project-overview-bindings-list">${bindings
                      .slice(0, 6)
                      .map((b) => `<span class="chip chip-muted">${escapeHtml(formatCrmBinding(b))}</span>`)
                      .join("")}</div>
                  </div>`
                : ""
            }
          </div>
          <div class="project-overview-side-actions">
            <button type="button" class="btn btn-primary project-overview-primary-btn" data-new-chat>Новый чат</button>
            <button type="button" class="btn btn-secondary" data-settings>Настройки</button>
          </div>
        </aside>

        <section class="project-overview-main" aria-label="Чаты проекта">
          <div class="project-overview-main-toolbar">
            <h3 class="project-overview-panel-title">Последние чаты</h3>
            <span class="project-overview-count">${chats.length}</span>
          </div>
          ${
            chats.length
              ? `<ul class="project-chat-list project-chat-list--overview">
                  ${chats
                    .slice(0, 12)
                    .map((c) => {
                      const preview = escapeHtml((c.lastMessagePreview || "").slice(0, 120));
                      const meta = formatRelativeDate(c.lastActivityAt || c.updatedAt);
                      return `<li>
                        <button type="button" class="project-chat-item" data-chat-id="${escAttr(c.id)}">
                          <span class="project-chat-item-top">
                            <span class="project-chat-item-title">${escapeHtml(c.title || "Диалог")}</span>
                            ${meta ? `<span class="project-chat-item-meta">${escapeHtml(meta)}</span>` : ""}
                          </span>
                          ${preview ? `<span class="project-chat-item-preview">${preview}</span>` : ""}
                        </button>
                      </li>`;
                    })
                    .join("")}
                </ul>`
              : `<div class="project-overview-empty">
                  <p class="project-overview-empty-title">В этом проекте пока нет чатов</p>
                  <p class="project-overview-empty-text">Начните первый диалог — ассистент уже учтёт файлы, инструкции и CRM-контекст проекта.</p>
                  <button type="button" class="btn btn-primary" data-new-chat-empty>Новый чат</button>
                </div>`
          }
        </section>
      </div>`;

    const startChat = async () => {
      await createNewChat(projectId);
      showChatView();
      await hooks.refreshSidebar?.();
    };

    root.querySelectorAll("[data-new-chat], [data-new-chat-empty]").forEach((btn) => {
      btn.addEventListener("click", startChat);
    });
    root.querySelector("[data-settings]")?.addEventListener("click", () => {
      hooks.openProjectSettings?.(projectId);
    });
    root.querySelectorAll("[data-chat-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await selectChat(btn.dataset.chatId);
        showChatView();
        await hooks.refreshSidebar?.();
        hooks.closeMobileSidebar?.();
      });
    });
  } catch (err) {
    root.innerHTML = renderEmptyState({
      title: "Не удалось открыть проект",
      text: err.message || "Попробуйте ещё раз.",
      actionsHtml: `<button type="button" class="btn btn-secondary" data-retry>Повторить</button>`,
    });
    root.querySelector("[data-retry]")?.addEventListener("click", () => {
      openProjectOverview(projectId);
    });
  }
}

export async function restoreSelectedProjectIfNeeded() {
  const id = getSelectedProjectId();
  if (!id) return;
  // Only restore overview if no chat is actively being shown with content preference —
  // user asked selected project to persist; restore overview when landing.
}

function collectBindingsFromChats(chats) {
  const map = new Map();
  for (const c of chats || []) {
    if (!c.crmEntityType) continue;
    const key = `${c.crmEntityType}:${c.crmEntityId || ""}`;
    if (!map.has(key)) {
      map.set(key, {
        type: c.crmEntityType,
        id: c.crmEntityId,
        title: c.title || null,
      });
    }
  }
  return [...map.values()];
}
