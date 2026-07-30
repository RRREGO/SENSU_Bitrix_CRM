import {
  getDealStageEntityId,
  hasPresentValue,
  isNil,
} from "../actions/helpers.js";
import { search_users } from "../actions/userActions.js";
import { deal_category_list, deal_stage_list } from "../actions/crmActions.js";
import { deal_fields } from "../actions/dealActions.js";
import { resolveAssigneeFromUsers } from "./dealCreateEmployees.js";
import {
  listRequiredWritableDealFields,
  validateDealRequiredFields,
  buildDealCreateFields,
} from "./dealCreateFields.js";
import { pickInitialDealStage, normalizeStageList } from "./dealCreateStages.js";
import { logDealCreateStep, logDealCreateError, newDealCreateActionId } from "./dealCreateLog.js";

export class DealCreateError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "DealCreateError";
    this.code = code;
    this.details = details;
  }
}

function normalizeCategories(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.categories)) return raw.categories;
  return [];
}

function categoryIdFromEntry(entry) {
  if (entry == null) return null;
  if (typeof entry === "number") return entry;
  const id = entry.id ?? entry.ID;
  if (id === 0 || id === "0") return 0;
  const num = Number(id);
  return Number.isFinite(num) ? num : null;
}

function categoryNameFromEntry(entry) {
  return entry?.name ?? entry?.NAME ?? "";
}

/**
 * ID воронки: 0 — валидный ID общей воронки (не использовать || для fallback).
 */
export function resolveDealCategoryId(categories, { categoryId, categoryName } = {}) {
  if (!isNil(categoryId)) {
    const id = Number(categoryId);
    if (!Number.isFinite(id) || id < 0) {
      throw new DealCreateError("INVALID_CATEGORY_ID", `Некорректный categoryId: ${categoryId}`);
    }
    return id;
  }

  const list = normalizeCategories(categories);
  if (categoryName) {
    const needle = String(categoryName).trim().toLowerCase();
    const found = list.find((c) => categoryNameFromEntry(c).toLowerCase() === needle);
    if (!found) {
      throw new DealCreateError(
        "CATEGORY_NOT_FOUND",
        `Воронка «${categoryName}» не найдена.`
      );
    }
    const resolved = categoryIdFromEntry(found);
    if (resolved === null) {
      throw new DealCreateError("CATEGORY_NOT_FOUND", `Не удалось определить ID воронки «${categoryName}».`);
    }
    return resolved;
  }

  const defaultEntry =
    list.find((c) => c.isDefault || c.IS_DEFAULT) ||
    list.find((c) => categoryIdFromEntry(c) === 0) ||
    list[0];

  if (!defaultEntry) return 0;
  const resolved = categoryIdFromEntry(defaultEntry);
  return resolved === null ? 0 : resolved;
}

function stageNameFromList(stages, stageId) {
  const hit = normalizeStageList(stages).find(
    (s) => String(s.STATUS_ID ?? s.statusId) === String(stageId)
  );
  return hit?.NAME ?? hit?.name ?? stageId;
}

function categoryNameFromList(categories, categoryId) {
  const hit = normalizeCategories(categories).find(
    (c) => categoryIdFromEntry(c) === categoryId
  );
  return categoryNameFromEntry(hit) || (categoryId === 0 ? "Общая" : `Воронка ${categoryId}`);
}

/**
 * Полный сценарий подготовки сделки (чтение Bitrix + валидация).
 */
