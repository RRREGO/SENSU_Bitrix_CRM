import { getActionHandler } from "./actions/index.js";
import {
  getActionSafetyCategory,
  requiresConfirmation,
  isActionBlocked,
} from "./actionSafety.js";
import {
  executeAction,
  prepareAction,
  commitAction,
  cancelAction,
} from "./safety/executor.js";
import { getBitrixActionTool } from "./toolDefinitions.js";
import { formatBusinessText } from "./textFormatters.js";
import { buildResultCards } from "./resultCards.js";
import {
  callClaudeWithTools,
  extractTextFromClaudeResponse,
  extractToolUseBlocks,
  getAssistantContent,
} from "./claudeClient.js";
import { buildConversationContext } from "./workspace/contextBuilder.js";
import {
  ensureChatForSession,
  createChat,
  updateChat,
  autoTitleFromMessage,
  getChatById,
  getChatBySessionId,
} from "./database/repositories/chatsRepository.js";
import { addMessage } from "./database/repositories/messagesRepository.js";
import { expandDiscoveryCatalog } from "./actions/catalogSelector.js";
import { sanitizeLlmPayload } from "./llm/sanitize.js";
import { getOperationByConfirmationId } from "./database/repositories/operationsRepository.js";

const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_ITERATIONS = 8;

/** Short-lived runtime cache: chatId → Claude tool-turn state (not durable). */
const runtimeSessions = new Map();

function getRuntimeSession(chatId) {
  if (!runtimeSessions.has(chatId)) {
    runtimeSessions.set(chatId, {
      chatId,
      sessionId: chatId,
      messages: [],
      pendingConfirmations: new Map(),
      systemPrompt: null,
    });
  }
  return runtimeSessions.get(chatId);
}

function clearRuntimeSession(chatId) {
  runtimeSessions.delete(chatId);
}

function isToolResultMessage(message) {
  return (
    message?.role === "user" &&
    Array.isArray(message.content) &&
    message.content.some((block) => block?.type === "tool_result")
  );
}

function isToolUseMessage(message) {
  return (
    message?.role === "assistant" &&
    Array.isArray(message.content) &&
    message.content.some((block) => block?.type === "tool_use")
  );
}

function getToolUseIds(message) {
  if (!Array.isArray(message?.content)) {
    return [];
  }
  return message.content
    .filter((block) => block?.type === "tool_use" && block.id)
    .map((block) => block.id);
}

/**
 * Обрезает историю, не разрывая пары tool_use → tool_result.
 * Claude API требует, чтобы каждый tool_result имел tool_use в предыдущем сообщении.
 */
function trimHistory(messages) {
  if (messages.length <= MAX_HISTORY_MESSAGES) {
    return sanitizeToolMessagePairs(messages);
  }

  let trimmed = messages.slice(-MAX_HISTORY_MESSAGES);

  // Если срез начался с tool_result — предшествующий tool_use отрезан.
  while (trimmed.length > 0 && isToolResultMessage(trimmed[0])) {
    trimmed = trimmed.slice(1);
  }

  // История должна начинаться с user.
  while (trimmed.length > 0 && trimmed[0]?.role === "assistant") {
    trimmed = trimmed.slice(1);
    while (trimmed.length > 0 && isToolResultMessage(trimmed[0])) {
      trimmed = trimmed.slice(1);
    }
  }

  return sanitizeToolMessagePairs(trimmed);
}

/**
 * Убирает осиротевшие tool_result и приводит историю к валидному виду для Claude API.
 */
function sanitizeToolMessagePairs(messages) {
  if (!messages.length) {
    return messages;
  }

  const result = [];

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i];

    if (isToolResultMessage(message)) {
      const prev = result[result.length - 1];
      if (!isToolUseMessage(prev)) {
        continue;
      }

      const allowedIds = new Set(getToolUseIds(prev));
      const filteredContent = message.content.filter(
        (block) => block?.type !== "tool_result" || allowedIds.has(block.tool_use_id)
      );

      if (!filteredContent.some((block) => block?.type === "tool_result")) {
        continue;
      }

      result.push({ ...message, content: filteredContent });
      continue;
    }

    result.push(message);
  }

  // История должна начинаться с user.
  while (result.length > 0 && result[0]?.role === "assistant") {
    result.shift();
    while (result.length > 0 && isToolResultMessage(result[0])) {
      result.shift();
    }
  }

  return result;
}

