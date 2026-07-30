/**
 * Read-only capture of Bitrix CRM metadata (fields, enums, pipelines, stages).
 * Uses callReadMethod / callBitrixMethodFull only — no writes.
 */

import { callReadMethod, callBitrixMethodFull } from "../bitrixClient.js";
import { ENTITY_TYPE, fetchAllPages, getDealStageEntityId } from "../actions/helpers.js";
import { redactObject } from "../safety/redact.js";

const ENTITY_SPECS = [
  { entityType: "lead", entityTypeId: ENTITY_TYPE.LEAD, legacyFields: "crm.lead.fields", statusEntity: "STATUS" },
  { entityType: "deal", entityTypeId: ENTITY_TYPE.DEAL, legacyFields: "crm.deal.fields", statusEntity: null },
  { entityType: "contact", entityTypeId: ENTITY_TYPE.CONTACT, legacyFields: "crm.contact.fields", statusEntity: null },
  { entityType: "company", entityTypeId: ENTITY_TYPE.COMPANY, legacyFields: "crm.company.fields", statusEntity: null },
];

/**
 * Capture full portal schema via read-only Bitrix REST.
 * @param {{ portalKey?: string, bitrixApi?: { callReadMethod: Function, callBitrixMethodFull: Function } }} [options]
 * @returns {Promise<{ fields: object[], pipelines: object[], warnings: object[], meta: object }>}
 */
export async function captureLiveBitrixSchema({ portalKey = "sensu", bitrixApi } = {}) {
  const api = bitrixApi || {
    callReadMethod,
    callBitrixMethodFull,
  };
  const warnings = [];
  const fields = [];
  const pipelines = [];
  const readMethods = [];

  for (const spec of ENTITY_SPECS) {
    const { fieldRows, fieldWarnings, methods } = await captureEntityFields(spec, api);
    fields.push(...fieldRows);
    warnings.push(...fieldWarnings);
    readMethods.push(...methods);
  }

  // Lead stages (STATUS)
  {
    const { pipeline, warning, methods } = await captureStatusPipeline(
      {
        portalKey,
        entityType: "lead",
        categoryId: "0",
        categoryName: "Лиды",
        entityId: "STATUS",
        canonicalPipeline: `${portalKey}.lead.default`,
        isDefault: true,
      },
      api
    );
    if (pipeline) pipelines.push(pipeline);
    if (warning) warnings.push(warning);
    readMethods.push(...methods);
  }

  // Deal categories + stages (multi-funnel)
  const { categories, methods: catMethods, warning: catWarning } = await listDealCategories(api);
  readMethods.push(...catMethods);
  if (catWarning) warnings.push(catWarning);

  if (!categories.length) {
    const { pipeline, warning, methods } = await captureStatusPipeline(
      {
        portalKey,
        entityType: "deal",
        categoryId: "0",
        categoryName: "Сделки (default)",
        entityId: getDealStageEntityId(0),
        canonicalPipeline: `${portalKey}.deal.default`,
        isDefault: true,
      },
      api
    );
    if (pipeline) pipelines.push(pipeline);
    if (warning) warnings.push(warning);
    readMethods.push(...methods);
  } else {
    for (const cat of categories) {
      const categoryId = String(cat.id ?? cat.ID ?? 0);
      const categoryName = cat.name || cat.NAME || `Category ${categoryId}`;
      const isDefault = Boolean(cat.isDefault ?? cat.IS_DEFAULT) || categoryId === "0";
      const { pipeline, warning, methods } = await captureStatusPipeline(
        {
          portalKey,
          entityType: "deal",
          categoryId,
          categoryName,
          entityId: getDealStageEntityId(categoryId),
          canonicalPipeline: `${portalKey}.deal.${categoryId}`,
          isDefault,
        },
        api
      );
      if (pipeline) pipelines.push(pipeline);
      if (warning) warnings.push(warning);
      readMethods.push(...methods);
    }
  }

  warnings.push({
    code: "STAGE_MANDATORY_FIELDS_UNRELIABLE",
    message:
      "Stage-specific mandatory fields нельзя надёжно получить через используемые REST-методы. Сохранены только is_required_globally; stage requirements — needs_confirmation.",
    severity: "warning",
  });

  return {
    portalKey,
    sourceType: "live_bitrix",
    fields,
    pipelines,
    warnings,
    meta: redactObject({
      capturedVia: "read_only",
      readMethods: [...new Set(readMethods)],
      entityCount: ENTITY_SPECS.length,
      pipelineCount: pipelines.length,
      fieldCount: fields.length,
      writeMethodsUsed: [],
    }),
  };
}

