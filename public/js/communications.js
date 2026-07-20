import { apiGet, apiPost, apiPatch, apiDelete } from "../apiClient.js";
import { escapeHtml } from "./utils.js";

const VIEWS = ["overview", "threads", "campaigns", "sequences", "templates", "delivery", "settings"];

const TEMPLATE_CATEGORIES = [
  "warmup",
  "cycle",
  "follow_up",
  "meeting_summary",
  "birthday",
  "holiday",
  "personal_congratulation",
  "meeting_invitation",
  "newsletter",
  "service",
];

const CHANNEL_OPTIONS = ["whatsapp", "wapi", "telegram", "max", "viber", "instagram"];

const STATUS_LABELS = {
  draft: "черновик",
  pending: "в очереди",
  processing: "отправка",
  sent: "отправлено",
  accepted: "принято",
  delivered: "доставлено",
  read: "прочитано",
  failed: "ошибка",
  error: "ошибка",
  dead_letter: "отложено",
  dry_run: "dry-run",
  policy_blocked: "политика",
  cancelled: "отменено",
  running: "запущена",
  active: "активна",
  paused: "пауза",
  completed: "завершена",
  inbound: "входящее",
};

let currentView = "overview";
let selectedThreadId = null;
let selectedCampaignId = null;
let selectedSequenceId = null;
let selectedTemplateId = null;
let hubEnabled = null;
let lastPrepareInfo = null;

function contentEl() {
  return document.getElementById("commsHubContent");
}

function formatTs(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString("ru-RU");
  } catch {
    return String(value);
  }
}

function statusBadge(status) {
  const s = String(status || "—").toLowerCase();
  const label = STATUS_LABELS[s] || s;
  let mod = "muted";
  if (["delivered", "read", "accepted", "active", "running", "completed", "certified", "sequence_verified", "campaign_verified", "single_send_verified", "delivery_verified", "connection_verified", "webhook_verified"].includes(s)) mod = "ok";
  else if (["pending", "processing", "draft", "dry_run", "paused", "not_started"].includes(s)) mod = "warn";
  else if (["failed", "error", "dead_letter", "policy_blocked", "cancelled", "revoked", "expired"].includes(s)) mod = "danger";
  return `<span class="comms-status comms-status--${mod}">${escapeHtml(label)}</span>`;
}

function flagChip(ok, yes = "да", no = "нет") {
  return `<span class="chip ${ok ? "" : "chip-muted"}">${ok ? yes : no}</span>`;
}

function emptyState(title, text) {
  return `<div class="empty-state empty-state--lg">
    <p class="empty-state-title">${escapeHtml(title)}</p>
    <p class="empty-state-text">${escapeHtml(text)}</p>
  </div>`;
}

function disabledHubHtml(detail) {
  return `<div class="empty-state empty-state--xl surface surface-section">
    <p class="empty-state-title">Communications Hub выключен</p>
    <p class="empty-state-text">
      Включите <code>COMMUNICATIONS_ENABLED=true</code> в окружении и перезапустите сервер.
      ${detail ? `<br><br>${escapeHtml(detail)}` : ""}
    </p>
  </div>`;
}

function isDisabledResponse(data) {
  if (!data) return false;
  if (data.config?.enabled === false) return true;
  if (data.enabled === false) return true;
  return data.error?.code === "COMMUNICATIONS_DISABLED";
}

function setStatusLine(text) {
  const el = document.getElementById("commsStatusLine");
  if (el) el.textContent = text || "";
}

async function ensureHubGate() {
  const data = await apiGet("/communications/settings");
  const cfg = data?.settings || data?.config || data;
  if (
    data?.error?.code === "COMMUNICATIONS_DISABLED" ||
    cfg?.enabled === false
  ) {
    hubEnabled = false;
    return false;
  }
  // Endpoint may be missing while backend lands in parallel — don't block UI shell
  hubEnabled = cfg?.enabled !== false;
  return true;
}

export function initCommunications() {
  const subnav = document.getElementById("commsSubnav");
  subnav?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-comms-view]");
    if (!btn) return;
    switchCommsView(btn.dataset.commsView);
  });
  document.getElementById("commsRefreshBtn")?.addEventListener("click", () => {
    renderCurrentView();
  });
}

export function onCommunicationsTabOpen() {
  switchCommsView(currentView || "overview");
}

