/**
 * Persistence for CRM schema registry (snapshots, fields, stages, mappings).
 */

import crypto from "crypto";
import { getDatabase } from "../index.js";
import { redactObject } from "../../safety/redact.js";

function now() {
  return new Date().toISOString();
}

function boolInt(v) {
  return v ? 1 : 0;
}

function parseJson(raw, fallback = null) {
  if (raw == null || raw === "") return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function insertSnapshot({
  id = crypto.randomUUID(),
  portalKey,
  sourceType,
  schemaVersion,
  capturedAt = now(),
  contentHash,
  status = "draft",
  metadata = {},
} = {}) {
  const safeMeta = redactObject(metadata || {});
  getDatabase()
    .prepare(
      `INSERT INTO crm_schema_snapshots
       (id, portal_key, source_type, schema_version, captured_at, content_hash, status, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      portalKey,
      sourceType,
      schemaVersion,
      capturedAt,
      contentHash,
      status,
      JSON.stringify(safeMeta),
      now()
    );
  return getSnapshotById(id);
}

export function getSnapshotById(id) {
  const row = getDatabase()
    .prepare("SELECT * FROM crm_schema_snapshots WHERE id = ?")
    .get(id);
  if (!row) return null;
  return mapSnapshot(row);
}

export function listSnapshots({ portalKey, sourceType, status, limit = 100 } = {}) {
  const clauses = [];
  const params = [];
  if (portalKey) {
    clauses.push("portal_key = ?");
    params.push(portalKey);
  }
  if (sourceType) {
    clauses.push("source_type = ?");
    params.push(sourceType);
  }
  if (status) {
    clauses.push("status = ?");
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = getDatabase()
    .prepare(
      `SELECT * FROM crm_schema_snapshots ${where}
       ORDER BY captured_at DESC LIMIT ?`
    )
    .all(...params, Math.min(Number(limit) || 100, 500));
  return rows.map(mapSnapshot);
}

export function getLatestSnapshot(portalKey, { sourceType } = {}) {
  if (sourceType) {
    const row = getDatabase()
      .prepare(
        `SELECT * FROM crm_schema_snapshots
         WHERE portal_key = ? AND source_type = ?
         ORDER BY captured_at DESC LIMIT 1`
      )
      .get(portalKey, sourceType);
    return row ? mapSnapshot(row) : null;
  }
  const row = getDatabase()
    .prepare(
      `SELECT * FROM crm_schema_snapshots
       WHERE portal_key = ?
       ORDER BY captured_at DESC LIMIT 1`
    )
    .get(portalKey);
  return row ? mapSnapshot(row) : null;
}

export function listPortalKeys() {
  return getDatabase()
    .prepare(
      `SELECT portal_key AS portalKey,
              COUNT(*) AS snapshotCount,
              MAX(captured_at) AS latestCapturedAt,
              GROUP_CONCAT(DISTINCT source_type) AS sourceTypes
       FROM crm_schema_snapshots
       GROUP BY portal_key
       ORDER BY portal_key`
    )
    .all()
    .map((r) => ({
      portalKey: r.portalKey,
      snapshotCount: r.snapshotCount,
      latestCapturedAt: r.latestCapturedAt,
      sourceTypes: String(r.sourceTypes || "")
        .split(",")
        .filter(Boolean),
    }));
}

export function insertFieldDefinition(field) {
  const id = field.id || crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO crm_field_definitions
       (id, snapshot_id, portal_key, entity_type, field_code, field_name, canonical_key,
        data_type, user_type_id, is_multiple, is_required_globally, is_read_only,
        bi_usage, verification_status, source_comment)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      field.snapshotId,
      field.portalKey,
      field.entityType,
      field.fieldCode,
      field.fieldName ?? null,
      field.canonicalKey ?? null,
      field.dataType ?? null,
      field.userTypeId ?? null,
      boolInt(field.isMultiple),
      boolInt(field.isRequiredGlobally),
      boolInt(field.isReadOnly),
      field.biUsage ?? null,
      field.verificationStatus || "draft",
      field.sourceComment ?? null
    );
  return id;
}

export function insertEnumValue(enumRow) {
  const id = enumRow.id || crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO crm_field_enum_values
       (id, field_definition_id, enum_id, xml_id, value, sort, canonical_value, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      enumRow.fieldDefinitionId,
      enumRow.enumId != null ? String(enumRow.enumId) : null,
      enumRow.xmlId ?? null,
      enumRow.value ?? null,
      enumRow.sort ?? null,
      enumRow.canonicalValue ?? null,
      boolInt(enumRow.isActive !== false)
    );
  return id;
}

export function insertPipeline(pipeline) {
  const id = pipeline.id || crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO crm_pipeline_definitions
       (id, snapshot_id, portal_key, entity_type, category_id, category_name, canonical_pipeline, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      pipeline.snapshotId,
      pipeline.portalKey,
      pipeline.entityType,
      pipeline.categoryId != null ? String(pipeline.categoryId) : null,
      pipeline.categoryName ?? null,
      pipeline.canonicalPipeline ?? null,
      boolInt(pipeline.isDefault)
    );
  return id;
}

export function insertStage(stage) {
  const id = stage.id || crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO crm_stage_definitions
       (id, pipeline_id, stage_id, stage_name, canonical_stage, stage_group, sort_order,
        semantic, probability, is_final, is_success, is_failure, is_optional,
        business_goal, success_trigger, recommended_action, maximum_duration_hours, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      stage.pipelineId,
      stage.stageId,
      stage.stageName ?? null,
      stage.canonicalStage ?? null,
      stage.stageGroup ?? null,
      stage.sortOrder ?? null,
      stage.semantic ?? null,
      stage.probability ?? null,
      boolInt(stage.isFinal),
      boolInt(stage.isSuccess),
      boolInt(stage.isFailure),
      boolInt(stage.isOptional),
      stage.businessGoal ?? null,
      stage.successTrigger ?? null,
      stage.recommendedAction ?? null,
      stage.maximumDurationHours ?? null,
      stage.verificationStatus || "draft"
    );
  return id;
}

export function insertStageRequirement(req) {
  const id = req.id || crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO crm_stage_requirements
       (id, stage_definition_id, field_code, requirement_type, validation_rule_json,
        error_message, source_type, verification_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      req.stageDefinitionId,
      req.fieldCode,
      req.requirementType,
      req.validationRule != null ? JSON.stringify(req.validationRule) : null,
      req.errorMessage ?? null,
      req.sourceType ?? null,
      req.verificationStatus || "needs_confirmation"
    );
  return id;
}

export function insertStageMapping(mapping) {
  const id = mapping.id || crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO crm_stage_mappings
       (id, canonical_stage, source_portal, source_stage_id, target_portal, target_stage_id,
        mapping_type, confidence, comment, verification_status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      mapping.canonicalStage,
      mapping.sourcePortal,
      mapping.sourceStageId ?? null,
      mapping.targetPortal,
      mapping.targetStageId ?? null,
      mapping.mappingType || "unmapped",
      mapping.confidence ?? null,
      mapping.comment ?? null,
      mapping.verificationStatus || "draft",
      now()
    );
  return id;
}

export function insertProcessRule(rule) {
  const id = rule.id || crypto.randomUUID();
  getDatabase()
    .prepare(
      `INSERT INTO crm_process_rules
       (id, canonical_stage, rule_type, rule_json, source_type, verification_status, version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      rule.canonicalStage,
      rule.ruleType,
      JSON.stringify(rule.ruleJson ?? {}),
      rule.sourceType ?? null,
      rule.verificationStatus || "draft",
      rule.version || "1"
    );
  return id;
}

export function findExistingSeedSnapshot(portalKey, sourceType, contentHash) {
  return getDatabase()
    .prepare(
      `SELECT * FROM crm_schema_snapshots
       WHERE portal_key = ? AND source_type = ? AND content_hash = ?
       ORDER BY captured_at DESC LIMIT 1`
    )
    .get(portalKey, sourceType, contentHash);
}

export function countFieldsForSnapshot(snapshotId) {
  return getDatabase()
    .prepare("SELECT COUNT(*) AS c FROM crm_field_definitions WHERE snapshot_id = ?")
    .get(snapshotId)?.c;
}

export function listFields({
  snapshotId,
  portalKey,
  entityType,
  fieldCode,
  canonicalKey,
} = {}) {
  const clauses = [];
  const params = [];
  if (snapshotId) {
    clauses.push("snapshot_id = ?");
    params.push(snapshotId);
  }
  if (portalKey) {
    clauses.push("portal_key = ?");
    params.push(portalKey);
  }
  if (entityType) {
    clauses.push("entity_type = ?");
    params.push(entityType);
  }
  if (fieldCode) {
    clauses.push("field_code = ?");
    params.push(fieldCode);
  }
  if (canonicalKey) {
    clauses.push("canonical_key = ?");
    params.push(canonicalKey);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDatabase()
    .prepare(
      `SELECT * FROM crm_field_definitions ${where}
       ORDER BY entity_type, field_code`
    )
    .all(...params)
    .map(mapField);
}

export function listEnumsForField(fieldDefinitionId) {
  return getDatabase()
    .prepare(
      `SELECT * FROM crm_field_enum_values
       WHERE field_definition_id = ?
       ORDER BY sort, value`
    )
    .all(fieldDefinitionId)
    .map(mapEnum);
}

export function listEnumsByCanonical({
  portalKey,
  entityType,
  canonicalKey,
  snapshotId,
} = {}) {
  const fields = listFields({ portalKey, entityType, canonicalKey, snapshotId });
  const out = [];
  for (const field of fields) {
    for (const ev of listEnumsForField(field.id)) {
      out.push({ ...ev, field });
    }
  }
  return out;
}

export function listPipelines({ snapshotId, portalKey, entityType } = {}) {
  const clauses = [];
  const params = [];
  if (snapshotId) {
    clauses.push("snapshot_id = ?");
    params.push(snapshotId);
  }
  if (portalKey) {
    clauses.push("portal_key = ?");
    params.push(portalKey);
  }
  if (entityType) {
    clauses.push("entity_type = ?");
    params.push(entityType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDatabase()
    .prepare(`SELECT * FROM crm_pipeline_definitions ${where} ORDER BY entity_type, category_id`)
    .all(...params)
    .map(mapPipeline);
}

export function listStages({
  pipelineId,
  snapshotId,
  portalKey,
  entityType,
  stageId,
  canonicalStage,
} = {}) {
  if (pipelineId) {
    return getDatabase()
      .prepare(
        `SELECT s.*, p.portal_key, p.entity_type, p.category_id, p.category_name, p.snapshot_id
         FROM crm_stage_definitions s
         JOIN crm_pipeline_definitions p ON p.id = s.pipeline_id
         WHERE s.pipeline_id = ?
         ORDER BY s.sort_order, s.stage_name`
      )
      .all(pipelineId)
      .map(mapStageJoined);
  }

  const clauses = ["1=1"];
  const params = [];
  if (snapshotId) {
    clauses.push("p.snapshot_id = ?");
    params.push(snapshotId);
  }
  if (portalKey) {
    clauses.push("p.portal_key = ?");
    params.push(portalKey);
  }
  if (entityType) {
    clauses.push("p.entity_type = ?");
    params.push(entityType);
  }
  if (stageId) {
    clauses.push("s.stage_id = ?");
    params.push(stageId);
  }
  if (canonicalStage) {
    clauses.push("s.canonical_stage = ?");
    params.push(canonicalStage);
  }

  return getDatabase()
    .prepare(
      `SELECT s.*, p.portal_key, p.entity_type, p.category_id, p.category_name, p.snapshot_id
       FROM crm_stage_definitions s
       JOIN crm_pipeline_definitions p ON p.id = s.pipeline_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY p.entity_type, p.category_id, s.sort_order`
    )
    .all(...params)
    .map(mapStageJoined);
}

export function listStageRequirements(stageDefinitionId) {
  return getDatabase()
    .prepare(
      `SELECT * FROM crm_stage_requirements WHERE stage_definition_id = ? ORDER BY field_code`
    )
    .all(stageDefinitionId)
    .map(mapRequirement);
}

export function listStageMappings({
  sourcePortal,
  targetPortal,
  canonicalStage,
} = {}) {
  const clauses = [];
  const params = [];
  if (sourcePortal) {
    clauses.push("source_portal = ?");
    params.push(sourcePortal);
  }
  if (targetPortal) {
    clauses.push("target_portal = ?");
    params.push(targetPortal);
  }
  if (canonicalStage) {
    clauses.push("canonical_stage = ?");
    params.push(canonicalStage);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDatabase()
    .prepare(
      `SELECT * FROM crm_stage_mappings ${where} ORDER BY canonical_stage, source_portal`
    )
    .all(...params)
    .map(mapMapping);
}

export function findStageMapping({
  sourcePortal,
  sourceStageId,
  targetPortal,
  canonicalStage,
} = {}) {
  if (canonicalStage && sourcePortal && targetPortal) {
    return (
      listStageMappings({ sourcePortal, targetPortal, canonicalStage })[0] || null
    );
  }
  if (sourcePortal && sourceStageId && targetPortal) {
    const row = getDatabase()
      .prepare(
        `SELECT * FROM crm_stage_mappings
         WHERE source_portal = ? AND source_stage_id = ? AND target_portal = ?
         LIMIT 1`
      )
      .get(sourcePortal, sourceStageId, targetPortal);
    return row ? mapMapping(row) : null;
  }
  return null;
}

export function listProcessRules({ canonicalStage, ruleType } = {}) {
  const clauses = [];
  const params = [];
  if (canonicalStage) {
    clauses.push("canonical_stage = ?");
    params.push(canonicalStage);
  }
  if (ruleType) {
    clauses.push("rule_type = ?");
    params.push(ruleType);
  }
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  return getDatabase()
    .prepare(`SELECT * FROM crm_process_rules ${where} ORDER BY canonical_stage, rule_type`)
    .all(...params)
    .map(mapProcessRule);
}

export function deleteStageMappingsByVersionComment(marker) {
  // used only in tests if needed — prefer insert-or-skip by content
  getDatabase()
    .prepare("DELETE FROM crm_stage_mappings WHERE comment LIKE ?")
    .run(`%${marker}%`);
}

export function countStageMappings() {
  return getDatabase().prepare("SELECT COUNT(*) AS c FROM crm_stage_mappings").get()?.c || 0;
}

function mapSnapshot(row) {
  return {
    id: row.id,
    portalKey: row.portal_key,
    sourceType: row.source_type,
    schemaVersion: row.schema_version,
    capturedAt: row.captured_at,
    contentHash: row.content_hash,
    status: row.status,
    metadata: parseJson(row.metadata_json, {}),
    createdAt: row.created_at,
  };
}

function mapField(row) {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    portalKey: row.portal_key,
    entityType: row.entity_type,
    fieldCode: row.field_code,
    fieldName: row.field_name,
    canonicalKey: row.canonical_key,
    dataType: row.data_type,
    userTypeId: row.user_type_id,
    isMultiple: Boolean(row.is_multiple),
    isRequiredGlobally: Boolean(row.is_required_globally),
    isReadOnly: Boolean(row.is_read_only),
    biUsage: row.bi_usage,
    verificationStatus: row.verification_status,
    sourceComment: row.source_comment,
  };
}

function mapEnum(row) {
  return {
    id: row.id,
    fieldDefinitionId: row.field_definition_id,
    enumId: row.enum_id,
    xmlId: row.xml_id,
    value: row.value,
    sort: row.sort,
    canonicalValue: row.canonical_value,
    isActive: Boolean(row.is_active),
  };
}

function mapPipeline(row) {
  return {
    id: row.id,
    snapshotId: row.snapshot_id,
    portalKey: row.portal_key,
    entityType: row.entity_type,
    categoryId: row.category_id,
    categoryName: row.category_name,
    canonicalPipeline: row.canonical_pipeline,
    isDefault: Boolean(row.is_default),
  };
}

function mapStageJoined(row) {
  return {
    id: row.id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    stageName: row.stage_name,
    canonicalStage: row.canonical_stage,
    stageGroup: row.stage_group,
    sortOrder: row.sort_order,
    semantic: row.semantic,
    probability: row.probability,
    isFinal: Boolean(row.is_final),
    isSuccess: Boolean(row.is_success),
    isFailure: Boolean(row.is_failure),
    isOptional: Boolean(row.is_optional),
    businessGoal: row.business_goal,
    successTrigger: row.success_trigger,
    recommendedAction: row.recommended_action,
    maximumDurationHours: row.maximum_duration_hours,
    verificationStatus: row.verification_status,
    portalKey: row.portal_key,
    entityType: row.entity_type,
    categoryId: row.category_id,
    categoryName: row.category_name,
    snapshotId: row.snapshot_id,
  };
}

function mapRequirement(row) {
  return {
    id: row.id,
    stageDefinitionId: row.stage_definition_id,
    fieldCode: row.field_code,
    requirementType: row.requirement_type,
    validationRule: parseJson(row.validation_rule_json, null),
    errorMessage: row.error_message,
    sourceType: row.source_type,
    verificationStatus: row.verification_status,
  };
}

function mapMapping(row) {
  return {
    id: row.id,
    canonicalStage: row.canonical_stage,
    sourcePortal: row.source_portal,
    sourceStageId: row.source_stage_id,
    targetPortal: row.target_portal,
    targetStageId: row.target_stage_id,
    mappingType: row.mapping_type,
    confidence: row.confidence,
    comment: row.comment,
    verificationStatus: row.verification_status,
    createdAt: row.created_at,
  };
}

function mapProcessRule(row) {
  return {
    id: row.id,
    canonicalStage: row.canonical_stage,
    ruleType: row.rule_type,
    ruleJson: parseJson(row.rule_json, {}),
    sourceType: row.source_type,
    verificationStatus: row.verification_status,
    version: row.version,
  };
}
