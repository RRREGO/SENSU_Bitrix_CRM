/**
 * Расширенные настройки: ИИ, голос, email.
 */

import { apiGet, apiPost, apiPatch, apiDelete, apiPut } from "../apiClient.js";

let currentSub = "prompt";

export async function initExtendedSettings(root) {
  if (!root) return;
  root.innerHTML = `
    <nav class="settings-subnav" role="tablist">
      <button type="button" class="comms-subnav-item active" data-set-sub="prompt">Профили промптов</button>
      <button type="button" class="comms-subnav-item" data-set-sub="ai">ИИ и модели</button>
      <button type="button" class="comms-subnav-item" data-set-sub="voice">Голос</button>
      <button type="button" class="comms-subnav-item" data-set-sub="email">Электронная почта</button>
    </nav>
    <div id="extSettingsBody" class="settings-ext-body"></div>
  `;
  root.querySelectorAll("[data-set-sub]").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll("[data-set-sub]").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      currentSub = btn.dataset.setSub;
      renderSub(root.querySelector("#extSettingsBody"));
    });
  });
  await renderSub(root.querySelector("#extSettingsBody"));
}

async function renderSub(body) {
  if (!body) return;
  body.innerHTML = `<p class="panel-desc">Загрузка…</p>`;
  try {
    if (currentSub === "prompt") await renderPrompt(body);
    else if (currentSub === "ai") await renderAi(body);
    else if (currentSub === "voice") await renderVoice(body);
    else if (currentSub === "email") await renderEmail(body);
  } catch (e) {
    body.innerHTML = `<p class="panel-desc">Ошибка: ${escape(e.message || e)}</p>`;
  }
}

function escape(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function renderPrompt(body) {
  const data = await apiGet("/profiles");
  const profiles = data.profiles || [];
  const vars = await apiGet("/profiles/variables").catch(() => ({ variables: [] }));
  body.innerHTML = `
    <div class="settings-card">
      <h3>Профили промптов</h3>
      <p class="section-hint">Системные правила безопасности и tools не редактируются. Доступные переменные: ${(vars.variables || []).map((v) => `{{${v}}}`).join(", ")}</p>
      <div id="promptList"></div>
      <hr>
      <h3>Новый / редактирование</h3>
      <input type="hidden" id="pfId">
      <label class="setting-row"><span>Название</span><input id="pfName"></label>
      <label class="setting-row"><span>Базовая инструкция</span><textarea id="pfBase" rows="4"></textarea></label>
      <label class="setting-row"><span>Язык ответа</span><input id="pfLang" value="ru"></label>
      <label class="setting-row"><span>Стиль</span><input id="pfStyle" placeholder="деловой, краткий"></label>
      <label class="setting-row"><span>Правила форматирования</span><textarea id="pfFmt" rows="2"></textarea></label>
      <label class="setting-row"><span>Правила ответов</span><textarea id="pfRules" rows="2"></textarea></label>
      <div class="confirmation-actions">
        <button type="button" class="btn btn-primary" id="pfSave">Сохранить</button>
        <button type="button" class="btn btn-secondary" id="pfPreview">Предпросмотр</button>
        <button type="button" class="btn btn-secondary" id="pfDup" disabled>Дублировать</button>
      </div>
      <pre id="pfPreviewOut" class="code-block" hidden></pre>
      <p id="pfStatus" class="panel-desc"></p>
    </div>`;
  const list = body.querySelector("#promptList");
  list.innerHTML = profiles
    .map(
      (p) =>
        `<button type="button" class="btn btn-secondary btn-sm" data-pid="${escape(p.id)}">${escape(p.name)} v${p.version || 1}${p.isActive ? " (активный)" : ""}</button>`
    )
    .join(" ") || '<p class="section-hint">Нет профилей</p>';

  list.querySelectorAll("[data-pid]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = profiles.find((x) => x.id === btn.dataset.pid);
      if (!p) return;
      body.querySelector("#pfId").value = p.id;
      body.querySelector("#pfName").value = p.name || "";
      body.querySelector("#pfBase").value = p.baseInstruction || "";
      body.querySelector("#pfLang").value = p.responseLanguage || "ru";
      body.querySelector("#pfStyle").value = p.responseStyle || "";
      body.querySelector("#pfFmt").value = p.formattingRules || "";
      body.querySelector("#pfRules").value = p.responseRules || "";
      body.querySelector("#pfDup").disabled = false;
    });
  });

  body.querySelector("#pfSave").onclick = async () => {
    const id = body.querySelector("#pfId").value;
    const payload = {
      name: body.querySelector("#pfName").value,
      baseInstruction: body.querySelector("#pfBase").value,
      responseLanguage: body.querySelector("#pfLang").value,
      responseStyle: body.querySelector("#pfStyle").value,
      formattingRules: body.querySelector("#pfFmt").value,
      responseRules: body.querySelector("#pfRules").value,
    };
    try {
      if (id) await apiPatch(`/profiles/${id}`, payload);
      else await apiPost("/profiles", payload);
      body.querySelector("#pfStatus").textContent = "Сохранено.";
      await renderPrompt(body);
    } catch (e) {
      body.querySelector("#pfStatus").textContent = e.message || "Ошибка";
    }
  };
  body.querySelector("#pfPreview").onclick = async () => {
    const preview = await apiPost("/profiles/preview", { userMessage: "пример запроса" });
    const out = body.querySelector("#pfPreviewOut");
    out.hidden = false;
    out.textContent = JSON.stringify(preview.preview, null, 2);
  };
  body.querySelector("#pfDup").onclick = async () => {
    const id = body.querySelector("#pfId").value;
    if (!id) return;
    await apiPost(`/profiles/${id}/duplicate`, {});
    await renderPrompt(body);
  };
}