/**
 * Если история заканчивается assistant с tool_use без tool_result
 * (например, после незавершённого подтверждения в старой сессии) — убираем его.
 * Так сохраняем чередование ролей перед новым user-сообщением.
 */
function closeOpenToolUses(session) {
  const messages = session.messages;
  if (!messages.length) {
    return;
  }

  const last = messages[messages.length - 1];
  if (!isToolUseMessage(last)) {
    return;
  }

  session.messages = messages.slice(0, -1);
  session.pendingConfirmations.clear();
}

function normalizeActionInput(input) {
  const action = input?.action?.trim();
  const params = input?.params && typeof input.params === "object" ? input.params : {};
  return { action, params };
}

function buildConfirmationMessage({ action, params, category, assistantText, preview }) {
  if (preview?.changes?.length) {
    const entityLabel = preview.entity
      ? `${preview.entity.type || ""} «${preview.entity.name || preview.entity.id}» (#${preview.entity.id ?? "новая"})`
      : action;
    const lines = preview.changes.slice(0, 12).map((c) => {
      return `• ${c.fieldName || c.field}: ${formatPreviewValue(c.before)} → ${formatPreviewValue(c.after)}`;
    });
    const risk = preview.risk ? `\nРиск: ${preview.risk}` : "";
    const rev =
      preview.reversible === false
        ? "\nОткат: недоступен"
        : preview.reversible === "conditional"
          ? "\nОткат: условный"
          : "\nОткат: доступен после выполнения";
    return `${preview.title || action}\n${entityLabel}\n\nИзменения:\n${lines.join("\n")}${risk}${rev}\n\nПодтвердить выполнение?`;
  }

  if (assistantText) {
    return assistantText;
  }

  const paramsPreview = JSON.stringify(params, null, 2);
  if (category === "dangerous") {
    return `Я собираюсь выполнить опасное действие «${action}».\n\nПараметры:\n${paramsPreview}\n\nПодтвердить?`;
  }

  return `Я собираюсь выполнить действие «${action}».\n\nПараметры:\n${paramsPreview}\n\nПодтвердить?`;
}

function formatPreviewValue(value) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function finalizeTurn({
  reply,
  toolCalls,
  pendingConfirmation,
  sessionId,
  chatId,
  messageId = null,
  persist = true,
  messageType = "text",
  metadata = null,
}) {
  const formatted = formatBusinessText(reply);
  let savedId = messageId;

  if (persist && chatId && formatted) {
    try {
      const chat = getChatById(chatId);
      const type =
        pendingConfirmation != null
          ? "confirmation_preview"
          : messageType;
      const saved = addMessage(chatId, {
        role: "assistant",
        content: formatted,
        messageType: type,
        metadata: {
          ...(metadata || {}),
          ...(pendingConfirmation
            ? { confirmationId: pendingConfirmation.confirmationId }
            : {}),
        },
        chatMeta: {
          title: chat?.title,
          projectName: chat?.projectName,
          crmEntityType: chat?.crmEntityType,
          crmEntityId: chat?.crmEntityId,
        },
      });
      savedId = saved.id;
    } catch (error) {
      console.warn("[Chat] failed to persist assistant message:", error.message);
    }
  }

  return {
    success: true,
    chatId,
    messageId: savedId,
    answer: formatted,
    reply: formatted,
    confirmation: pendingConfirmation,
    toolCalls,
    resultCards: buildResultCards(toolCalls),
    pendingConfirmation,
    sessionId: sessionId || chatId,
  };
}

