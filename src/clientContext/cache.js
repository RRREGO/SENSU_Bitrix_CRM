/**
 * Краткий in-memory TTL-кэш CRM-контекста.
 */

import { getClientContextConfig } from "./config.js";

const cache = new Map();

function cacheKey(entityType, entityId, includeKey) {
  return `${entityType}:${entityId}:${includeKey}`;
}

export function getCachedClientContext(entityType, entityId, include = []) {
  const key = cacheKey(entityType, entityId, [...include].sort().join(","));
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

export function setCachedClientContext(entityType, entityId, include, value) {
  const { cacheTtlSeconds } = getClientContextConfig();
  const key = cacheKey(entityType, entityId, [...include].sort().join(","));
  cache.set(key, {
    expiresAt: Date.now() + cacheTtlSeconds * 1000,
    value,
  });
}

export function invalidateClientContextCache(entityType, entityId) {
  const prefix = `${entityType}:${entityId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clearClientContextCache() {
  cache.clear();
}
