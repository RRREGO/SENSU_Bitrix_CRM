const SETTINGS_KEY = "bitrixAppSettings";

const DEFAULTS = {
  documentStyle: "strict",
  documentFormat: "html",
  language: "ru",
  emojiDisabled: true,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  const merged = { ...loadSettings(), ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

export function getDocumentStyle() {
  return loadSettings().documentStyle || "strict";
}

export function getDocumentFormat() {
  return loadSettings().documentFormat || "html";
}
