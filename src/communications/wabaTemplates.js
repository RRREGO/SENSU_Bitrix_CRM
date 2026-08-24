/**
 * WABA template catalog: Wazzup API + SQLite cache, same sync pattern as channels.
 */

import { CommunicationError } from "./config.js";
import { getProvider } from "./providers/index.js";
import * as repo from "./communicationRepository.js";
import { ensureHubChannel, findHubChannel, wazzupApiChannelId } from "./outboundAddress.js";
import {
  normalizeWazzupTemplate,
  publicWabaTemplate,
  renderWabaBody,
  templateValuesArray,
  normalizeWabaStatus,
} from "./wabaTemplateParse.js";

function requireChannelId(channelId) {
  const id = String(channelId || "").trim();
  if (!id) {
    throw new CommunicationError("CHANNEL_ID_REQUIRED", "Для шаблонов WABA укажите channelId.");
  }
  return id;
}

export function resolveWabaChannel(channelId) {
  const id = requireChannelId(channelId);
  const hub = findHubChannel(id);
  if (!hub) {
    throw new CommunicationError(
      "CHANNEL_NOT_FOUND",
      `Канал ${id} не найден. Сначала вызовите communication_channels_list с sync=true.`
    );
  }
  return hub;
}

export async function refreshWabaTemplates(channelId) {
  const hub = resolveWabaChannel(channelId);
  const extId = wazzupApiChannelId(hub, channelId);
  const provider = getProvider("wazzup");
  if (!provider?.isEnabled?.()) {
    throw new CommunicationError("WAZZUP_DISABLED", "Wazzup выключен или API key не задан.");
  }
  const rows = await provider.getTemplates({ channelId: extId });
  const normalized = (rows || [])
    .map((row) => normalizeWazzupTemplate(row, extId))
    .filter((t) => t.templateId)
    .filter((t) => !t.channels?.length || t.channels.includes(extId) || t.channelId === extId || !t.channelId);
  repo.replaceWabaTemplatesForChannel(extId, normalized);
  return {
    channelId: extId,
    count: normalized.length,
    syncedAt: new Date().toISOString(),
  };
}

export async function listWabaTemplates({ channelId, status, sync = false } = {}) {
  if (sync) {
    try {
      await ensureHubChannel("waba");
    } catch {
      /* listing must still try local catalog */
    }
  }
  const hub = resolveWabaChannel(channelId);
  const extId = wazzupApiChannelId(hub, channelId);
  const cached = repo.listWabaTemplates({ channelId: extId, status });
  const shouldSync = Boolean(sync) || cached.length === 0;
  let fromCache = !shouldSync;
  if (shouldSync) {
    await refreshWabaTemplates(extId);
    fromCache = false;
  }
  const templates = repo.listWabaTemplates({ channelId: extId, status }).map(publicWabaTemplate);
  return {
    success: true,
    channelId: extId,
    channelName: hub.displayName || null,
    channelState: hub.state || hub.status || null,
    supportsTemplates: Boolean(hub.capabilities?.supportsTemplates) || String(hub.transport || "").toLowerCase() === "wapi",
    templates,
    fromCache,
    syncedAt: repo.getWabaTemplatesSyncedAt(extId),
  };
}

export async function getWabaTemplate(channelId, templateId, { sync = false } = {}) {
  const hub = resolveWabaChannel(channelId);
  const extId = wazzupApiChannelId(hub, channelId);
  const id = String(templateId || "").trim();
  if (!id) {
    throw new CommunicationError("TEMPLATE_ID_REQUIRED", "Укажите templateId.");
  }
  let tpl = repo.getWabaTemplate(extId, id);
  if (!tpl || sync) {
    await refreshWabaTemplates(extId);
    tpl = repo.getWabaTemplate(extId, id);
  }
  if (!tpl) {
    throw new CommunicationError("TEMPLATE_NOT_FOUND", `Шаблон ${id} не найден на канале.`);
  }
  return tpl;
}

export function defaultWabaVarsFromContact(template, contact, explicitVars = {}) {
  const vars = { ...(explicitVars || {}) };
  const firstName = String(contact?.NAME || contact?.name || "").trim();
  const needsName = (template.variables || []).some((v) => Number(v.index) === 1);
  if (needsName && (vars["1"] == null || String(vars["1"]).trim() === "") && firstName) {
    vars["1"] = firstName;
  }
  return vars;
}

export function assertWabaTemplateVars(template, vars = {}, { contact } = {}) {
  const needed = (template.variables || []).map((v) => String(v.index));
  const provided = Object.fromEntries(
    Object.entries(vars || {}).map(([k, v]) => [String(k), v == null ? "" : String(v).trim()])
  );
  const missing = needed.filter((k) => !provided[k]);
  const extra = Object.keys(provided).filter((k) => provided[k] && !needed.includes(k));
  if (missing.length || extra.length) {
    const nameMissing = missing.includes("1") && !(contact?.NAME || contact?.name);
    throw new CommunicationError(
      missing.length && !extra.length ? "REQUIRED_FIELD_EMPTY" : "TEMPLATE_VARS_MISMATCH",
      nameMissing
        ? "В карточке контакта пусто поле NAME — нельзя подставить переменную шаблона."
        : "Переменные шаблона не совпадают со схемой: проверьте количество и индексы.",
      { expected: needed, missing, extra, templateId: template.templateId }
    );
  }
  return true;
}

export function buildWabaSendPayload(template, vars) {
  const rendered = renderWabaBody(template.bodyText || template.bodyText, vars);
  return {
    templateId: template.templateId,
    templateName: template.name,
    templateStatus: normalizeWabaStatus(template.status),
    renderedBody: rendered,
    templateValues: templateValuesArray(template.variables, vars),
    variables: template.variables,
  };
}
