/**
 * Registry адаптеров каналов.
 */

import { bitrixImAdapter } from "./adapters/bitrixImAdapter.js";
import { bitrixEmailAdapter } from "./adapters/bitrixEmailAdapter.js";
import { bitrixOpenLinesAdapter } from "./adapters/bitrixOpenLinesAdapter.js";
import { whatsappAdapter, telegramAdapter } from "./adapters/providerAdapter.js";

const ADAPTERS = [
  whatsappAdapter,
  telegramAdapter,
  bitrixOpenLinesAdapter,
  bitrixEmailAdapter,
  bitrixImAdapter,
];

export function listAdapters() {
  return [...ADAPTERS];
}

export function getAdapterByChannel(channel) {
  const c = String(channel || "").toLowerCase();
  return ADAPTERS.find((a) => a.channel === c) || null;
}

export function getAdapterById(id) {
  return ADAPTERS.find((a) => a.id === id) || null;
}
