/**
 * Сверка списка компаний / ФИО с CRM одним read-запросом.
 * Загружает справочники Bitrix и сопоставляет локально — без N поисков и без подтверждения.
 */

import XLSX from "xlsx";
import { callBitrixMethodFull } from "../bitrixClient.js";
import {
  ENTITY_TYPE,
  crmItemListAll,
  fetchAllPages,
  getAnalyticsMaxPages,
  logAnalytics,
  normalizeListResult,
} from "./helpers.js";

export const MATCH_LIST_KIND = "crm_match_list";
export const MAX_MATCH_INPUT_ROWS = 300;
const FOUND_SCORE = 0.92;
const SIMILAR_SCORE = 0.55;
const LEGAL_FORM_NAMES =
  "ооо|тоо|ао|зао|оао|пао|ип|нко|llp|ltd|llc|inc|gmbh|corp";

function legalFormPattern(flags) {
  return new RegExp(`(^|\\s)(${LEGAL_FORM_NAMES})(?=\\s|$|[."«»])`, flags);
}

function hasLegalForm(text) {
  return legalFormPattern("i").test(String(text || "").toLowerCase());
}

function cleanBitrixFilter(filter = {}) {
  const out = {};
  for (const [key, value] of Object.entries(filter || {})) {
    if (key.startsWith("__")) continue;
    out[key] = value;
  }
  return out;
}

