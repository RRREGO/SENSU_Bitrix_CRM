import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../apiClient.js";
import { escapeHtml, enhanceFileFields } from "../utils.js";
import { createNewChat, selectChat } from "../chat.js";
import {
  formatBytes,
  formatCrmBinding,
  formatRelativeDate,
  escAttr,
  CRM_BINDING_TYPES,
} from "./helpers.js";
import { renderEmptyState } from "./ui/emptyState.js";
import { confirmDialog } from "./ui/confirmDialog.js";
import { renderSkeletonList } from "./ui/skeletonList.js";
import { showOverviewView, showChatView } from "./projectOverview.js";
import { setSelectedProjectId } from "./state.js";

/** UI flag: protocol template editor is hidden until the meetings UX is clearer. API remains. */
const SHOW_PROJECT_PROTOCOL_TEMPLATE = false;

let projectDetailEl = null;
let onOpenChatTab = null;
let hooks = {};

export function initProjectSettings({ projectDetail, openChatTab, workspaceHooks }) {
  projectDetailEl = projectDetail;
  onOpenChatTab = openChatTab;
  hooks = workspaceHooks || {};
}

export async function refreshProjects() {
  try {
    const data = await apiGet("/projects");
    hooks.setCachedProjects?.(data.projects || []);
  } catch {
    /* ignore */
  }
}

/**
 * Open project settings inside the chat workspace (no separate top-level tab).
 */
export async function openProjectSettings(projectId) {
  if (!projectId) return;
  setSelectedProjectId(projectId);
  showOverviewView();
  onOpenChatTab?.();
  const root = document.getElementById("projectOverview") || projectDetailEl;
  await openProjectSettingsDetail(projectId, root, { embedded: true });
}

