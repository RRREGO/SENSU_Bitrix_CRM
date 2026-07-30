import { callBitrixMethod } from "../bitrixClient.js";
import { get_task_by_id, update_task } from "./taskActions.js";

const TRANSLIT_MAP = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

/** Латиница → кириллица. Порядок важен: сначала многобуквенные сочетания. */
const REVERSE_TRANSLIT_PAIRS = [
  ["shch", "щ"], ["sch", "щ"], ["yo", "ё"], ["zh", "ж"], ["kh", "х"],
  ["ts", "ц"], ["ch", "ч"], ["sh", "ш"], ["yu", "ю"], ["ya", "я"],
  ["a", "а"], ["b", "б"], ["v", "в"], ["g", "г"], ["d", "д"], ["e", "е"],
  ["z", "з"], ["i", "и"], ["y", "й"], ["k", "к"], ["l", "л"], ["m", "м"],
  ["n", "н"], ["o", "о"], ["p", "п"], ["r", "р"], ["s", "с"], ["t", "т"],
  ["u", "у"], ["f", "ф"], ["h", "х"], ["c", "ц"], ["j", "ж"], ["w", "в"],
  ["q", "к"], ["x", "кс"],
];

function hasCyrillic(value) {
  return /[а-яё]/i.test(String(value));
}

function hasLatin(value) {
  return /[a-z]/i.test(String(value));
}

function looksLikeEmail(value) {
  return String(value).includes("@");
}

function matchCase(sample, replacement) {
  const isUpper = sample === sample.toUpperCase() && sample !== sample.toLowerCase();
  return isUpper ? replacement.charAt(0).toUpperCase() + replacement.slice(1) : replacement;
}

/** Кириллица → латиница: на портале сотрудники могут быть записаны латиницей. */
function transliterate(value) {
  return String(value)
    .split("")
    .map((char) => {
      const lower = char.toLowerCase();
      const mapped = TRANSLIT_MAP[lower];
      if (mapped === undefined) return char;
      return char === lower ? mapped : matchCase(char, mapped);
    })
    .join("");
}

/** Латиница → кириллица: карточка на портале может быть заполнена по-русски. */
function reverseTransliterate(value) {
  const source = String(value);
  let result = "";
  let index = 0;

  while (index < source.length) {
    const tail = source.slice(index).toLowerCase();
    const pair = REVERSE_TRANSLIT_PAIRS.find(([latin]) => tail.startsWith(latin));
    if (!pair) {
      result += source[index];
      index += 1;
      continue;
    }
    const [latin, cyrillic] = pair;
    result += matchCase(source[index], cyrillic);
    index += latin.length;
  }

  return result;
}

/**
 * Варианты написания для поиска: сам запрос, его транслитерация в обе стороны
 * и локальная часть e-mail (в ней обычно фамилия).
 */
function buildSearchVariants(query) {
  const variants = [];
  const push = (value) => {
    const trimmed = String(value || "").trim();
    if (trimmed && !variants.includes(trimmed)) variants.push(trimmed);
  };

  const raw = String(query).trim();
  push(raw);
  if (looksLikeEmail(raw)) push(raw.split("@")[0].split(/[._\-+]/)[0]);

  for (const base of [...variants]) {
    if (looksLikeEmail(base)) continue;
    if (hasCyrillic(base)) push(transliterate(base));
    else if (hasLatin(base)) push(reverseTransliterate(base));
  }

  return variants;
}

function usersFound(result) {
  if (Array.isArray(result)) return result.length > 0;
  return Boolean(result);
}

/**
 * Поиск пользователей. user.search ищет по точному написанию имени и не знает
 * про e-mail, поэтому при пустом результате пробуем транслитерацию запроса в
 * обе стороны и поиск по подстроке фамилии/имени/e-mail через user.get.
 */
export async function search_users(params = {}) {
  const baseFilter = { ...(params.filter || {}) };
  const query = params.query || baseFilter.FIND || null;

  if (!query) {
    return callBitrixMethod("user.search", baseFilter);
  }

  if (looksLikeEmail(query)) {
    const byEmail = await callBitrixMethod("user.get", { filter: { EMAIL: String(query).trim() } });
    if (usersFound(byEmail)) {
      return { users: byEmail, searchedAs: query, note: `Найдено по e-mail «${query}».` };
    }
  }

  const variants = buildSearchVariants(query);
  const nameVariants = variants.filter((variant) => !looksLikeEmail(variant));

  for (const variant of nameVariants) {
    const result = await callBitrixMethod("user.search", { ...baseFilter, FIND: variant });
    if (usersFound(result)) {
      return variant === String(query).trim()
        ? result
        : { users: result, searchedAs: variant, note: `Найдено по написанию «${variant}».` };
    }
  }

  // user.search не поддерживает поиск по части слова — добираем через user.get
  for (const variant of nameVariants) {
    for (const field of ["%LAST_NAME", "%NAME", "%EMAIL"]) {
      const result = await callBitrixMethod("user.get", { filter: { [field]: variant } });
      if (usersFound(result)) {
        return {
          users: result,
          searchedAs: variant,
          note: `Найдено по частичному совпадению ${field.replace("%", "")}: «${variant}».`,
        };
      }
    }
  }

  return {
    users: [],
    triedVariants: variants,
    note: `Сотрудник по запросу «${query}» не найден. Пробовали написания: ${variants.join(", ")}. Проверьте фамилию или укажите ID пользователя.`,
  };
}

/** Получить пользователя по ID. */
export async function user_get(params = {}) {
  if (!params.id) throw new Error("id is required");
  const result = await callBitrixMethod("user.get", { ID: Number(params.id) });
  return Array.isArray(result) ? result[0] : result;
}

/** Список подразделений. */
export async function department_list(params = {}) {
  const requestParams = {};
  if (params.id !== undefined) requestParams.ID = params.id;
  return callBitrixMethod("department.get", requestParams);
}