function switchCommsView(view) {
  if (!VIEWS.includes(view)) view = "overview";
  currentView = view;
  document.querySelectorAll("#commsSubnav .comms-subnav-item").forEach((btn) => {
    const active = btn.dataset.commsView === view;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  renderCurrentView();
}

async function renderCurrentView() {
  const root = contentEl();
  if (!root) return;
  root.innerHTML = `<p class="panel-desc">Загрузка…</p>`;

  if (currentView === "settings" || currentView === "overview") {
    // always allow settings/overview to explain disabled state
  } else {
    const ok = await ensureHubGate();
    if (!ok) {
      root.innerHTML = disabledHubHtml("Раздел недоступен, пока хаб выключен.");
      return;
    }
  }

  try {
    if (currentView === "overview") await renderOverview(root);
    else if (currentView === "threads") await renderThreads(root);
    else if (currentView === "campaigns") await renderCampaigns(root);
    else if (currentView === "sequences") await renderSequences(root);
    else if (currentView === "templates") await renderTemplates(root);
    else if (currentView === "delivery") await renderDelivery(root);
    else if (currentView === "settings") await renderSettings(root);
  } catch (err) {
    root.innerHTML = emptyState("Ошибка загрузки", err.message || String(err));
  }
}

/* ——— Overview ——— */

async function renderOverview(root) {
  const data = await apiGet("/communications/overview");
  if (isDisabledResponse(data) || data?.config?.enabled === false) {
    hubEnabled = false;
    root.innerHTML = disabledHubHtml(data?.error?.message);
    return;
  }
  hubEnabled = true;
  const cfg = data.config || {};
  const provider = data.provider || {};
  const channels = data.channels || {};
  const queue = data.queue || {};

  root.innerHTML = `
    <div class="comms-overview">
      <div class="comms-stat-grid">
        <div class="comms-stat surface">
          <div class="comms-stat-label">Wazzup</div>
          <div class="comms-stat-value">${flagChip(provider.configured, "настроен", "не настроен")}</div>
          <div class="panel-desc">${provider.enabled ? "провайдер включён" : "провайдер выключен"} · проверка: ${escapeHtml(formatTs(provider.lastSuccessfulCheckAt))}</div>
        </div>
        <div class="comms-stat surface">
          <div class="comms-stat-label">Каналы</div>
          <div class="comms-stat-value">${escapeHtml(String(channels.active ?? 0))} / ${escapeHtml(String(channels.total ?? 0))}</div>
          <div class="panel-desc">активных · неавторизовано: ${escapeHtml(String(channels.unauthorized ?? 0))}</div>
        </div>
        <div class="comms-stat surface">
          <div class="comms-stat-label">Без ответа</div>
          <div class="comms-stat-value">${escapeHtml(String(data.unansweredCount ?? 0))}</div>
          <div class="panel-desc">диалогов с входящим без ответа</div>
        </div>
        <div class="comms-stat surface">
          <div class="comms-stat-label">Очередь</div>
          <div class="comms-stat-value">${escapeHtml(String(queue.pending ?? 0))}</div>
          <div class="panel-desc">ошибок: ${escapeHtml(String(queue.failed ?? 0))} · dry-run: ${escapeHtml(String(queue.dryRun ?? 0))}</div>
        </div>
        <div class="comms-stat surface">
          <div class="comms-stat-label">Кампании</div>
          <div class="comms-stat-value">${escapeHtml(String(data.activeCampaigns ?? 0))}</div>
          <div class="panel-desc">запущенных</div>
        </div>
        <div class="comms-stat surface">
          <div class="comms-stat-label">Цепочки</div>
          <div class="comms-stat-value">${escapeHtml(String(data.activeSequences ?? 0))}</div>
          <div class="panel-desc">активных</div>
        </div>
      </div>
      ${cfg.dryRun || !cfg.sendEnabled ? `<div class="comms-banner comms-banner--warn">Режим безопасной отправки: dry-run=${cfg.dryRun ? "да" : "нет"}, sendEnabled=${cfg.sendEnabled ? "да" : "нет"}. Реальные сообщения не уходят без явной конфигурации.</div>` : ""}
      <div class="surface surface-section">
        <h3 class="section-title">Каналы</h3>
        ${(channels.items || []).length
          ? `<table class="data-table"><thead><tr><th>Имя</th><th>Транспорт</th><th>Состояние</th><th>Синхр.</th></tr></thead><tbody>
            ${(channels.items || [])
              .map(
                (c) => `<tr>
                  <td>${escapeHtml(c.displayName || c.id)}</td>
                  <td>${escapeHtml(c.transport || "—")}</td>
                  <td>${statusBadge(c.state || c.status)}</td>
                  <td>${escapeHtml(formatTs(c.lastSyncedAt))}</td>
                </tr>`
              )
              .join("")}
          </tbody></table>`
          : emptyState("Нет каналов", "Синхронизируйте каналы в разделе «Настройки».")}
      </div>
      <p class="panel-desc" id="commsClientContextHint">Client Context: блок «Коммуникации» появляется в чате, если API контекста возвращает communications.</p>
    </div>`;
}

/* ——— Threads ——— */

async function renderThreads(root) {
  const filter = document.getElementById("commsThreadFilter")?.value || "";
  const params = new URLSearchParams({ limit: "60" });
  if (filter === "unanswered") params.set("unanswered", "true");
  const data = await apiGet(`/communications/threads?${params}`);
  if (isDisabledResponse(data)) {
    root.innerHTML = disabledHubHtml(data?.error?.message);
    return;
  }
  const threads = data.threads || [];

  root.innerHTML = `
    <div class="comms-master-detail">
      <div class="comms-list-pane surface">
        <div class="pane-toolbar">
          <label class="filter-field">
            <span>Фильтр</span>
            <select id="commsThreadFilter">
              <option value="">Все</option>
              <option value="unanswered" ${filter === "unanswered" ? "selected" : ""}>Без ответа</option>
            </select>
          </label>
        </div>
        <div id="commsThreadList" class="comms-thread-list">
          ${
            threads.length
              ? threads
                  .map(
                    (t) => `<button type="button" class="comms-thread-item ${t.id === selectedThreadId ? "active" : ""}" data-thread-id="${escapeHtml(t.id)}">
                      <div class="comms-thread-item-top">
                        <strong>${escapeHtml(t.chatType || t.transport || "канал")}</strong>
                        ${t.unanswered ? '<span class="chip">без ответа</span>' : ""}
                      </div>
                      <div class="panel-desc">${escapeHtml(t.lastMessagePreview || "нет превью")} · ${escapeHtml(formatTs(t.updatedAt))}</div>
                      <div class="panel-desc">контакт ${escapeHtml(t.contactId || "—")}</div>
                    </button>`
                  )
                  .join("")
              : emptyState("Нет диалогов", "Входящие появятся после вебхуков Wazzup.")
          }
        </div>
      </div>
      <div class="comms-detail-pane surface" id="commsThreadDetail">
        ${emptyState("Выберите диалог", "Откройте переписку слева.")}
      </div>
    </div>`;

  document.getElementById("commsThreadFilter")?.addEventListener("change", () => renderThreads(root));
  root.querySelectorAll("[data-thread-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedThreadId = btn.dataset.threadId;
      loadThreadDetail(selectedThreadId);
      root.querySelectorAll(".comms-thread-item").forEach((el) => {
        el.classList.toggle("active", el.dataset.threadId === selectedThreadId);
      });
    });
  });

  if (selectedThreadId && threads.some((t) => t.id === selectedThreadId)) {
    loadThreadDetail(selectedThreadId);
  }
}

