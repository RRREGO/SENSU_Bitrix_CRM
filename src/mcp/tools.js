/**
 * MCP tools over the existing Bitrix action registry and Safety Layer.
 * Reads run immediately. Writes only prepare a preview until confirm_crm_operation.
 */

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getActionCatalog } from "../actions/index.js";
import { selectRelevantActions } from "../actions/catalogSelector.js";
import { executeAction, commitAction, cancelAction } from "../safety/executor.js";
import { getOperationByConfirmationId } from "../database/repositories/operationsRepository.js";
import { sanitizeLlmPayload } from "../llm/sanitize.js";

const INSTRUCTIONS = `Ты подключён к Bitrix24 CRM Assistant через MCP.
Действуй от имени вошедшего пользователя и не выдумывай данные CRM.

Порядок:
1. search_crm_actions — найти имя действия и параметры.
2. run_crm_action — чтение выполняется сразу. Создание, изменение и удаление только готовят предпросмотр и возвращают confirmationId. В Bitrix24 в этот момент ничего не записано.
3. Покажи предпросмотр пользователю обычным языком.
4. confirm_crm_operation — только после явного согласия пользователя на этот confirmationId. Если нужна фраза подтверждения, передай её дословно от пользователя.
5. cancel_crm_operation — если пользователь отказался.

Не подтверждай запись в том же шаге, в котором подготовил её. Не обходи подтверждение.`;

function toolResult(value, isError = false) {
  let text;
  try {
    text = JSON.stringify(sanitizeLlmPayload(value, "generic"), null, 2);
  } catch {
    text = JSON.stringify({ success: false, error: { message: "Не удалось сериализовать ответ." } });
    isError = true;
  }
  if (text.length > 48000) text = `${text.slice(0, 48000)}\n…обрезано…`;
  return { content: [{ type: "text", text }], isError };
}

function canonicalActionName(name) {
  const raw = String(name || "").trim();
  const catalog = getActionCatalog();
  if (catalog.some((entry) => entry.name === raw)) return raw;
  const alias = catalog.find((entry) => (entry.aliases || []).includes(raw));
  return alias?.name || raw;
}

function normalizeParams(params) {
  if (params == null || params === "") return {};
  if (typeof params === "string") {
    const parsed = JSON.parse(params);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("params должен быть объектом.");
    }
    return parsed;
  }
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new Error("params должен быть объектом.");
  }
  return params;
}

function canConfirm(user, initiatorId) {
  const canAny = user.permissions?.has?.("operations.confirm.any");
  const canOwn = user.permissions?.has?.("operations.confirm.own");
  if (canAny) return true;
  return Boolean(canOwn && initiatorId && String(initiatorId) === String(user.userId));
}

export function createMcpServer(user) {
  const server = new McpServer(
    { name: "bitrix-crm-assistant", version: "1.0.0" },
    { instructions: INSTRUCTIONS }
  );

  server.registerTool(
    "search_crm_actions",
    {
      title: "Найти действия CRM",
      description:
        "Ищет действия Bitrix24 по смыслу запроса и возвращает имя, описание, параметры и нужно ли подтверждение. Вызови перед run_crm_action, если имя действия не очевидно.",
      inputSchema: {
        query: z.string().describe("Что нужно сделать, обычными словами"),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true, idempotentHint: true },
    },
    async ({ query }) => {
      const selection = selectRelevantActions(query || "");
      return toolResult({
        actions: selection.actions,
        hint: "Для чтения вызови run_crm_action. Для записи он вернёт предпросмотр, а не выполнит изменение.",
      });
    }
  );

  server.registerTool(
    "run_crm_action",
    {
      title: "Выполнить или подготовить действие CRM",
      description:
        "Читает CRM сразу. Создание, изменение и удаление только готовят предпросмотр Safety Layer и возвращают confirmationId. Пока не вызван confirm_crm_operation, Bitrix24 не изменяется. Не подтверждай действие сам.",
      inputSchema: {
        action: z.string().min(1).describe("Имя действия из search_crm_actions, например deal_list или deal_create_prepare"),
        params: z.record(z.any()).optional().describe("Параметры действия объектом"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async ({ action, params }) => {
      try {
        const name = canonicalActionName(action);
        if (!name || name.startsWith("__")) {
          return toolResult({ success: false, error: { message: "Служебные действия недоступны. Используй search_crm_actions." } }, true);
        }
        const result = await executeAction(name, normalizeParams(params), {
          source: "mcp",
          sessionId: `mcp:${user.userId}`,
          user,
          mode: "auto",
        });
        if (result?.status === "confirmation_required") {
          return toolResult({
            success: true,
            status: "confirmation_required",
            written: false,
            confirmationId: result.confirmationId,
            expiresAt: result.expiresAt,
            operation: result.operation,
            preview: result.preview,
            nextStep:
              "Покажите предпросмотр пользователю. Вызовите confirm_crm_operation только после явного согласия. До этого в Bitrix24 ничего не изменено.",
          });
        }
        return toolResult(result, result?.success === false);
      } catch (error) {
        return toolResult({ success: false, error: { message: error.message || "Не удалось выполнить действие." } }, true);
      }
    }
  );

  server.registerTool(
    "confirm_crm_operation",
    {
      title: "Подтвердить подготовленное изменение",
      description:
        "Записывает в Bitrix24 уже подготовленную операцию. Вызывай только после явного согласия пользователя на этот confirmationId. Фразу подтверждения передавай только если пользователь написал её сам.",
      inputSchema: {
        confirmationId: z.string().min(8).describe("confirmationId из run_crm_action"),
        confirmationPhrase: z.string().optional().describe("Точная фраза, если предпросмотр её требует"),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true, idempotentHint: false },
    },
    async ({ confirmationId, confirmationPhrase }) => {
      const operation = getOperationByConfirmationId(confirmationId);
      if (!operation) {
        return toolResult({ success: false, error: { code: "OPERATION_NOT_FOUND", message: "Операция не найдена." } }, true);
      }
      if (!canConfirm(user, operation.initiatedByUserId)) {
        return toolResult({ success: false, error: { code: "PERMISSION_DENIED", message: "Нельзя подтвердить эту операцию." } }, true);
      }
      const result = await commitAction(confirmationId, {
        source: "mcp",
        sessionId: `mcp:${user.userId}`,
        user,
        confirmationPhrase: confirmationPhrase || null,
        bulkConfirmationPhrase: confirmationPhrase || null,
      });
      return toolResult(result, result?.success === false);
    }
  );

  server.registerTool(
    "cancel_crm_operation",
    {
      title: "Отменить подготовленное изменение",
      description: "Отменяет операцию, которая ещё ждёт подтверждения. Bitrix24 не изменяется.",
      inputSchema: {
        confirmationId: z.string().min(8).describe("confirmationId из run_crm_action"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
    },
    async ({ confirmationId }) => {
      const operation = getOperationByConfirmationId(confirmationId);
      if (!operation) {
        return toolResult({ success: false, error: { code: "OPERATION_NOT_FOUND", message: "Операция не найдена." } }, true);
      }
      if (!canConfirm(user, operation.initiatedByUserId)) {
        return toolResult({ success: false, error: { code: "PERMISSION_DENIED", message: "Нельзя отменить эту операцию." } }, true);
      }
      const result = await cancelAction(confirmationId, { source: "mcp", sessionId: `mcp:${user.userId}` });
      return toolResult(result, result?.success === false);
    }
  );

  return server;
}
