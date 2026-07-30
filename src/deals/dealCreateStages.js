import { getDealStageEntityId } from "../actions/helpers.js";

export function normalizeStageList(stages) {
  if (Array.isArray(stages)) return stages;
  if (Array.isArray(stages?.stages)) return stages.stages;
  if (Array.isArray(stages?.result)) return stages.result;
  return [];
}

export function isFinalDealStage(stage) {
  const semantics = stage?.SEMANTICS ?? stage?.semantics ?? stage?.EXTRA?.SEMANTICS;
  if (semantics === "S" || semantics === "F") return true;
  const id = String(stage?.STATUS_ID ?? stage?.statusId ?? "");
  if (!id) return false;
  if (id === "WON" || id === "LOSE") return true;
  if (id.endsWith(":WON") || id.endsWith(":LOSE")) return true;
  return false;
}

/**
 * Начальная стадия: явная → первая активная по SORT (не финальная).
 * @returns {string}
 */
export function pickInitialDealStage(stages, { preferredStageId = null } = {}) {
  const list = normalizeStageList(stages).filter((s) => !isFinalDealStage(s));
  if (!list.length) {
    throw new Error("Для выбранной воронки нет доступных активных стадий.");
  }

  if (hasPreferredStageId(preferredStageId)) {
    const hit = list.find(
      (s) => String(s.STATUS_ID ?? s.statusId) === String(preferredStageId).trim()
    );
    if (hit) return String(hit.STATUS_ID ?? hit.statusId);
  }

  const sorted = [...list].sort(
    (a, b) => Number(a.SORT ?? a.sort ?? 0) - Number(b.SORT ?? b.sort ?? 0)
  );
  const first = sorted[0];
  return String(first.STATUS_ID ?? first.statusId);
}

function hasPreferredStageId(preferredStageId) {
  return preferredStageId != null && String(preferredStageId).trim() !== "";
}

export function stageEntityIdForCategory(categoryId) {
  return getDealStageEntityId(categoryId ?? 0);
}
