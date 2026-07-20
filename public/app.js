import { initChat, getSessionId, resetSession } from "./js/chat.js";
import { initWorkspaceUI, refreshSidebar } from "./js/workspace.js";
import { initReports, onReportsTabOpen } from "./js/reports.js";
import { initDocuments, showDocumentPreview, onDocumentsTabOpen } from "./js/documents.js";
import { initHistory, onHistoryTabOpen } from "./js/history.js";
import { loadSettings, saveSettings } from "./js/settings.js";
import { formatRuDate, getPeriodRange } from "./js/dateUtils.js";
import { initMeetings } from "./js/meetings.js";
import { initNotifications, onNotificationsTabOpen, refreshBadge } from "./js/notifications.js";
import { initSchedules, onSchedulesTabOpen } from "./js/schedules.js";
import { initOutbound, onOutboundTabOpen, setActiveMessageDraft } from "./js/outbound.js";
import { initCommunications, onCommunicationsTabOpen } from "./js/communications.js";
import { initAuth, onUsersTabOpen } from "./js/auth.js";
import { initSystem, onSystemTabOpen } from "./js/system.js";
import { enhanceFileFields } from "./js/utils.js";

const tabs = document.querySelectorAll(".tab");
const panels = document.querySelectorAll(".panel");
const categoryButtons = document.querySelectorAll(".nav-category");
const routeGroups = document.querySelectorAll(".nav-route-group");
const lastTabByCategory = { work: "chat", analytics: "reports", comms: "notifications", admin: "history" };

function categoryForTab(tabName) {
  const tab = document.querySelector(`.tab[data-tab="${tabName}"]`);
  return tab?.closest(".nav-route-group")?.dataset.navCategory || null;
}

function setActiveCategory(categoryId) {
  categoryButtons.forEach((btn) => {
    const active = btn.dataset.navCategory === categoryId;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  routeGroups.forEach((group) => {
    const active = group.dataset.navCategory === categoryId;
    group.classList.toggle("active", active);
    group.hidden = !active;
  });
}

function firstVisibleTabInCategory(categoryId) {
  const group = document.querySelector(`.nav-route-group[data-nav-category="${categoryId}"]`);
  if (!group) return null;
  const tab = [...group.querySelectorAll(".tab")].find((el) => !el.hidden);
  return tab?.dataset.tab || null;
}

function switchCategory(categoryId) {
  const remembered = lastTabByCategory[categoryId];
  const rememberedEl = remembered
    ? document.querySelector(`.nav-route-group[data-nav-category="${categoryId}"] .tab[data-tab="${remembered}"]`)
    : null;
  const tabName =
    rememberedEl && !rememberedEl.hidden
      ? remembered
      : firstVisibleTabInCategory(categoryId);
  if (tabName) switchTab(tabName);
  else setActiveCategory(categoryId);
}

function switchTab(tabName) {
  const categoryId = categoryForTab(tabName);
  if (categoryId) {
    lastTabByCategory[categoryId] = tabName;
    setActiveCategory(categoryId);
  }

  tabs.forEach((tab) => {
    const active = tab.dataset.tab === tabName;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });

  panels.forEach((panel) => {
    const active = panel.id === `panel-${tabName}`;
    panel.classList.toggle("active", active);
    panel.hidden = !active;
  });

  if (tabName === "reports") onReportsTabOpen();
  if (tabName === "documents") onDocumentsTabOpen();
  if (tabName === "history") onHistoryTabOpen(getSessionId());
  if (tabName === "settings") loadSettingsForm();
  if (tabName === "notifications") onNotificationsTabOpen();
  if (tabName === "schedules") onSchedulesTabOpen();
  if (tabName === "outbound") onOutboundTabOpen();
  if (tabName === "communications") onCommunicationsTabOpen();
  if (tabName === "users") onUsersTabOpen();
  if (tabName === "system") onSystemTabOpen();
}

await initAuth();

initSystem();

initMeetings({ setActiveMessageDraft });
initNotifications();
initSchedules();
initOutbound();
initCommunications();
refreshBadge();
enhanceFileFields();

categoryButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchCategory(btn.dataset.navCategory));
});

tabs.forEach((tab) => {
  tab.addEventListener("click", () => switchTab(tab.dataset.tab));
});

initChat(
  {
    messagesEl: document.getElementById("messages"),
    chatForm: document.getElementById("chatForm"),
    messageInput: document.getElementById("messageInput"),
    sendBtn: document.getElementById("sendBtn"),
    confirmationEl: document.getElementById("confirmation"),
    confirmationTextEl: document.getElementById("confirmationText"),
    confirmBtn: document.getElementById("confirmBtn"),
    cancelBtn: document.getElementById("cancelBtn"),
    chatTitle: document.getElementById("chatTitle"),
    chatMetaLine: document.getElementById("chatMetaLine"),
  },
  { onChatChanged: () => refreshSidebar() }
);

