/**
 * CrmSchemaDiffService — compare schema snapshots.
 */

import * as repo from "../database/repositories/crmSchemaRepository.js";

function fieldKey(f) {
  return `${f.entityType}::${f.fieldCode}`;
}

function stageKey(s) {
  return `${s.entityType}::${s.categoryId || "0"}::${s.stageId}`;
}

function loadSnapshotBundle(snapshotId) {
  const snapshot = repo.getSnapshotById(snapshotId);
  if (!snapshot) throw new Error(`Snapshot not found: ${snapshotId}`);
  const fields = repo.listFields({ snapshotId });
  const fieldsWithEnums = fields.map((f) => ({
    ...f,
    enums: repo.listEnumsForField(f.id),
  }));
  const pipelines = repo.listPipelines({ snapshotId });
  const stages = repo.listStages({ snapshotId });
  return { snapshot, fields: fieldsWithEnums, pipelines, stages };
}

export function detectMissingFields(base, target) {
  const targetKeys = new Set(target.fields.map(fieldKey));
  return base.fields
    .filter((f) => !targetKeys.has(fieldKey(f)))
    .map((f) => ({
      type: "missing_field",
      entityType: f.entityType,
      fieldCode: f.fieldCode,
      fieldName: f.fieldName,
      in: "base_not_in_target",
    }));
}

export function detectExtraFields(base, target) {
  const baseKeys = new Set(base.fields.map(fieldKey));
  return target.fields
    .filter((f) => !baseKeys.has(fieldKey(f)))
    .map((f) => ({
      type: "extra_field",
      entityType: f.entityType,
      fieldCode: f.fieldCode,
      fieldName: f.fieldName,
      in: "target_not_in_base",
    }));
}

export function detectChangedTypes(base, target) {
  const targetMap = new Map(target.fields.map((f) => [fieldKey(f), f]));
  const out = [];
  for (const f of base.fields) {
    const t = targetMap.get(fieldKey(f));
    if (!t) continue;
    if ((f.dataType || "") !== (t.dataType || "") || (f.userTypeId || "") !== (t.userTypeId || "")) {
      out.push({
        type: "changed_type",
        entityType: f.entityType,
        fieldCode: f.fieldCode,
        base: { dataType: f.dataType, userTypeId: f.userTypeId },
        target: { dataType: t.dataType, userTypeId: t.userTypeId },
      });
    }
  }
  return out;
}

export function detectChangedEnums(base, target) {
  const targetMap = new Map(target.fields.map((f) => [fieldKey(f), f]));
  const out = [];
  for (const f of base.fields) {
    const t = targetMap.get(fieldKey(f));
    if (!t) continue;
    const baseEnums = new Map((f.enums || []).map((e) => [String(e.enumId), e]));
    const targetEnums = new Map((t.enums || []).map((e) => [String(e.enumId), e]));
    const missing = [...baseEnums.keys()].filter((id) => !targetEnums.has(id));
    const added = [...targetEnums.keys()].filter((id) => !baseEnums.keys.has?.(id) && !baseEnums.has(id));
    const renamed = [];
    for (const [id, be] of baseEnums) {
      const te = targetEnums.get(id);
      if (te && (be.value || "") !== (te.value || "")) {
        renamed.push({ enumId: id, baseValue: be.value, targetValue: te.value });
      }
    }
    if (missing.length || added.length || renamed.length) {
      out.push({
        type: "changed_enum",
        entityType: f.entityType,
        fieldCode: f.fieldCode,
        missingEnumIds: missing,
        addedEnumIds: added,
        renamed,
      });
    }
  }
  return out;
}

export function detectMissingStages(base, target) {
  const targetKeys = new Set(target.stages.map(stageKey));
  return base.stages
    .filter((s) => !targetKeys.has(stageKey(s)))
    .map((s) => ({
      type: "missing_stage",
      entityType: s.entityType,
      categoryId: s.categoryId,
      stageId: s.stageId,
      stageName: s.stageName,
      canonicalStage: s.canonicalStage,
    }));
}

export function detectChangedStageOrder(base, target) {
  const targetMap = new Map(target.stages.map((s) => [stageKey(s), s]));
  const out = [];
  for (const s of base.stages) {
    const t = targetMap.get(stageKey(s));
    if (!t) continue;
    if (Number(s.sortOrder) !== Number(t.sortOrder)) {
      out.push({
        type: "changed_stage_order",
        entityType: s.entityType,
        categoryId: s.categoryId,
        stageId: s.stageId,
        baseSort: s.sortOrder,
        targetSort: t.sortOrder,
      });
    }
  }
  return out;
}