async function renderAi(body) {
  const flags = await apiGet("/settings/connections/flags");
  const providers = (await apiGet("/settings/ai/providers").catch(() => ({ providers: [] }))).providers || [];
  body.innerHTML = `
    <div class="settings-card">
      <h3>ИИ и модели</h3>
      <p class="section-hint">Секреты после сохранения не возвращаются. Master key: ${flags.secretsConfigured ? "задан" : "не задан (SECRETS_MASTER_KEY)"}.</p>
      <div id="aiProviders"></div>
      <hr>
      <h3>Добавить провайдера</h3>
      <label class="setting-row"><span>Название</span><input id="aiName"></label>
      <label class="setting-row"><span>Тип</span>
        <select id="aiType">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="openai_compatible">OpenAI-compatible</option>
          <option value="gemini">Google Gemini</option>
          <option value="ollama">Ollama</option>
        </select>
      </label>
      <label class="setting-row"><span>Base URL</span><input id="aiBase" placeholder="https://..."></label>
      <label class="setting-row"><span>API key</span><input id="aiKey" type="password" autocomplete="new-password"></label>
      <p class="section-hint">Прокси задаётся только администратором через LLM_PROXY_* / ANTHROPIC_PROXY в окружении сервера.</p>
      <button type="button" class="btn btn-primary" id="aiCreate">Создать</button>
      <p id="aiStatus" class="panel-desc"></p>
    </div>`;
  const box = body.querySelector("#aiProviders");
  box.innerHTML = providers
    .map(
      (p) => `<div class="settings-card settings-card--nested">
        <strong>${escape(p.name)}</strong> · ${escape(p.providerType)} · ключ: ${p.apiKey?.configured ? p.apiKey.mask || "********" : "нет"}
        <div class="confirmation-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-test="${p.id}">Проверить</button>
          <button type="button" class="btn btn-secondary btn-sm" data-sync="${p.id}">Синхронизировать модели</button>
          <button type="button" class="btn btn-secondary btn-sm" data-del="${p.id}">Удалить</button>
        </div>
        <p class="section-hint" data-res="${p.id}"></p>
      </div>`
    )
    .join("") || '<p class="section-hint">Нет подключений. Системный Anthropic из env остаётся доступен.</p>';

  box.querySelectorAll("[data-test]").forEach((btn) => {
    btn.onclick = async () => {
      const r = await apiPost(`/settings/ai/providers/${btn.dataset.test}/test`, {});
      box.querySelector(`[data-res="${btn.dataset.test}"]`).textContent = JSON.stringify(r.result);
    };
  });
  box.querySelectorAll("[data-sync]").forEach((btn) => {
    btn.onclick = async () => {
      const r = await apiPost(`/settings/ai/providers/${btn.dataset.sync}/sync-models`, {});
      box.querySelector(`[data-res="${btn.dataset.sync}"]`).textContent = `Синхронизировано: ${r.synced}`;
    };
  });
  box.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      await apiDelete(`/settings/ai/providers/${btn.dataset.del}`);
      await renderAi(body);
    };
  });
  body.querySelector("#aiCreate").onclick = async () => {
    try {
      await apiPost("/settings/ai/providers", {
        name: body.querySelector("#aiName").value,
        providerType: body.querySelector("#aiType").value,
        baseUrl: body.querySelector("#aiBase").value || undefined,
        apiKey: body.querySelector("#aiKey").value,
      });
      body.querySelector("#aiKey").value = "";
      await renderAi(body);
    } catch (e) {
      body.querySelector("#aiStatus").textContent = e.message || "Ошибка";
    }
  };
}

