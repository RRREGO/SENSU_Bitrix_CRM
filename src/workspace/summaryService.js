import { askClaude } from "../claudeClient.js";
import { getWorkspaceConfig, WorkspaceError } from "./config.js";
import {
  countMessages,
  createChatSummary,
  getLatestSummary,
  getMessagesBefore,
  getRecentPlainMessages,
} from "../database/repositories/messagesRepository.js";

/**
 * Ensure summary exists when history exceeds threshold.
 * Failures never break chat.
 */
export async function ensureChatSummary(chatId) {
  const cfg = getWorkspaceConfig();
  if (!cfg.autoSummaryEnabled) {
    return { summary: getLatestSummary(chatId), warning: null };
  }

  const total = countMessages(chatId);
  if (total < cfg.autoSummaryThreshold) {
    return { summary: getLatestSummary(chatId), warning: null };
  }

  const existing = getLatestSummary(chatId);
  const recent = getRecentPlainMessages(chatId, cfg.recentMessagesLimit);
  const oldestRecentId = recent[0]?.id;
  if (!oldestRecentId) {
    return { summary: existing, warning: null };
  }

  if (existing && existing.throughMessageId >= oldestRecentId - 1) {
    return { summary: existing, warning: null };
  }

  const older = getMessagesBefore(chatId, oldestRecentId, 120);
  if (older.length < 8) {
    return { summary: existing, warning: null };
  }

  const transcript = older
    .map((m) => `${m.role === "user" ? "Пользователь" : "Ассистент"}: ${m.content}`)
    .join("\n")
    .slice(0, 20000);

  try {
    const summaryText = await askClaude({
      systemPrompt:
        "Составь краткую деловую сводку диалога на русском. Включи факты, решения, CRM-сущности, незакрытые вопросы и предпочтения. Без JSON, секретов и технических tool-блоков.",
      userPrompt: transcript,
    });

    const summary = createChatSummary({
      chatId,
      summaryText: String(summaryText || "").trim().slice(0, 8000),
      throughMessageId: older[older.length - 1].id,
    });

    return { summary, warning: null };
  } catch (error) {
    const warning = {
      code: "CHAT_SUMMARY_FAILED",
      message: "Не удалось создать сводку диалога. Используется обрезка последних сообщений.",
      details: { reason: error.message },
    };
    console.warn("[Workspace]", warning.message, error.message);
    return { summary: existing, warning };
  }
}