async function loadThreadDetail(threadId) {
  const pane = document.getElementById("commsThreadDetail");
  if (!pane || !threadId) return;
  pane.innerHTML = `<p class="panel-desc">Загрузка…</p>`;
  const data = await apiGet(`/communications/threads/${encodeURIComponent(threadId)}`);
  if (!data.success && data.error) {
    pane.innerHTML = emptyState("Ошибка", data.error.message || "Не удалось загрузить");
    return;
  }
  const thread = data.thread || {};
  const messages = data.messages || [];

  pane.innerHTML = `
    <div class="comms-thread-header">
      <div>
        <h3 class="section-title">${escapeHtml(thread.chatType || thread.transport || "Диалог")}</h3>
        <p class="panel-desc">контакт ${escapeHtml(thread.contactId || "—")} · ${thread.unanswered ? "ожидает ответа" : "отвечено"}</p>
      </div>
      ${statusBadge(thread.unanswered ? "pending" : "delivered")}
    </div>
    <div class="comms-bubbles" id="commsBubbles">
      ${
        messages.length
          ? messages
              .map((m) => {
                const inbound = m.direction === "inbound";
                const dirClass = inbound ? "inbound" : "outbound";
                return `<div class="comms-bubble comms-bubble--${dirClass}">
                  <div class="comms-bubble-meta">${inbound ? "входящее" : "исходящее"} · ${statusBadge(m.status)} · ${escapeHtml(formatTs(m.providerTimestamp || m.createdAt))}</div>
                  <div class="comms-bubble-text">${escapeHtml(m.textSafe || "—")}</div>
                </div>`;
              })
              .join("")
          : emptyState("Нет сообщений", "История пуста.")
      }
    </div>
    <div class="surface-section comms-draft-box">
      <h4 class="section-title">Черновик ответа</h4>
      <label class="form-field">
        <span>Текст</span>
        <textarea id="commsDraftBody" rows="4" placeholder="Текст сообщения…"></textarea>
      </label>
      <div class="confirmation-actions">
        <button type="button" class="btn btn-secondary" id="commsDraftBtn">Подготовить черновик</button>
        <button type="button" class="btn btn-primary" id="commsPrepareBtn">Prepare отправку</button>
      </div>
      <pre id="commsDraftPreview" class="protocol-preview comms-preview"></pre>
      <p class="panel-desc" id="commsStatusLine"></p>
    </div>`;

  const bubbles = document.getElementById("commsBubbles");
  if (bubbles) bubbles.scrollTop = bubbles.scrollHeight;

  document.getElementById("commsDraftBtn")?.addEventListener("click", async () => {
    const body = document.getElementById("commsDraftBody")?.value || "";
    setStatusLine("Черновик…");
    const res = await apiPost(
      `/communications/threads/${encodeURIComponent(threadId)}/draft`,
      { body },
      { throwOnError: false }
    );
    const preview = document.getElementById("commsDraftPreview");
    if (preview) {
      preview.textContent = res.draft
        ? [`Канал: ${res.draft.channel || "—"}`, res.draft.dryRun ? "dry-run: да" : "", "", res.draft.body || ""].filter(Boolean).join("\n")
        : res.error?.message || JSON.stringify(res, null, 2);
    }
    setStatusLine(res.success === false ? res.error?.message || "Ошибка" : "Черновик готов");
  });

  document.getElementById("commsPrepareBtn")?.addEventListener("click", async () => {
    const body = document.getElementById("commsDraftBody")?.value || "";
    setStatusLine("Prepare…");
    const res = await apiPost(
      "/communications/messages/prepare",
      {
        threadId,
        contactId: thread.contactId,
        channel: thread.chatType || thread.transport,
        chatType: thread.chatType,
        transport: thread.transport,
        chatId: thread.externalChatId,
        channelId: thread.channelId,
        body,
      },
      { throwOnError: false }
    );
    lastPrepareInfo = res;
    const preview = document.getElementById("commsDraftPreview");
    const phrase = res.confirmationPhrase || res.preview?.requiredConfirmationPhrase;
    if (preview) {
      preview.textContent = [
        res.blocked ? "ЗАБЛОКИРОВАНО политикой" : "Prepare OK",
        phrase ? `Фраза подтверждения: ${phrase}` : "",
        res.policy?.message || "",
        res.preview?.bodyPreview || body,
        "Commit через Safety Layer (/bitrix/action + confirmationId).",
      ]
        .filter(Boolean)
        .join("\n\n");
    }
    setStatusLine(
      res.success === false || res.blocked
        ? res.error?.message || res.policy?.message || "Prepare отклонён"
        : `confirmationId / prepareId: ${res.confirmationId || res.prepareId || "—"}`
    );
  });
}

/* ——— Campaigns ——— */