async function renderVoice(body) {
  const settings = (await apiGet("/settings/ai/user").catch(() => ({}))).settings || {};
  const providers = (await apiGet("/settings/ai/providers").catch(() => ({ providers: [] }))).providers || [];
  body.innerHTML = `
    <div class="settings-card">
      <h3>Голосовой ввод</h3>
      <p class="section-hint">Распознанный текст попадает в поле ввода и не отправляется автоматически.</p>
      <label class="setting-row"><span>Провайдер STT</span>
        <select id="vcProv"><option value="">Авто</option>${providers.map((p) => `<option value="${p.id}" ${settings.speechProviderId === p.id ? "selected" : ""}>${escape(p.name)}</option>`).join("")}</select>
      </label>
      <label class="setting-row"><span>Модель</span><input id="vcModel" value="${escape(settings.speechModel || "whisper-1")}"></label>
      <label class="setting-row"><span>Язык</span><input id="vcLang" value="${escape(settings.speechLanguage || "ru")}"></label>
      <label class="setting-row"><span>Макс. длительность (с)</span><input id="vcDur" type="number" value="${settings.voiceMaxDurationSec || 60}"></label>
      <button type="button" class="btn btn-primary" id="vcSave">Сохранить</button>
      <p id="vcStatus" class="panel-desc"></p>
    </div>`;
  body.querySelector("#vcSave").onclick = async () => {
    await apiPut("/settings/ai/user", {
      speechProviderId: body.querySelector("#vcProv").value || null,
      speechModel: body.querySelector("#vcModel").value,
      speechLanguage: body.querySelector("#vcLang").value,
      voiceMaxDurationSec: Number(body.querySelector("#vcDur").value) || 60,
    });
    body.querySelector("#vcStatus").textContent = "Сохранено.";
  };
}

async function renderEmail(body) {
  const data = await apiGet("/settings/email/accounts").catch(() => ({ accounts: [], sendFlags: {} }));
  const accounts = data.accounts || [];
  const flags = data.sendFlags || {};
  body.innerHTML = `
    <div class="settings-card">
      <h3>Электронная почта (SMTP)</h3>
      <p class="section-hint">Отправка: ${flags.sendEnabled ? "включена" : "выключена"}; dry-run: ${flags.dryRun ? "да" : "нет"}.</p>
      <div id="emList"></div>
      <hr>
      <label class="setting-row"><span>Название</span><input id="emName"></label>
      <label class="setting-row"><span>SMTP host</span><input id="emHost"></label>
      <label class="setting-row"><span>Порт</span><input id="emPort" type="number" value="587"></label>
      <label class="setting-row"><span>Шифрование</span>
        <select id="emEnc"><option value="starttls">STARTTLS</option><option value="tls">TLS</option><option value="none">Нет</option></select>
      </label>
      <label class="setting-row"><span>Username</span><input id="emUser"></label>
      <label class="setting-row"><span>Password</span><input id="emPass" type="password" autocomplete="new-password"></label>
      <label class="setting-row"><span>From email</span><input id="emFrom"></label>
      <label class="setting-row"><span>From name</span><input id="emFromName"></label>
      <button type="button" class="btn btn-primary" id="emCreate">Создать</button>
      <p id="emStatus" class="panel-desc"></p>
    </div>`;
  const list = body.querySelector("#emList");
  list.innerHTML = accounts
    .map(
      (a) => `<div class="settings-card settings-card--nested">
        <strong>${escape(a.name)}</strong> · ${escape(a.fromEmail)} · ${escape(a.host)}:${a.port}
        <div class="confirmation-actions">
          <button type="button" class="btn btn-secondary btn-sm" data-test="${a.id}">Проверить подключение</button>
          <button type="button" class="btn btn-secondary btn-sm" data-del="${a.id}">Удалить</button>
        </div>
        <p class="section-hint" data-res="${a.id}"></p>
      </div>`
    )
    .join("") || '<p class="section-hint">Нет аккаунтов</p>';
  list.querySelectorAll("[data-test]").forEach((btn) => {
    btn.onclick = async () => {
      const r = await apiPost(`/settings/email/accounts/${btn.dataset.test}/test`, {});
      list.querySelector(`[data-res="${btn.dataset.test}"]`).textContent = r.result?.message || JSON.stringify(r.result);
    };
  });
  list.querySelectorAll("[data-del]").forEach((btn) => {
    btn.onclick = async () => {
      await apiDelete(`/settings/email/accounts/${btn.dataset.del}`);
      await renderEmail(body);
    };
  });
  body.querySelector("#emCreate").onclick = async () => {
    try {
      await apiPost("/settings/email/accounts", {
        name: body.querySelector("#emName").value,
        host: body.querySelector("#emHost").value,
        port: Number(body.querySelector("#emPort").value),
        encryption: body.querySelector("#emEnc").value,
        username: body.querySelector("#emUser").value,
        password: body.querySelector("#emPass").value,
        fromEmail: body.querySelector("#emFrom").value,
        fromName: body.querySelector("#emFromName").value,
      });
      body.querySelector("#emPass").value = "";
      await renderEmail(body);
    } catch (e) {
      body.querySelector("#emStatus").textContent = e.message || "Ошибка";
    }
  };
}
