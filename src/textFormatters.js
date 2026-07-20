import Typograf from "typograf";

const typograf = new Typograf({ locale: ["ru", "en-US"] });
typograf.enableRule("common/nbsp/afterShortWord");
typograf.enableRule("ru/nbsp/abbr");
typograf.enableRule("ru/nbsp/afterNumberSign");
typograf.enableRule("ru/money/ruble");
typograf.enableRule("ru/date/fromISO");

const EMOJI_REGEX =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu;

const DECORATIVE_REGEX = /[\u2500-\u257F\u2580-\u259F\u25A0-\u25FF\u2600-\u26FF\u2700-\u27BF]/gu;

/**
 * Удаляет emoji и декоративные символы.
 */
export function removeEmoji(text) {
  if (text == null) return "";
  return String(text)
    .replace(EMOJI_REGEX, "")
    .replace(DECORATIVE_REGEX, "");
}

/**
 * Нормализует пробелы и переносы строк.
 */
export function normalizeSpaces(text) {
  if (text == null) return "";

  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .trim();
}

/**
 * Применяет правила русской типографики.
 */
export function applyTypograf(text) {
  if (text == null) return "";
  const normalized = normalizeSpaces(removeEmoji(text));
  if (!normalized) return "";
  return typograf.execute(normalized);
}

/**
 * Полный конвейер для делового текста.
 */
export function formatBusinessText(text) {
  return applyTypograf(normalizeSpaces(removeEmoji(text)));
}

/**
 * Типографика для HTML: обрабатывает текстовые фрагменты между тегами.
 */
export function formatBusinessHtml(html) {
  if (html == null) return "";
  return String(html).replace(/>([^<]+)</g, (match, chunk) => {
    if (!chunk.trim()) return match;
    return `>${formatBusinessText(chunk)}<`;
  });
}

/** @deprecated используйте formatBusinessText */
export function processText(text) {
  return formatBusinessText(text);
}

/** @deprecated используйте normalizeSpaces */
export function normalizeText(text) {
  return normalizeSpaces(text);
}