async function captureEntityFields(spec, api) {
  const warnings = [];
  const methods = [];
  let rawFields = null;

  try {
    methods.push("crm.item.fields");
    rawFields = await api.callReadMethod("crm.item.fields", {
      entityTypeId: spec.entityTypeId,
    });
  } catch (error) {
    warnings.push({
      code: "CRM_ITEM_FIELDS_FALLBACK",
      message: `crm.item.fields failed for ${spec.entityType}: ${error.message}; fallback ${spec.legacyFields}`,
    });
    methods.push(spec.legacyFields);
    rawFields = await api.callReadMethod(spec.legacyFields, {});
  }

  const fieldMap = normalizeFieldsMap(rawFields);
  const fieldRows = [];

  for (const [code, def] of Object.entries(fieldMap)) {
    const items = extractEnumItems(def);
    const dataType =
      def.type ||
      def.TYPE ||
      def.userTypeId ||
      def.USER_TYPE_ID ||
      (items.length ? "enumeration" : "unknown");
    const userTypeId = def.userTypeId || def.USER_TYPE_ID || null;
    const isMultiple = Boolean(
      def.isMultiple ?? (def.MULTIPLE === "Y" || def.multiple)
    );
    const isRequired = Boolean(
      def.isRequired ?? (def.REQUIRED === "Y" || def.required || def.mandatory)
    );
    const isReadOnly = Boolean(
      def.isReadOnly ?? (def.READONLY === "Y" || def.readOnly || def.editable === false)
    );
    const title =
      def.title ||
      def.formLabel ||
      def.listLabel ||
      def.TITLE ||
      def.LIST_LABEL ||
      code;

    fieldRows.push({
      entityType: spec.entityType,
      fieldCode: code,
      fieldName: typeof title === "object" ? title.ru || title.en || code : String(title),
      canonicalKey: null,
      dataType: String(dataType),
      userTypeId: userTypeId ? String(userTypeId) : null,
      isMultiple,
      isRequiredGlobally: isRequired,
      isReadOnly,
      biUsage: null,
      verificationStatus: "verified_from_live_bitrix",
      sourceComment: "captured via Bitrix REST metadata",
      enums: items.map((it, idx) => ({
        enumId: String(it.ID ?? it.id ?? it.VALUE ?? idx),
        xmlId: it.XML_ID ?? it.xmlId ?? null,
        value: it.VALUE ?? it.value ?? it.NAME ?? null,
        sort: Number(it.SORT ?? it.sort ?? (idx + 1) * 10) || null,
        canonicalValue: null,
        isActive: (it.DEF ?? it.ACTIVE ?? "Y") !== "N",
      })),
    });
  }

  return { fieldRows, fieldWarnings: warnings, methods };
}

function normalizeFieldsMap(raw) {
  if (!raw || typeof raw !== "object") return {};
  if (raw.fields && typeof raw.fields === "object") return raw.fields;
  // legacy crm.*.fields returns map of field code → definition
  return raw;
}

function extractEnumItems(def) {
  if (!def || typeof def !== "object") return [];
  const items =
    def.items ||
    def.ITEMS ||
    def.list ||
    def.LIST ||
    def.enums ||
    def.ENUMS ||
    [];
  if (Array.isArray(items)) return items;
  if (typeof items === "object") {
    return Object.entries(items).map(([id, value]) => ({
      ID: id,
      VALUE: typeof value === "object" ? value.VALUE || value.value || value : value,
    }));
  }
  return [];
}

async function listDealCategories(api) {
  const methods = ["crm.category.list"];
  try {
    const result = await api.callReadMethod("crm.category.list", {
      entityTypeId: ENTITY_TYPE.DEAL,
    });
    const list = result?.categories || result || [];
    return {
      categories: Array.isArray(list) ? list : [],
      methods,
      warning: null,
    };
  } catch (error) {
    return {
      categories: [],
      methods,
      warning: {
        code: "DEAL_CATEGORY_LIST_FAILED",
        message: error.message,
      },
    };
  }
}

async function captureStatusPipeline(opts, api) {
  const {
    portalKey,
    entityType,
    categoryId,
    categoryName,
    entityId,
    canonicalPipeline,
    isDefault,
  } = opts;
  const methods = ["crm.status.list"];
  try {
    const { items, truncated, warnings: pageWarnings } = await fetchAllPages({
      actionName: `crm.status.list:${entityId}`,
      fetchPage: async (start) => {
        const { result, next, total } = await api.callBitrixMethodFull("crm.status.list", {
          filter: { ENTITY_ID: entityId },
          order: { SORT: "ASC" },
          start,
        });
        const list = Array.isArray(result) ? result : result?.statuses || [];
        return { items: list, next, total };
      },
    });

    const stages = items.map((st, idx) => {
      const stageId = String(st.STATUS_ID ?? st.statusId ?? st.ID ?? "");
      const name = st.NAME || st.name || stageId;
      const semantics = st.SEMANTICS || st.semantics || null;
      const isSuccess = semantics === "S" || /success|won|converted/i.test(String(name));
      const isFailure = semantics === "F" || /fail|lose|junk|провал/i.test(String(name));
      return {
        stageId,
        stageName: name,
        canonicalStage: null,
        stageGroup: isSuccess ? "success" : isFailure ? "failure" : "process",
        sortOrder: Number(st.SORT ?? st.sort ?? (idx + 1) * 10) || null,
        semantic: semantics,
        probability: st.EXTRA?.PROBABILITY ?? st.probability ?? null,
        isFinal: isSuccess || isFailure,
        isSuccess,
        isFailure,
        isOptional: false,
        verificationStatus: "verified_from_live_bitrix",
        requirements: [],
      };
    });

    const warning =
      truncated || (pageWarnings && pageWarnings.length)
        ? {
            code: "STATUS_LIST_TRUNCATED",
            message: `crm.status.list for ${entityId} may be incomplete`,
            details: { truncated, pageWarnings },
          }
        : null;

    return {
      pipeline: {
        portalKey,
        entityType,
        categoryId: String(categoryId),
        categoryName,
        canonicalPipeline,
        isDefault,
        stages,
      },
      warning,
      methods,
    };
  } catch (error) {
    return {
      pipeline: null,
      warning: {
        code: "STATUS_LIST_FAILED",
        message: `${entityId}: ${error.message}`,
      },
      methods,
    };
  }
}
