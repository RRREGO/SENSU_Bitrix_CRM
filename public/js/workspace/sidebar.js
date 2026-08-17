import { apiDelete, apiGet, apiPatch, apiPost } from "../../apiClient.js";
import { escapeHtml } from "../utils.js";
import { createNewChat, selectChat, getChatId, getCurrentChat } from "../chat.js";
import {
  escAttr,
  renderPinMark,
} from "./helpers.js";
import { confirmDialog, promptDialog } from "./ui/confirmDialog.js";
import { renderSkeletonList } from "./ui/skeletonList.js";
import {
  closeAllMenus,
  closeFlyouts,
  ensureMenuDocumentClose,
  openPortaledMenu,
  positionFlyout,
  wireMenuToggle,
} from "./ui/contextMenu.js";
import {
  getCachedProjects,
  setCachedProjects,
  getChatsFilter,
  setChatsFilter,
  getChatsSort,
  getProjectsView,
  setProjectsView,
  isProjectExpanded,
  toggleProjectExpanded,
  expandProject,
  getSelectedProjectId,
  setSelectedProjectId,
  getSidebarCollapsed,
  setSidebarCollapsed,
  setFilterProjectId,
  getFilterProjectId,
} from "./state.js";

const FOLDER_ICON = `<span class="sidebar-item-icon" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg></span>`;
let hooks = {};

export function initSidebar(workspaceHooks) {
  hooks = workspaceHooks || {};
  ensureMenuDocumentClose();
  wireSidebarChrome();
  applySidebarCollapsed(getSidebarCollapsed());
}

function wireSidebarChrome() {
  const projectsMenuBtn = document.getElementById("projectsMenuBtn");
  const projectsSectionMenu = document.getElementById("projectsSectionMenu");
  const backToProjectsBtn = document.getElementById("backToProjectsBtn");
  const chatsMenuBtn = document.getElementById("chatsMenuBtn");
  const chatsSectionMenu = document.getElementById("chatsSectionMenu");
  const backToChatsBtn = document.getElementById("backToChatsBtn");
  const newProjectSidebarBtn = document.getElementById("newProjectSidebarBtn");
  const newChatSidebarBtn = document.getElementById("newChatSidebarBtn");
  const searchToggle = document.getElementById("sidebarSearchToggle");
  const searchWrap = document.getElementById("sidebarSearchWrap");
  const searchInput = document.getElementById("chatSearchInput");
  const collapseBtn = document.getElementById("sidebarCollapseBtn");
  const expandBtn = document.getElementById("sidebarExpandBtn");
  const mobileToggle = document.getElementById("mobileSidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");

  projectsMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !projectsSectionMenu?.classList.contains("hidden");
    closeAllMenus();
    if (!open && projectsSectionMenu) {
      openPortaledMenu(projectsSectionMenu, projectsMenuBtn);
    }
  });

  projectsSectionMenu?.querySelector('[data-projects-menu="archive"]')?.addEventListener("click", async () => {
    closeAllMenus();
    setProjectsView("archived-projects");
    await refreshSidebar();
  });

  backToProjectsBtn?.addEventListener("click", async () => {
    setProjectsView("projects");
    await refreshSidebar();
  });

  chatsMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !chatsSectionMenu?.classList.contains("hidden");
    closeAllMenus();
    if (!open && chatsSectionMenu) {
      openPortaledMenu(chatsSectionMenu, chatsMenuBtn);
    }
  });

  chatsSectionMenu?.querySelector('[data-chats-menu="archive"]')?.addEventListener("click", async () => {
    closeAllMenus();
    setFilterProjectId(null);
    setChatsFilter("archived");
    await refreshSidebar();
  });

  backToChatsBtn?.addEventListener("click", async () => {
    setChatsFilter("all");
    setFilterProjectId(null);
    await refreshSidebar();
  });

  newProjectSidebarBtn?.addEventListener("click", () => hooks.openCreateProject?.());
  newChatSidebarBtn?.addEventListener("click", () => document.getElementById("newChatBtn")?.click());

  searchToggle?.addEventListener("click", () => {
    const open = !searchWrap?.classList.contains("hidden");
    closeAllMenus();
    if (open) closeSidebarSearch();
    else openSidebarSearch();
  });

  searchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeSidebarSearch();
    }
  });

  collapseBtn?.addEventListener("click", () => {
    setSidebarCollapsed(true);
    applySidebarCollapsed(true);
  });
  expandBtn?.addEventListener("click", () => {
    setSidebarCollapsed(false);
    applySidebarCollapsed(false);
  });

  mobileToggle?.addEventListener("click", () => openMobileSidebar());
  backdrop?.addEventListener("click", () => closeMobileSidebar());
}

