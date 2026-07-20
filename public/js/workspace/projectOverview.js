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
        <header class="project-overview-header">
          <div class="project-overview-heading">
            <h2 class="project-overview-title">${escapeHtml(p.name)}</h2>
            ${p.description ? `<p class="project-overview-desc">${escapeHtml(p.description)}</p>` : ""}
            <div class="project-overview-stats">
              <span>${files.length} ${plural(files.length, "файл", "файла", "файлов")}</span>
              <span class="project-overview-stats-sep" aria-hidden="true">·</span>
              <span>${chats.length} ${plural(chats.length, "чат", "чата", "чатов")}</span>
              <span class="project-overview-stats-sep" aria-hidden="true">·</span>
              <span>${escapeHtml(formatRelativeDate(p.lastActivityAt || p.updatedAt) || "Нет активности")}</span>
            </div>
            ${
              bindings.length
                ? `<div class="project-overview-bindings">${bindings
                    .slice(0, 6)
                    .map((b) => `<span class="chip chip-muted">${escapeHtml(formatCrmBinding(b))}</span>`)
                    .join("")}</div>`
                : ""
            }
          </div>
          <div class="project-overview-actions">
            <button type="button" class="btn btn-secondary" data-settings>Настройки</button>
            <button type="button" class="btn btn-primary" data-new-chat>Новый чат</button>
          </div>
        </header>

        <section class="project-overview-chats">
          <h3 class="section-title">Последние чаты</h3>
          ${
            chats.length
              ? `<ul class="project-chat-list project-chat-list--overview">
                  ${chats
                    .slice(0, 12)
                    .map((c) => {
                      const preview = escapeHtml((c.lastMessagePreview || "").slice(0, 80));
                      const meta = formatRelativeDate(c.lastActivityAt || c.updatedAt);
                      return `<li>
                        <button type="button" class="project-chat-item" data-chat-id="${escAttr(c.id)}">
                          <span class="project-chat-item-title">${escapeHtml(c.title || "Диалог")}</span>
                          ${preview ? `<span class="project-chat-item-preview">${preview}</span>` : ""}
                          ${meta ? `<span class="project-chat-item-meta">${escapeHtml(meta)}</span>` : ""}
                        </button>
                      </li>`;
                    })
                    .join("")}
                </ul>`
              : `<div class="project-overview-empty">
                  <p class="project-overview-empty-title">В этом проекте пока нет чатов</p>
                  <p class="project-overview-empty-text">Начните первый диалог — ассистент уже учтёт файлы, инструкции и CRM-контекст проекта.</p>
                </div>`
          }
        </section>
      </div>`;

    const startChat = async () => {
      await createNewChat(projectId);
      showChatView();
      await hooks.refreshSidebar?.();
    };

    root.querySelector("[data-new-chat]")?.addEventListener("click", startChat);
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

function plural(n, one, few, many) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}
