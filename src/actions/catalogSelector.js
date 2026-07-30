/**
 * Серверный подбор релевантных Bitrix actions для Claude (без embeddings).
 */

import { getActionCatalog } from "../actions/index.js";
import { getActionPolicy } from "../safety/policies.js";

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export function getActionCatalogBudget() {
  return intEnv("ACTION_CATALOG_MAX_CHARS", 20000);
}

const DISCOVERY_ACTIONS = [
  "deal_create_prepare",
  "deal_category_list",
  "deal_stage_list",
  "lead_stage_list",
  "search_users",
  "contact_field_audit",
];

const CATEGORY_KEYWORDS = {
  contacts: [
    "контакт",
    "контакты",
    "день рождения",
    "цикл",
    "статус контакт",
    "quality",
    "теплот",
  ],
  leads: ["лид", "лиды", "лидов", "квалификац"],
  deals: ["сделк", "воронк", "стади", "opportunity", "сумм"],
  companies: ["компани", "организац"],
  tasks: ["задач", "исполнител", "чеклист", "checklist"],
  activities: ["дело", "дела", "activity", "активност", "просрочен"],
  analytics: [
    "сколько",
    "отчет",
    "отчёт",
    "аналитик",
    "статистик",
    "нагрузк",
    "дисциплин",
    "quality",
    "без следующего",
  ],
  reports: ["быстр", "отчет", "отчёт"],
  documents: ["документ", "коммерческ", "kp", "кп"],
  users: ["пользовател", "менеджер", "сотрудник", "иван", "ответственн"],
  timeline: ["комментар", "таймлайн", "timeline", "писали", "менеджер"],
  stagehistory: ["истори", "стадий", "перемещ", "находилась", "сколько времени"],
  structure: ["воронк", "стади", "пользовательск", "поле", "кастом"],
};

const ACTION_CATEGORY = {
  contact_: "contacts",
  contacts_: "contacts",
  lead_: "leads",
  deal_: "deals",
  create_deal: "deals",
  deal_create_prepare: "deals",
  company_: "companies",
  create_task: "tasks",
  update_task: "tasks",
  delete_task: "tasks",
  search_tasks: "tasks",
  get_task: "tasks",
  activity_: "activities",
  manager_: "analytics",
  crm_discipline: "analytics",
  stale_: "analytics",
  overdue_: "analytics",
  timeline_: "timeline",
  stagehistory_: "stagehistory",
  search_users: "users",
  deal_category: "structure",
  deal_stage: "structure",
  lead_stage: "structure",
  create_funnel: "structure",
  rename_funnel: "structure",
  create_crm_custom: "structure",
};

function detectCategories(text) {
  const hay = String(text || "").toLowerCase();
  const cats = new Set();
  for (const [cat, words] of Object.entries(CATEGORY_KEYWORDS)) {
    if (words.some((w) => hay.includes(w))) cats.add(cat);
  }
  if (!cats.size) {
    cats.add("deals");
    cats.add("leads");
    cats.add("analytics");
  }
  return cats;
}

function detectIntent(text) {
  const hay = String(text || "").toLowerCase();
  if (/создай|добавь|измени|обнови|удали|перенес|назначь|переименуй/.test(hay)) {
    return "write";
  }
  if (/сколько|отчет|отчёт|статистик|без |нагрузк|дисциплин|аналитик/.test(hay)) {
    return "analytics";
  }
  return "read";
}

function categorizeAction(name) {
  for (const [prefix, cat] of Object.entries(ACTION_CATEGORY)) {
    if (name.startsWith(prefix) || name === prefix) return cat;
  }
  if (name.includes("contact")) return "contacts";
  if (name.includes("lead")) return "leads";
  if (name.includes("deal")) return "deals";
  if (name.includes("task")) return "tasks";
  if (name.includes("activity")) return "activities";
  if (name.includes("report") || name.includes("count") || name.includes("analytics")) {
    return "analytics";
  }
  return "structure";
}