export function applySidebarCollapsed(collapsed) {
  const layout = document.querySelector(".chat-layout");
  layout?.classList.toggle("sidebar-collapsed", collapsed);
}

export function openMobileSidebar() {
  document.querySelector(".chat-layout")?.classList.add("sidebar-open");
  document.getElementById("sidebarBackdrop")?.classList.remove("hidden");
}

export function closeMobileSidebar() {
  document.querySelector(".chat-layout")?.classList.remove("sidebar-open");
  document.getElementById("sidebarBackdrop")?.classList.add("hidden");
}

function openSidebarSearch() {
  const wrap = document.getElementById("sidebarSearchWrap");
  const input = document.getElementById("chatSearchInput");
  wrap?.classList.remove("hidden");
  input?.focus();
}

function closeSidebarSearch() {
  const wrap = document.getElementById("sidebarSearchWrap");
  const input = document.getElementById("chatSearchInput");
  wrap?.classList.add("hidden");
  if (input) input.value = "";
  runSearch("", document.getElementById("searchResults"));
}

function buildChatsQuery() {
  const filter = getChatsFilter();
  const sort = getChatsSort();
  const params = new URLSearchParams();
  params.set("limit", "200");
  params.set("sort", sort);

  const projectFilter = getFilterProjectId();
  if (projectFilter) {
    params.set("projectId", projectFilter);
    params.set("status", filter === "archived" ? "archived" : "active");
    return `/chats?${params}`;
  }

  if (filter === "archived") {
    params.set("status", "archived");
  } else if (filter === "unassigned") {
    params.set("unassigned", "1");
    params.set("status", "active");
  } else if (filter === "projects") {
    params.set("status", "active");
  } else {
    params.set("status", "active");
  }
  return `/chats?${params}`;
}

let refreshPromise = null;