initWorkspaceUI({
  newChatBtn: document.getElementById("newChatBtn"),
  chatSearchInput: document.getElementById("chatSearchInput"),
  searchResults: document.getElementById("searchResults"),
  sidebarProjects: document.getElementById("sidebarProjects"),
  sidebarChats: document.getElementById("sidebarChats"),
  projectsList: document.getElementById("projectsList"),
  projectDetail: document.getElementById("projectDetail"),
  newProjectBtn: document.getElementById("newProjectBtn"),
  onOpenChatTab: () => switchTab("chat"),
  profileFields: {
    name: document.getElementById("profileName"),
    userContext: document.getElementById("profileUserContext"),
    companyContext: document.getElementById("profileCompanyContext"),
    crmMethodology: document.getElementById("profileCrmMethodology"),
    responseRules: document.getElementById("profileResponseRules"),
    description: document.getElementById("profileDescription"),
    saveBtn: document.getElementById("saveProfileBtn"),
    status: document.getElementById("profileSaveStatus"),
  },
});

initReports(
  {
    funnelSelect: document.getElementById("funnelSelect"),
    funnelError: document.getElementById("funnelError"),
    funnelErrorText: document.getElementById("funnelErrorText"),
    funnelManualId: document.getElementById("funnelManualId"),
    advancedToggle: document.getElementById("advancedToggle"),
    advancedBlock: document.getElementById("advancedBlock"),
    reportDateFrom: document.getElementById("reportDateFrom"),
    reportDateTo: document.getElementById("reportDateTo"),
    reportDateFromIso: document.getElementById("reportDateFromIso"),
    reportDateToIso: document.getElementById("reportDateToIso"),
    periodPresets: document.getElementById("periodPresets"),
    quickReportsGrid: document.getElementById("quickReportsGrid"),
    reportResultEmpty: document.getElementById("reportResultEmpty"),
    reportResultLoading: document.getElementById("reportResultLoading"),
    reportResultError: document.getElementById("reportResultError"),
    reportResultErrorText: document.getElementById("reportResultErrorText"),
    reportResultSuccess: document.getElementById("reportResultSuccess"),
    reportResultTitle: document.getElementById("reportResultTitle"),
    reportResultBody: document.getElementById("reportResultBody"),
    reportOpenDocBtn: document.getElementById("reportOpenDocBtn"),
    reportExportHtmlBtn: document.getElementById("reportExportHtmlBtn"),
    reportPrintPdfBtn: document.getElementById("reportPrintPdfBtn"),
    reportExportMdBtn: document.getElementById("reportExportMdBtn"),
    reportCopyBtn: document.getElementById("reportCopyBtn"),
    reportBitrixBtn: document.getElementById("reportBitrixBtn"),
  },
  {
    onOpenDocument: (doc, reportId) => showDocumentPreview(doc, reportId),
    onSwitchTab: switchTab,
  }
);

initDocuments(
  {
    documentType: document.getElementById("documentType"),
    documentEntityId: document.getElementById("documentEntityId"),
    documentCategoryId: document.getElementById("documentCategoryId"),
    documentDateFrom: document.getElementById("documentDateFrom"),
    documentDateTo: document.getElementById("documentDateTo"),
    generateDocumentBtn: document.getElementById("generateDocumentBtn"),
    documentPreviewFrame: document.getElementById("documentPreviewFrame"),
    documentPreviewTitle: document.getElementById("documentPreviewTitle"),
    documentStatus: document.getElementById("documentStatus"),
    docCopyBtn: document.getElementById("docCopyBtn"),
    docExportHtmlBtn: document.getElementById("docExportHtmlBtn"),
    docPrintPdfBtn: document.getElementById("docPrintPdfBtn"),
    docBackToReportBtn: document.getElementById("docBackToReportBtn"),
    savedDocumentsList: document.getElementById("savedDocumentsList"),
  },
  { onSwitchTab: switchTab }
);

initHistory({
  historyTableBody: document.getElementById("historyTableBody"),
  operationDetails: document.getElementById("operationDetails"),
  refreshHistoryBtn: document.getElementById("refreshHistoryBtn"),
  refreshReportHistoryBtn: document.getElementById("refreshReportHistoryBtn"),
  reportHistoryBody: document.getElementById("reportHistoryBody"),
  sessionId: document.getElementById("settingsSessionId"),
});

function loadSettingsForm() {
  const settings = loadSettings();
  document.getElementById("settingsSessionId").value = getSessionId();
  document.getElementById("settingsDocStyle").value = settings.documentStyle;
  document.getElementById("settingsDocFormat").value = settings.documentFormat;
  document.getElementById("settingsLanguage").value = settings.language;
}

document.getElementById("settingsDocStyle")?.addEventListener("change", (e) => {
  saveSettings({ documentStyle: e.target.value });
});
document.getElementById("settingsDocFormat")?.addEventListener("change", (e) => {
  saveSettings({ documentFormat: e.target.value });
});

document.getElementById("resetSessionBtn")?.addEventListener("click", async () => {
  const newId = await resetSession();
  document.getElementById("settingsSessionId").value = newId;
  refreshSidebar();
});

const weekRange = getPeriodRange("7days");
document.getElementById("documentDateFrom").value = formatRuDate(weekRange.dateFrom);
document.getElementById("documentDateTo").value = formatRuDate(weekRange.dateTo);

loadSettingsForm();