async function executeBitrixAction(action, params, { confirmed = false, sessionId = "default", confirmationId = null, confirmationPhrase = null, user = null } = {}) {
  if (confirmed && confirmationId) {
    return commitAction(confirmationId, {
      source: "chat",
      sessionId,
      confirmationPhrase,
      user,
    });
  }

  if (confirmed && !confirmationId) {
    // Старое confirm:true без plan — недостаточно
    return {
      success: false,
      error: {
        code: "CONFIRMATION_ID_REQUIRED",
        message: "Для выполнения изменения требуется confirmationId сохранённого operation plan.",
      },
    };
  }

  const result = await executeAction(action, params, {
    source: "chat",
    sessionId,
    user,
  });

  if (result?.success === false) {
    const err = new Error(result.error?.message || "Action failed");
    err.code = result.error?.code;
    err.details = result.error?.details;
    err.safetyResult = result;
    throw err;
  }

  return result.result !== undefined ? result.result : result;
}

function formatToolResult(result) {
  const sanitized = sanitizeLlmPayload(result, inferSanitizePurpose(result));
  if (typeof sanitized === "string") {
    return sanitized;
  }

  try {
    return JSON.stringify(sanitized, null, 2);
  } catch {
    return String(sanitized);
  }
}

function inferSanitizePurpose(result) {
  if (result?.verification != null || result?.operationId) return "operation_result";
  if (result?.truncated != null || result?.groups || result?.managers) return "analytics";
  if (result?.ID || result?.id || result?.TITLE || result?.title) return "entity_summary";
  return "generic";
}

function formatToolError(error) {
  return JSON.stringify({
    ok: false,
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
  });
}

/** Safety layer возвращает ошибку объектом, а не исключением. */
function safetyFailure(result) {
  if (!result || typeof result !== "object") return null;
  if (result.success === false) return result.error || { message: "Действие не выполнено." };
  if (result.status && ["failed", "cancelled", "expired"].includes(result.status)) {
    return result.error || { message: `Операция завершилась со статусом ${result.status}.` };
  }
  return null;
}

function describeOperationFailure(error) {
  const message = error?.message || "Действие не выполнено.";
  const code = error?.code ? ` (код ${error.code})` : "";
  return `Действие не выполнено${code}: ${message} Изменения в Bitrix24 не внесены.`;
}