export function refreshSidebar() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = runRefreshSidebar().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function runRefreshSidebar() {
  const sidebarProjects = document.getElementById("sidebarProjects");
  const sidebarChats = document.getElementById("sidebarChats");
  if (!sidebarChats) return;

  closeAllMenus();

  if (getChatsFilter() === "unassigned" || getChatsFilter() === "projects") {
    setChatsFilter("all");
  }
  updateProjectsSectionChrome();
  updateChatsSectionChrome();
  renderChatsToolbar();

  const archivedProjects = getProjectsView() === "archived-projects";
  const chatsScroll = sidebarChats.scrollTop;
  const projectsScroll = sidebarProjects?.scrollTop || 0;
  const showSkeleton = !sidebarChats.querySelector(".sidebar-row, .sidebar-quiet-note");

  if (showSkeleton) {
    if (sidebarProjects) {
      sidebarProjects.innerHTML = renderSkeletonList({ rows: 3 });
    }
    sidebarChats.innerHTML = renderSkeletonList({ rows: 4 });
  }

  try {
    const [projectsRes, chatsRes] = await Promise.all([
      apiGet(archivedProjects ? "/projects?archived=true" : "/projects"),
      apiGet(buildChatsQuery()),
    ]);

    const projects = projectsRes.projects || [];
    setCachedProjects(projects);

    const chats = chatsRes.chats || [];
    const archived = getChatsFilter() === "archived";
    const { byProject, unassigned } = groupChatsByProject(chats);

    if (sidebarProjects) {
      if (archivedProjects) {
        if (!projects.length) {
          sidebarProjects.innerHTML = `<li class="sidebar-quiet-note">Архив пуст</li>`;
        } else {
          sidebarProjects.innerHTML = projects
            .map((p) => `<li class="sidebar-row">${renderProjectItem(p, { archived: true })}</li>`)
            .join("");
        }
      } else if (!projects.length) {
        sidebarProjects.innerHTML = `<li class="sidebar-quiet-note">Пока нет проектов</li>`;
      } else {
        sidebarProjects.innerHTML = projects
          .map((p) => {
            const nestedChats = archived ? [] : byProject.get(p.id) || [];
            const expanded = isProjectExpanded(p.id);
            const selected = getSelectedProjectId() === p.id;
            return `<li class="sidebar-row sidebar-project-row${expanded ? " is-expanded" : ""}${selected ? " is-selected" : ""}">${renderProjectItem(p, { nestedChats })}</li>`;
          })
          .join("");
      }
      wireProjectItems(sidebarProjects);
      sidebarProjects.scrollTop = projectsScroll;
    }

    const generalChats = archived ? chats : unassigned;
    if (!generalChats.length) {
      sidebarChats.innerHTML = `<li class="sidebar-quiet-note">${archived ? "Архив пуст" : "Пока нет общих чатов"}</li>`;
    } else {
      sidebarChats.innerHTML = generalChats.map((c) => renderChatItem(c, archived)).join("");
    }
    wireChatItems(sidebarChats);
    sidebarChats.scrollTop = chatsScroll;
  } catch (err) {
    const msg = escapeHtml(err.message || "Ошибка загрузки");
    if (sidebarProjects) {
      sidebarProjects.innerHTML = `<li><p class="project-note">${msg}</p></li>`;
    }
    sidebarChats.innerHTML = `<li>
      <div class="empty-state empty-state--sm empty-state--inset">
        <p class="empty-state-title">Ошибка</p>
        <p class="empty-state-text">${msg}</p>
        <div class="empty-state-actions"><button type="button" class="btn btn-secondary btn-sm" data-retry>Повторить</button></div>
      </div>
    </li>`;
    sidebarChats.querySelector("[data-retry]")?.addEventListener("click", () => refreshSidebar());
  }
}

function updateProjectsSectionChrome() {
  const titleEl = document.getElementById("sidebarProjectsTitle");
  const menuBtn = document.getElementById("projectsMenuBtn");
  const newBtn = document.getElementById("newProjectSidebarBtn");
  const backBtn = document.getElementById("backToProjectsBtn");
  const archived = getProjectsView() === "archived-projects";
  if (titleEl) titleEl.textContent = archived ? "Архивные проекты" : "Проекты";
  menuBtn?.classList.toggle("hidden", archived);
  newBtn?.classList.toggle("hidden", archived);
  backBtn?.classList.toggle("hidden", !archived);
}

function updateChatsSectionChrome() {
  const titleEl = document.getElementById("sidebarChatsTitle");
  const menuBtn = document.getElementById("chatsMenuBtn");
  const newBtn = document.getElementById("newChatSidebarBtn");
  const backBtn = document.getElementById("backToChatsBtn");
  const archived = getChatsFilter() === "archived";
  if (titleEl) titleEl.textContent = archived ? "Архив" : "Общие чаты";
  menuBtn?.classList.toggle("hidden", archived);
  newBtn?.classList.toggle("hidden", archived);
  backBtn?.classList.toggle("hidden", !archived);
}