export function normalizeMatchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/["«»„“”'`]/g, "")
    .replace(/[.,;:()/\\|]+/g, " ")
    .replace(legalFormPattern("gi"), " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractInn(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 12) return digits;
  return "";
}

function looksLikePerson(value) {
  const text = String(value || "").trim();
  if (!text || /\d{5,}/.test(text)) return false;
  if (hasLegalForm(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.length <= 4 && words.every((w) => /^[A-Za-zА-Яа-яЁё-]{2,}$/.test(w));
}

function looksLikeCompany(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (hasLegalForm(text)) return true;
  return /["«»]|компани|групп|холдинг/i.test(text);
}

function splitRow(line) {
  const text = String(line || "").replace(/\r/g, "").trim();
  if (!text || text.startsWith("#") || text.startsWith("###")) return [];
  if (text.includes("\t")) return text.split("\t").map((c) => c.trim());
  if (text.includes(";")) return text.split(";").map((c) => c.trim());
  if (text.includes("|")) return text.split("|").map((c) => c.trim());
  const csv = text.split(",").map((c) => c.trim());
  if (csv.length >= 2) return csv;
  return [text];
}

function isHeaderRow(cells) {
  const hay = cells.join(" ").toLowerCase();
  return /компани|назван|организац|фио|контакт|фамилия|имя|инн|телефон|phone|title|company|name/.test(
    hay
  );
}

function looksLikeInn(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  const stripped = raw.replace(/^инн[:\s]*/i, "").replace(/[\s-]/g, "");
  return /^\d{10}$|^\d{12}$/.test(stripped);
}

function headerColumnMap(cells) {
  const map = { company: -1, person: -1, inn: -1 };
  cells.forEach((h, i) => {
    const hay = String(h || "").toLowerCase();
    if (/инн|\binn\b/.test(hay)) map.inn = i;
    else if (/фио|контакт|фамилия/.test(hay) && !/компани|company/.test(hay)) map.person = i;
    else if (/компани|назван|организац|company|title/.test(hay)) map.company = i;
  });
  if (map.company < 0 && map.person < 0 && map.inn < 0) return null;
  return map;
}

function assignColumns(cells) {
  const innCell = cells.find((c) => looksLikeInn(c));
  const rest = innCell ? cells.filter((c) => c !== innCell) : cells;
  const innQuery = innCell ? extractInn(innCell) : "";
  const [a, b] = [rest[0] || "", rest[1] || ""];
  if (!b) {
    if (looksLikePerson(a)) return { companyQuery: "", personQuery: a, innQuery };
    return { companyQuery: a, personQuery: "", innQuery };
  }
  const aPerson = looksLikePerson(a);
  const bPerson = looksLikePerson(b);
  const aCompany = looksLikeCompany(a);
  const bCompany = looksLikeCompany(b);
  if (aPerson && !bPerson) return { companyQuery: b, personQuery: a, innQuery };
  if (bPerson && !aPerson) return { companyQuery: a, personQuery: b, innQuery };
  if (aCompany && !bCompany) return { companyQuery: a, personQuery: b, innQuery };
  if (bCompany && !aCompany) return { companyQuery: b, personQuery: a, innQuery };
  return { companyQuery: a, personQuery: b, innQuery };
}

function rowFromCells(cells, headerMap) {
  if (!headerMap) return assignColumns(cells);
  const companyQuery = headerMap.company >= 0 ? String(cells[headerMap.company] || "").trim() : "";
  const personQuery = headerMap.person >= 0 ? String(cells[headerMap.person] || "").trim() : "";
  const innQuery = headerMap.inn >= 0 ? extractInn(cells[headerMap.inn]) : extractInn(cells.find((c) => looksLikeInn(c)));
  return { companyQuery, personQuery, innQuery };
}

export function isPlaceholderListText(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  const lines = t.split(/\n/).filter((line) => line.trim());
  if (lines.length >= 3) return false;
  if (/\t/.test(t) && lines.length >= 2) return false;
  return /^(см\.?\s*)?(вложен|файл|список|приложен|attachment|текст вложения)/i.test(t);
}

export function extractListTextFromUserMessage(userMessage) {
  const text = String(userMessage || "");
  const marker = "---\nПрикреплённые файлы";
  const idx = text.indexOf(marker);
  if (idx < 0) return "";
  const rest = text.slice(idx + marker.length);
  const fileHead = rest.search(/###\s*Файл:/i);
  const body = fileHead >= 0 ? rest.slice(fileHead) : rest;
  const firstNl = body.indexOf("\n");
  return (firstNl >= 0 ? body.slice(firstNl + 1) : body).trim();
}

const MATCH_ACTIONS = new Set(["crm_match_list", "crm_duplicate_search"]);

export function applyAttachmentTextToMatchParams(action, params = {}, fallbackText = "") {
  if (!MATCH_ACTIONS.has(String(action || ""))) return params || {};
  const next = { ...(params || {}) };
  if (Array.isArray(next.items) && next.items.length) return next;
  const raw = String(next.text || next.content || next.list || "").trim();
  if (raw && !isPlaceholderListText(raw)) {
    next.text = raw;
    return next;
  }
  const fallback = String(fallbackText || "").trim();
  if (fallback) next.text = fallback;
  return next;
}

export function parseMatchItems(params = {}) {
  if (Array.isArray(params.items) && params.items.length) {
    return params.items
      .map((item, index) => {
        if (item == null) return null;
        if (typeof item === "string") {
          const cells = splitRow(item);
          if (!cells.length) return null;
          const assigned = assignColumns(cells);
          return {
            line: index + 1,
            input: cells.filter(Boolean).join(" | "),
            ...assigned,
          };
        }
        const companyQuery = String(item.company || item.title || item.companyQuery || "").trim();
        const personQuery = String(item.name || item.fio || item.person || item.personQuery || "").trim();
        const innQuery = extractInn(item.inn || item.innQuery || item.INN || "");
        const input =
          String(item.raw || item.input || [companyQuery, personQuery, innQuery].filter(Boolean).join(" | ")).trim();
        if (!companyQuery && !personQuery && !innQuery && !input) return null;
        const fallback = !companyQuery && !personQuery && !innQuery ? assignColumns(splitRow(input)) : null;
        return {
          line: Number(item.line) || index + 1,
          input: input || `${companyQuery} | ${personQuery}`.trim(),
          companyQuery: companyQuery || fallback?.companyQuery || "",
          personQuery: personQuery || fallback?.personQuery || "",
          innQuery: innQuery || fallback?.innQuery || "",
        };
      })
      .filter(Boolean);
  }

  const text = String(params.text || "").trim();
  if (!text) return [];

  const lines = text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter(
      (line) =>
        !/^#{1,3}\s*файл:/i.test(line) &&
        !/^лист:/i.test(line) &&
        !/извлечённый текст вложений|опирайся на него|пользователь прикрепил файлы|найдено \/ не найдено/i.test(
          line
        )
    );

  const rows = [];
  let headerMap = null;
  for (const line of lines) {
    const cells = splitRow(line).filter((c) => c && c !== "[текст обрезан]");
    if (!cells.length) continue;
    if (!headerMap && rows.length === 0 && isHeaderRow(cells)) {
      headerMap = headerColumnMap(cells);
      continue;
    }
    const assigned = rowFromCells(cells, headerMap);
    if (!assigned.companyQuery && !assigned.personQuery && !assigned.innQuery) continue;
    rows.push({
      line: rows.length + 1,
      input: cells.join(" | "),
      ...assigned,
    });
  }
  return rows;
}

function tokenSet(normalized) {
  return new Set(
    String(normalized || "")
      .split(" ")
      .filter((w) => w.length > 1)
  );
}

function tokenJaccard(a, b) {
  const ta = tokenSet(a);
  const tb = tokenSet(b);
  if (!ta.size || !tb.size) return 0;
  let inter = 0;
  for (const word of ta) {
    if (tb.has(word)) inter += 1;
  }
  return inter / (ta.size + tb.size - inter);
}

const RU_TO_LAT = {
  а: "a",
  б: "b",
  в: "v",
  г: "g",
  д: "d",
  е: "e",
  ж: "zh",
  з: "z",
  и: "i",
  й: "y",
  к: "k",
  л: "l",
  м: "m",
  н: "n",
  о: "o",
  п: "p",
  р: "r",
  с: "s",
  т: "t",
  у: "u",
  ф: "f",
  х: "h",
  ц: "ts",
  ч: "ch",
  ш: "sh",
  щ: "sch",
  ъ: "",
  ы: "y",
  ь: "",
  э: "e",
  ю: "yu",
  я: "ya",
};

function translitRuToLat(word) {
  return [...String(word || "")].map((ch) => RU_TO_LAT[ch] ?? ch).join("");
}

function companyTokensEqual(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const aLat = translitRuToLat(a);
  const bLat = translitRuToLat(b);
  return aLat === b || bLat === a || aLat === bLat;
}

function matchedQueryTokens(queryTokens, titleTokens) {
  const used = new Set();
  let count = 0;
  for (const q of queryTokens) {
    const idx = titleTokens.findIndex((t, i) => !used.has(i) && companyTokensEqual(q, t));
    if (idx < 0) continue;
    used.add(idx);
    count += 1;
  }
  return count;
}

export function scoreNames(left, right) {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    return Math.min(0.98, 0.72 + 0.26 * ratio);
  }
  return tokenJaccard(a, b);
}

/**
 * Компании: бренд из списка может быть частью длинного названия в CRM
 * («Ozon» = «ОЗОН / OZON (ООО ИНТЕРНЕТ РЕШЕНИЯ)»).
 * Обратное неверно: «НОВАБЕВ ИНФО ТЕХ» ≠ «ИНФО ТЕХ».
 */
export function scoreCompanyNames(left, right) {
  const a = normalizeMatchText(left);
  const b = normalizeMatchText(right);
  if (!a || !b) return 0;
  if (a === b || companyTokensEqual(a, b)) return 1;

  const ta = [...tokenSet(a)];
  const tb = [...tokenSet(b)];
  if (!ta.length || !tb.length) return 0;

  const queryInTitle = matchedQueryTokens(ta, tb);
  const titleInQuery = matchedQueryTokens(tb, ta);

  if (queryInTitle === ta.length) {
    if (tb.length === ta.length) return 1;
    const distinctive = ta.some((w) => w.length >= 3);
    if (!distinctive) return 0.7;
    return ta.length === 1 ? (ta[0].length >= 4 ? 0.97 : 0.9) : 0.94;
  }

  if (titleInQuery === tb.length) {
    const extra = ta.filter((w) => !tb.some((t) => companyTokensEqual(w, t)) && w.length >= 3);
    if (!extra.length) return 0.95;
    // Название в CRM целиком входит в запрос, но в списке есть лишние слова → «похоже», не «найдено».
    return Math.max(SIMILAR_SCORE + 0.12, Math.min(0.85, 0.55 + 0.3 * (titleInQuery / ta.length)));
  }

  return queryInTitle / (ta.length + tb.length - queryInTitle);
}

function nameParts(value) {
  return normalizeMatchText(value)
    .replace(/\./g, " ")
    .split(" ")
    .filter(Boolean);
}

function isPatronymic(word) {
  return /(?:ович|евич|овна|евна|ична|инична)$/.test(String(word || "")) && String(word || "").length >= 6;
}

/** Имя не равно отчеству; префикс только для инициала или почти того же слова. */
function personTokensCompatible(a, b) {
  if (!a || !b) return null;
  if (a === b) return "exact";
  if (isPatronymic(a) !== isPatronymic(b)) return null;
  if (a.length === 1 && b.startsWith(a)) return "initial";
  if (b.length === 1 && a.startsWith(b)) return "initial";
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) {
    const ratio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
    if (ratio >= 0.75) return "prefix";
  }
  return null;
}

/** Сравнение ФИО: порядок имя/фамилия, инициалы, при необходимости только фамилия. */
export function scorePersonNames(query, title, { allowSurnameOnly = false } = {}) {
  const base = tokenJaccard(normalizeMatchText(query), normalizeMatchText(title));
  const q = nameParts(query);
  const t = nameParts(title);
  if (!q.length || !t.length) return base;

  const tSet = new Set(t);
  const queryCovered = q.every((w) => tSet.has(w));
  if (queryCovered && q.length >= 2) {
    return Math.max(base, t.length === q.length ? 1 : 0.96);
  }

  const longQ = q.filter((w) => w.length >= 4);
  const longT = t.filter((w) => w.length >= 4);
  let shared = null;
  for (const s of longQ) {
    if (longT.includes(s)) {
      shared = s;
      break;
    }
    const hit = longT.find((ts) => personTokensCompatible(s, ts) === "prefix");
    if (hit) {
      shared = s;
      break;
    }
  }
  if (!shared) return base;

  const related = (w) =>
    w === shared || personTokensCompatible(w, shared) === "prefix" || personTokensCompatible(w, shared) === "exact";
  const qRest = q.filter((w) => !related(w));
  const tRest = t.filter((w) => !related(w));
  let bestRest = 0;
  for (const a of qRest) {
    for (const b of tRest) {
      const kind = personTokensCompatible(a, b);
      if (kind === "exact") bestRest = Math.max(bestRest, 0.97);
      else if (kind === "initial") bestRest = Math.max(bestRest, 0.88);
      else if (kind === "prefix") bestRest = Math.max(bestRest, 0.9);
    }
  }
  if (bestRest) return Math.max(base, bestRest);

  if (allowSurnameOnly) return Math.max(base, 0.62);
  return base;
}

function companyTitle(item) {
  return String(item?.TITLE || item?.title || "").trim();
}

function contactTitle(item) {
  const last = item?.LAST_NAME || item?.lastName || "";
  const first = item?.NAME || item?.name || "";
  const second = item?.SECOND_NAME || item?.secondName || "";
  const assembled = [last, first, second].filter(Boolean).join(" ").trim();
  if (assembled) return assembled;
  return String(item?.FULL_NAME || item?.fullName || item?.TITLE || item?.title || "").trim();
}

function entityId(item) {
  return Number(item?.ID || item?.id || 0) || null;
}

function contactCompanyId(item) {
  return Number(item?.COMPANY_ID || item?.companyId || 0) || null;
}

function takeTopHits(scored, limit) {
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      Number(Boolean(b.inCompany)) - Number(Boolean(a.inCompany)) ||
      a.title.localeCompare(b.title, "ru")
  );
  const uniq = [];
  const seen = new Set();
  for (const hit of scored) {
    if (!hit.id || seen.has(hit.id)) continue;
    seen.add(hit.id);
    uniq.push(hit);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

function companyInn(item) {
  return extractInn(item?.inn || item?.RQ_INN || item?.rqInn || "");
}

function companyLegalNames(item) {
  return [
    item?.legalName,
    item?.fullName,
    item?.RQ_COMPANY_NAME,
    item?.rqCompanyName,
    item?.RQ_COMPANY_FULL_NAME,
    item?.rqCompanyFullName,
  ]
    .map((v) => String(v || "").trim())
    .filter(Boolean);
}

function companyContainmentKind(query, title) {
  const a = normalizeMatchText(query);
  const b = normalizeMatchText(title);
  if (!a || !b) return null;
  const ta = [...tokenSet(a)];
  const tb = [...tokenSet(b)];
  if (!ta.length || !tb.length) return null;
  const queryInTitle = matchedQueryTokens(ta, tb);
  const titleInQuery = matchedQueryTokens(tb, ta);
  if (queryInTitle === ta.length && tb.length > ta.length) return "brand";
  if (titleInQuery === tb.length && ta.length > tb.length) return "partial";
  return null;
}

function bestCompanyNameKind(query, item) {
  const names = [companyTitle(item), ...companyLegalNames(item)];
  for (const name of names) {
    const kind = companyContainmentKind(query, name);
    if (kind) return kind;
  }
  return null;
}

function scoreCompanyItem(query, item) {
  const names = [companyTitle(item), ...companyLegalNames(item)];
  let best = 0;
  for (const name of names) {
    best = Math.max(best, scoreCompanyNames(query, name));
    if (best >= 1) break;
  }
  return best;
}

function bestCompanyHits(query, innQuery, companies, limit = 3) {
  const q = String(query || "").trim();
  const inn = extractInn(innQuery);
  const scored = [];
  for (const item of companies) {
    const itemInn = companyInn(item);
    if (inn && itemInn && inn === itemInn) {
      scored.push({
        id: entityId(item),
        title: companyTitle(item),
        inn: itemInn,
        score: 1,
        match: "exact",
      });
      continue;
    }
    if (!q) continue;
    const score = scoreCompanyItem(q, item);
    if (score < SIMILAR_SCORE) continue;
    scored.push({
      id: entityId(item),
      title: companyTitle(item),
      inn: itemInn || "",
      score,
      match: score >= FOUND_SCORE ? "exact" : "similar",
      reason: score >= FOUND_SCORE ? "brand" : bestCompanyNameKind(q, item) || "similar",
    });
  }
  return takeTopHits(scored, limit);
}

function bestPersonHits(query, contacts, companyHits, limit = 3) {
  const q = String(query || "").trim();
  if (!q) return [];
  const companyIds = new Set(companyHits.map((h) => h.id).filter(Boolean));

  function collect(minScore, surnameOnlyInCompany) {
    const scored = [];
    for (const item of contacts) {
      const title = contactTitle(item);
      if (!title) continue;
      const cid = contactCompanyId(item);
      const inCompany = Boolean(cid && companyIds.has(cid));
      const score = scorePersonNames(q, title, {
        allowSurnameOnly: surnameOnlyInCompany && inCompany,
      });
      if (score < minScore) continue;
      scored.push({
        id: entityId(item),
        title,
        score,
        companyId: cid,
        inCompany,
        match: score >= FOUND_SCORE ? "exact" : "similar",
      });
    }
    return takeTopHits(scored, limit);
  }

  const hits = collect(SIMILAR_SCORE, false);
  if (hits.length) return hits;
  if (companyIds.size) return collect(0.5, true);
  return [];
}

function pickPrimary(hits) {
  return hits[0] || null;
}

function rowStatus(companyHits, contactHits, hasPersonQuery, hasCompanyQuery) {
  const contactExact = contactHits.some((h) => h.match === "exact");
  const companyExact = companyHits.some((h) => h.match === "exact");
  const exactCompanyIds = new Set(
    companyHits.filter((h) => h.match === "exact").map((h) => h.id).filter(Boolean)
  );
  const primary = contactHits[0];
  const primaryFitsCompany =
    !primary?.companyId || exactCompanyIds.has(primary.companyId);

  if (hasPersonQuery && hasCompanyQuery) {
    if (contactExact && companyExact && primaryFitsCompany) return "found";
    if (contactExact || contactHits.length) return "similar";
    if (companyHits.length) return "company_only";
    return "not_found";
  }
  if (hasPersonQuery) {
    if (contactExact) return "found";
    if (contactHits.length) return "similar";
    if (companyHits.length) return "company_only";
    return "not_found";
  }
  if (!companyHits.length) return "not_found";
  if (companyExact) return "found";
  return "similar";
}

function companiesById(companies) {
  const map = new Map();
  for (const item of companies) {
    const id = entityId(item);
    if (id) {
      map.set(id, {
        id,
        title: companyTitle(item),
        inn: companyInn(item),
      });
    }
  }
  return map;
}

function pickDisplayedCompany(companyHits, contact, index) {
  const named = pickPrimary(companyHits);
  if (named) {
    if (!named.inn && named.id && index.has(named.id)) {
      return { ...named, inn: index.get(named.id).inn || "" };
    }
    return named;
  }
  if (contact?.companyId && index.has(contact.companyId)) {
    const linked = index.get(contact.companyId);
    return { ...linked, score: 0, match: "other" };
  }
  return null;
}

function rowNote({
  status,
  companyHits,
  contactHits,
  company,
  hasCompanyQuery,
  hasPersonQuery,
}) {
  const companyExact = companyHits.some((h) => h.match === "exact");
  const primaryCompany = companyHits[0] || company;
  const parts = [];

  if (hasCompanyQuery && primaryCompany?.title && !companyExact) {
    if (primaryCompany.reason === "partial") {
      parts.push(`Похожая компания: в Bitrix более короткое название («${primaryCompany.title}»)`);
    } else if (primaryCompany.match === "similar") {
      parts.push(`Похожая компания: «${primaryCompany.title}»`);
    }
  }

  if (hasPersonQuery && contactHits.length && !contactHits.some((h) => h.match === "exact")) {
    parts.push("ФИО совпало неточно");
  } else if (hasPersonQuery && hasCompanyQuery && contactHits.some((h) => h.match === "exact") && !companyExact) {
    if (!parts.length) parts.push("Контакт найден, компания не совпала");
  }

  if (status === "company_only" && !parts.length) {
    parts.push("Компания есть, контакт не найден");
  }

  return parts.join(". ");
}

export function matchQueriesToDirectory(items, { companies = [], contacts = [] } = {}) {
  const index = companiesById(companies);
  return items.map((item) => {
    const companyHits = bestCompanyHits(item.companyQuery, item.innQuery, companies);
    const personQuery = String(item.personQuery || (!item.companyQuery && !item.innQuery ? item.input : "")).trim();
    const contactHits = bestPersonHits(personQuery, contacts, companyHits);
    const hasPersonQuery = Boolean(personQuery);
    const hasCompanyQuery = Boolean(String(item.companyQuery || "").trim() || item.innQuery);
    const status = rowStatus(companyHits, contactHits, hasPersonQuery, hasCompanyQuery);
    const contact = pickPrimary(contactHits);
    const company = pickDisplayedCompany(companyHits, contact, index);
    return {
      line: item.line,
      input: item.input,
      companyQuery: item.companyQuery || "",
      personQuery: item.personQuery || "",
      innQuery: item.innQuery || "",
      status,
      note: rowNote({
        status,
        companyHits,
        contactHits,
        company,
        hasCompanyQuery,
        hasPersonQuery,
      }),
      company,
      contact,
      companyHits,
      contactHits,
    };
  });
}

function formatHit(hit, type) {
  if (!hit) return "";
  const label = type === "company" ? "компания" : "контакт";
  const inn = type === "company" && hit.inn ? ` ИНН ${hit.inn}` : "";
  return `${label} ${hit.id} ${hit.title}${inn}`;
}

export function formatMatchListForLlm(result) {
  const summary = result.summary || {};
  const lines = [
    "Сверка списка с CRM выполнена. Подтверждение не требуется — это чтение.",
    `Всего: ${summary.total ?? 0}. Контактов найдено: ${summary.found ?? 0}. Похоже: ${summary.similar ?? 0}. Компания без контакта: ${summary.companyOnly ?? 0}. Нет в CRM: ${summary.notFound ?? 0}.`,
  ];
  if (result.directory) {
    lines.push(
      `Справочник: компаний ${result.directory.companies ?? 0}, контактов ${result.directory.contacts ?? 0}${
        result.directory.truncated ? " (неполный, лимит страниц)" : ""
      }.`
    );
  }
  if (result.warnings?.length) {
    for (const warning of result.warnings) {
      lines.push(`Предупреждение: ${warning.message || warning}`);
    }
  }
  lines.push("Таблица:");
  for (const row of result.rows || []) {
    const bits = [formatHit(row.company, "company"), formatHit(row.contact, "contact")].filter(Boolean);
    const status =
      row.status === "found"
        ? "найдено"
        : row.status === "similar"
          ? "похоже"
          : row.status === "company_only"
            ? "нет контакта"
            : "нет";
    lines.push(`${row.line}\t${status}\t${row.input}\t${bits.join("; ") || "—"}${row.note ? `\t${row.note}` : ""}`);
  }
  lines.push("В ответе пользователю кратко итог. Полная таблица уже в карточке, не копируй все строки.");
  return lines.join("\n");
}

function statusLabel(status) {
  if (status === "found") return "Найдено";
  if (status === "similar") return "Похоже";
  if (status === "company_only") return "Нет контакта";
  return "Нет в CRM";
}

function splitListedInput(input) {
  const text = String(input || "").trim();
  if (!text) return { company: "", person: "" };
  const parts = text.split(/\s*\|\s*|\s·\s/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { company: parts[0], person: parts.slice(1).join(" | ") };
  return { company: text, person: "" };
}

function cell(value) {
  const text = String(value || "").trim();
  return text || "—";
}

export function matchListTable(result) {
  const rows = Array.isArray(result?.rows) ? result.rows : [];
  const columns = [
    "#",
    "Компания",
    "ФИО",
    "Статус",
    "Компания в Bitrix",
    "ФИО в Bitrix",
    "ID компании",
    "ID контакта",
    "ИНН",
    "Примечание",
  ];
  return {
    columns,
    rows: rows.map((row) => {
      const listed = splitListedInput(row.input);
      return [
        row.line,
        cell(row.companyQuery || listed.company),
        cell(row.personQuery || listed.person),
        statusLabel(row.status),
        cell(row.company?.title),
        cell(row.contact?.title),
        row.company?.id ? String(row.company.id) : "—",
        row.contact?.id ? String(row.contact.id) : "—",
        cell(row.company?.inn),
        cell(row.note),
      ];
    }),
  };
}

export function tableToXlsxBase64(columns, rows, sheetName = "Сверка") {
  const aoa = [columns, ...(rows || [])];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = columns.map((title, index) => {
    const maxLen = Math.max(
      String(title).length,
      ...aoa.slice(1).map((row) => String(row?.[index] ?? "").length)
    );
    return { wch: Math.min(48, Math.max(10, maxLen + 2)) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, String(sheetName).slice(0, 31) || "Сверка");
  return XLSX.write(wb, { type: "base64", bookType: "xlsx" });
}

export function buildMatchListCard(result) {
  const table = matchListTable(result);
  const date = new Date().toISOString().slice(0, 10);
  return {
    type: "report",
    title: "Сверка с CRM",
    summary:
      result?.summary != null
        ? `Контактов найдено ${result.summary.found}, похоже ${result.summary.similar}, нет контакта ${result.summary.companyOnly ?? 0}, нет в CRM ${result.summary.notFound} из ${result.summary.total}`
        : null,
    table,
    download: table.rows.length
      ? {
          filename: `sverka-crm-${date}.xlsx`,
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          contentBase64: tableToXlsxBase64(table.columns, table.rows),
        }
      : null,
  };
}

function attachRequisites(companies, requisites) {
  const byCompany = new Map();
  for (const rq of requisites || []) {
    const cid = Number(rq.ENTITY_ID || rq.entityId || 0);
    if (!cid) continue;
    const prev = byCompany.get(cid) || { inn: "", legalName: "", fullName: "" };
    const inn = extractInn(rq.RQ_INN || rq.rqInn || rq.inn);
    const legalName = String(rq.RQ_COMPANY_NAME || rq.rqCompanyName || "").trim();
    const fullName = String(rq.RQ_COMPANY_FULL_NAME || rq.rqCompanyFullName || "").trim();
    if (inn && !prev.inn) prev.inn = inn;
    if (legalName && !prev.legalName) prev.legalName = legalName;
    if (fullName && !prev.fullName) prev.fullName = fullName;
    byCompany.set(cid, prev);
  }
  return companies.map((item) => {
    const extra = byCompany.get(entityId(item)) || {};
    return {
      ...item,
      inn: extra.inn || companyInn(item),
      legalName: extra.legalName || "",
      fullName: extra.fullName || "",
    };
  });
}

async function loadCompanyRequisites(maxPages) {
  const loaded = await fetchAllPages({
    actionName: "crm_match_list_requisites",
    maxPages,
    fetchPage: async (start) => {
      const { result, next, total } = await callBitrixMethodFull("crm.requisite.list", {
        filter: { ENTITY_TYPE_ID: ENTITY_TYPE.COMPANY },
        select: ["ID", "ENTITY_ID", "RQ_INN", "RQ_COMPANY_NAME", "RQ_COMPANY_FULL_NAME"],
        start,
      });
      return normalizeListResult(result, { next, total });
    },
  });
  return loaded;
}

export async function crm_match_list(params = {}) {
  const started = Date.now();
  const items = parseMatchItems(params).slice(0, MAX_MATCH_INPUT_ROWS);
  if (!items.length) {
    return {
      kind: MATCH_LIST_KIND,
      success: false,
      error: {
        code: "MATCH_LIST_EMPTY",
        message: "Нет строк для сверки. Сервер не получил текст списка: прикрепите файл в это же сообщение.",
      },
    };
  }

  const filter = cleanBitrixFilter(params.filter || {});
  const matchCompanies = params.matchContactsOnly === true ? false : params.match !== "contact";
  const matchContacts = params.matchCompaniesOnly === true ? false : params.match !== "company";

  const warnings = [];
  let companies = [];
  let contacts = [];
  let truncated = false;
  let pages = 0;

  if (matchCompanies) {
    const loaded = await crmItemListAll(
      ENTITY_TYPE.COMPANY,
      { filter, select: ["ID", "TITLE"], order: { ID: "ASC" } },
      "crm.company.list",
      {
        actionName: "crm_match_list_companies",
        maxPages: getAnalyticsMaxPages(),
        preferLegacy: true,
      }
    );
    companies = loaded.items || [];
    truncated = truncated || Boolean(loaded.truncated);
    pages += loaded.pages || 0;
    if (loaded.truncated) {
      warnings.push({
        code: "MATCH_DIRECTORY_TRUNCATED",
        message: "Список компаний в CRM загружен не полностью (лимит страниц). Часть совпадений могла не найтись.",
      });
    }
    try {
      const requisites = await loadCompanyRequisites(getAnalyticsMaxPages());
      companies = attachRequisites(companies, requisites.items || []);
      truncated = truncated || Boolean(requisites.truncated);
      pages += requisites.pages || 0;
      if (requisites.truncated) {
        warnings.push({
          code: "MATCH_REQUISITES_TRUNCATED",
          message: "Реквизиты (ИНН) загружены не полностью. У части компаний ИНН может быть пустым.",
        });
      }
    } catch (error) {
      console.warn("crm.requisite.list failed:", error.message);
      warnings.push({
        code: "MATCH_REQUISITES_UNAVAILABLE",
        message: "Не удалось загрузить реквизиты компаний. ИНН в таблице может быть пустым.",
      });
    }
  }

  if (matchContacts) {
    const loaded = await crmItemListAll(
      ENTITY_TYPE.CONTACT,
      {
        filter,
        select: ["ID", "NAME", "LAST_NAME", "SECOND_NAME", "COMPANY_ID"],
        order: { ID: "ASC" },
      },
      "crm.contact.list",
      {
        actionName: "crm_match_list_contacts",
        maxPages: getAnalyticsMaxPages(),
        preferLegacy: true,
      }
    );
    contacts = loaded.items || [];
    truncated = truncated || Boolean(loaded.truncated);
    pages += loaded.pages || 0;
    if (loaded.truncated) {
      warnings.push({
        code: "MATCH_DIRECTORY_TRUNCATED",
        message: "Список контактов в CRM загружен не полностью (лимит страниц). Часть совпадений могла не найтись.",
      });
    }
  }

  if (parseMatchItems(params).length > MAX_MATCH_INPUT_ROWS) {
    warnings.push({
      code: "MATCH_INPUT_TRUNCATED",
      message: `Сверены первые ${MAX_MATCH_INPUT_ROWS} строк.`,
    });
  }

  const rows = matchQueriesToDirectory(items, { companies, contacts });
  const summary = {
    total: rows.length,
    found: rows.filter((r) => r.status === "found").length,
    similar: rows.filter((r) => r.status === "similar").length,
    companyOnly: rows.filter((r) => r.status === "company_only").length,
    notFound: rows.filter((r) => r.status === "not_found").length,
  };

  logAnalytics({
    action: "crm_match_list",
    pages,
    items: rows.length,
    durationMs: Date.now() - started,
    truncated,
    companies: companies.length,
    contacts: contacts.length,
    found: summary.found,
  });

  return {
    kind: MATCH_LIST_KIND,
    summary,
    rows,
    directory: {
      companies: companies.length,
      contacts: contacts.length,
      truncated,
    },
    warnings,
  };
}

export const crm_duplicate_search = crm_match_list;
