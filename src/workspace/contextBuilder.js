import { compileSystemPrompt } from "../connections/prompts/promptCompiler.js";
import { getWorkspaceConfig, WorkspaceError } from "./config.js";
import { getProjectById } from "../database/repositories/projectsRepository.js";
import { listProjectFiles } from "../database/repositories/projectFilesRepository.js";
import { getChatById } from "../database/repositories/chatsRepository.js";
import { getRecentPlainMessages, getLatestSummary } from "../database/repositories/messagesRepository.js";
import { sanitizeLlmPayload } from "../llm/sanitize.js";
import { crm_context_get } from "../clientContext/crmContextGet.js";
import { ensureChatSummary } from "./summaryService.js";
import { resolveChatModel } from "../connections/ai/modelResolver.js";

export function shouldLoadCrmContext(userMessage) {
  const hay = String(userMessage || "").toLowerCase();
  return /что с клиент|что происходил|последн(ее|яя) общен|что написать|следующ(ий|ие) шаг|подготовь протокол|проанализируй сделк|контекст|картк|кто ответствен|просроч|договорён|договорен/i.test(
    hay
  );
}

function intEnv(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function keywordScore(text, query) {
  const q = String(query || "")
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (!q.length) return 0;
  const hay = String(text || "").toLowerCase();
  return q.reduce((score, word) => score + (hay.includes(word) ? 1 : 0), 0);
}

function selectProjectFiles(files, userMessage, maxChars) {
  if (!files.length) return { texts: [], chars: 0, count: 0 };

  const scored = files
    .map((f) => ({
      file: f,
      score: keywordScore(`${f.filename}\n${f.contentText}`, userMessage),
    }))
    .sort((a, b) => b.score - a.score || a.file.filename.localeCompare(b.file.filename));

  const selected = [];
  let chars = 0;
  for (const item of scored) {
    const chunk = `# ${item.file.filename}\n${item.file.contentText}`.trim();
    if (chars + chunk.length > maxChars) {
      if (!selected.length && chunk.length > maxChars) {
        selected.push(chunk.slice(0, maxChars));
        chars = maxChars;
      }
      break;
    }
    selected.push(chunk);
    chars += chunk.length;
  }

  if (!selected.length) {
    for (const f of [...files].sort((a, b) => a.filename.localeCompare(b.filename))) {
      const chunk = `# ${f.filename}\n${f.contentText}`.trim();
      if (chars + chunk.length > maxChars) break;
      selected.push(chunk);
      chars += chunk.length;
    }
  }

  return { texts: selected, chars, count: selected.length };
}

/**
 * Build Claude-facing context for a chat turn.
 */
export async function buildConversationContext({
  chatId,
  projectId,
  userMessage,
  expandDiscovery = false,
  userId = null,
}) {
  const cfg = getWorkspaceConfig();
  const systemMax = intEnv("SYSTEM_PROMPT_MAX_CHARS", 60000);
  const catalogMax = intEnv("ACTION_CATALOG_MAX_CHARS", 20000);

  const chat = chatId ? getChatById(chatId) : null;
  const resolvedProjectId = projectId || chat?.projectId || null;
  const project = resolvedProjectId ? getProjectById(resolvedProjectId) : null;

  let fileBudget = cfg.projectContextMaxChars;
  let files = project ? listProjectFiles(project.id) : [];
  let fileSelection = selectProjectFiles(files, userMessage, fileBudget);

  const { summary, warning: summaryWarning } = chatId
    ? await ensureChatSummary(chatId)
    : { summary: null, warning: null };

  const latestSummary = summary || (chatId ? getLatestSummary(chatId) : null);
  let historyMessages = normalizeAlternation(
    (chatId ? getRecentPlainMessages(chatId, cfg.recentMessagesLimit) : []).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content,
    }))
  );

  const crmBind =
    chat?.crmEntityType && chat?.crmEntityId
      ? `Чат привязан к CRM: ${chat.crmEntityType} #${chat.crmEntityId}. Запрашивай карточку только при необходимости.`
      : "";

  let crmContextBlock = "";
  if (chat?.crmEntityType && chat?.crmEntityId && shouldLoadCrmContext(userMessage)) {
    try {
      console.log(
        `[Workspace] loading CRM context reason=intent entity=${chat.crmEntityType}:${chat.crmEntityId}`
      );
      const ctx = await crm_context_get({
        entityType: chat.crmEntityType,
        entityId: chat.crmEntityId,
        mode: "compact",
        include: ["fields", "relations", "activities", "timeline"],
      });
      const safe = sanitizeLlmPayload(
        {
          entity: ctx.entity,
          state: ctx.state,
          relations: ctx.relations,
          timeline: (ctx.timeline || []).slice(0, 12),
          warnings: ctx.warnings,
        },
        "entity_summary"
      );
      crmContextBlock = `Компактный CRM-контекст:\n${JSON.stringify(safe)}`;
    } catch (error) {
      console.warn("[Workspace] CRM context load failed:", error.message);
    }
  }

  const compiled = compileSystemPrompt({
    userMessage,
    chat,
    project,
    userId,
    expandDiscovery,
    vars: {
      crmContextBlock: [crmBind, crmContextBlock].filter(Boolean).join("\n\n"),
      project_name: project?.name || "",
      chat_title: chat?.title || "",
      crm_entity_type: chat?.crmEntityType || "",
    },
  });

  let mandatory = compiled.systemPrompt;
  if (mandatory.length > systemMax) {
    throw new WorkspaceError(
      "SYSTEM_CONTEXT_TOO_LARGE",
      "Обязательный системный контекст превышает допустимый размер.",
      { systemPromptChars: mandatory.length, budget: systemMax }
    );
  }

  let optionalFiles = fileSelection.texts.length
    ? `Файлы проекта (фрагменты):\n${fileSelection.texts.join("\n\n")}`
    : "";
  let optionalSummary = latestSummary
    ? `Сводка более ранней части диалога:\n${latestSummary.summaryText}`
    : "";

  let systemPrompt = [mandatory, optionalFiles, optionalSummary].filter(Boolean).join("\n\n");

  while (systemPrompt.length > systemMax && optionalFiles) {
    fileBudget = Math.floor(fileBudget * 0.6);
    fileSelection = selectProjectFiles(files, userMessage, fileBudget);
    optionalFiles = fileSelection.texts.length
      ? `Файлы проекта (фрагменты):\n${fileSelection.texts.join("\n\n")}`
      : "";
    systemPrompt = [mandatory, optionalFiles, optionalSummary].filter(Boolean).join("\n\n");
  }

  if (systemPrompt.length > systemMax && optionalSummary) {
    optionalSummary = "";
    systemPrompt = [mandatory, optionalFiles].filter(Boolean).join("\n\n");
  }

  let totalChars =
    systemPrompt.length +
    historyMessages.reduce((s, m) => s + String(m.content).length, 0) +
    String(userMessage || "").length;

  while (totalChars > cfg.contextMaxChars && historyMessages.length > 2) {
    historyMessages = historyMessages.slice(2);
    totalChars =
      systemPrompt.length +
      historyMessages.reduce((s, m) => s + String(m.content).length, 0) +
      String(userMessage || "").length;
  }

  const modelResolution = resolveChatModel({ chat, project, userId, requireTools: true });

  const diagnostics = {
    systemPromptChars: systemPrompt.length,
    actionCatalogChars: compiled.diagnostics.actionCatalogChars,
    profileChars: (compiled.layers.promptProfile || "").length,
    projectChars: (compiled.layers.project || "").length,
    filesChars: fileSelection.chars,
    historyChars: historyMessages.reduce((s, m) => s + String(m.content).length, 0),
    filesIncluded: fileSelection.count,
    historyCount: historyMessages.length,
    totalChars,
    budget: cfg.contextMaxChars,
    systemBudget: systemMax,
    catalogBudget: catalogMax,
    dynamicActionCatalog: true,
    fullCatalogAvoided: compiled.diagnostics.fullCatalogAvoided,
    actionCount: compiled.diagnostics.actionCount,
    promptProfileId: compiled.profile?.id || null,
    modelSource: modelResolution.source,
    apiModelName: modelResolution.apiModelName,
  };

  console.log(
    `[Workspace] context chat=${chatId || "—"} actions=${diagnostics.actionCount} files=${fileSelection.count} totalChars=${totalChars}`
  );

  return {
    systemPrompt,
    historyMessages,
    chat,
    project,
    profile: compiled.profile,
    summary: latestSummary,
    summaryWarning,
    diagnostics,
    selectedActions: compiled.selectedActions,
    modelResolution,
  };
}

function normalizeAlternation(messages) {
  const out = [];
  for (const msg of messages) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    const content = String(msg.content || "").trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.content = `${last.content}\n\n${content}`;
    } else {
      out.push({ role, content });
    }
  }
  while (out.length && out[0].role !== "user") {
    out.shift();
  }
  return out;
}