function renderChatsToolbar() {
  const toolbar = document.getElementById("chatsFilterBar");
  if (!toolbar) return;
  const filterProjectId = getFilterProjectId();
  const filterLabel = filterProjectId
    ? getCachedProjects().find((p) => p.id === filterProjectId)?.name
    : null;

  if (!filterLabel) {
    toolbar.classList.add("hidden");
    toolbar.innerHTML = "";
    return;
  }

  toolbar.classList.remove("hidden");
  toolbar.innerHTML = `<div class="sidebar-filter-chip">
    <span>${escapeHtml(filterLabel)}</span>
    <button type="button" class="sidebar-icon-btn" data-clear-project-filter aria-label="Сбросить фильтр">×</button>
  </div>`;

  toolbar.querySelector("[data-clear-project-filter]")?.addEventListener("click", async () => {
    setFilterProjectId(null);
    setChatsFilter("all");
    await refreshSidebar();
  });
}

function groupChatsByProject(chats) {
  const byProject = new Map();
  const unassigned = [];
  for (const chat of chats) {
    if (chat.projectId) {
      const list = byProject.get(chat.projectId) || [];
      list.push(chat);
      byProject.set(chat.projectId, list);
    } else {
      unassigned.push(chat);
    }
  }
  return { byProject, unassigned };
}

function renderProjectItem(project, { archived = false, nestedChats = [] } = {}) {
  const selected = getSelectedProjectId() === project.id ? " active" : "";
  const expanded = !archived && isProjectExpanded(project.id);

  const menuItems = archived
    ? `
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-project-action="restore" data-project-id="${escAttr(project.id)}">Вернуть из архива</button>
      <button type="button" class="sidebar-dropdown-item sidebar-dropdown-item-danger" role="menuitem" data-project-action="delete" data-project-id="${escAttr(project.id)}">Удалить</button>`
    : `
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-project-action="open" data-project-id="${escAttr(project.id)}">Открыть</button>
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-project-action="new-chat" data-project-id="${escAttr(project.id)}">Новый чат</button>
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-project-action="rename" data-project-id="${escAttr(project.id)}">Переименовать</button>
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-project-action="settings" data-project-id="${escAttr(project.id)}">Настройки</button>
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-project-action="duplicate" data-project-id="${escAttr(project.id)}">Дублировать</button>
      <button type="button" class="sidebar-dropdown-item" role="menuitem" data-project-action="archive" data-project-id="${escAttr(project.id)}">Архивировать</button>
      <button type="button" class="sidebar-dropdown-item sidebar-dropdown-item-danger" role="menuitem" data-project-action="delete" data-project-id="${escAttr(project.id)}">Удалить</button>`;

  const nested =
    expanded
      ? `<ul class="sidebar-nested-list">
          ${
            nestedChats.length
              ? nestedChats.map((c) => renderChatItem(c, false, true)).join("")
              : `<li class="sidebar-quiet-note">Нет чатов</li>`
          }
        </ul>`
      : "";

  return `
    <div class="sidebar-row-card">
      ${
        archived
          ? ""
          : `<button type="button" class="sidebar-expand-btn" data-expand-project="${escAttr(project.id)}" aria-expanded="${expanded ? "true" : "false"}" aria-label="${expanded ? "Свернуть" : "Развернуть"}">
              <span class="sidebar-expand-icon" aria-hidden="true"></span>
            </button>`
      }
      <button type="button" class="sidebar-item${selected}" data-project-id="${escAttr(project.id)}">
        ${FOLDER_ICON}
        <span class="sidebar-item-title">${renderPinMark(project.isPinned)}${escapeHtml(project.name)}</span>
      </button>
      <div class="sidebar-item-menu-wrap">
        <button type="button" class="sidebar-item-menu-btn" data-project-menu="${escAttr(project.id)}" aria-label="Действия с проектом" aria-haspopup="true" aria-expanded="false" title="Действия">⋯</button>
        <div class="sidebar-dropdown sidebar-entity-menu hidden" role="menu">${menuItems}</div>
      </div>
    </div>
    ${nested}`;
}

