const SELECTED_PROJECT_KEY = "bitrixSelectedProjectId";
const EXPANDED_PROJECTS_KEY = "bitrixExpandedProjectIds";
const SIDEBAR_COLLAPSED_KEY = "bitrixSidebarCollapsed";
const CHATS_FILTER_KEY = "bitrixChatsFilter";
const CHATS_SORT_KEY = "bitrixChatsSort";

/** @type {'overview' | 'chat'} */
let mainView = "chat";
let selectedProjectId = localStorage.getItem(SELECTED_PROJECT_KEY) || null;
/** @type {Set<string>} */
let expandedProjectIds = loadExpanded();
let sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
/** @type {'all' | 'unassigned' | 'projects' | 'archived'} */
let chatsFilter = localStorage.getItem(CHATS_FILTER_KEY) || "all";
/** @type {'activity' | 'created' | 'title'} */
let chatsSort = localStorage.getItem(CHATS_SORT_KEY) || "activity";
/** @type {'projects' | 'archived-projects'} */
let projectsView = "projects";
let cachedProjects = [];
let filterProjectId = null;

function loadExpanded() {
  try {
    const raw = JSON.parse(localStorage.getItem(EXPANDED_PROJECTS_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.map(String) : []);
  } catch {
    return new Set();
  }
}

function persistExpanded() {
  localStorage.setItem(EXPANDED_PROJECTS_KEY, JSON.stringify([...expandedProjectIds]));
}

export function getMainView() {
  return mainView;
}

export function setMainView(view) {
  mainView = view === "overview" ? "overview" : "chat";
}

export function getSelectedProjectId() {
  return selectedProjectId;
}

export function setSelectedProjectId(id) {
  selectedProjectId = id || null;
  if (selectedProjectId) localStorage.setItem(SELECTED_PROJECT_KEY, selectedProjectId);
  else localStorage.removeItem(SELECTED_PROJECT_KEY);
}

export function isProjectExpanded(id) {
  return expandedProjectIds.has(String(id));
}

export function toggleProjectExpanded(id) {
  const key = String(id);
  if (expandedProjectIds.has(key)) expandedProjectIds.delete(key);
  else expandedProjectIds.add(key);
  persistExpanded();
  return expandedProjectIds.has(key);
}

export function expandProject(id) {
  expandedProjectIds.add(String(id));
  persistExpanded();
}

export function getSidebarCollapsed() {
  return sidebarCollapsed;
}

export function setSidebarCollapsed(value) {
  sidebarCollapsed = Boolean(value);
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, sidebarCollapsed ? "1" : "0");
}

export function getChatsFilter() {
  return chatsFilter;
}

export function setChatsFilter(value) {
  const allowed = new Set(["all", "unassigned", "projects", "archived"]);
  chatsFilter = allowed.has(value) ? value : "all";
  localStorage.setItem(CHATS_FILTER_KEY, chatsFilter);
}

export function getChatsSort() {
  return chatsSort;
}

export function setChatsSort(value) {
  const allowed = new Set(["activity", "created", "title"]);
  chatsSort = allowed.has(value) ? value : "activity";
  localStorage.setItem(CHATS_SORT_KEY, chatsSort);
}

export function getProjectsView() {
  return projectsView;
}

export function setProjectsView(view) {
  projectsView = view === "archived-projects" ? "archived-projects" : "projects";
}

export function getCachedProjects() {
  return cachedProjects;
}

export function setCachedProjects(list) {
  cachedProjects = Array.isArray(list) ? list : [];
}

export function getFilterProjectId() {
  return filterProjectId;
}

export function setFilterProjectId(id) {
  filterProjectId = id || null;
}