async function runClaudeTurn(session, { toolCallsLog = [], systemPrompt = null } = {}) {
  const prompt = systemPrompt || session.systemPrompt || null;
  if (!prompt) {
    throw new Error("systemPrompt is required for Claude turn");
  }
  const tools = [getBitrixActionTool()];

  session.messages = trimHistory(session.messages);
  let messages = [...session.messages];
  let iterations = 0;

  while (iterations < MAX_TOOL_ITERATIONS) {
    iterations += 1;

    const response = await callClaudeWithTools({
      systemPrompt: prompt,
      messages,
      tools,
      toolChoice: { type: "auto" },
    });

    const toolUses = extractToolUseBlocks(response);
    const assistantText = extractTextFromClaudeResponse(response);
    const assistantContent = getAssistantContent(response);

    if (toolUses.length === 0) {
      // Keep tool pairs only in runtime memory for this request path;
      // durable history stores plain text via finalizeTurn.
      session.messages = trimHistory([
        ...session.messages,
        { role: "assistant", content: assistantText || "Готово." },
      ]);

      return finalizeTurn({
        reply: assistantText || "Готово.",
        toolCalls: toolCallsLog,
        pendingConfirmation: null,
        sessionId: session.sessionId,
        chatId: session.chatId,
        persist: true,
      });
    }

    const toolResults = [];

    for (let i = 0; i < toolUses.length; i += 1) {
      const toolUse = toolUses[i];

      if (toolUse.name !== "run_bitrix_action") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: formatToolError(new Error(`Unknown tool: ${toolUse.name}`)),
          is_error: true,
        });
        continue;
      }

      const { action, params } = normalizeActionInput(toolUse.input);

      if (action === "__discover_actions") {
        const expanded = expandDiscoveryCatalog(
          params?.query || session.lastUserMessage || "",
          session.selectedActionNames || []
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: formatToolResult({
            success: true,
            discovery: true,
            actions: expanded.actions,
            hint: "Используй action из расширенного списка.",
          }),
        });
        continue;
      }

      const handler = getActionHandler(action);
      const category = getActionSafetyCategory(action);

      if (!handler || category === "unknown") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: formatToolError(new Error(`Unknown or unsupported action: ${action}`)),
          is_error: true,
        });
        continue;
      }

      if (isActionBlocked(action) || category === "blocked") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: formatToolResult({
            success: false,
            error: {
              code: "ACTION_BLOCKED_BY_SAFETY_POLICY",
              message: "Действие заблокировано политикой безопасности.",
              details: { action },
            },
          }),
          is_error: true,
        });
        continue;
      }

      if (requiresConfirmation(action)) {
        let prepared;
        try {
          prepared = await prepareAction(action, params, {
            source: "chat",
            sessionId: session.sessionId,
            chatId: session.chatId,
            messageId: session.lastUserMessageId || null,
            projectId: session.projectId || null,
            user: session.user || null,
          });
        } catch (error) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: formatToolError(error),
            is_error: true,
          });
          continue;
        }

        if (!prepared?.success || prepared.status !== "confirmation_required") {
          const userMessage =
            prepared?.error?.code === "PREPARE_FAILED" && prepared?.error?.details?.code
              ? prepared.error.message
              : null;
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: formatToolResult(
              userMessage
                ? { success: false, error: { ...prepared.error, message: userMessage } }
                : prepared
            ),
            is_error: prepared?.success === false,
          });
          continue;
        }

        const confirmationId = prepared.confirmationId;
        const pending = {
          confirmationId,
          action,
          params,
          toolUseId: toolUse.id,
          assistantContent,
          category,
          preparedResults: [...toolResults],
          skippedToolUseIds: toolUses.slice(i + 1).map((item) => item.id),
          preview: prepared.preview,
          expiresAt: prepared.expiresAt,
        };

        session.pendingConfirmations.set(confirmationId, pending);

        const reply = buildConfirmationMessage({
          action,
          params,
          category,
          assistantText,
          preview: prepared.preview,
        });

        return finalizeTurn({
          reply,
          toolCalls: toolCallsLog,
          pendingConfirmation: {
            confirmationId,
            action,
            params,
            preview: prepared.preview,
            expiresAt: prepared.expiresAt,
            operation: prepared.operation,
          },
          sessionId: session.sessionId,
          chatId: session.chatId,
          persist: true,
          messageType: "confirmation_preview",
        });
      }

      try {
        const result = await executeBitrixAction(action, params, { sessionId: session.sessionId });
        toolCallsLog.push({ action, params, result });

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: formatToolResult(result),
        });
      } catch (error) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: formatToolError(error),
          is_error: true,
        });
      }
    }

    session.messages = trimHistory([
      ...session.messages,
      { role: "assistant", content: assistantContent },
      { role: "user", content: toolResults },
    ]);
    messages = [...session.messages];
  }

  return finalizeTurn({
    reply: "Слишком много шагов за один запрос. Уточните задачу или разбейте её на части.",
    toolCalls: toolCallsLog,
    pendingConfirmation: null,
    sessionId: session.sessionId,
    chatId: session.chatId,
  });
}

function buildSkippedToolResults(skippedToolUseIds = []) {
  return skippedToolUseIds.map((id) => ({
    type: "tool_result",
    tool_use_id: id,
    content: "Пропущено: ожидается подтверждение другого действия.",
    is_error: true,
  }));
}

function appendPendingToolTurn(session, pending, primaryResult) {
  const toolResults = [
    ...(pending.preparedResults || []),
    primaryResult,
    ...buildSkippedToolResults(pending.skippedToolUseIds),
  ];

  session.messages = trimHistory([
    ...session.messages,
    { role: "assistant", content: pending.assistantContent },
    { role: "user", content: toolResults },
  ]);
}