function renderChatItem(chat, archived = false, nested = false) {
  const active = chat.id === getChatId() ? " active" : "";
  const archiveActionLabel = archived ? "Вернуть из архива" : "Архивировать";
  const archiveAction = archived ? "restore" : "archive";

  const projectOptions = [
    `<button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="move-project" data-chat-id="${escAttr(chat.id)}" data-project-id="">Без проекта</button>`,
    ...getCachedProjects().map(
      (p) =>
        `<button type="button" class="sidebar-dropdown-item${p.id === chat.projectId ? " is-current" : ""}" role="menuitem" data-chat-action="move-project" data-chat-id="${escAttr(chat.id)}" data-project-id="${escAttr(p.id)}">${escapeHtml(p.name)}</button>`
    ),
  ];
  if (!getCachedProjects().length) {
    projectOptions.push(`<span class="sidebar-dropdown-empty">Нет проектов</span>`);
  }

  return `<li class="sidebar-row${archived ? " is-archived" : ""}">
    <div class="sidebar-row-card">
      <button type="button" class="sidebar-item${nested ? " sidebar-item--nested" : ""}${active}" data-chat-id="${escAttr(chat.id)}" data-project-id="${escAttr(chat.projectId || "")}">
        <span class="sidebar-item-title">${renderPinMark(chat.isPinned)}${escapeHtml(chat.title || "Диалог")}</span>
      </button>
      <div class="sidebar-item-menu-wrap">
        <button type="button" class="sidebar-item-menu-btn" data-chat-menu="${escAttr(chat.id)}" aria-label="Действия с чатом" aria-haspopup="true" aria-expanded="false" title="Действия">⋯</button>
        <div class="sidebar-dropdown sidebar-entity-menu hidden" role="menu">
          <button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="open" data-chat-id="${escAttr(chat.id)}">Открыть</button>
          <button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="rename" data-chat-id="${escAttr(chat.id)}">Переименовать</button>
          <div class="sidebar-menu-flyout-wrap">
            <button type="button" class="sidebar-dropdown-item sidebar-dropdown-item-nav" role="menuitem" data-open-flyout aria-haspopup="true" aria-expanded="false">
              <span>Переместить</span>
              <span class="sidebar-submenu-caret" aria-hidden="true">›</span>
            </button>
            <div class="sidebar-flyout hidden" role="menu">${projectOptions.join("")}</div>
          </div>
          ${
            chat.projectId
              ? `<button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="move-project" data-chat-id="${escAttr(chat.id)}" data-project-id="">Убрать из проекта</button>`
              : ""
          }
          <button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="duplicate" data-chat-id="${escAttr(chat.id)}">Дублировать</button>
          <button type="button" class="sidebar-dropdown-item" role="menuitem" data-chat-action="${archiveAction}" data-chat-id="${escAttr(chat.id)}">${archiveActionLabel}</button>
          <button type="button" class="sidebar-dropdown-item sidebar-dropdown-item-danger" role="menuitem" data-chat-action="delete" data-chat-id="${escAttr(chat.id)}">Удалить</button>
        </div>
      </div>
    </div>
  </li>`;
}

function wireProjectItems(root) {
  root.querySelectorAll("[data-expand-project]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      toggleProjectExpanded(btn.dataset.expandProject);
      await refreshSidebar();
    });
  });

  root.querySelectorAll("[data-project-id].sidebar-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      toggleProjectExpanded(btn.dataset.projectId);
      await refreshSidebar();
    });
  });

  wireMenuToggle(root, "[data-project-menu]", ".sidebar-entity-menu");

  root.querySelectorAll("[data-project-action]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const action = btn.dataset.projectAction;
      const id = btn.dataset.projectId;
      closeAllMenus();
      await handleProjectAction(action, id);
    });
  });

  wireChatItems(root);
}