export async function buildCreateDealPlan(params = {}, context = {}) {
  const actionId = context.actionId || newDealCreateActionId();
  const step = context.step || "prepare";
  const userQuery = params.userQuery || params.assigneeQuery || null;

  const logBase = {
    actionId,
    step,
    confirmationState: context.confirmationState || "none",
    safetyContext: Boolean(context.safetyContext),
    userQuery,
  };

  try {
    logDealCreateStep({ ...logBase, step: "start" });

    let assignedById = !isNil(params.assignedById) ? Number(params.assignedById) : null;
    let assigneeUser = null;

    if (!assignedById && hasPresentValue(params.assigneeQuery)) {
      logDealCreateStep({ ...logBase, step: "resolve_employee" });
      const users = await search_users({ query: params.assigneeQuery });
      const resolved = resolveAssigneeFromUsers(users);
      if (resolved.status === "not_found") {
        return {
          status: "not_found",
          code: "ASSIGNEE_NOT_FOUND",
          message: `Сотрудник «${params.assigneeQuery}» не найден. Уточните фамилию или укажите ID.`,
          actionId,
        };
      }
      if (resolved.status === "ambiguous") {
        return {
          status: "ambiguous_assignee",
          code: "ASSIGNEE_AMBIGUOUS",
          message: "Найдено несколько сотрудников. Уточните, кого назначить ответственным.",
          candidates: resolved.candidates,
          actionId,
        };
      }
      assignedById = resolved.assignedById;
      assigneeUser = resolved.user;
    }

    if (!assignedById && !hasPresentValue(params.assigneeQuery) && isNil(params.fields?.ASSIGNED_BY_ID)) {
      return {
        status: "needs_input",
        code: "ASSIGNEE_REQUIRED",
        message: "Укажите ответственного (фамилию или assignedById).",
        missing: [{ code: "ASSIGNED_BY_ID", label: "Ответственный" }],
        actionId,
      };
    }

    if (!assignedById && params.fields?.ASSIGNED_BY_ID != null) {
      assignedById = Number(params.fields.ASSIGNED_BY_ID);
    }

    logDealCreateStep({ ...logBase, step: "resolve_category", employeeId: assignedById || undefined });

    const categories = await deal_category_list({});
    const categoryId = resolveDealCategoryId(categories, {
      categoryId: params.categoryId,
      categoryName: params.categoryName,
    });

    const stageEntityId = getDealStageEntityId(categoryId);
    logDealCreateStep({
      ...logBase,
      step: "resolve_stage",
      employeeId: assignedById || undefined,
      categoryId,
      stageEntityId,
    });

    const stages = await deal_stage_list({ categoryId });
    const stageId = pickInitialDealStage(stages, {
      preferredStageId: params.stageId ?? params.fields?.STAGE_ID,
    });

    logDealCreateStep({
      ...logBase,
      step: "resolve_stage",
      employeeId: assignedById || undefined,
      categoryId,
      stageEntityId,
      stageId,
    });

    if (!params.title && !params.fields?.TITLE) {
      return {
        status: "needs_input",
        code: "TITLE_REQUIRED",
        message: "Укажите название сделки (title).",
        missing: [{ code: "TITLE", label: "Название" }],
        actionId,
        categoryId,
        stageId,
      };
    }

    logDealCreateStep({ ...logBase, step: "deal_fields", categoryId, stageId });

    const fieldsMeta = await deal_fields();
    const requiredMeta = listRequiredWritableDealFields(fieldsMeta);
    const fields = buildDealCreateFields(params, { categoryId, stageId, assignedById });

    const validation = validateDealRequiredFields(fields, requiredMeta);
    if (!validation.ok) {
      return {
        status: "needs_input",
        code: "REQUIRED_FIELDS_MISSING",
        message: `Заполните обязательные поля: ${validation.missing.map((m) => m.label).join(", ")}.`,
        missing: validation.missing,
        actionId,
        categoryId,
        stageId,
        fieldsPreview: {
          TITLE: fields.TITLE,
          ASSIGNED_BY_ID: fields.ASSIGNED_BY_ID,
          CATEGORY_ID: fields.CATEGORY_ID,
          STAGE_ID: fields.STAGE_ID,
        },
      };
    }

    const createParams = {
      title: fields.TITLE,
      categoryId,
      stageId: fields.STAGE_ID,
      assignedById: fields.ASSIGNED_BY_ID,
      fields,
    };

    const summary = {
      title: fields.TITLE,
      assignedById: fields.ASSIGNED_BY_ID,
      assigneeName: assigneeUser
        ? [assigneeUser.NAME, assigneeUser.LAST_NAME].filter(Boolean).join(" ")
        : null,
      categoryId,
      categoryName: categoryNameFromList(categories, categoryId),
      stageId: fields.STAGE_ID,
      stageName: stageNameFromList(stages, fields.STAGE_ID),
    };

    logDealCreateStep({
      ...logBase,
      step: "payload_ready",
      employeeId: assignedById,
      categoryId,
      stageId,
      payloadSafe: {
        TITLE: fields.TITLE,
        ASSIGNED_BY_ID: fields.ASSIGNED_BY_ID,
        CATEGORY_ID: fields.CATEGORY_ID,
        STAGE_ID: fields.STAGE_ID,
      },
    });

    return {
      status: "ready",
      actionId,
      createParams,
      summary,
      payload: { fields },
    };
  } catch (error) {
    logDealCreateError({
      actionId,
      step: context.step || "prepare",
      errorCode: error.code || "DEAL_CREATE_FAILED",
      errorName: error.name,
      message: error.message,
      stack: error.stack,
      categoryId: params.categoryId,
      stageId: params.stageId,
      safetyContext: Boolean(context.safetyContext),
      confirmationState: context.confirmationState,
    });
    if (error instanceof DealCreateError) {
      return {
        status: "error",
        code: error.code,
        message: error.message,
        details: error.details,
        actionId,
      };
    }
    throw error;
  }
}