function scoreAction(entry, categories, intent, message) {
  const hay = String(message || "").toLowerCase();
  const cat = categorizeAction(entry.name);
  let score = 0;
  if (categories.has(cat)) score += 5;
  if (intent === "analytics" && (cat === "analytics" || /count|report|quality|stale|without/.test(entry.name))) {
    score += 4;
  }
  if (intent === "write" && (entry.destructive || /update|create|add|delete|move|rename|set/.test(entry.name))) {
    score += 3;
  }
  if (intent === "read" && !entry.destructive) score += 1;

  const tokens = entry.name.split("_");
  for (const token of tokens) {
    if (token.length > 3 && hay.includes(token.replace(/s$/, ""))) score += 2;
  }
  if (String(entry.description || "").toLowerCase().split(/\s+/).some((w) => w.length > 4 && hay.includes(w))) {
    score += 1;
  }
  return score;
}

function compactEntry(entry) {
  const policy = getActionPolicy(entry.name);
  const access = policy?.access || (entry.destructive ? "write" : "read");
  return {
    name: entry.name,
    description: String(entry.description || "").slice(0, 120),
    params: entry.params || {},
    access,
    requiresConfirmation: Boolean(
      policy ? !["read"].includes(access) : entry.destructive
    ),
  };
}

/**
 * @param {string} userMessage
 * @param {{ expandDiscovery?: boolean, maxChars?: number }} [options]
 */
export function selectRelevantActions(userMessage, options = {}) {
  const maxChars = options.maxChars ?? getActionCatalogBudget();
  const catalog = getActionCatalog().filter((a) => a.implemented !== false);
  const categories = detectCategories(userMessage);
  const intent = detectIntent(userMessage);

  const scored = catalog
    .map((entry) => ({
      entry,
      score: scoreAction(entry, categories, intent, userMessage),
      category: categorizeAction(entry.name),
    }))
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name));

  const selected = new Map();
  for (const name of DISCOVERY_ACTIONS) {
    const found = catalog.find((a) => a.name === name);
    if (found) selected.set(name, compactEntry(found));
  }

  for (const item of scored) {
    if (item.score <= 0 && selected.size > 12) continue;
    selected.set(item.entry.name, compactEntry(item.entry));
    const draft = formatCompactCatalog([...selected.values()]);
    if (draft.length > maxChars) {
      selected.delete(item.entry.name);
      break;
    }
    if (selected.size >= 28) break;
  }

  // Always keep safety-relevant discovery + some analytics for common CRM questions
  const list = [...selected.values()];
  const text = formatCompactCatalog(list);

  return {
    actions: list,
    catalogText: text,
    diagnostics: {
      actionCatalogChars: text.length,
      actionCount: list.length,
      categories: [...categories],
      intent,
      fullCatalogAvoided: true,
      discoveryExpanded: Boolean(options.expandDiscovery),
    },
  };
}

export function expandDiscoveryCatalog(userMessage, previousNames = []) {
  const base = selectRelevantActions(userMessage, { expandDiscovery: true });
  const catalog = getActionCatalog().filter((a) => a.implemented !== false);
  const prev = new Set(previousNames);
  const extras = catalog
    .filter((a) => !prev.has(a.name))
    .slice(0, 20)
    .map(compactEntry);
  const merged = [...base.actions, ...extras];
  const text = formatCompactCatalog(merged).slice(0, getActionCatalogBudget());
  return {
    actions: merged,
    catalogText: text,
    diagnostics: {
      ...base.diagnostics,
      actionCatalogChars: text.length,
      actionCount: merged.length,
      discoveryExpanded: true,
    },
  };
}

export function formatCompactCatalog(actions) {
  return actions
    .map(
      (a) =>
        `- ${a.name} [${a.access}${a.requiresConfirmation ? ", confirm" : ""}]: ${a.description}; params=${JSON.stringify(a.params)}`
    )
    .join("\n");
}

export function measureFullCatalogChars() {
  const catalog = getActionCatalog().filter((a) => a.implemented !== false);
  return formatCompactCatalog(catalog.map(compactEntry)).length;
}