function wireChatItems(root) {
  root.querySelectorAll("[data-chat-id].sidebar-item").forEach((btn) => {
    // avoid double-binding if already has listener via clone — replace node pattern not used
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", async () => {
      const projectId = btn.dataset.projectId || null;
      if (projectId) expandProject(projectId);
      setSelectedProjectId(projectId);
      await selectChat(btn.dataset.chatId);
      hooks.showChatView?.();
      hooks.onOpenChatTab?.();
      closeMobileSidebar();
    });
  });

  wireMenuToggle(root, "[data-chat-menu]", ".sidebar-entity-menu");

  root.querySelectorAll("[data-open-flyout]").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const wrap = btn.closest(".sidebar-menu-flyout-wrap");
      const chatId =
        btn.closest(".sidebar-item-menu-wrap")?.querySelector("[data-chat-menu]")?.dataset.chatMenu || "";
      const flyout = wrap?.querySelector(".sidebar-flyout");
      if (!flyout) return;
      const wasOpen = !flyout.classList.contains("hidden");
      closeFlyouts();
      if (!wasOpen) {
        flyout.dataset.flyoutFor = chatId;
        if (wrap) wrap.dataset.flyoutOwner = chatId;
        document.body.appendChild(flyout);
        flyout.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
        positionFlyout(flyout, btn);
      }
    });
  });

  root.querySelectorAll("[data-chat-action]").forEach((btn) => {
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      closeAllMenus();
      await handleChatAction(btn.dataset.chatAction, btn.dataset.chatId, {
        projectId: btn.dataset.projectId,
        pinned: btn.dataset.pinned === "1",
      });
    });
  });
}

async function handleProjectAction(action, projectId) {
  if (!projectId) return;

  if (action === "open") {
    expandProject(projectId);
    await hooks.openProjectOverview?.(projectId);
    await refreshSidebar();
    return;
  }
  if (action === "settings") {
    await hooks.openProjectSettings?.(projectId);
    return;
  }
  if (action === "new-chat") {
    expandProject(projectId);
    setSelectedProjectId(projectId);
    await createNewChat(projectId);
    hooks.showChatView?.();
    hooks.onOpenChatTab?.();
    return;
  }
  if (action === "rename") {
    const project = getCachedProjects().find((p) => p.id === projectId);
    const next = await promptDialog({
      title: "Переименовать проект",
      defaultValue: project?.name || "Проект",
    });
    if (!next) return;
    await apiPatch(`/projects/${projectId}`, { name: next });
    await hooks.refreshProjects?.();
    await refreshSidebar();
    return;
  }
  if (action === "duplicate") {
    const res = await apiPost(`/projects/${projectId}/duplicate`, {});
    await refreshSidebar();
    await hooks.refreshProjects?.();
    if (res?.project?.id) {
      await hooks.openProjectOverview?.(res.project.id);
    }
    return;
  }
  if (action === "archive") {
    const ok = await confirmDialog({
      title: "Архивировать проект?",
      message: "Проект будет скрыт из списка. Данные и чаты сохранятся.",
      confirmLabel: "Архивировать",
    });
    if (!ok) return;
    await apiPost(`/projects/${projectId}/archive`, {}, { throwOnError: false });
    if (getSelectedProjectId() === projectId) {
      setSelectedProjectId(null);
      hooks.showChatView?.();
    }
    await hooks.refreshProjects?.();
    await refreshSidebar();
    return;
  }
  if (action === "restore") {
    await apiPost(`/projects/${projectId}/restore`, {}, { throwOnError: false });
    await refreshSidebar();
    return;
  }
  if (action === "delete") {
    const ok = await confirmDialog({
      title: "Удалить проект?",
      message:
        "Проект и все его чаты с сообщениями будут удалены безвозвратно. Файлы проекта тоже удалятся.",
      confirmLabel: "Удалить всё",
      danger: true,
    });
    if (!ok) return;
    await apiDelete(`/projects/${projectId}?permanent=true`);
    if (getSelectedProjectId() === projectId) {
      setSelectedProjectId(null);
      hooks.showChatView?.();
    }
    await hooks.refreshProjects?.();
    await refreshSidebar();
  }
}

