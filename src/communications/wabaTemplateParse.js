/**
 * Parse Wazzup / Meta WABA templates into a safe public shape.
 * No API keys, webhook secrets, or raw provider dumps.
 */

const PLACEHOLDER_RE = /\{\{\s*(\d+)\s*\}\}/g;
const WAZZUP_VAR_RE = /\[\[\s*(headerVar|bodyVar|buttonVar)(\d+)\s*\]\]/gi;

export function normalizeWabaStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (["approved", "active", "ok", "ready", "enabled"].includes(s)) return "approved";
  if (["pending", "in_review", "submitted", "processing", "new"].includes(s)) return "pending";
  if (["rejected", "failed", "declined", "disabled", "paused"].includes(s)) return "rejected";
  return s || "unknown";
}

function componentText(component) {
  if (!component) return "";
  return String(component.text || component.body || component.content || "");
}

function examplesFromComponent(component) {
  const ex = component?.example || component?.examples || {};
  if (Array.isArray(ex.body_text) && Array.isArray(ex.body_text[0])) return ex.body_text[0].map(String);
  if (Array.isArray(ex.header_text)) return ex.header_text.map(String);
  if (Array.isArray(ex)) return ex.map((v) => (Array.isArray(v) ? String(v[0] ?? "") : String(v)));
  return [];
}

export function extractWabaVariables(bodyText, components = []) {
  const byIndex = new Map();

  const add = (index, extra = {}) => {
    const n = Number(index);
    if (!Number.isInteger(n) || n < 1) return;
    const key = String(n);
    const prev = byIndex.get(key) || { index: n, placeholder: `{{${n}}}`, example: null, component: extra.component || "body" };
    byIndex.set(key, {
      ...prev,
      ...extra,
      index: n,
      placeholder: extra.placeholder || prev.placeholder,
      example: extra.example || prev.example,
      component: extra.component || prev.component,
    });
  };

  const text = String(bodyText || "");
  let m;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(text)) !== null) add(m[1], { component: "body", placeholder: `{{${m[1]}}}` });

  const re2 = new RegExp(WAZZUP_VAR_RE.source, "gi");
  while ((m = re2.exec(text)) !== null) {
    add(m[2], { component: String(m[1]).toLowerCase().replace("var", ""), placeholder: `{{${m[2]}}}` });
  }

  for (const component of components) {
    const type = String(component?.type || "BODY").toLowerCase();
    const ctext = componentText(component);
    const examples = examplesFromComponent(component);
    const re3 = new RegExp(PLACEHOLDER_RE.source, "g");
    const indexes = [];
    while ((m = re3.exec(ctext)) !== null) indexes.push(Number(m[1]));
    const re4 = new RegExp(WAZZUP_VAR_RE.source, "gi");
    while ((m = re4.exec(ctext)) !== null) indexes.push(Number(m[2]));
    if (!indexes.length && examples.length && type === "body") {
      examples.forEach((_, i) => indexes.push(i + 1));
    }
    indexes.forEach((idx, i) => {
      add(idx, {
        component: type,
        example: examples[i] != null ? String(examples[i]) : null,
      });
    });
  }

  return [...byIndex.values()].sort((a, b) => a.index - b.index);
}

export function renderWabaBody(bodyText, vars = {}) {
  const map = {};
  for (const [k, v] of Object.entries(vars || {})) {
    if (v == null) continue;
    map[String(k)] = String(v);
  }
  let text = String(bodyText || "");
  text = text.replace(PLACEHOLDER_RE, (_, n) => (map[String(n)] != null ? map[String(n)] : `{{${n}}}`));
  text = text.replace(WAZZUP_VAR_RE, (_, _kind, n) => (map[String(n)] != null ? map[String(n)] : `{{${n}}}`));
  return text;
}

export function templateValuesArray(variables, vars = {}) {
  return (variables || [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((v) => String(vars[String(v.index)] ?? ""));
}

function channelsOf(raw) {
  const list = raw?.channels || raw?.channelIds || raw?.channelList || [];
  if (Array.isArray(list)) {
    return list
      .map((c) => String(c?.channelId || c?.id || c || "").trim())
      .filter(Boolean);
  }
  if (raw?.channelId) return [String(raw.channelId)];
  return [];
}

export function normalizeWazzupTemplate(raw = {}, channelId = null) {
  const components = Array.isArray(raw.components)
    ? raw.components
    : Array.isArray(raw.templateComponents)
      ? raw.templateComponents
      : [];
  const bodyComponent =
    components.find((c) => String(c.type || "").toUpperCase() === "BODY") || components[0] || null;
  const bodyText =
    raw.bodyText ||
    raw.body ||
    raw.text ||
    componentText(bodyComponent) ||
    "";
  const variables =
    Array.isArray(raw.variables) && raw.variables.length
      ? raw.variables.map((v, i) => ({
          index: Number(v.index || v.number || i + 1),
          placeholder: v.placeholder || `{{${v.index || i + 1}}}`,
          example: v.example != null ? String(v.example) : null,
          component: v.component || "body",
        }))
      : extractWabaVariables(bodyText, components);
  const templateChannels = channelsOf(raw);
  const resolvedChannelId = raw.channelId || channelId || templateChannels[0] || null;

  return {
    templateId: String(raw.templateId || raw.templateGuid || raw.id || raw.guid || ""),
    // Prefer Wazzup UI title ("I касание общий") over Meta technical name.
    name: raw.title || raw.name || raw.templateName || raw.displayName || null,
    metaName: raw.metaName || (raw.title && raw.name && raw.title !== raw.name ? raw.name : null),
    language: raw.language || raw.lang || null,
    category: raw.category || raw.templateCategory || null,
    status: normalizeWabaStatus(raw.status || raw.moderationStatus || raw.state),
    bodyText,
    variables,
    channelId: resolvedChannelId ? String(resolvedChannelId) : null,
    channels: templateChannels,
  };
}

export function publicWabaTemplate(tpl) {
  if (!tpl) return null;
  return {
    templateId: tpl.templateId,
    name: tpl.name,
    metaName: tpl.metaName || null,
    language: tpl.language,
    category: tpl.category,
    status: tpl.status,
    bodyText: tpl.bodyText || tpl.bodyText,
    variables: (tpl.variables || []).map((v) => ({
      index: v.index,
      placeholder: v.placeholder,
      example: v.example || null,
      component: v.component || "body",
    })),
  };
}
