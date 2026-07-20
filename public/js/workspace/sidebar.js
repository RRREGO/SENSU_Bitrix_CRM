import { apiDelete, apiGet, apiPatch, apiPost } from "../../apiClient.js";
import { escapeHtml } from "../utils.js";
import { createNewChat, selectChat, getChatId, getCurrentChat } from "../chat.js";
import {
  escAttr,
  formatRelativeDate,
  renderPinMark,
} from "./helpers.js";
import { renderEmptyState } from "./ui/emptyState.js";
import { confirmDialog, promptDialog } from "./ui/confirmDialog.js";
import { renderSkeletonList } from "./ui/skeletonList.js";
import { renderFilterTabs, wireFilterTabs } from "./ui/filterTabs.js";
import {
  closeAllMenus,
  closeFlyouts,
  ensureMenuDocumentClose,
  positionFlyout,
  wireMenuToggle,
} from "./ui/contextMenu.js";
import {
  getCachedProjects,
  setCachedProjects,
  getChatsFilter,
  setChatsFilter,
  getChatsSort,
  setChatsSort,
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

const NESTED_CHAT_LIMIT = 5;
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
  const collapseBtn = document.getElementById("sidebarCollapseBtn");
  const expandBtn = document.getElementById("sidebarExpandBtn");
  const mobileToggle = document.getElementById("mobileSidebarToggle");
  const backdrop = document.getElementById("sidebarBackdrop");

  projectsMenuBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = !projectsSectionMenu?.classList.contains("hidden");
    closeAllMenus();
    if (!open && projectsSectionMenu) {
      projectsSectionMenu.classList.remove("hidden");
      projectsMenuBtn.setAttribute("aria-expanded", "true");
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

function buildChatsQuery() {
  const filter = getChatsFilter();
  const sort = getChatsSort();
  const params = new URLSearchParams();
  params.set("limit", "40");
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

export async function refreshSidebar() {
  const sidebarProjects = document.getElementById("sidebarProjects");
  const sidebarChats = document.getElementById("sidebarChats");
  if (!sidebarChats) return;

  updateProjectsSectionChrome();
  renderChatsToolbar();

  const archivedProjects = getProjectsView() === "archived-projects";
  if (sidebarProjects) {
    sidebarProjects.innerHTML = renderSkeletonList({ rows: 3 });
  }
  sidebarChats.innerHTML = renderSkeletonList({ rows: 4 });

  try {
    const [projectsRes, chatsRes] = await Promise.all([
      apiGet(archivedProjects ? "/projects?archived=true" : "/projects"),
      apiGet(buildChatsQuery()),
    ]);

    const projects = projectsRes.projects || [];
    setCachedProjects(projects);

    if (sidebarProjects) {
      if (archivedProjects) {
        if (!projects.length) {
          sidebarProjects.innerHTML = `<li>${renderEmptyState({
            title: "Архив пуст",
            text: "Архивные проекты появятся здесь.",
            size: "sm",
            inset: true,
          })}</li>`;
        } else {
          sidebarProjects.innerHTML = projects
            .map((p) => `<li class="sidebar-row">${renderProjectItem(p, { archived: true })}</li>`)
            .join("");
        }
      } else if (!projects.length) {
        sidebarProjects.innerHTML = `<li>${renderEmptyState({
          title: "Нет проектов",
          text: "Создайте рабочее пространство для связанных чатов, файлов и CRM-контекста.",
          actionsHtml: `<button type="button" class="btn btn-primary btn-sm" data-new-project>Создать проект</button>`,
          size: "sm",
          inset: true,
        })}</li>`;
      } else {
        const items = await Promise.all(projects.map((p) => renderProjectItemWithChats(p)));
        const newProjectRow = `<li>
          <button type="button" class="sidebar-item sidebar-item-new-project" data-new-project>
            <span class="sidebar-item-title">Новый проект</span>
          </button>
        </li>`;
        sidebarProjects.innerHTML = items.join("") + newProjectRow;
      }
      wireProjectItems(sidebarProjects);
    }

    let chats = chatsRes.chats || [];
    if (getChatsFilter() === "projects" && !getFilterProjectId()) {
      chats = chats.filter((c) => c.projectId);
    }

    const archived = getChatsFilter() === "archived";
    if (!chats.length) {
      sidebarChats.innerHTML = `<li>${renderEmptyState({
        title: archived ? "Архив пуст" : "Нет чатов",
        text: archived
          ? "Архивные диалоги появятся здесь."
          : "Здесь появятся ваши диалоги с ассистентом.",
        size: "sm",
        inset: true,
      })}</li>`;
    } else {
      sidebarChats.innerHTML = chats.map((c) => renderChatItem(c, archived)).join("");
    }
    wireChatItems(sidebarChats);
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
  const backBtn = document.getElementById("backToProjectsBtn");
  const archived = getProjectsView() === "archived-projects";
  if (titleEl) titleEl.textContent = archived ? "Архивные проекты" : "Проекты";
  menuBtn?.classList.toggle("hidden", archived);
  backBtn?.classList.toggle("hidden", !archived);
}

function renderChatsToolbar() {
  const toolbar = document.getElementById("chatsFilterBar");
  if (!toolbar) return;
  const filterProjectId = getFilterProjectId();
  const filterLabel = filterProjectId
    ? getCachedProjects().find((p) => p.id === filterProjectId)?.name
    : null;

  toolbar.innerHTML = `
    ${
      filterLabel
        ? `<div class="sidebar-filter-chip">
            <span>Проект: ${escapeHtml(filterLabel)}</span>
            <button type="button" class="sidebar-icon-btn" data-clear-project-filter aria-label="Сбросить фильтр">×</button>
          </div>`
        : renderFilterTabs({
            name: "chats",
            active: getChatsFilter(),
            tabs: [
              { id: "all", label: "Все" },
              { id: "unassigned", label: "Без проекта" },
              { id: "projects", label: "По проектам" },
              { id: "archived", label: "Архив" },
            ],
          })
    }
    <label class="sidebar-sort">
      <span class="visually-hidden">Сортировка</span>
      <select data-chats-sort aria-label="Сортировка чатов">
        <option value="activity"${getChatsSort() === "activity" ? " selected" : ""}>По активности</option>
        <option value="created"${getChatsSort() === "created" ? " selected" : ""}>По созданию</option>
        <option value="title"${getChatsSort() === "title" ? " selected" : ""}>По названию</option>
      </select>
    </label>
    ${
      getChatsFilter() === "unassigned" && !filterLabel
        ? `<button type="button" class="btn btn-ghost btn-sm sidebar-bulk-delete" data-delete-unassigned>Удалить все без проекта</button>`
        : ""
    }`;

  wireFilterTabs(toolbar, async (id) => {
    setFilterProjectId(null);
    setChatsFilter(id);
    await refreshSidebar();
  });
  toolbar.querySelector("[data-clear-project-filter]")?.addEventListener("click", async () => {
    setFilterProjectId(null);
    setChatsFilter("all");
    await refreshSidebar();
  });
  toolbar.querySelector("[data-chats-sort]")?.addEventListener("change", async (e) => {
    setChatsSort(e.target.value);
    await refreshSidebar();
  });
  toolbar.querySelector("[data-delete-unassigned]")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Удалить чаты без проекта?",
      message: "Все диалоги без проекта и их сообщения будут удалены безвозвратно.",
      confirmLabel: "Удалить все",
      danger: true,
    });
    if (!ok) return;
    const res = await apiGet("/chats?unassigned=1&status=active&limit=200");
    const chats = res.chats || [];
    for (const c of chats) {
      await apiDelete(`/chats/${c.id}?permanent=true`);
    }
    const archived = await apiGet("/chats?unassigned=1&status=archived&limit=200");
    for (const c of archived.chats || []) {
      await apiDelete(`/chats/${c.id}?permanent=true`);
    }
    await refreshSidebar();
  });
}

