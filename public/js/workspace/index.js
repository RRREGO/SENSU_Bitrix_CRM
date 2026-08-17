import { apiGet, apiPost } from "../../apiClient.js";
import { createNewChat } from "../chat.js";
import { openCreateProjectModal } from "./ui/createProjectModal.js";
import { initSidebar, refreshSidebar, runSearch, closeMobileSidebar, handleChatAction } from "./sidebar.js";
import {
  initProjectOverview,
  openProjectOverview,
  showChatView,
  showOverviewView,
} from "./projectOverview.js";
import {
  initProjectSettings,
  refreshProjects,
  openProjectSettings,
} from "./projectSettings.js";
import { setSelectedProjectId, setCachedProjects } from "./state.js";

let profileFieldsRef = null;

export function initWorkspaceUI({
  newChatBtn,
  chatSearchInput,
  searchResults,
  projectDetail,
  newProjectBtn,
  profileFields,
  onOpenChatTab,
}) {
  profileFieldsRef = profileFields;

  const hooks = {
    onOpenChatTab,
    refreshSidebar: () => refreshSidebar(),
    refreshProjects: () => refreshProjects(),
    openProjectOverview: (id) => openProjectOverview(id),
    openProjectSettings: (id) => openProjectSettings(id),
    openCreateProject: () => createProjectFlow(),
    showChatView,
    showOverviewView,
    closeMobileSidebar,
    setCachedProjects,
    refreshChatMeta: async (chatId) => {
      const { getChatId, selectChat } = await import("../chat.js");
      if (chatId && chatId === getChatId()) {
        await selectChat(chatId);
      }
    },
  };

  initSidebar(hooks);
  initProjectOverview(hooks);
  initProjectSettings({
    projectDetail,
    openChatTab: onOpenChatTab,
    workspaceHooks: hooks,
  });

  newChatBtn?.addEventListener("click", async () => {
    setSelectedProjectId(null);
    await createNewChat(null);
    showChatView();
    onOpenChatTab?.();
    closeMobileSidebar();
  });

  let searchTimer = null;
  chatSearchInput?.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(chatSearchInput.value, searchResults), 250);
  });

  newProjectBtn?.addEventListener("click", () => createProjectFlow());

  profileFields?.saveBtn?.addEventListener("click", () => saveProfile(profileFields));

  loadProfile(profileFields);
  refreshSidebar();
  refreshProjects();

  return {
    refreshSidebar,
    refreshProjects,
    openProjectSettings,
    openProjectOverview,
    showChatView,
    handleChatAction,
  };
}

async function createProjectFlow() {
  const draft = await openCreateProjectModal();
  if (!draft) return;
  const created = await apiPost("/projects", draft);
  await refreshProjects();
  await refreshSidebar();
  if (created?.project?.id) {
    setSelectedProjectId(created.project.id);
    await openProjectOverview(created.project.id);
    await refreshSidebar();
  }
}

export { refreshSidebar, refreshProjects, openProjectSettings, openProjectOverview, showChatView, handleChatAction };

async function loadProfile(fields) {
  if (!fields?.name) return;
  const data = await apiGet("/profiles");
  const profile = data.active || data.profiles?.[0];
  if (!profile) return;
  fields.id = profile.id;
  fields.name.value = profile.name || "";
  fields.userContext.value = profile.userContext || "";
  fields.companyContext.value = profile.companyContext || "";
  fields.crmMethodology.value = profile.crmMethodology || "";
  fields.responseRules.value = profile.responseRules || "";
  fields.description.value = profile.description || "";
}

export async function saveProfile(fields = profileFieldsRef) {
  if (!fields) return;
  const body = {
    name: fields.name.value,
    userContext: fields.userContext.value,
    companyContext: fields.companyContext.value,
    crmMethodology: fields.crmMethodology.value,
    responseRules: fields.responseRules.value,
    description: fields.description.value,
    isActive: true,
  };
  let data;
  if (fields.id) {
    const { apiPatch } = await import("../../apiClient.js");
    data = await apiPatch(`/profiles/${fields.id}`, body, { throwOnError: false });
  } else {
    data = await apiPost("/profiles", body, { throwOnError: false });
  }
  if (fields.status) {
    fields.status.textContent = data.success ? "Профиль сохранён." : data.error?.message || "Ошибка";
  }
  if (data.profile) fields.id = data.profile.id;
}