async function renderCampaigns(root) {
  const data = await apiGet("/communications/campaigns");
  if (isDisabledResponse(data)) {
    root.innerHTML = disabledHubHtml(data?.error?.message);
    return;
  }
  const campaigns = data.campaigns || [];
  const templatesData = await apiGet("/communications/templates");
  const templates = templatesData.templates || [];

  root.innerHTML = `
    <div class="comms-split">
      <div class="surface surface-section">
        <h3 class="section-title">Кампании</h3>
        <div id="commsCampaignList" class="comms-item-list">
          ${
            campaigns.length
              ? campaigns
                  .map(
                    (c) => `<button type="button" class="comms-list-card ${c.id === selectedCampaignId ? "active" : ""}" data-campaign-id="${escapeHtml(c.id)}">
                      <div><strong>${escapeHtml(c.name)}</strong> ${statusBadge(c.status)}</div>
                      <div class="panel-desc">${escapeHtml(c.channel || "—")} · обновлено ${escapeHtml(formatTs(c.updatedAt))}</div>
                    </button>`
                  )
                  .join("")
              : emptyState("Нет кампаний", "Создайте рассылку формой справа.")
          }
        </div>
      </div>
      <div class="surface surface-section" id="commsCampaignEditor">
        <h3 class="section-title">Новая кампания</h3>
        <form id="commsCampaignForm" class="form-grid">
          <label class="form-field span-2"><span>Название</span><input name="name" required placeholder="Рассылка …"></label>
          <label class="form-field"><span>Канал</span>
            <select name="channel">${CHANNEL_OPTIONS.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
          </label>
          <label class="form-field"><span>Шаблон</span>
            <select name="templateId">
              <option value="">— без шаблона —</option>
              ${templates.map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`).join("")}
            </select>
          </label>
          <label class="form-field span-2"><span>Сегмент (JSON)</span>
            <textarea name="segmentJson" rows="3" placeholder='{"includeIds":[]}'>{}</textarea>
          </label>
          <div class="confirmation-actions span-2">
            <button type="submit" class="btn btn-primary">Создать</button>
          </div>
        </form>
        <div id="commsCampaignDetail" class="comms-campaign-detail"></div>
      </div>
    </div>`;

  root.querySelectorAll("[data-campaign-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedCampaignId = btn.dataset.campaignId;
      const campaign = campaigns.find((c) => c.id === selectedCampaignId);
      showCampaignDetail(campaign);
      root.querySelectorAll(".comms-list-card").forEach((el) => {
        el.classList.toggle("active", el.dataset.campaignId === selectedCampaignId);
      });
    });
  });

  document.getElementById("commsCampaignForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    let segment = {};
    try {
      segment = JSON.parse(String(fd.get("segmentJson") || "{}"));
    } catch {
      setCampaignDetailHtml(`<p class="panel-desc">Некорректный JSON сегмента.</p>`);
      return;
    }
    const res = await apiPost(
      "/communications/campaigns",
      {
        name: fd.get("name"),
        channel: fd.get("channel"),
        templateId: fd.get("templateId") || null,
        segment,
        dryRun: true,
      },
      { throwOnError: false }
    );
    if (res.success === false || res.error) {
      setCampaignDetailHtml(`<p class="panel-desc">${escapeHtml(res.error?.message || "Ошибка создания")}</p>`);
      return;
    }
    selectedCampaignId = res.campaign?.id || res.id;
    renderCampaigns(root);
  });

  if (selectedCampaignId) {
    const campaign = campaigns.find((c) => c.id === selectedCampaignId);
    if (campaign) showCampaignDetail(campaign);
  }
}

function setCampaignDetailHtml(html) {
  const el = document.getElementById("commsCampaignDetail");
  if (el) el.innerHTML = html;
}

function showCampaignDetail(campaign) {
  if (!campaign) {
    setCampaignDetailHtml("");
    return;
  }
  const st = String(campaign.status || "");
  const canPause = ["running", "active"].includes(st);
  const canResume = st === "paused";
  setCampaignDetailHtml(`
    <hr class="comms-divider">
    <h3 class="section-title">${escapeHtml(campaign.name)}</h3>
    <p class="panel-desc">Статус: ${statusBadge(campaign.status)} · канал ${escapeHtml(campaign.channel || "—")} · dry-run ${campaign.dryRun ? "да" : "нет"}</p>
    ${
      campaign.confirmationPhrase
        ? `<div class="comms-banner"><strong>Фраза подтверждения:</strong> <code>${escapeHtml(campaign.confirmationPhrase)}</code></div>`
        : ""
    }
    <div class="confirmation-actions">
      <button type="button" class="btn btn-secondary" id="commsCampaignPreviewBtn">Preview</button>
      <button type="button" class="btn btn-primary" id="commsCampaignStartBtn">Start / prepare</button>
      ${canPause ? `<button type="button" class="btn btn-secondary" id="commsCampaignPauseBtn">Пауза</button>` : ""}
      ${canResume ? `<button type="button" class="btn btn-secondary" id="commsCampaignResumeBtn">Возобновить</button>` : ""}
    </div>
    <div id="commsCampaignPreviewBox"></div>
  `);

  document.getElementById("commsCampaignPreviewBtn")?.addEventListener("click", async () => {
    const box = document.getElementById("commsCampaignPreviewBox");
    if (box) box.innerHTML = `<p class="panel-desc">Preview…</p>`;
    const res = await apiPost(
      `/communications/campaigns/${encodeURIComponent(campaign.id)}/preview`,
      { contacts: [] },
      { throwOnError: false }
    );
    renderCampaignPreview(box, res);
  });

  document.getElementById("commsCampaignStartBtn")?.addEventListener("click", async () => {
    const box = document.getElementById("commsCampaignPreviewBox");
    if (box) box.innerHTML = `<p class="panel-desc">Prepare…</p>`;
    const res = await apiPost(
      `/communications/campaigns/${encodeURIComponent(campaign.id)}/start/prepare`,
      {},
      { throwOnError: false }
    );
    const phrase = res.confirmationPhrase || res.preview?.confirmationPhrase;
    if (box) {
      box.innerHTML = `
        <div class="comms-banner">${res.success === false ? "Отклонено" : "Prepare готов (не отправлено)"}</div>
        ${phrase ? `<p><strong>Фраза:</strong> <code>${escapeHtml(phrase)}</code></p>` : ""}
        <pre class="protocol-preview comms-preview">${escapeHtml(JSON.stringify(res.preview || res, null, 2))}</pre>
        <p class="panel-desc">Подтверждение только через Safety Layer с точной фразой.</p>`;
    }
  });

  document.getElementById("commsCampaignPauseBtn")?.addEventListener("click", async () => {
    const box = document.getElementById("commsCampaignPreviewBox");
    const res = await apiPost(
      `/communications/campaigns/${encodeURIComponent(campaign.id)}/pause`,
      {},
      { throwOnError: false }
    );
    if (box) {
      box.innerHTML = `<div class="comms-banner">${res.success === false ? escapeHtml(res.error?.message || "Ошибка паузы") : "Кампания на паузе"}</div>`;
    }
    if (res.success !== false) {
      const root = contentEl();
      if (root) await renderCampaigns(root);
    }
  });

  document.getElementById("commsCampaignResumeBtn")?.addEventListener("click", async () => {
    const box = document.getElementById("commsCampaignPreviewBox");
    const res = await apiPost(
      `/communications/campaigns/${encodeURIComponent(campaign.id)}/resume`,
      {},
      { throwOnError: false }
    );
    if (box) {
      box.innerHTML = `<div class="comms-banner">${res.success === false ? escapeHtml(res.error?.message || "Ошибка возобновления") : "Кампания возобновлена"}</div>`;
    }
    if (res.success !== false) {
      const root = contentEl();
      if (root) await renderCampaigns(root);
    }
  });
}

function renderCampaignPreview(box, res) {
  if (!box) return;
  if (res.success === false || res.error) {
    box.innerHTML = `<p class="panel-desc">${escapeHtml(res.error?.message || "Ошибка preview")}</p>`;
    return;
  }
  const plan = res.plan || res.preview?.plan || res;
  const allowed = plan.allowed || plan.recipients || plan.samples || [];
  const exclusions = plan.exclusions || [];
  const phrase = res.confirmationPhrase || plan.confirmationPhrase || "";

  box.innerHTML = `
    ${phrase ? `<div class="comms-banner"><strong>Фраза:</strong> <code>${escapeHtml(phrase)}</code></div>` : ""}
    <p class="panel-desc">Разрешено: ${escapeHtml(String(plan.allowedCount ?? allowed.length ?? "—"))} · исключено: ${escapeHtml(String(plan.excludedCount ?? exclusions.length ?? "—"))}</p>
    <h4 class="section-title">Получатели (превью)</h4>
    ${
      Array.isArray(allowed) && allowed.length
        ? `<table class="data-table"><thead><tr><th>Контакт</th><th>Канал</th><th>Текст</th></tr></thead><tbody>
          ${allowed
            .slice(0, 30)
            .map((r) => {
              const id = r.contactId || r.id || r.recipientKey || "—";
              const ch = r.channel || "—";
              const body = r.renderedBody || r.body || r.sample || "";
              return `<tr><td>${escapeHtml(String(id))}</td><td>${escapeHtml(String(ch))}</td><td>${escapeHtml(String(body).slice(0, 120))}</td></tr>`;
            })
            .join("")}
        </tbody></table>`
        : emptyState("Нет получателей", "Добавьте contacts в preview или уточните сегмент.")
    }
    <h4 class="section-title">Исключения</h4>
    ${
      exclusions.length
        ? `<table class="data-table"><thead><tr><th>Контакт</th><th>Код</th><th>Причина</th></tr></thead><tbody>
          ${exclusions
            .slice(0, 40)
            .map(
              (x) => `<tr>
                <td>${escapeHtml(String(x.contactId || x.contact?.id || "—"))}</td>
                <td>${escapeHtml(x.code || x.exclusionCode || "—")}</td>
                <td>${escapeHtml(x.message || x.exclusionMessage || "")}</td>
              </tr>`
            )
            .join("")}
        </tbody></table>`
        : `<p class="panel-desc">Исключений нет.</p>`
    }`;
}

/* ——— Sequences ——— */

async function renderSequences(root) {
  const data = await apiGet("/communications/sequences");
  if (isDisabledResponse(data)) {
    root.innerHTML = disabledHubHtml(data?.error?.message);
    return;
  }
  const sequences = data.sequences || [];
  const templatesData = await apiGet("/communications/templates");
  const templates = templatesData.templates || [];

  root.innerHTML = `
    <div class="comms-split">
      <div class="surface surface-section">
        <h3 class="section-title">Цепочки</h3>
        <div class="comms-item-list">
          ${
            sequences.length
              ? sequences
                  .map(
                    (s) => `<button type="button" class="comms-list-card ${s.id === selectedSequenceId ? "active" : ""}" data-sequence-id="${escapeHtml(s.id)}">
                      <div><strong>${escapeHtml(s.name)}</strong> ${statusBadge(s.status)}</div>
                      <div class="panel-desc">${escapeHtml(String((s.steps || []).length))} шагов · ${escapeHtml(formatTs(s.updatedAt))}</div>
                    </button>`
                  )
                  .join("")
              : emptyState("Нет цепочек", "Создайте последовательность касаний.")
          }
        </div>
      </div>
      <div class="surface surface-section" id="commsSequenceEditor">
        <h3 class="section-title">Редактор цепочки</h3>
        <form id="commsSequenceForm" class="form-grid">
          <label class="form-field span-2"><span>Название</span><input name="name" required placeholder="Прогрев …"></label>
          <label class="form-field span-2"><span>Целевой CRM-статус</span><input name="targetCrmStatus" placeholder="опционально"></label>
          <div class="span-2">
            <div class="section-hint">Шаги (вертикально)</div>
            <div id="commsSequenceSteps" class="comms-sequence-steps"></div>
            <button type="button" class="btn btn-secondary" id="commsAddStepBtn">Добавить шаг</button>
          </div>
          <div class="confirmation-actions span-2">
            <button type="submit" class="btn btn-primary" id="commsSequenceSaveBtn">Сохранить</button>
          </div>
        </form>
        <p class="panel-desc" id="commsSequenceStatus"></p>
      </div>
    </div>`;

  const stepsHost = document.getElementById("commsSequenceSteps");
  let draftSteps = [{ delayValue: 0, delayUnit: "days", channel: "whatsapp", templateId: "", businessDays: true }];

  function renderStepCards() {
    if (!stepsHost) return;
    stepsHost.innerHTML = draftSteps
      .map(
        (step, i) => `<div class="comms-step-card" data-step-index="${i}">
          <div class="comms-step-card-head">
            <strong>Шаг ${i + 1}</strong>
            <button type="button" class="btn btn-ghost btn-sm" data-remove-step="${i}">Удалить</button>
          </div>
          <div class="form-grid">
            <label class="form-field"><span>Задержка</span><input type="number" min="0" data-field="delayValue" value="${escapeHtml(String(step.delayValue ?? 0))}"></label>
            <label class="form-field"><span>Единица</span>
              <select data-field="delayUnit">
                ${["minutes", "hours", "days"].map((u) => `<option value="${u}" ${step.delayUnit === u ? "selected" : ""}>${u}</option>`).join("")}
              </select>
            </label>
            <label class="form-field"><span>Канал</span>
              <select data-field="channel">${CHANNEL_OPTIONS.map((c) => `<option value="${c}" ${step.channel === c ? "selected" : ""}>${c}</option>`).join("")}</select>
            </label>
            <label class="form-field"><span>Шаблон</span>
              <select data-field="templateId">
                <option value="">—</option>
                ${templates.map((t) => `<option value="${escapeHtml(t.id)}" ${step.templateId === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`).join("")}
              </select>
            </label>
            <label class="form-field"><span>Только будни</span>
              <select data-field="businessDays">
                <option value="1" ${step.businessDays !== false ? "selected" : ""}>да</option>
                <option value="0" ${step.businessDays === false ? "selected" : ""}>нет</option>
              </select>
            </label>
          </div>
        </div>`
      )
      .join("");

    stepsHost.querySelectorAll("[data-remove-step]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const idx = Number(btn.dataset.removeStep);
        draftSteps = draftSteps.filter((_, i) => i !== idx);
        if (!draftSteps.length) draftSteps = [{ delayValue: 0, delayUnit: "days", channel: "whatsapp", templateId: "", businessDays: true }];
        renderStepCards();
      });
    });
    stepsHost.querySelectorAll("[data-field]").forEach((el) => {
      el.addEventListener("change", () => syncStepsFromDom());
      el.addEventListener("input", () => syncStepsFromDom());
    });
  }

  function syncStepsFromDom() {
    draftSteps = [...stepsHost.querySelectorAll(".comms-step-card")].map((card) => {
      const get = (f) => card.querySelector(`[data-field="${f}"]`)?.value;
      return {
        delayValue: Number(get("delayValue") || 0),
        delayUnit: get("delayUnit") || "days",
        channel: get("channel") || "whatsapp",
        templateId: get("templateId") || null,
        businessDays: get("businessDays") !== "0",
      };
    });
  }

  renderStepCards();

  document.getElementById("commsAddStepBtn")?.addEventListener("click", () => {
    syncStepsFromDom();
    draftSteps.push({ delayValue: 1, delayUnit: "days", channel: "whatsapp", templateId: "", businessDays: true });
    renderStepCards();
  });

  function loadSequenceIntoEditor(seq) {
    selectedSequenceId = seq.id;
    const form = document.getElementById("commsSequenceForm");
    if (form) {
      form.name.value = seq.name || "";
      form.targetCrmStatus.value = seq.targetCrmStatus || "";
    }
    draftSteps = (seq.steps || []).length
      ? seq.steps.map((s) => ({
          delayValue: s.delayValue ?? 0,
          delayUnit: s.delayUnit || "days",
          channel: s.channel || "whatsapp",
          templateId: s.templateId || "",
          businessDays: s.businessDays !== false,
        }))
      : [{ delayValue: 0, delayUnit: "days", channel: "whatsapp", templateId: "", businessDays: true }];
    renderStepCards();
    document.getElementById("commsSequenceSaveBtn").textContent = "Обновить";
  }

  root.querySelectorAll("[data-sequence-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const seq = sequences.find((s) => s.id === btn.dataset.sequenceId);
      if (seq) loadSequenceIntoEditor(seq);
      root.querySelectorAll(".comms-list-card").forEach((el) => {
        el.classList.toggle("active", el.dataset.sequenceId === selectedSequenceId);
      });
    });
  });

  document.getElementById("commsSequenceForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    syncStepsFromDom();
    const fd = new FormData(e.target);
    const payload = {
      name: fd.get("name"),
      targetCrmStatus: fd.get("targetCrmStatus") || null,
      steps: draftSteps.map((s, i) => ({ ...s, stepNumber: i + 1, templateId: s.templateId || null })),
    };
    const statusEl = document.getElementById("commsSequenceStatus");
    let res;
    if (selectedSequenceId) {
      res = await apiPatch(`/communications/sequences/${encodeURIComponent(selectedSequenceId)}`, payload, {
        throwOnError: false,
      });
    } else {
      res = await apiPost("/communications/sequences", payload, { throwOnError: false });
    }
    if (statusEl) {
      statusEl.textContent =
        res.success === false || res.error ? res.error?.message || "Ошибка" : "Сохранено";
    }
    if (res.success !== false && !res.error) {
      selectedSequenceId = res.sequence?.id || selectedSequenceId;
      renderSequences(contentEl());
    }
  });

  if (selectedSequenceId) {
    const seq = sequences.find((s) => s.id === selectedSequenceId);
    if (seq) loadSequenceIntoEditor(seq);
  }
}

/* ——— Templates ——— */

async function renderTemplates(root) {
  const data = await apiGet("/communications/templates");
  if (isDisabledResponse(data)) {
    root.innerHTML = disabledHubHtml(data?.error?.message);
    return;
  }
  const templates = data.templates || [];

  root.innerHTML = `
    <div class="comms-split">
      <div class="surface surface-section">
        <h3 class="section-title">Шаблоны</h3>
        <div class="comms-item-list">
          ${
            templates.length
              ? templates
                  .map(
                    (t) => `<button type="button" class="comms-list-card ${t.id === selectedTemplateId ? "active" : ""}" data-template-id="${escapeHtml(t.id)}">
                      <div><strong>${escapeHtml(t.name)}</strong> ${statusBadge(t.status)}</div>
                      <div class="panel-desc">${escapeHtml(t.channel)} · ${escapeHtml(t.category)}</div>
                    </button>`
                  )
                  .join("")
              : emptyState("Нет шаблонов", "Создайте шаблон формой справа.")
          }
        </div>
      </div>
      <div class="surface surface-section">
        <h3 class="section-title" id="commsTemplateFormTitle">Новый шаблон</h3>
        <form id="commsTemplateForm" class="form-grid">
          <label class="form-field span-2"><span>Название</span><input name="name" required></label>
          <label class="form-field"><span>Канал</span>
            <select name="channel">${CHANNEL_OPTIONS.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
          </label>
          <label class="form-field"><span>Категория</span>
            <select name="category">${TEMPLATE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join("")}</select>
          </label>
          <label class="form-field"><span>Статус</span>
            <select name="status"><option value="draft">draft</option><option value="active">active</option><option value="archived">archived</option></select>
          </label>
          <label class="form-field"><span>WABA template id</span><input name="wabaTemplateId" placeholder="опционально"></label>
          <label class="form-field span-2"><span>Назначение</span><input name="purpose" placeholder="кратко"></label>
          <label class="form-field span-2"><span>Текст ({{firstName}} и др.)</span><textarea name="body" rows="5" required></textarea></label>
          <div class="confirmation-actions span-2">
            <button type="submit" class="btn btn-primary">Сохранить</button>
            <button type="button" class="btn btn-secondary" id="commsTemplateNewBtn">Сбросить</button>
            <button type="button" class="btn btn-secondary" id="commsTemplateDeleteBtn" hidden>Удалить</button>
          </div>
        </form>
        <p class="panel-desc" id="commsTemplateStatus"></p>
      </div>
    </div>`;

  const form = document.getElementById("commsTemplateForm");
  const deleteBtn = document.getElementById("commsTemplateDeleteBtn");

  function fillTemplate(t) {
    selectedTemplateId = t?.id || null;
    document.getElementById("commsTemplateFormTitle").textContent = t ? "Редактирование" : "Новый шаблон";
    if (!form) return;
    form.name.value = t?.name || "";
    form.channel.value = t?.channel || "whatsapp";
    form.category.value = t?.category || "service";
    form.status.value = t?.status || "draft";
    form.wabaTemplateId.value = t?.wabaTemplateId || "";
    form.purpose.value = t?.purpose || "";
    form.body.value = t?.body || "";
    deleteBtn.hidden = !selectedTemplateId;
  }

  root.querySelectorAll("[data-template-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = templates.find((x) => x.id === btn.dataset.templateId);
      fillTemplate(t);
      root.querySelectorAll(".comms-list-card").forEach((el) => {
        el.classList.toggle("active", el.dataset.templateId === selectedTemplateId);
      });
    });
  });

  document.getElementById("commsTemplateNewBtn")?.addEventListener("click", () => fillTemplate(null));

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const payload = {
      name: fd.get("name"),
      channel: fd.get("channel"),
      category: fd.get("category"),
      status: fd.get("status"),
      wabaTemplateId: fd.get("wabaTemplateId") || null,
      purpose: fd.get("purpose") || null,
      body: fd.get("body"),
    };
    const statusEl = document.getElementById("commsTemplateStatus");
    let res;
    if (selectedTemplateId) {
      res = await apiPatch(`/communications/templates/${encodeURIComponent(selectedTemplateId)}`, payload, {
        throwOnError: false,
      });
    } else {
      res = await apiPost("/communications/templates", payload, { throwOnError: false });
    }
    if (statusEl) {
      statusEl.textContent =
        res.success === false || res.error ? res.error?.message || "Ошибка" : "Сохранено";
    }
    if (res.success !== false && !res.error) {
      selectedTemplateId = res.template?.id || selectedTemplateId;
      renderTemplates(contentEl());
    }
  });

  deleteBtn?.addEventListener("click", async () => {
    if (!selectedTemplateId) return;
    if (!confirm("Удалить шаблон?")) return;
    const res = await apiDelete(`/communications/templates/${encodeURIComponent(selectedTemplateId)}`, null, {
      throwOnError: false,
    });
    const statusEl = document.getElementById("commsTemplateStatus");
    if (statusEl) {
      statusEl.textContent =
        res.success === false || res.error ? res.error?.message || "Ошибка удаления" : "Удалено";
    }
    selectedTemplateId = null;
    if (res.success !== false && !res.error) renderTemplates(contentEl());
  });

  if (selectedTemplateId) {
    const t = templates.find((x) => x.id === selectedTemplateId);
    if (t) fillTemplate(t);
  }
}

/* ——— Delivery ——— */

async function renderDelivery(root) {
  const [delivery, analytics] = await Promise.all([
    apiGet("/communications/delivery"),
    apiGet("/communications/analytics"),
  ]);
  if (isDisabledResponse(delivery) || isDisabledResponse(analytics)) {
    root.innerHTML = disabledHubHtml(delivery?.error?.message || analytics?.error?.message);
    return;
  }

  const report = delivery.funnel ? delivery : analytics.funnel ? analytics : delivery;
  const funnel = report.funnel || {};
  const totals = report.totals || {};
  const byChannel = report.byChannel || [];
  const outbox = delivery.outbox || delivery.queue || analytics.outbox || {};

  root.innerHTML = `
    <div class="comms-overview">
      <div class="comms-stat-grid">
        ${[
          ["В очереди", funnel.scheduled ?? outbox.pending ?? "—"],
          ["Отправлено", funnel.sent ?? totals.accepted ?? "—"],
          ["Доставлено", funnel.delivered ?? totals.delivered ?? "—"],
          ["Прочитано", funnel.read ?? totals.read ?? "—"],
          ["Ответы", funnel.reply ?? totals.inboundReplies ?? "—"],
          ["Ошибки", totals.errors ?? outbox.failed ?? "—"],
        ]
          .map(
            ([label, value]) => `<div class="comms-stat surface">
              <div class="comms-stat-label">${escapeHtml(label)}</div>
              <div class="comms-stat-value">${escapeHtml(String(value))}</div>
            </div>`
          )
          .join("")}
      </div>
      ${report.note ? `<p class="panel-desc">${escapeHtml(report.note)}</p>` : ""}
      <div class="surface surface-section">
        <h3 class="section-title">По каналам</h3>
        ${
          byChannel.length
            ? `<table class="data-table"><thead><tr><th>Канал</th><th>Sent</th><th>Delivered</th><th>Read</th><th>Errors</th></tr></thead><tbody>
              ${byChannel
                .map(
                  (ch) => `<tr>
                    <td>${escapeHtml(ch.transport || "—")}</td>
                    <td>${escapeHtml(String(ch.sent ?? 0))}</td>
                    <td>${escapeHtml(String(ch.delivered ?? 0))}</td>
                    <td>${escapeHtml(String(ch.read ?? "Нет данных"))}</td>
                    <td>${escapeHtml(String(ch.errors ?? 0))}</td>
                  </tr>`
                )
                .join("")}
            </tbody></table>`
            : emptyState("Нет данных", "После первых отправок здесь появится разбивка.")
        }
      </div>
      <div class="surface surface-section">
        <h3 class="section-title">Outbox</h3>
        <p class="panel-desc">
          pending ${escapeHtml(String(outbox.pending ?? "—"))} ·
          failed ${escapeHtml(String(outbox.failed ?? "—"))} ·
          dry-run ${escapeHtml(String(outbox.dryRun ?? totals.dryRun ?? "—"))} ·
          policy-blocked ${escapeHtml(String(totals.policyBlocked ?? "—"))}
        </p>
      </div>
    </div>`;
}

/* ——— Settings ——— */

function shortFp(fp) {
  if (!fp) return "—";
  const s = String(fp);
  return s.length > 12 ? `${s.slice(0, 8)}…${s.slice(-4)}` : s;
}

function certLevelCell(ts) {
  return ts ? formatTs(ts) : "—";
}

function certBlockers(cert) {
  const bits = [];
  if (cert.status === "revoked") bits.push("отозвана");
  if (cert.status === "expired" || (cert.expiresAt && new Date(cert.expiresAt).getTime() < Date.now())) {
    bits.push("истекла");
  }
  if (cert.status === "failed") bits.push("ошибка");
  if (cert.lastError?.code) bits.push(String(cert.lastError.code));
  return bits.length ? bits.join(", ") : "—";
}

function certCardHtml(cert) {
  const id = escapeHtml(cert.id);
  return `<div class="surface surface-section comms-cert-card" data-cert-id="${id}">
    <div class="comms-cert-card__head">
      <h4 class="section-title">${escapeHtml(cert.provider || "—")} · ${escapeHtml(cert.channel || "—")}</h4>
      ${statusBadge(cert.status)}
    </div>
    <p class="panel-desc">
      transport ${escapeHtml(cert.transportId || "—")} ·
      fingerprint <code title="${escapeHtml(cert.accountFingerprint || "")}">${escapeHtml(shortFp(cert.accountFingerprint))}</code> ·
      истекает ${formatTs(cert.expiresAt)}
    </p>
    <table class="data-table data-table--compact">
      <thead><tr>
        <th>Соединение</th><th>Webhook</th><th>Одиночный</th>
        <th>Доставка</th><th>Кампания</th><th>Цепочка</th>
      </tr></thead>
      <tbody><tr>
        <td>${certLevelCell(cert.connectionTestedAt)}</td>
        <td>${certLevelCell(cert.webhookVerifiedAt)}</td>
        <td>${certLevelCell(cert.singleSendVerifiedAt)}</td>
        <td>${certLevelCell(cert.deliveryStatusVerifiedAt)}</td>
        <td>${certLevelCell(cert.campaignVerifiedAt)}</td>
        <td>${certLevelCell(cert.sequenceVerifiedAt)}</td>
      </tr></tbody>
    </table>
    <p class="panel-desc">Блокеры: ${escapeHtml(certBlockers(cert))}</p>
    <div class="confirmation-actions confirmation-actions--wrap">
      <button type="button" class="btn btn-secondary btn-sm" data-cert-run="connection">Проверить соединение</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cert-run="webhook">Проверить webhook</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cert-run="single_send">Подготовить одиночный тест</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cert-run="campaign">Подготовить кампанию</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cert-run="sequence">Подготовить цепочку</button>
      <button type="button" class="btn btn-ghost btn-sm" data-cert-revoke="1">Отозвать</button>
    </div>
  </div>`;
}

async function renderSettings(root) {
  const [settingsRes, certRes] = await Promise.all([
    apiGet("/communications/settings"),
    apiGet("/communications/certifications"),
  ]);
  const cfg = settingsRes.settings || settingsRes.config || settingsRes;
  if (cfg.enabled === false || isDisabledResponse(settingsRes)) {
    hubEnabled = false;
  } else {
    hubEnabled = cfg.enabled !== false;
  }

  const wazzup = cfg.wazzup || {};
  const maxBot = cfg.maxBot || {};
  const fields = cfg.bitrixFieldsConfigured || {};
  const autos = cfg.autoFlags || {};
  const emergency = cfg.emergencyStop || certRes.emergencyStop || { active: false };
  const certifications = certRes.certifications || [];

  root.innerHTML = `
    ${cfg.enabled === false ? disabledHubHtml("Текущий статус: COMMUNICATIONS_ENABLED=false") : ""}
    ${
      emergency.active
        ? `<div class="comms-banner comms-banner--danger">
            <strong>Аварийная остановка активна.</strong>
            ${emergency.reason ? ` Причина: ${escapeHtml(emergency.reason)}.` : ""}
            Снятие: POST /admin/communications/emergency-resume (admin, settings.manage).
          </div>`
        : ""
    }
    <div class="comms-settings ${cfg.enabled === false ? "comms-settings--dim" : ""}">
      <div class="surface surface-section">
        <h3 class="section-title">Провайдеры</h3>
        <table class="data-table">
          <tbody>
            <tr><td>Wazzup</td><td>${flagChip(wazzup.configured, "ключ задан", "ключ не задан")} ${flagChip(wazzup.enabled, "enabled", "disabled")}</td></tr>
            <tr><td>Webhook Wazzup</td><td>${flagChip(wazzup.webhookConfigured, "секрет задан", "секрет не задан")}</td></tr>
            <tr><td>MAX Bot</td><td>${flagChip(maxBot.configured, "токен задан", "токен не задан")} ${flagChip(maxBot.enabled, "enabled", "disabled")}</td></tr>
          </tbody>
        </table>
        <p class="section-hint">Секреты и API keys в интерфейсе не показываются.</p>
        <div class="confirmation-actions">
          <button type="button" class="btn btn-secondary" id="commsTestConnBtn">Проверить соединение</button>
          <button type="button" class="btn btn-secondary" id="commsSyncChannelsBtn">Синхронизировать каналы</button>
        </div>
        <p class="panel-desc" id="commsSettingsStatus"></p>
      </div>
      <div class="surface surface-section">
        <h3 class="section-title">Режимы безопасности</h3>
        ${cfg.dryRun || !cfg.sendEnabled ? `<div class="comms-banner comms-banner--warn">Внимание: dry-run или sendEnabled=false — реальная отправка отключена.</div>` : ""}
        <table class="data-table">
          <tbody>
            <tr><td>COMMUNICATIONS_ENABLED</td><td>${flagChip(cfg.enabled)}</td></tr>
            <tr><td>COMMUNICATIONS_SEND_ENABLED</td><td>${flagChip(cfg.sendEnabled)}</td></tr>
            <tr><td>COMMUNICATIONS_DRY_RUN</td><td>${flagChip(cfg.dryRun, "да", "нет")}</td></tr>
            <tr><td>REQUIRE_CERTIFICATION</td><td>${flagChip(cfg.requireCertification)}</td></tr>
            <tr><td>Часовой пояс</td><td>${escapeHtml(cfg.timezone || "—")}</td></tr>
            <tr><td>Тихие часы</td><td>${escapeHtml(cfg.quietHoursStart || "—")} – ${escapeHtml(cfg.quietHoursEnd || "—")}</td></tr>
            <tr><td>Рабочие дни</td><td>${escapeHtml((cfg.allowedWeekdays || []).join(", ") || "—")}</td></tr>
            <tr><td>Лимит кампании</td><td>${escapeHtml(String(cfg.maxCampaignRecipients ?? "—"))}</td></tr>
          </tbody>
        </table>
      </div>
      <div class="surface surface-section">
        <div class="comms-cert-section-head">
          <h3 class="section-title">Сертификация каналов</h3>
          <button type="button" class="btn btn-primary btn-sm" id="commsCertStartBtn">Начать</button>
        </div>
        <p class="panel-desc">Перед реальной отправкой канал должен пройти уровни connection → webhook → single / delivery / campaign / sequence. Live-отправка только через <code>certify:communications</code> с <code>COMMUNICATION_LIVE_CERTIFY=true</code>.</p>
        <p class="panel-desc" id="commsCertStatus"></p>
        <div id="commsCertList">
          ${
            certifications.length
              ? certifications.map(certCardHtml).join("")
              : emptyState("Нет сертификаций", "Нажмите «Начать», чтобы создать запись для провайдера/канала.")
          }
        </div>
      </div>
      <div class="surface surface-section">
        <h3 class="section-title">Bitrix-поля / авто-действия</h3>
        <div class="comms-flag-grid">
          ${Object.entries(fields)
            .map(([k, v]) => `<div><span class="panel-desc">${escapeHtml(k)}</span> ${flagChip(v, "задано", "нет")}</div>`)
            .join("") || "<p class=\"panel-desc\">Нет данных</p>"}
        </div>
        <div class="comms-flag-grid" style="margin-top:12px">
          ${Object.entries(autos)
            .map(([k, v]) => `<div><span class="panel-desc">${escapeHtml(k)}</span> ${flagChip(v)}</div>`)
            .join("")}
        </div>
      </div>
    </div>`;

  const statusEl = () => document.getElementById("commsSettingsStatus");
  const certStatusEl = () => document.getElementById("commsCertStatus");

  document.getElementById("commsTestConnBtn")?.addEventListener("click", async () => {
    if (statusEl()) statusEl().textContent = "Проверка…";
    const res = await apiPost("/communications/test-connection", { provider: "wazzup" }, { throwOnError: false });
    if (statusEl()) {
      statusEl().textContent = res.success || res.ok
        ? `OK · ${formatTs(res.checkedAt || new Date().toISOString())}`
        : res.error?.message || res.message || "Ошибка соединения";
    }
  });

  document.getElementById("commsSyncChannelsBtn")?.addEventListener("click", async () => {
    if (statusEl()) statusEl().textContent = "Синхронизация…";
    const res = await apiPost("/communications/channels/sync", {}, { throwOnError: false });
    if (statusEl()) {
      statusEl().textContent = res.success
        ? `Синхронизировано каналов: ${res.count ?? (res.channels || []).length}`
        : res.error?.message || "Ошибка sync";
    }
  });

  document.getElementById("commsCertStartBtn")?.addEventListener("click", async () => {
    if (certStatusEl()) certStatusEl().textContent = "Создание…";
    const res = await apiPost(
      "/communications/certifications",
      { provider: "wazzup", channel: "whatsapp" },
      { throwOnError: false }
    );
    if (res.success === false) {
      if (certStatusEl()) certStatusEl().textContent = res.error?.message || "Не удалось создать";
      return;
    }
    await renderSettings(root);
  });

  root.querySelectorAll("[data-cert-id]").forEach((card) => {
    const certId = card.dataset.certId;
    card.querySelectorAll("[data-cert-run]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const step = btn.dataset.certRun;
        if (certStatusEl()) certStatusEl().textContent = `Шаг «${step}»…`;
        const res = await apiPost(
          `/communications/certifications/${encodeURIComponent(certId)}/run`,
          { testType: step, unit: true, prepareOnly: true, markVerified: step === "connection" },
          { throwOnError: false }
        );
        if (certStatusEl()) {
          certStatusEl().textContent =
            res.success === false
              ? res.error?.message || `Ошибка шага ${step}`
              : `Шаг «${step}» выполнен`;
        }
        if (res.success !== false) await renderSettings(root);
      });
    });
    card.querySelector("[data-cert-revoke]")?.addEventListener("click", async () => {
      if (!window.confirm("Отозвать сертификацию этого канала?")) return;
      const res = await apiPost(
        `/communications/certifications/${encodeURIComponent(certId)}/revoke`,
        { reason: "ui" },
        { throwOnError: false }
      );
      if (certStatusEl()) {
        certStatusEl().textContent =
          res.success === false ? res.error?.message || "Ошибка отзыва" : "Сертификация отозвана";
      }
      if (res.success !== false) await renderSettings(root);
    });
  });
}

/** Optional: open hub on a specific thread from Client Context */
export function openCommunicationsThread(threadId) {
  selectedThreadId = threadId;
  switchCommsView("threads");
}