async function renderProjectItemWithChats(project) {
  const expanded = isProjectExpanded(project.id);
  const selected = getSelectedProjectId() === project.id;
  let nested = "";
  if (expanded) {
    try {
      const res = await apiGet(`/chats?projectId=${encodeURIComponent(project.id)}&status=active&limit=${NESTED_CHAT_LIMIT + 1}&sort=activity`);
      const chats = res.chats || [];
      const shown = chats.slice(0, NESTED_CHAT_LIMIT);
      const hasMore = chats.length > NESTED_CHAT_LIMIT;
      nested = `<ul class="sidebar-nested-list">
        ${
          shown.length
            ? shown
                .map((c) => {
                  const active = c.id === getChatId() ? " active" : "";
                  return `<li>
                    <button type="button" class="sidebar-item sidebar-item--nested${active}" data-chat-id="${escAttr(c.id)}">
                      <span class="sidebar-item-title">${escapeHtml(c.title || "Диалог")}</span>
                    </button>
                  </li>`;
                })
                .join("")
            : `<li><p class="project-note">Нет чатов</p></li>`
        }
        ${
          hasMore
            ? `<li><button type="button" class="sidebar-show-all" data-show-all-project="${escAttr(project.id)}">Показать все</button></li>`
            : ""
        }
      </ul>`;
    } catch {
      nested = `<p class="project-note">Не удалось загрузить чаты</p>`;
    }
  }

  return `<li class="sidebar-row sidebar-project-row${expanded ? " is-expanded" : ""}${selected ? " is-selected" : ""}">
    ${renderProjectItem(project, { nested })}
  </li>`;
}