async function openProjectSettingsDetail(id, detailEl = projectDetailEl, { embedded = true } = {}) {
  if (!detailEl) return;
  detailEl.innerHTML = renderSkeletonList({ rows: 6 });
  const data = await apiGet(`/projects/${id}`);
  if (!data.success) {
    detailEl.innerHTML = renderEmptyState({
      title: "Проект не найден",
      text: "Выберите другой проект или создайте новый.",
    });
    return;
  }
  const p = data.project;
  const files = data.files || [];
  const chats = data.chats || [];
  /** @type {Array<{type: string, id?: string|null, title?: string|null}>} */
  let projectBindings = Array.isArray(p.crmBindings) ? [...p.crmBindings] : [];
  const fromChats = collectCrmLinks(chats).filter((l) => {
    return !projectBindings.some(
      (b) => b.type === l.type && String(b.id || "") === String(l.id || "")
    );
  });

  const typeOptions = CRM_BINDING_TYPES.map(
    (t) => `<option value="${escAttr(t.value)}">${escapeHtml(t.label)}</option>`
  ).join("");

  detailEl.innerHTML = `
    <div class="project-settings">
      <div class="project-settings-toolbar">
        ${
          embedded
            ? `<button type="button" class="btn btn-ghost btn-sm" data-back-overview>К проекту</button>`
            : `<span></span>`
        }
        <div class="project-settings-toolbar-actions">
          <button type="button" class="btn btn-secondary" id="archiveProjectBtn">Архивировать</button>
          <button type="button" class="btn btn-primary" id="saveProjectBtn">Сохранить</button>
        </div>
      </div>

      <header class="project-settings-header">
        <p class="project-settings-eyebrow">Настройки проекта</p>
        <input type="text" class="project-name-input" id="projectName" value="${escapeHtml(p.name)}" aria-label="Название проекта">
        <textarea class="project-desc-input" id="projectDescription" rows="2" placeholder="Краткое описание рабочего пространства…" aria-label="Описание">${escapeHtml(p.description || "")}</textarea>
        <div class="project-meta">
          <span class="chip chip-muted">${escapeHtml(formatRelativeDate(p.lastActivityAt || p.updatedAt) || "—")}</span>
          <span class="chip chip-muted">${files.length} файл(ов)</span>
          <span class="chip chip-muted">${chats.length} чат(ов)</span>
        </div>
      </header>

      <div class="project-settings-grid">
        <section class="project-settings-block project-settings-block--wide">
          <h3 class="section-title">Инструкции</h3>
          <p class="section-hint">Дополняет базовый профиль для всех чатов этого проекта.</p>
          <textarea id="projectInstruction" class="project-settings-textarea" rows="5" placeholder="Как ассистенту работать в этом проекте…">${escapeHtml(p.instruction || "")}</textarea>
        </section>

        <section class="project-settings-block">
          <h3 class="section-title">Файлы</h3>
          <p class="section-hint">Markdown и TXT в контексте ассистента.</p>
          ${
            files.length
              ? `<ul class="project-file-list">${files
                  .map(
                    (f) => `<li>
                      <span>${escapeHtml(f.filename)} · ${formatBytes(f.sizeBytes)}</span>
                      <button type="button" class="btn btn-ghost btn-sm" data-del-file="${escAttr(f.id)}">Удалить</button>
                    </li>`
                  )
                  .join("")}</ul>`
              : `<p class="project-note">Файлов пока нет.</p>`
          }
          <div class="file-field project-settings-file">
            <input type="file" id="projectFileInput" class="file-field-input visually-hidden" accept=".md,.txt,text/plain,text/markdown">
            <label for="projectFileInput" class="btn btn-secondary btn-sm file-field-btn">Загрузить</label>
            <span class="file-field-name is-empty" data-empty="Файл не выбран" aria-live="polite">Файл не выбран</span>
          </div>
        </section>

        <section class="project-settings-block" id="projectCrmSection">
          <h3 class="section-title">CRM-связи</h3>
          <p class="section-hint">Воронка, сделка, компания и другие сущности.</p>
          <div id="projectCrmList" class="project-crm-editor-list"></div>
          <div class="project-crm-add-grid">
            <label class="project-crm-field">
              <span>Тип</span>
              <select id="crmBindType">${typeOptions}</select>
            </label>
            <label class="project-crm-field project-crm-field--grow">
              <span>Название</span>
              <input type="text" id="crmBindTitle" placeholder="Воронка Продажи SENSU" autocomplete="off">
            </label>
            <label class="project-crm-field">
              <span>ID <small>опц.</small></span>
              <input type="text" id="crmBindId" placeholder="123" inputmode="numeric" autocomplete="off">
            </label>
            <button type="button" class="btn btn-secondary btn-sm" id="crmBindAddBtn">Добавить</button>
          </div>
          <p id="crmBindStatus" class="panel-desc"></p>
          ${
            fromChats.length
              ? `<div class="project-crm-inferred">
                  <p class="section-hint">Из чатов проекта:</p>
                  <div class="project-crm-list">${fromChats
                    .map((l) => `<span class="chip chip-muted">${escapeHtml(formatCrmBinding(l))}</span>`)
                    .join("")}</div>
                </div>`
              : ""
          }
        </section>

        ${
          SHOW_PROJECT_PROTOCOL_TEMPLATE
            ? `<section class="project-settings-block project-settings-block--wide">
          <h3 class="section-title">Шаблон протокола</h3>
          <p class="section-hint">Опциональный шаблон для протоколов встреч.</p>
          <label class="setting-row"><span>Название шаблона</span>
            <input type="text" id="protocolTemplateName" value="Шаблон проекта">
          </label>
          <label class="setting-row"><span>Инструкция</span>
            <textarea id="protocolTemplateInstruction" rows="4" placeholder="Как оформлять протокол…"></textarea>
          </label>
          <button type="button" class="btn btn-secondary" id="saveProtocolTemplateBtn">Сохранить шаблон</button>
          <p id="protocolTemplateStatus" class="panel-desc"></p>
        </section>`
            : ""
        }

        <section class="project-settings-block project-settings-block--wide">
          <div class="project-settings-block-head">
            <div>
              <h3 class="section-title">Чаты проекта</h3>
              <p class="section-hint">Диалоги с инструкциями и файлами проекта.</p>
            </div>
            <button type="button" class="btn btn-secondary btn-sm" id="openProjectChatBtn">Новый чат</button>
          </div>
          ${
            chats.length
              ? `<ul class="project-chat-list project-chat-list--overview">${chats
                  .slice(0, 8)
                  .map((c) => {
                    const meta = formatRelativeDate(c.lastActivityAt || c.updatedAt);
                    return `<li>
                      <button type="button" class="project-chat-item" data-chat-id="${escAttr(c.id)}">
                        <span class="project-chat-item-title">${escapeHtml(c.title || "Диалог")}</span>
                        ${meta ? `<span class="project-chat-item-meta">${escapeHtml(meta)}</span>` : ""}
                      </button>
                    </li>`;
                  })
                  .join("")}</ul>`
              : `<p class="project-note">В проекте пока нет чатов.</p>`
          }
        </section>
      </div>
    </div>
  `;

  detailEl.querySelector("[data-back-overview]")?.addEventListener("click", async () => {
    const { openProjectOverview } = await import("./projectOverview.js");
    await openProjectOverview(id);
  });

  function renderBindingsList() {
    const listEl = detailEl.querySelector("#projectCrmList");
    if (!listEl) return;
    if (!projectBindings.length) {
      listEl.innerHTML = `<p class="project-note">Пока нет связанных сущностей. Добавьте воронку, сделку или компанию ниже.</p>`;
      return;
    }
    listEl.innerHTML = `<ul class="project-crm-items">${projectBindings
      .map((b, index) => {
        const label = formatCrmBinding(b);
        const idHint = b.id ? `<span class="project-crm-item-id">ID ${escapeHtml(String(b.id))}</span>` : "";
        return `<li class="project-crm-item">
          <div class="project-crm-item-main">
            <span class="project-crm-item-title">${escapeHtml(label)}</span>
            ${idHint}
          </div>
          <button type="button" class="btn btn-ghost btn-sm" data-remove-binding="${index}">Удалить</button>
        </li>`;
      })
      .join("")}</ul>`;

    listEl.querySelectorAll("[data-remove-binding]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.removeBinding);
        projectBindings = projectBindings.filter((_, i) => i !== idx);
        await persistBindings();
        renderBindingsList();
      });
    });
  }

  async function persistBindings() {
    const status = detailEl.querySelector("#crmBindStatus");
    const res = await apiPatch(
      `/projects/${id}`,
      { crmBindings: projectBindings },
      { throwOnError: false }
    );
    if (status) {
      status.textContent = res.success ? "Привязки сохранены." : res.error?.message || "Ошибка сохранения";
    }
    if (res.success && res.project?.crmBindings) {
      projectBindings = [...res.project.crmBindings];
    }
    await hooks.refreshSidebar?.();
  }

  renderBindingsList();

  detailEl.querySelector("#crmBindAddBtn")?.addEventListener("click", async () => {
    const type = detailEl.querySelector("#crmBindType")?.value || "deal";
    const title = detailEl.querySelector("#crmBindTitle")?.value?.trim() || "";
    const rawId = detailEl.querySelector("#crmBindId")?.value?.trim() || "";
    const status = detailEl.querySelector("#crmBindStatus");

    if (!title) {
      if (status) status.textContent = "Укажите название привязки.";
      detailEl.querySelector("#crmBindTitle")?.focus();
      return;
    }

    const binding = { type, title, id: rawId || null };
    const duplicate = projectBindings.some(
      (b) =>
        b.type === binding.type &&
        String(b.id || "") === String(binding.id || "") &&
        (b.title || "").toLowerCase() === title.toLowerCase()
    );
    if (duplicate) {
      if (status) status.textContent = "Такая привязка уже есть.";
      return;
    }

    projectBindings = [...projectBindings, binding];
    await persistBindings();
    renderBindingsList();
    const titleInput = detailEl.querySelector("#crmBindTitle");
    const idInput = detailEl.querySelector("#crmBindId");
    if (titleInput) titleInput.value = "";
    if (idInput) idInput.value = "";
    titleInput?.focus();
  });

  detailEl.querySelector("#crmBindTitle")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      detailEl.querySelector("#crmBindAddBtn")?.click();
    }
  });

  if (SHOW_PROJECT_PROTOCOL_TEMPLATE) {
    detailEl.querySelector("#saveProtocolTemplateBtn")?.addEventListener("click", async () => {
      const status = detailEl.querySelector("#protocolTemplateStatus");
      const res = await apiPut(
        `/projects/${id}/meeting-protocol-template`,
        {
          name: detailEl.querySelector("#protocolTemplateName")?.value || "Шаблон проекта",
          instruction: detailEl.querySelector("#protocolTemplateInstruction")?.value || "",
          description: "Шаблон протокола проекта",
        },
        { throwOnError: false }
      );
      if (status) {
        status.textContent = res.success ? "Шаблон протокола сохранён." : res.error?.message || "Ошибка";
      }
    });

    apiGet(`/meeting-protocol-templates?projectId=${encodeURIComponent(id)}`)
      .then((tplData) => {
        const tpl = (tplData.templates || []).find((t) => t.projectId === id);
        if (!tpl) return;
        const nameEl = detailEl.querySelector("#protocolTemplateName");
        const instrEl = detailEl.querySelector("#protocolTemplateInstruction");
        if (nameEl) nameEl.value = tpl.name || "";
        if (instrEl) instrEl.value = tpl.instruction || "";
      })
      .catch(() => {});
  }

  detailEl.querySelector("#saveProjectBtn")?.addEventListener("click", async () => {
    await apiPatch(`/projects/${id}`, {
      name: detailEl.querySelector("#projectName")?.value || p.name,
      description: detailEl.querySelector("#projectDescription")?.value || "",
      instruction: detailEl.querySelector("#projectInstruction")?.value || "",
      crmBindings: projectBindings,
    });
    await refreshProjects();
    await hooks.refreshSidebar?.();
  });

  detailEl.querySelector("#archiveProjectBtn")?.addEventListener("click", async () => {
    const ok = await confirmDialog({
      title: "Архивировать проект?",
      message: "Проект будет скрыт из основного списка. Данные сохранятся.",
      confirmLabel: "Архивировать",
    });
    if (!ok) return;
    await apiPost(`/projects/${id}/archive`, {}, { throwOnError: false });
    await refreshProjects();
    await hooks.refreshSidebar?.();
    setSelectedProjectId(null);
    showChatView();
  });

  async function openProjectConversation() {
    await createNewChat(id);
    await hooks.refreshSidebar?.();
    onOpenChatTab?.();
    hooks.showChatView?.();
  }

  detailEl.querySelector("#openProjectChatBtn")?.addEventListener("click", openProjectConversation);

  detailEl.querySelector("#projectFileInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const contentText = await file.text();
    await apiPost(`/projects/${id}/files`, {
      filename: file.name,
      mimeType: file.type,
      contentText,
    });
    openProjectSettingsDetail(id, detailEl, { embedded });
  });

  enhanceFileFields(detailEl);

  detailEl.querySelectorAll("[data-del-file]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await apiDelete(`/projects/${id}/files/${btn.dataset.delFile}`);
      openProjectSettingsDetail(id, detailEl, { embedded });
    });
  });

  detailEl.querySelectorAll("[data-chat-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await selectChat(btn.dataset.chatId);
      onOpenChatTab?.();
      hooks.showChatView?.();
    });
  });
}

function collectCrmLinks(chats) {
  const map = new Map();
  for (const c of chats || []) {
    if (!c.crmEntityType || !c.crmEntityId) continue;
    const key = `${c.crmEntityType}:${c.crmEntityId}`;
    if (!map.has(key)) {
      map.set(key, { type: c.crmEntityType, id: c.crmEntityId, title: c.title });
    }
  }
  return [...map.values()];
}