/**
 * Добавляет user-сообщение с сохранением чередования ролей user/assistant.
 */
function appendUserText(session, text) {
  const messages = [...session.messages];
  const last = messages[messages.length - 1];

  if (last?.role === "user" && typeof last.content === "string") {
    messages[messages.length - 1] = {
      role: "user",
      content: `${last.content}\n\n${text}`,
    };
    session.messages = trimHistory(messages);
    return;
  }

  if (last?.role === "user") {
    messages.push({
      role: "assistant",
      content: "Хорошо, продолжаем.",
    });
  }

  messages.push({ role: "user", content: text });
  session.messages = trimHistory(messages);
}

export async function handleChatMessage({
  message,
  sessionId = "default",
  chatId = null,
  projectId = null,
  user = null,
}) {
  if (!message || typeof message !== "string" || !message.trim()) {
    throw new Error('Request body must contain a non-empty "message" field');
  }

  const userMessage = message.trim();
  const chat = ensureChatForSession({ sessionId, chatId, projectId });
  const session = getRuntimeSession(chat.id);
  session.sessionId = sessionId || chat.sessionId || chat.id;
  session.user = user || null;

  session.pendingConfirmations.clear();
  closeOpenToolUses(session);

  const savedUser = addMessage(chat.id, {
    role: "user",
    content: userMessage,
    messageType: "text",
    chatMeta: {
      title: chat.title,
      projectName: chat.projectName,
      crmEntityType: chat.crmEntityType,
      crmEntityId: chat.crmEntityId,
    },
  });

  session.lastUserMessage = userMessage;
  session.lastUserMessageId = savedUser.id;
  session.projectId = chat.projectId || projectId || null;

  if (!chat.title || chat.title === "Новый диалог") {
    updateChat(chat.id, { title: autoTitleFromMessage(userMessage) });
  }

  const context = await buildConversationContext({
    chatId: chat.id,
    projectId: chat.projectId || projectId,
    userMessage,
  });

  session.systemPrompt = context.systemPrompt;
  session.selectedActionNames = (context.selectedActions || []).map((a) => a.name);
  session.contextDiagnostics = context.diagnostics;
  const history = [...context.historyMessages];
  const last = history[history.length - 1];
  if (last?.role === "user" && last.content === userMessage) {
    history.pop();
  }
  session.messages = trimHistory([
    ...history,
    { role: "user", content: userMessage },
  ]);

  const result = await runClaudeTurn(session, {
    toolCallsLog: [],
    systemPrompt: context.systemPrompt,
  });

  return {
    ...result,
    chatId: chat.id,
    userMessageId: savedUser.id,
    warnings: context.summaryWarning ? [context.summaryWarning] : undefined,
  };
}

