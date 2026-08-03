/**
 * Provider registry.
 * Wazzup is primary. MaxBotProvider is disabled-by-default fallback for official MAX Bot API only.
 * If transport max/maxbot appears in Wazzup /v3/channels — use WazzupProvider (no fake MAX).
 */

import { CommunicationError } from "../config.js";
import { createWazzupProvider } from "./wazzupProvider.js";
import { createMaxBotProvider } from "./maxBotProvider.js";
import { createSmtpProvider } from "./smtpProvider.js";

const cache = new Map();

export function getProvider(name, options = {}) {
  const key = String(name || "").toLowerCase();
  if (!options.fresh && cache.has(key)) return cache.get(key);

  let provider;
  if (key === "wazzup") {
    provider = createWazzupProvider(options);
  } else if (key === "max_bot" || key === "maxbot") {
    provider = createMaxBotProvider(options);
  } else if (key === "smtp" || key === "email") {
    provider = createSmtpProvider(options);
  } else {
    throw new CommunicationError("UNKNOWN_PROVIDER", `Неизвестный провайдер: ${name}`);
  }

  if (!options.fresh) cache.set(key, provider);
  return provider;
}

export function getDefaultProvider() {
  return getProvider("wazzup");
}

export function clearProviderCache() {
  cache.clear();
}

export { createWazzupProvider, createMaxBotProvider, createSmtpProvider };
