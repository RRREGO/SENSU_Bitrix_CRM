/**
 * CrmProcessKnowledgeService — stage explanations, requirements, mappings.
 * getAllowedOrRecommendedNextStages returns config recommendations only (no transition).
 */

import * as repo from "../database/repositories/crmSchemaRepository.js";

export function getStageDescription(portalKey, entityType, categoryId, stageId) {
  const stages = repo.listStages({
    portalKey,
    entityType,
    stageId: String(stageId),
  });
  let stage =
    stages.find((s) => String(s.categoryId || "0") === String(categoryId ?? "0")) ||
    stages[0] ||
    null;

  if (!stage) {
    return {
      found: false,
      portalKey,
      entityType,
      categoryId,
      stageId,
      message: "Стадия не найдена в локальном реестре схем",
    };
  }

  const ontology = stage.canonicalStage
    ? repo.listStages({
        portalKey: "shared",
        entityType: "ontology",
        canonicalStage: stage.canonicalStage,
      })[0]
    : null;

  return {
    found: true,
    stage,
    ontology: ontology
      ? {
          businessGoal: ontology.businessGoal,
          successTrigger: ontology.successTrigger,
          recommendedAction: ontology.recommendedAction,
          maximumDurationHours: ontology.maximumDurationHours,
          verificationStatus: ontology.verificationStatus,
        }
      : null,
    verificationStatus: stage.verificationStatus,
    source: "local_schema_registry",
  };
}

export function getStageRequirements(portalKey, entityType, categoryId, stageId) {
  const desc = getStageDescription(portalKey, entityType, categoryId, stageId);
  if (!desc.found) return { ...desc, requirements: [] };

  const requirements = repo.listStageRequirements(desc.stage.id);

  // Enrich with globally required fields as needs_confirmation hints (not enforced)
  const snapshotId = desc.stage.snapshotId;
  const globalRequired = repo
    .listFields({ snapshotId, entityType: desc.stage.entityType })
    .filter((f) => f.isRequiredGlobally)
    .map((f) => ({
      fieldCode: f.fieldCode,
      requirementType: "global_required",
      verificationStatus: "needs_confirmation",
      sourceType: "live_or_seed_metadata",
      errorMessage:
        "Глобально обязательное поле из metadata; stage-specific обязательность не подтверждена REST.",
    }));

  return {
    found: true,
    stage: desc.stage,
    requirements,
    globalRequiredHints: globalRequired,
    warning:
      "Stage-specific mandatory fields не извлечены из Bitrix REST — требуют бизнес-подтверждения.",
  };
}

/**
 * Recommendations from process rules / ontology only — does NOT perform transition.
 */
export function getAllowedOrRecommendedNextStages(
  portalKey,
  entityType,
  categoryId,
  stageId
) {
  const desc = getStageDescription(portalKey, entityType, categoryId, stageId);
  if (!desc.found) {
    return {
      found: false,
      recommended: [],
      note: "Стадия не найдена; переходы не выполняются на этом этапе.",
    };
  }

  const canonical = desc.stage.canonicalStage;
  const rules = canonical
    ? repo.listProcessRules({
        canonicalStage: canonical,
        ruleType: "recommended_next_stages",
      })
    : [];

  const recommendedCanonical = [];
  for (const rule of rules) {
    const next = rule.ruleJson?.next || [];
    for (const c of next) recommendedCanonical.push(c);
  }

  const recommended = recommendedCanonical.map((c) => {
    const local = repo.listStages({ portalKey, entityType, canonicalStage: c });
    const match =
      local.find((s) => String(s.categoryId || "0") === String(categoryId ?? "0")) ||
      local[0];
    return {
      canonicalStage: c,
      stageId: match?.stageId || null,
      stageName: match?.stageName || null,
      verificationStatus: "draft",
      source: "sales_process_ontology",
    };
  });

  return {
    found: true,
    current: desc.stage,
    recommended,
    performsTransition: false,
    note: "Только рекомендации из конфигурации. Переход стадий не выполняется.",
  };
}