export async function handleChatAction(action, chatId, extras = {}) {
  if (!chatId) return;

  if (action === "open") {
    await selectChat(chatId);
    hooks.showChatView?.();
    hooks.onOpenChatTab?.();
    closeMobileSidebar();
    return;
  }
  if (action === "rename") {
    const current = getCurrentChat?.();
    const fallback =
      document.querySelector(`.sidebar-item[data-chat-id="${CSS.escape?.(chatId) || chatId}"] .sidebar-item-title`)
        ?.textContent || "Диалог";
    const next = await promptDialog({
      title: "Переименовать чат",
      defaultValue: (current?.id === chatId ? current.title : null) || fallback.trim(),
    });
    if (!next) return;
    await apiPatch(`/chats/${chatId}`, { title: next });
    await refreshSidebar();
    hooks.refreshChatMeta?.(chatId);
    return;
  }
  if (action === "move-project") {
    const projectId = extras.projectId === "" || extras.projectId == null ? null : extras.projectId;
    await apiPatch(`/chats/${chatId}`, { projectId });
    if (projectId) expandProject(projectId);
    setSelectedProjectId(projectId);
    await refreshSidebar();
    hooks.refreshChatMeta?.(chatId);
    return;
  }
  if (action === "duplicate") {
    const res = await apiPost(`/chats/${chatId}/duplicate`, {});
    if (res?.chat?.id) {
      await selectChat(res.chat.id);
      hooks.showChatView?.();
    }
    await refreshSidebar();
    return;
  }
  if (action === "archive") {
    await apiDelete(`/chats/${chatId}`);
    if (chatId === getChatId()) {
      await createNewChat();
      hooks.showChatView?.();
    }
    await refreshSidebar();
    return;
  }
  if (action === "restore") {
    await apiPost(`/chats/${chatId}/restore`, {}, { throwOnError: false });
    await refreshSidebar();
    return;
  }
  if (action === "delete") {
    const ok = await confirmDialog({
      title: "Удалить чат?",
      message: "Чат и сообщения будут удалены безвозвратно.",
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    await apiDelete(`/chats/${chatId}?permanent=true`);
    if (chatId === getChatId()) {
      await createNewChat();
      hooks.showChatView?.();
    }
    await refreshSidebar();
  }
}

export async function runSearch(query, container) {
  if (!container) return;
  const q = query.trim();
  const listsHidden = Boolean(q);
  document.getElementById("sidebarProjectsSection")?.classList.toggle("hidden", listsHidden);
  document.getElementById("sidebarChatsSection")?.classList.toggle("hidden", listsHidden);
  if (!q) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  const data = await apiGet(`/search?q=${encodeURIComponent(q)}`);
  container.classList.remove("hidden");
  const results = data.results || [];
  if (!results.length) {
    container.innerHTML = `<p class="sidebar-quiet-note">Ничего не найдено</p>`;
    return;
  }
  container.innerHTML = results
    .map(
      (r) =>
        `<button type="button" class="sidebar-item" data-search-type="${escAttr(r.entityType)}" data-search-id="${escAttr(r.entityId)}">
          <span class="sidebar-item-title">${escapeHtml(r.title || r.entityType)}</span>
        </button>`
    )
    .join("");

  container.querySelectorAll("[data-search-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (btn.dataset.searchType === "chat" || btn.dataset.searchType === "message") {
        if (btn.dataset.searchType === "message") {
          const chats = await apiGet(`/chats?status=active&limit=100&q=${encodeURIComponent(btn.querySelector(".sidebar-item-title")?.textContent || "")}`);
          const match = (chats.chats || []).find(
            (c) => c.title === btn.querySelector(".sidebar-item-title")?.textContent
          );
          if (match) await selectChat(match.id);
        } else {
          await selectChat(btn.dataset.searchId);
        }
        const chat = getCurrentChat?.();
        if (chat?.projectId) expandProject(chat.projectId);
        setSelectedProjectId(chat?.projectId || null);
        closeSidebarSearch();
        hooks.showChatView?.();
        await refreshSidebar();
        hooks.onOpenChatTab?.();
        closeMobileSidebar();
      } else if (btn.dataset.searchType === "project") {
        await hooks.openProjectOverview?.(btn.dataset.searchId);
        await refreshSidebar();
      }
    });
  });
}
