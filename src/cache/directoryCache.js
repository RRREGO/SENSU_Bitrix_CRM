/**
 * Кэш пользователей и компаний для аналитики (без N+1).
 */

import { callBitrixMethod, callBitrixMethodFull } from "../bitrixClient.js";
import { normalizeListResult } from "../actions/helpers.js";

const userCache = new Map();
const companyCache = new Map();

function userDisplayName(user) {
  if (!user) return null;
  const parts = [user.NAME || user.name, user.LAST_NAME || user.lastName].filter(Boolean);
  if (parts.length) return parts.join(" ").trim();
  return user.LOGIN || user.EMAIL || user.email || null;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Пакетно подтянуть пользователей по ID.
 * @returns {Map<string, { id: number, name: string|null }>}
 */
export async function resolveUsersByIds(ids = []) {
  const unique = [
    ...new Set(ids.map((id) => String(id)).filter((id) => id && id !== "0" && id !== "null")),
  ];
  const missing = unique.filter((id) => !userCache.has(id));

  for (const batch of chunk(missing, 50)) {
    try {
      const result = await callBitrixMethod("user.get", {
        FILTER: { "@ID": batch.map(Number) },
      });
      const list = Array.isArray(result) ? result : [];
      for (const user of list) {
        const id = String(user.ID || user.id);
        userCache.set(id, {
          id: Number(id),
          name: userDisplayName(user),
        });
      }
      for (const id of batch) {
        if (!userCache.has(String(id))) {
          userCache.set(String(id), { id: Number(id), name: null });
        }
      }
    } catch (error) {
      console.warn("resolveUsersByIds:", error.message);
      for (const id of batch) {
        if (!userCache.has(String(id))) {
          userCache.set(String(id), { id: Number(id), name: null });
        }
      }
    }
  }

  const map = new Map();
  for (const id of unique) {
    map.set(id, userCache.get(id) || { id: Number(id), name: null });
  }
  return map;
}

/**
 * Пакетно подтянуть названия компаний.
 */
export async function resolveCompaniesByIds(ids = []) {
  const unique = [
    ...new Set(ids.map((id) => String(id)).filter((id) => id && id !== "0" && id !== "null")),
  ];
  const missing = unique.filter((id) => !companyCache.has(id));

  for (const batch of chunk(missing, 50)) {
    try {
      const { result, next, total } = await callBitrixMethodFull("crm.company.list", {
        filter: { "@ID": batch.map(Number) },
        select: ["ID", "TITLE"],
        start: 0,
      });
      const page = normalizeListResult(result, { next, total });
      for (const item of page.items) {
        const id = String(item.ID || item.id);
        companyCache.set(id, {
          id: Number(id),
          name: item.TITLE || item.title || null,
        });
      }
    } catch (error) {
      console.warn("resolveCompaniesByIds:", error.message);
    }

    for (const id of batch) {
      if (!companyCache.has(String(id))) {
        companyCache.set(String(id), { id: Number(id), name: null });
      }
    }
  }

  const map = new Map();
  for (const id of unique) {
    map.set(id, companyCache.get(id) || { id: Number(id), name: null });
  }
  return map;
}

/** Сброс кэша (для тестов). */
export function clearDirectoryCaches() {
  userCache.clear();
  companyCache.clear();
}

export function getDirectoryCacheStats() {
  return {
    usersCached: userCache.size,
    companiesCached: companyCache.size,
  };
}