export async function handleChatConfirmation({
  sessionId = "default",
  chatId = null,
  confirmationId,
  confirm,
  confirmationPhrase = null,
  user = null,
}) {
  if (!confirmationId) {
    throw new Error('Request body must contain "confirmationId"');
  }

  const operation = getOperationByConfirmationId(confirmationId);
  const linkedChatId = chatId || operation?.chatId || null;
  const chat = ensureChatForSession({
    sessionId: sessionId || operation?.sessionId || "default",
    chatId: linkedChatId,
    projectId: operation?.projectId || null,
  });
  const session = getRuntimeSession(chat.id);
  session.sessionId = sessionId || chat.sessionId || chat.id;

  const pending = session.pendingConfirmations.get(confirmationId);
  const recoveredWithoutToolTurn = !pending;

  if (pending) {
    session.pendingConfirmations.delete(confirmationId);
  } else if (!operation || operation.status !== "pending_confirmation") {
    throw new Error("Confirmation not found or already processed");
  }

  if (!confirm) {
    await cancelAction(confirmationId, { source: "chat", sessionId: session.sessionId });

    if (pending) {
      appendPendingToolTurn(session, pending, {
        type: "tool_result",
        tool_use_id: pending.toolUseId,
        content: "Действие отменено пользователем.",
        is_error: true,
      });

      const context = await buildConversationContext({
        chatId: chat.id,
        projectId: chat.projectId,
        userMessage: "Отменяю действие.",
      });
      session.systemPrompt = context.systemPrompt;

      const response = await callClaudeWithTools({
        systemPrompt: session.systemPrompt,
        messages: session.messages,
        tools: [getBitrixActionTool()],
        toolChoice: { type: "auto" },
      });

      const reply =
        extractTextFromClaudeResponse(response) || "Ок, действие отменено.";

      session.messages = trimHistory([
        ...session.messages,
        { role: "assistant", content: reply },
      ]);

      return finalizeTurn({
        reply,
        toolCalls: [],
        pendingConfirmation: null,
        sessionId: session.sessionId,
        chatId: chat.id,
        persist: true,
      });
    }

    const reply = "Действие отменено пользователем.";
    return finalizeTurn({
      reply,
      toolCalls: [],
      pendingConfirmation: null,
      sessionId: session.sessionId,
      chatId: chat.id,
      persist: true,
    });
  }

  // Confirm path
  let result;
  const action = pending?.action || operation?.action;
  const params = pending?.params || {};
  const toolCallsLog = [];

  try {
    result = await executeBitrixAction(action, params, {
      confirmed: true,
      sessionId: session.sessionId,
      confirmationId,
      confirmationPhrase,
      user,
    });
    const failure = safetyFailure(result);
    if (failure) {
      const error = new Error(failure.message || "Действие не выполнено.");
      error.code = failure.code;
      error.details = failure.details;
      throw error;
    }
    toolCallsLog.push({ action, params, result });
  } catch (error) {
    // Результат подтверждения не отдаём на пересказ модели: о неудаче
    // сообщаем ровно то, что вернул safety layer.
    if (pending) {
      appendPendingToolTurn(session, pending, {
        type: "tool_result",
        tool_use_id: pending.toolUseId,
        content: formatToolError(error),
        is_error: true,
      });
    }

    return finalizeTurn({
      reply: describeOperationFailure(error),
      toolCalls: toolCallsLog,
      pendingConfirmation: null,
      sessionId: session.sessionId,
      chatId: chat.id,
      persist: true,
      messageType: "error",
      metadata: {
        confirmationId,
        operationId: operation?.id || null,
        errorCode: error.code || null,
      },
    });
  }

  if (recoveredWithoutToolTurn) {
    const reply =
      "Действие выполнено после восстановления сервера. Результат сохранён в истории операций.";
    addMessage(chat.id, {
      role: "system_note",
      content: reply,
      messageType: "operation_result",
      metadata: {
        confirmationId,
        operationId: result?.operationId || operation?.id || null,
        recoveredAfterRestart: true,
      },
    });
    return finalizeTurn({
      reply,
      toolCalls: toolCallsLog,
      pendingConfirmation: null,
      sessionId: session.sessionId,
      chatId: chat.id,
      persist: true,
      messageType: "operation_result",
    });
  }

  appendPendingToolTurn(session, pending, {
    type: "tool_result",
    tool_use_id: pending.toolUseId,
    content: formatToolResult(result),
  });

  const context = await buildConversationContext({
    chatId: chat.id,
    projectId: chat.projectId,
    userMessage: "Подтверждаю действие.",
  });

  const turn = await runClaudeTurn(session, {
    toolCallsLog,
    systemPrompt: context.systemPrompt,
  });

  return turn;
}

/**
 * Close runtime context and create a new durable chat.
 */
export async function handleChatReset({ sessionId = "default", projectId = null } = {}) {
  const existing = getChatBySessionId(sessionId);
  if (existing) {
    clearRuntimeSession(existing.id);
  }

  const chat = createChat({
    sessionId: `session-${Date.now()}`,
    projectId,
    title: "Новый диалог",
  });

  return {
    success: true,
    chatId: chat.id,
    sessionId: chat.sessionId,
    title: chat.title,
  };
}