function renderProjectItem(project, { archived = false, nested = "" } = {}) {
  const selected = getSelectedProjectId() === project.id ? " active" : "";
  const expanded = isProjectExpanded(project.id);
  const colorDot = project.colorKey
    ? `<span class="project-color-dot color-swatch--${escAttr(project.colorKey)}" aria-hidden="true"></span>`
    : "";

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
        <span class="sidebar-item-title">${colorDot}${renderPinMark(project.isPinned)}${escapeHtml(project.name)}</span>
      </button>
      <div class="sidebar-item-menu-wrap">
        <button type="button" class="sidebar-item-menu-btn" data-project-menu="${escAttr(project.id)}" aria-label="Действия с проектом" aria-haspopup="true" aria-expanded="false" title="Действия">⋯</button>
        <div class="sidebar-dropdown sidebar-entity-menu hidden" role="menu">${menuItems}</div>
      </div>
    </div>
    ${nested}`;
}

function renderChatItem(chat, archived = false) {
  const active = chat.id === getChatId() ? " active" : "";
  const date = formatRelativeDate(chat.lastActivityAt || chat.updatedAt);
  const preview = escapeHtml((chat.lastMessagePreview || "").slice(0, 60));
  const archiveActionLabel = archived ? "Вернуть из архива" : "Архивировать";
  const archiveAction = archived ? "restore" : "archive";
  const projectLine = [chat.projectName || (chat.projectId ? "Проект" : "Без проекта"), date]
    .filter(Boolean)
    .join(" · ");

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
      <button type="button" class="sidebar-item${active}" data-chat-id="${escAttr(chat.id)}">
        <span class="sidebar-item-title">${renderPinMark(chat.isPinned)}${escapeHtml(chat.title || "Диалог")}</span>
        ${preview ? `<span class="sidebar-item-preview">${preview}</span>` : ""}
        <span class="sidebar-item-meta">${escapeHtml(projectLine)}</span>
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
  root.querySelectorAll("[data-new-project]").forEach((btn) => {
    btn.addEventListener("click", () => hooks.openCreateProject?.());
  });

  root.querySelectorAll("[data-expand-project]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      toggleProjectExpanded(btn.dataset.expandProject);
      await refreshSidebar();
    });
  });

  root.querySelectorAll("[data-project-id].sidebar-item").forEach((btn) => {
    btn.addEventListener("click", async () => {
      expandProject(btn.dataset.projectId);
      await hooks.openProjectOverview?.(btn.dataset.projectId);
      await refreshSidebar();
      closeMobileSidebar();
    });
  });

  root.querySelectorAll("[data-show-all-project]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      setFilterProjectId(btn.dataset.showAllProject);
      setChatsFilter("all");
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

  // nested chats
  wireChatItems(root);
}

function wireChatItems(root) {
  root.querySelectorAll("[data-chat-id].sidebar-item").forEach((btn) => {
    // avoid double-binding if already has listener via clone — replace node pattern not used
    if (btn.dataset.wired === "1") return;
    btn.dataset.wired = "1";
    btn.addEventListener("click", async () => {
      await selectChat(btn.dataset.chatId);
      hooks.showChatView?.();
      await refreshSidebar();
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
    await hooks.openProjectOverview?.(projectId);
    await refreshSidebar();
    return;
  }
  if (action === "settings") {
    await hooks.openProjectSettings?.(projectId);
    return;
  }
  if (action === "new-chat") {
    await createNewChat(projectId);
    hooks.showChatView?.();
    await refreshSidebar();
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
    await refreshSidebar();
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
  if (!q) {
    container.classList.add("hidden");
    container.innerHTML = "";
    return;
  }
  const data = await apiGet(`/search?q=${encodeURIComponent(q)}`);
  container.classList.remove("hidden");
  const results = data.results || [];
  if (!results.length) {
    container.innerHTML = `<div class="sidebar-section-title">Результаты</div>
      <p class="project-note">Ничего не найдено</p>`;
    return;
  }
  container.innerHTML = `<div class="sidebar-section-title">Результаты</div>${results
    .map(
      (r) =>
        `<button type="button" class="sidebar-item" data-search-type="${escAttr(r.entityType)}" data-search-id="${escAttr(r.entityId)}">
          <span class="sidebar-item-title">${escapeHtml(r.title || r.entityType)}</span>
          <span class="sidebar-item-preview">${escapeHtml(r.snippet || "")}</span>
        </button>`
    )
    .join("")}`;

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
