/**
 * CrmSchemaSnapshotService — seed import + live capture + versioning.
 */

import crypto from "crypto";
import { getDatabase } from "../database/index.js";
import * as repo from "../database/repositories/crmSchemaRepository.js";
import { redactObject } from "../safety/redact.js";
import {
  SOURCE_TYPES,
  SEED_FILES,
  loadJsonConfig,
  stableStringify,
} from "./configLoader.js";
import { captureLiveBitrixSchema } from "./bitrixSchemaCapture.js";

export function calculateSchemaHash(snapshotPayload) {
  const normalized = {
    portalKey: snapshotPayload.portalKey,
    sourceType: snapshotPayload.sourceType,
    fields: (snapshotPayload.fields || []).map((f) => ({
      entityType: f.entityType,
      fieldCode: f.fieldCode,
      dataType: f.dataType,
      userTypeId: f.userTypeId,
      isMultiple: Boolean(f.isMultiple),
      isRequiredGlobally: Boolean(f.isRequiredGlobally),
      enums: (f.enums || []).map((e) => ({
        enumId: e.enumId,
        value: e.value,
        canonicalValue: e.canonicalValue,
      })),
    })),
    pipelines: (snapshotPayload.pipelines || []).map((p) => ({
      entityType: p.entityType,
      categoryId: p.categoryId,
      stages: (p.stages || []).map((s) => ({
        stageId: s.stageId,
        stageName: s.stageName,
        sortOrder: s.sortOrder,
        canonicalStage: s.canonicalStage,
      })),
    })),
  };
  return crypto.createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

export function getLatestSnapshot(portalKey, options) {
  return repo.getLatestSnapshot(portalKey, options);
}

export function saveSnapshot(snapshotPayload, { status = "draft", forceNew = false } = {}) {
  const contentHash = snapshotPayload.contentHash || calculateSchemaHash(snapshotPayload);
  if (!forceNew) {
    const existing = repo.findExistingSeedSnapshot(
      snapshotPayload.portalKey,
      snapshotPayload.sourceType,
      contentHash
    );
    if (existing) {
      return {
        snapshot: repo.getSnapshotById(existing.id),
        created: false,
        contentHash,
      };
    }
  }

  const schemaVersion =
    snapshotPayload.schemaVersion ||
    `${snapshotPayload.sourceType}-${new Date().toISOString().slice(0, 10)}`;

  const db = getDatabase();
  const run = db.transaction(() => {
    const snapshot = repo.insertSnapshot({
      portalKey: snapshotPayload.portalKey,
      sourceType: snapshotPayload.sourceType,
      schemaVersion,
      contentHash,
      status,
      metadata: redactObject(snapshotPayload.meta || snapshotPayload.metadata || {}),
    });

    const fieldIdByKey = new Map();

    for (const field of snapshotPayload.fields || []) {
      const fieldId = repo.insertFieldDefinition({
        snapshotId: snapshot.id,
        portalKey: snapshotPayload.portalKey,
        entityType: field.entityType,
        fieldCode: field.fieldCode,
        fieldName: field.fieldName,
        canonicalKey: field.canonicalKey,
        dataType: field.dataType,
        userTypeId: field.userTypeId,
        isMultiple: field.isMultiple,
        isRequiredGlobally: field.isRequiredGlobally,
        isReadOnly: field.isReadOnly,
        biUsage: field.biUsage,
        verificationStatus: field.verificationStatus || "draft",
        sourceComment: field.sourceComment,
      });
      fieldIdByKey.set(`${field.entityType}:${field.fieldCode}`, fieldId);

      for (const ev of field.enums || []) {
        repo.insertEnumValue({
          fieldDefinitionId: fieldId,
          enumId: ev.enumId,
          xmlId: ev.xmlId,
          value: ev.value,
          sort: ev.sort,
          canonicalValue: ev.canonicalValue,
          isActive: ev.isActive,
        });
      }
    }

    for (const pipeline of snapshotPayload.pipelines || []) {
      const pipelineId = repo.insertPipeline({
        snapshotId: snapshot.id,
        portalKey: snapshotPayload.portalKey,
        entityType: pipeline.entityType,
        categoryId: pipeline.categoryId,
        categoryName: pipeline.categoryName,
        canonicalPipeline: pipeline.canonicalPipeline,
        isDefault: pipeline.isDefault,
      });

      for (const stage of pipeline.stages || []) {
        const stageId = repo.insertStage({
          pipelineId,
          stageId: stage.stageId,
          stageName: stage.stageName,
          canonicalStage: stage.canonicalStage,
          stageGroup: stage.stageGroup,
          sortOrder: stage.sortOrder,
          semantic: stage.semantic,
          probability: stage.probability,
          isFinal: stage.isFinal,
          isSuccess: stage.isSuccess,
          isFailure: stage.isFailure,
          isOptional: stage.isOptional,
          businessGoal: stage.businessGoal,
          successTrigger: stage.successTrigger,
          recommendedAction: stage.recommendedAction,
          maximumDurationHours: stage.maximumDurationHours,
          verificationStatus: stage.verificationStatus || "draft",
        });

        // Global required fields as needs_confirmation stage requirements (not guessed)
        if (Array.isArray(stage.requirements)) {
          for (const req of stage.requirements) {
            repo.insertStageRequirement({
              stageDefinitionId: stageId,
              fieldCode: req.fieldCode,
              requirementType: req.requirementType || "mandatory",
              validationRule: req.validationRule,
              errorMessage: req.errorMessage,
              sourceType: req.sourceType || snapshotPayload.sourceType,
              verificationStatus: req.verificationStatus || "needs_confirmation",
            });
          }
        }
      }
    }

    return snapshot;
  });

  const snapshot = run();
  return { snapshot, created: true, contentHash, fieldIdByKey: undefined };
}

/**
 * Build payload from seed JSON files for a source type.
 */
export function loadSeedSchema(sourceType) {
  if (sourceType === SOURCE_TYPES.EXCEL_TWIGA) {
    const fieldsCfg = loadJsonConfig(SEED_FILES.twigaFields);
    const enumsCfg = loadJsonConfig(SEED_FILES.twigaEnums);
    const stagesCfg = loadJsonConfig(SEED_FILES.twigaStages);

    const enumsByField = new Map();
    for (const block of enumsCfg.enums || []) {
      const key = `${block.entity_type}:${block.field_code}`;
      enumsByField.set(key, block.values || []);
    }

    const fields = (fieldsCfg.fields || []).map((f) => {
      const key = `${f.entity_type}:${f.field_code}`;
      const enumValues = enumsByField.get(key) || [];
      return {
        entityType: f.entity_type,
        fieldCode: f.field_code,
        fieldName: f.field_name,
        canonicalKey: f.canonical_key,
        dataType: f.data_type,
        userTypeId: f.user_type_id,
        isMultiple: Boolean(f.is_multiple),
        isRequiredGlobally: Boolean(f.is_required_globally),
        isReadOnly: Boolean(f.is_read_only),
        biUsage: f.bi_usage,
        verificationStatus: f.verification_status || "imported_from_excel",
        sourceComment: f.source_comment,
        enums: enumValues.map((ev) => ({
          enumId: String(ev.enum_id),
          xmlId: ev.xml_id,
          value: ev.value,
          sort: ev.sort,
          canonicalValue: ev.canonical_value,
          isActive: ev.is_active !== false,
        })),
      };
    });

    const pipelines = (stagesCfg.pipelines || []).map((p) => ({
      entityType: p.entity_type,
      categoryId: String(p.category_id ?? "0"),
      categoryName: p.category_name,
      canonicalPipeline: p.canonical_pipeline,
      isDefault: Boolean(p.is_default),
      stages: (p.stages || []).map((s) => ({
        stageId: s.stage_id,
        stageName: s.stage_name,
        canonicalStage: s.canonical_stage,
        stageGroup: s.stage_group,
        sortOrder: s.sort_order,
        semantic: s.semantic,
        probability: s.probability,
        isFinal: Boolean(s.is_final),
        isSuccess: Boolean(s.is_success),
        isFailure: Boolean(s.is_failure),
        isOptional: Boolean(s.is_optional),
        verificationStatus: s.verification_status || "imported_from_excel",
      })),
    }));

    return {
      portalKey: fieldsCfg.portal_key || "twiga",
      sourceType: SOURCE_TYPES.EXCEL_TWIGA,
      schemaVersion: fieldsCfg.schema_version || "twiga-bi-v1",
      fields,
      pipelines,
      meta: {
        sourceNote: fieldsCfg.source_note,
        verificationStatus: "imported_from_excel",
      },
    };
  }

  if (sourceType === SOURCE_TYPES.EXCEL_SENSU) {
    const fieldsCfg = loadJsonConfig(SEED_FILES.sensuFields);
    const stagesCfg = loadJsonConfig(SEED_FILES.sensuStages);
    const fields = (fieldsCfg.fields || []).map((f) => ({
      entityType: f.entity_type,
      fieldCode: f.field_code,
      fieldName: f.field_name,
      canonicalKey: f.canonical_key,
      dataType: f.data_type,
      userTypeId: f.user_type_id,
      isMultiple: Boolean(f.is_multiple),
      isRequiredGlobally: Boolean(f.is_required_globally),
      isReadOnly: Boolean(f.is_read_only),
      biUsage: f.bi_usage,
      verificationStatus: f.verification_status || "imported_from_excel",
      sourceComment: f.source_comment,
      enums: [],
    }));
    const pipelines = (stagesCfg.pipelines || []).map((p) => ({
      entityType: p.entity_type,
      categoryId: String(p.category_id ?? "0"),
      categoryName: p.category_name,
      canonicalPipeline: p.canonical_pipeline,
      isDefault: Boolean(p.is_default),
      stages: (p.stages || []).map((s) => ({
        stageId: s.stage_id,
        stageName: s.stage_name,
        canonicalStage: s.canonical_stage,
        stageGroup: s.stage_group,
        sortOrder: s.sort_order,
        semantic: s.semantic,
        isFinal: Boolean(s.is_final),
        isSuccess: Boolean(s.is_success),
        isFailure: Boolean(s.is_failure),
        isOptional: Boolean(s.is_optional),
        verificationStatus: s.verification_status || "imported_from_excel",
      })),
    }));
    return {
      portalKey: fieldsCfg.portal_key || "sensu",
      sourceType: SOURCE_TYPES.EXCEL_SENSU,
      schemaVersion: fieldsCfg.schema_version || "sensu-draft-v1",
      fields,
      pipelines,
      meta: {
        sourceNote: fieldsCfg.source_note,
        verificationStatus: "imported_from_excel",
      },
    };
  }

  if (sourceType === SOURCE_TYPES.SALES_PROCESS) {
    const ontology = loadJsonConfig(SEED_FILES.salesProcess);
    // Ontology is process knowledge, stored as a lightweight snapshot + process rules
    const fields = [];
    const pipelines = [
      {
        entityType: "ontology",
        categoryId: "0",
        categoryName: "Sales process ontology",
        canonicalPipeline: "sales.process",
        isDefault: true,
        stages: (ontology.stages || []).map((s, idx) => ({
          stageId: s.canonical_stage,
          stageName: s.canonical_stage,
          canonicalStage: s.canonical_stage,
          sortOrder: (idx + 1) * 10,
          businessGoal: s.business_goal,
          successTrigger: s.success_trigger,
          recommendedAction: s.recommended_action,
          maximumDurationHours: s.maximum_duration_hours,
          isFinal: Boolean(s.is_final),
          isSuccess: Boolean(s.is_success),
          isFailure: Boolean(s.is_failure),
          isOptional: Boolean(s.is_optional),
          verificationStatus: s.verification_status || "inferred",
        })),
      },
    ];
    return {
      portalKey: "shared",
      sourceType: SOURCE_TYPES.SALES_PROCESS,
      schemaVersion: ontology.schema_version || "sales-process-v1",
      fields,
      pipelines,
      ontology,
      meta: {
        sourceNote: ontology.source_note,
        verificationStatus: "inferred",
      },
    };
  }

  throw new Error(`Unsupported seed sourceType: ${sourceType}`);
}

/**
 * Import all seed configs idempotently. Also loads stage mappings + process rules.
 */
export function importAllSeedConfigs({ forceNew = false } = {}) {
  const results = [];

  for (const sourceType of [
    SOURCE_TYPES.EXCEL_TWIGA,
    SOURCE_TYPES.EXCEL_SENSU,
    SOURCE_TYPES.SALES_PROCESS,
  ]) {
    const payload = loadSeedSchema(sourceType);
    const saved = saveSnapshot(payload, {
      status: "draft",
      forceNew,
    });
    results.push({
      sourceType,
      portalKey: payload.portalKey,
      created: saved.created,
      snapshotId: saved.snapshot.id,
      contentHash: saved.contentHash,
    });

    if (sourceType === SOURCE_TYPES.SALES_PROCESS && saved.created) {
      const ontology = payload.ontology;
      for (const rule of ontology.process_rules || []) {
        repo.insertProcessRule({
          canonicalStage: rule.canonical_stage,
          ruleType: rule.rule_type,
          ruleJson: rule.rule_json,
          sourceType: SOURCE_TYPES.SALES_PROCESS,
          verificationStatus: rule.verification_status || "draft",
          version: rule.version || "1",
        });
      }
      for (const tr of ontology.recommended_transitions || []) {
        repo.insertProcessRule({
          canonicalStage: tr.from,
          ruleType: "recommended_next_stages",
          ruleJson: { next: tr.to },
          sourceType: SOURCE_TYPES.SALES_PROCESS,
          verificationStatus: tr.verification_status || "draft",
          version: "1",
        });
      }
    }
  }

  const mappingResult = importStageMappingsDraft({ forceNew });
  results.push(mappingResult);
  return results;
}

export function importStageMappingsDraft({ forceNew = false } = {}) {
  const cfg = loadJsonConfig(SEED_FILES.stageMapping);
  const existingCount = repo.countStageMappings();
  if (existingCount > 0 && !forceNew) {
    return {
      sourceType: "stage_mapping",
      created: false,
      mappingCount: existingCount,
      note: "mappings already present (idempotent skip)",
    };
  }

  let inserted = 0;
  for (const m of cfg.mappings || []) {
    // Skip exact duplicates
    const found = repo.findStageMapping({
      sourcePortal: m.source_portal,
      sourceStageId: m.source_stage_id,
      targetPortal: m.target_portal,
    });
    if (found && !forceNew) continue;
    repo.insertStageMapping({
      canonicalStage: m.canonical_stage,
      sourcePortal: m.source_portal,
      sourceStageId: m.source_stage_id,
      targetPortal: m.target_portal,
      targetStageId: m.target_stage_id,
      mappingType: m.mapping_type,
      confidence: m.confidence,
      comment: m.comment,
      verificationStatus: "draft",
    });
    inserted += 1;
  }
  return {
    sourceType: "stage_mapping",
    created: inserted > 0,
    mappingCount: inserted,
  };
}

/**
 * Capture live portal schema (read-only Bitrix) and persist snapshot.
 * @param {string} [portalKey]
 * @param {{ bitrixApi?: object }} [options]
 */
export async function capturePortalSchema(portalKey = "sensu", options = {}) {
  const live = await captureLiveBitrixSchema({
    portalKey,
    bitrixApi: options.bitrixApi,
  });
  const payload = {
    portalKey: live.portalKey,
    sourceType: SOURCE_TYPES.LIVE_BITRIX,
    schemaVersion: `live-${new Date().toISOString()}`,
    fields: live.fields,
    pipelines: live.pipelines,
    meta: {
      ...live.meta,
      warnings: live.warnings,
      verificationStatus: "verified_from_live_bitrix",
    },
  };
  // Live captures always create a new versioned snapshot (even if hash matches)
  const saved = saveSnapshot(payload, { status: "draft", forceNew: true });
  return {
    ...saved,
    warnings: live.warnings,
    meta: payload.meta,
  };
}

export const CrmSchemaSnapshotService = {
  capturePortalSchema,
  loadSeedSchema,
  calculateSchemaHash,
  saveSnapshot,
  getLatestSnapshot,
  importAllSeedConfigs,
  importStageMappingsDraft,
};

export default CrmSchemaSnapshotService;