export function detectUnmappedValues(base, target) {
  const out = [];
  // Enums with same canonical_key but different enum IDs across entities
  const byCanonical = new Map();
  for (const f of [...base.fields, ...target.fields]) {
    if (!f.canonicalKey) continue;
    const list = byCanonical.get(f.canonicalKey) || [];
    list.push(f);
    byCanonical.set(f.canonicalKey, list);
  }
  for (const [canonicalKey, fields] of byCanonical) {
    const enumIdSets = fields.map((f) => ({
      portalKey: f.portalKey,
      entityType: f.entityType,
      fieldCode: f.fieldCode,
      enumIds: (f.enums || []).map((e) => String(e.enumId)).sort(),
    }));
    const unique = new Set(enumIdSets.map((x) => x.enumIds.join(",")));
    if (unique.size > 1) {
      out.push({
        type: "cross_entity_enum_id_divergence",
        canonicalKey,
        detail: enumIdSets,
        note: "Нельзя использовать ID справочника одной сущности для другой",
      });
    }
  }

  // Stages without canonical mapping
  for (const s of target.stages) {
    if (!s.canonicalStage) {
      out.push({
        type: "unmapped_stage",
        entityType: s.entityType,
        stageId: s.stageId,
        stageName: s.stageName,
        verificationStatus: "needs_confirmation",
      });
    }
  }
  return out;
}

export function detectBiCompatibilityProblems(base, target) {
  // base expected = TWIGA BI fields; target = live or SENSU
  const problems = [];
  const biFields = base.fields.filter((f) => f.biUsage);
  const targetMap = new Map(target.fields.map((f) => [fieldKey(f), f]));

  for (const f of biFields) {
    const t = targetMap.get(fieldKey(f));
    if (!t) {
      problems.push({
        type: "bi_missing_field",
        severity: "high",
        entityType: f.entityType,
        fieldCode: f.fieldCode,
        biUsage: f.biUsage,
        message: `BI-поле ${f.fieldCode} отсутствует в целевой схеме`,
      });
      continue;
    }
    if (f.dataType && t.dataType && f.dataType !== t.dataType && f.dataType !== "unknown" && t.dataType !== "unknown") {
      problems.push({
        type: "bi_type_mismatch",
        severity: "medium",
        entityType: f.entityType,
        fieldCode: f.fieldCode,
        baseType: f.dataType,
        targetType: t.dataType,
      });
    }
  }

  // Market/BU canonical fields must not share enum IDs across entities
  for (const key of ["market", "business_unit"]) {
    const related = target.fields.filter((f) => f.canonicalKey === key);
    const idPools = related.map((f) => new Set((f.enums || []).map((e) => String(e.enumId))));
    for (let i = 0; i < idPools.length; i++) {
      for (let j = i + 1; j < idPools.length; j++) {
        const overlap = [...idPools[i]].filter((id) => idPools[j].has(id));
        if (overlap.length) {
          problems.push({
            type: "bi_enum_id_collision",
            severity: "high",
            canonicalKey: key,
            overlapEnumIds: overlap,
            fields: [related[i].fieldCode, related[j].fieldCode],
            message: "Обнаружено пересечение enum ID между сущностями — риск неверной BI-агрегации",
          });
        }
      }
    }
  }

  return problems;
}

export function compareSnapshots(baseSnapshotId, targetSnapshotId) {
  const base = loadSnapshotBundle(baseSnapshotId);
  const target = loadSnapshotBundle(targetSnapshotId);

  const missingFields = detectMissingFields(base, target);
  const extraFields = detectExtraFields(base, target);
  const changedTypes = detectChangedTypes(base, target);
  const changedEnums = detectChangedEnums(base, target);
  const missingStages = detectMissingStages(base, target);
  const changedStageOrder = detectChangedStageOrder(base, target);
  const unmappedValues = detectUnmappedValues(base, target);
  const biCompatibility = detectBiCompatibilityProblems(base, target);

  return {
    base: {
      id: base.snapshot.id,
      portalKey: base.snapshot.portalKey,
      sourceType: base.snapshot.sourceType,
      schemaVersion: base.snapshot.schemaVersion,
      contentHash: base.snapshot.contentHash,
    },
    target: {
      id: target.snapshot.id,
      portalKey: target.snapshot.portalKey,
      sourceType: target.snapshot.sourceType,
      schemaVersion: target.snapshot.schemaVersion,
      contentHash: target.snapshot.contentHash,
    },
    summary: {
      missingFields: missingFields.length,
      extraFields: extraFields.length,
      changedTypes: changedTypes.length,
      changedEnums: changedEnums.length,
      missingStages: missingStages.length,
      changedStageOrder: changedStageOrder.length,
      unmappedValues: unmappedValues.length,
      biCompatibilityProblems: biCompatibility.length,
    },
    missingFields,
    extraFields,
    changedTypes,
    changedEnums,
    missingStages,
    changedStageOrder,
    unmappedValues,
    biCompatibility,
    confidence: "draft_diff",
    notes: [
      "Diff носит информационный характер.",
      "Excel-источники не являются истиной после live capture.",
      "Неоднозначные значения помечены needs_confirmation / draft.",
    ],
  };
}

export const CrmSchemaDiffService = {
  compareSnapshots,
  detectMissingFields,
  detectChangedTypes,
  detectChangedEnums,
  detectMissingStages,
  detectChangedStageOrder,
  detectUnmappedValues,
  detectBiCompatibilityProblems,
};

export default CrmSchemaDiffService;
