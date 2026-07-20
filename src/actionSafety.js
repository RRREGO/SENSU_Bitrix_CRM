/**
 * Категории безопасности Bitrix24 actions.
 * Источник истины — явные политики в src/safety/policies.js
 */

import {
  getActionPolicy,
  hasActionPolicy,
  isReadPolicy,
  isBlockedPolicy,
  ACTION_POLICIES,
} from "./safety/policies.js";

export { getActionPolicy, hasActionPolicy, ACTION_POLICIES };

/** @deprecated используйте getActionPolicy — оставлено для совместимости списков */
export const readOnlyActions = new Set(
  Object.entries(ACTION_POLICIES)
    .filter(([, p]) => p.access === "read" && !p.blocked)
    .map(([name]) => name)
);

export const writeActionsRequireConfirmation = new Set(
  Object.entries(ACTION_POLICIES)
    .filter(
      ([, p]) =>
        !p.blocked &&
        p.requiresConfirmation &&
        (p.access === "write" || p.access === "destructive")
    )
    .map(([name]) => name)
);

export const dangerousActionsAlwaysConfirm = new Set(
  Object.entries(ACTION_POLICIES)
    .filter(([, p]) => p.access === "destructive" || p.access === "structural")
    .map(([name]) => name)
);

/**
 * @returns {"read_only"|"write"|"dangerous"|"blocked"|"unknown"}
 */
export function getActionSafetyCategory(action) {
  const policy = getActionPolicy(action);
  if (!policy) return "unknown";
  if (policy.blocked) return "blocked";
  if (policy.access === "read") return "read_only";
  if (policy.access === "destructive" || policy.access === "structural") return "dangerous";
  if (policy.access === "write") return "write";
  return "unknown";
}

export function requiresConfirmation(action) {
  const policy = getActionPolicy(action);
  if (!policy || policy.blocked) return true;
  return Boolean(policy.requiresConfirmation);
}

export function isDangerousAction(action) {
  const policy = getActionPolicy(action);
  return Boolean(
    policy &&
      (policy.access === "destructive" ||
        policy.access === "structural" ||
        policy.risk === "critical")
  );
}

export function isActionBlocked(action) {
  const policy = getActionPolicy(action);
  return !policy || isBlockedPolicy(policy);
}

export function isReadOnlyAction(action) {
  const policy = getActionPolicy(action);
  return Boolean(policy && isReadPolicy(policy));
}