export function explainStage(portalKey, entityType, categoryId, stageId) {
  const desc = getStageDescription(portalKey, entityType, categoryId, stageId);
  const reqs = getStageRequirements(portalKey, entityType, categoryId, stageId);
  const next = getAllowedOrRecommendedNextStages(
    portalKey,
    entityType,
    categoryId,
    stageId
  );

  const mappings = desc.stage?.canonicalStage
    ? repo.listStageMappings({ canonicalStage: desc.stage.canonicalStage })
    : [];

  return {
    explanation: {
      portalKey,
      entityType,
      categoryId: categoryId ?? "0",
      stageId,
      found: desc.found,
      stageName: desc.stage?.stageName,
      canonicalStage: desc.stage?.canonicalStage,
      businessGoal: desc.ontology?.businessGoal || desc.stage?.businessGoal,
      successTrigger: desc.ontology?.successTrigger || desc.stage?.successTrigger,
      recommendedAction:
        desc.ontology?.recommendedAction || desc.stage?.recommendedAction,
      maximumDurationHours:
        desc.ontology?.maximumDurationHours || desc.stage?.maximumDurationHours,
      verificationStatus: desc.verificationStatus,
      confidenceLabels: {
        liveBitrix: desc.stage?.verificationStatus === "verified_from_live_bitrix",
        fromExcel: String(desc.verificationStatus || "").includes("excel") ||
          desc.verificationStatus === "imported_from_excel",
        inferred: desc.ontology?.verificationStatus === "inferred",
        requiresBusinessConfirmation:
          desc.verificationStatus === "needs_confirmation" ||
          desc.verificationStatus === "draft",
      },
    },
    requirements: reqs.requirements,
    globalRequiredHints: reqs.globalRequiredHints,
    recommendedNextStages: next.recommended,
    mappings,
    warning: reqs.warning,
    performsTransition: false,
  };
}

export function mapStageBetweenPortals({
  sourcePortal,
  sourceStageId,
  targetPortal,
  canonicalStage,
} = {}) {
  let mapping = null;
  if (sourcePortal && sourceStageId && targetPortal) {
    mapping = repo.findStageMapping({
      sourcePortal,
      sourceStageId,
      targetPortal,
    });
  }
  if (!mapping && canonicalStage) {
    mapping = repo.findStageMapping({
      sourcePortal,
      targetPortal,
      canonicalStage,
    });
  }

  if (!mapping) {
    return {
      found: false,
      mappingType: "unmapped",
      confidence: 0,
      verificationStatus: "draft",
      comment: "Mapping не найден в черновике",
    };
  }

  return {
    found: true,
    ...mapping,
    note: "Mapping носит статус draft и не утверждён бизнесом.",
  };
}

export function mapEnumValueBetweenPortals({
  canonicalKey,
  canonicalValue,
  sourcePortal,
  sourceEntityType,
  sourceEnumId,
  targetPortal,
  targetEntityType,
} = {}) {
  // Resolve via canonical_value — never reuse enum IDs across entities
  let sourceEnums = [];
  let targetEnums = [];

  if (canonicalKey) {
    sourceEnums = repo.listEnumsByCanonical({
      portalKey: sourcePortal,
      entityType: sourceEntityType,
      canonicalKey,
    });
    targetEnums = repo.listEnumsByCanonical({
      portalKey: targetPortal,
      entityType: targetEntityType,
      canonicalKey,
    });
  }

  let resolvedCanonical = canonicalValue;
  if (!resolvedCanonical && sourceEnumId) {
    const hit = sourceEnums.find((e) => String(e.enumId) === String(sourceEnumId));
    resolvedCanonical = hit?.canonicalValue || null;
  }

  if (!resolvedCanonical) {
    return {
      found: false,
      reason: "canonical_value_unknown",
      warning: "Нельзя маппить по сырому enum ID между сущностями/порталами",
      verificationStatus: "needs_confirmation",
    };
  }

  const target = targetEnums.find(
    (e) => e.canonicalValue === resolvedCanonical
  );

  return {
    found: Boolean(target),
    canonicalKey,
    canonicalValue: resolvedCanonical,
    source: {
      portal: sourcePortal,
      entityType: sourceEntityType,
      enumId: sourceEnumId || sourceEnums.find((e) => e.canonicalValue === resolvedCanonical)?.enumId,
    },
    target: target
      ? {
          portal: targetPortal,
          entityType: targetEntityType,
          enumId: target.enumId,
          value: target.value,
          fieldCode: target.field?.fieldCode,
        }
      : null,
    verificationStatus: "draft",
    note: "Сопоставление только через canonical_value; ID справочников entity-scoped.",
  };
}

export const CrmProcessKnowledgeService = {
  getStageDescription,
  getStageRequirements,
  getAllowedOrRecommendedNextStages,
  explainStage,
  mapStageBetweenPortals,
  mapEnumValueBetweenPortals,
};

export default CrmProcessKnowledgeService;
