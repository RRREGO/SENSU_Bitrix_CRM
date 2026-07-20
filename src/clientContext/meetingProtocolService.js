/**
 * Генерация протокола встречи (эвристика + опциональный Claude).
 * Факты / выводы / рекомендации разделены структурно.
 */

import { askClaude } from "../claudeClient.js";
import { getActiveProfile } from "../database/repositories/profilesRepository.js";
import { getProjectById } from "../database/repositories/projectsRepository.js";
import { getMeetingTranscript } from "../database/repositories/meetingTranscriptsRepository.js";
import {
  ensureDefaultProtocolTemplate,
  getProtocolTemplate,
  createMeetingProtocol,
  listMeetingProtocols,
} from "../database/repositories/meetingProtocolsRepository.js";
import { crm_context_get } from "./crmContextGet.js";
import { ClientContextError, getClientContextConfig } from "./config.js";
import { sanitizeLlmPayload } from "../llm/sanitize.js";

function section(fact = "", inference = "", recommendation = "") {
  return {
    fact: fact || null,
    inference: inference || null,
    recommendation: recommendation || null,
  };
}

function extractHeuristicProtocol(transcriptText, context, template) {
  const lines = String(transcriptText || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const agreements = lines.filter((l) => /договор|соглас|решил|берём|берем|сделаем/i.test(l)).slice(0, 8);
  const questions = lines.filter((l) => /\?/.test(l) || /уточн/i.test(l)).slice(0, 8);
  const next = lines.filter((l) => /следующ|отправ|подготов|срок|до \d/i.test(l)).slice(0, 8);

  return {
    date: {
      fact: context?.entity?.updatedAt || null,
      inference: null,
      recommendation: null,
    },
    participants: section(null, "Участники не извлечены автоматически — укажите вручную.", null),
    client: section(context?.relations?.contact?.name || context?.entity?.title || null),
    company: section(context?.relations?.company?.name || null),
    goal: section(null, "Цель встречи не выделена явно в транскрипте.", "Уточнить цель у менеджера."),
    context: section(
      context?.entity?.stage
        ? `Текущая стадия CRM: ${context.entity.stage.name}`
        : null
    ),
    topics: {
      fact: lines.slice(0, 12).map((t) => ({ text: t.slice(0, 200), kind: "fact" })),
      inference: null,
      recommendation: null,
    },
    needs: section(null, agreements.length ? null : "Потребности клиента не сформулированы явно."),
    constraints: section(null, "Ограничения не выделены автоматически."),
    agreements: {
      fact: agreements.map((t) => ({ text: t, kind: "fact" })),
      inference: null,
      recommendation: null,
    },
    nextSteps: {
      fact: next.map((t) => ({ text: t, kind: "fact" })),
      inference: null,
      recommendation: next.length
        ? null
        : "Сформулировать следующие шаги после проверки с менеджером.",
    },
    owners: section(context?.entity?.responsible?.name || null),
    deadlines: section(null, "Сроки не извлечены гарантированно — не выдумывать."),
    materials: section(null, null, "Подготовить материалы только по явным договорённостям."),
    risks: {
      fact: [],
      inference: context?.state?.overdueActivities
        ? "На карточке есть просроченные дела."
        : null,
      recommendation: null,
    },
    forecast: section(null, "Прогноз не строится без достаточных данных.", null),
    recommendedStage: section(
      context?.entity?.stage?.name || null,
      null,
      "Менять стадию только после подтверждения менеджером через Safety Layer."
    ),
    openQuestions: {
      fact: questions.map((t) => ({ text: t, kind: "fact" })),
      inference: null,
      recommendation: null,
    },
    templateId: template?.id || null,
    source: {
      transcript: true,
      bitrix: Boolean(context?.entity),
      generatedAt: new Date().toISOString(),
    },
  };
}

function protocolToText(protocol) {
  const blocks = [];
  const push = (title, sec) => {
    if (!sec) return;
    blocks.push(`## ${title}`);
    if (sec.fact) {
      if (Array.isArray(sec.fact)) {
        for (const item of sec.fact) blocks.push(`- Факт: ${item.text || item}`);
      } else blocks.push(`Факт: ${sec.fact}`);
    }
    if (sec.inference) blocks.push(`Вывод: ${sec.inference}`);
    if (sec.recommendation) blocks.push(`Рекомендация: ${sec.recommendation}`);
    blocks.push("");
  };
  push("Дата", protocol.date);
  push("Клиент", protocol.client);
  push("Компания", protocol.company);
  push("Цель", protocol.goal);
  push("Контекст CRM", protocol.context);
  push("Договорённости", protocol.agreements);
  push("Следующие шаги", protocol.nextSteps);
  push("Ответственные", protocol.owners);
  push("Риски", protocol.risks);
  push("Открытые вопросы", protocol.openQuestions);
  return blocks.join("\n").trim();
}

/**
 * meeting_protocol_generate
 */
export async function meeting_protocol_generate(params = {}) {
  const transcript = getMeetingTranscript(params.transcriptId);
  if (!transcript) {
    throw new ClientContextError("TRANSCRIPT_NOT_FOUND", "Транскрипт не найден.");
  }

  const entityType = params.entityType || transcript.crmEntityType;
  const entityId = params.entityId || transcript.crmEntityId;

  let context = null;
  if (entityType && entityId) {
    try {
      context = await crm_context_get({
        entityType,
        entityId,
        mode: "compact",
        include: ["fields", "relations", "activities", "timeline"],
      });
    } catch {
      context = null;
    }
  }

  const template =
    (params.templateId && getProtocolTemplate(params.templateId)) ||
    ensureDefaultProtocolTemplate();

  const profile = getActiveProfile();
  const project = params.projectId ? getProjectById(params.projectId) : null;
  const previous = entityType && entityId
    ? listMeetingProtocols({ entityType, entityId, limit: 1 })[0]
    : null;

  let protocol = extractHeuristicProtocol(transcript.contentText, context, template);

  // Optional Claude enrichment — soft fail
  try {
    const cfg = getClientContextConfig();
    const safeContext = sanitizeLlmPayload(
      {
        title: context?.entity?.title,
        stage: context?.entity?.stage,
        responsible: context?.entity?.responsible?.name,
        nextActivity: context?.state?.nextActivity,
      },
      "meeting_protocol"
    );
    const userPrompt = [
      `Шаблон: ${template.name}`,
      template.instruction,
      profile?.responseRules ? `Правила профиля: ${profile.responseRules}` : "",
      project?.instruction ? `Инструкция проекта: ${project.instruction}` : "",
      `CRM: ${JSON.stringify(safeContext)}`,
      previous ? `Прошлый протокол (кратко): ${String(previous.protocolText || "").slice(0, 1500)}` : "",
      `Транскрипт:\n${transcript.contentText.slice(0, Math.min(cfg.transcriptMaxChars, 60000))}`,
      "Верни краткий JSON с ключами agreements (string[]), nextSteps (string[]), openQuestions (string[]), risks (string[]). Только подтверждённое транскриптом.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const answer = await askClaude({
      systemPrompt:
        "Ты помощник по протоколам встреч. Не выдумывай факты. Ответ — только JSON.",
      userPrompt,
    });
    const match = String(answer).match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      if (Array.isArray(parsed.agreements) && parsed.agreements.length) {
        protocol.agreements.fact = parsed.agreements.map((t) => ({ text: t, kind: "fact" }));
      }
      if (Array.isArray(parsed.nextSteps) && parsed.nextSteps.length) {
        protocol.nextSteps.fact = parsed.nextSteps.map((t) => ({ text: t, kind: "fact" }));
      }
      if (Array.isArray(parsed.openQuestions)) {
        protocol.openQuestions.fact = parsed.openQuestions.map((t) => ({ text: t, kind: "fact" }));
      }
      if (Array.isArray(parsed.risks) && parsed.risks.length) {
        protocol.risks.inference = parsed.risks.join("; ");
      }
    }
  } catch (error) {
    protocol.generationWarning = {
      code: "MEETING_PROTOCOL_GENERATION_FAILED",
      message: "LLM-уточнение недоступно; использована эвристика по транскрипту.",
      details: { reason: error.message },
    };
  }

  const protocolText = protocolToText(protocol);
  const saved = createMeetingProtocol({
    transcriptId: transcript.id,
    chatId: params.chatId || transcript.chatId,
    projectId: params.projectId || transcript.projectId,
    templateId: template.id,
    crmEntityType: entityType,
    crmEntityId: entityId,
    title: params.title || transcript.title || "Протокол встречи",
    protocol,
    protocolText,
    status: "draft",
  });

  return {
    success: true,
    protocolId: saved.id,
    protocol: saved,
    recommendedActions: buildRecommendedActionsFromProtocol(saved, context),
  };
}

export function buildRecommendedActionsFromProtocol(protocolRow, context) {
  const actions = [];
  const responsibleId = context?.entity?.responsible?.id || null;
  const steps = protocolRow.protocol?.nextSteps?.fact || [];
  for (const step of steps.slice(0, 5)) {
    actions.push({
      type: "crm_activity",
      title: String(step.text || step).slice(0, 120),
      deadline: null,
      responsibleId,
      reason: "Договорённость / следующий шаг из протокола",
      source: { type: "meeting_protocol", id: protocolRow.id },
    });
  }
  if (!actions.length) {
    actions.push({
      type: "crm_activity",
      title: "Follow-up после встречи",
      deadline: null,
      responsibleId,
      reason: "Протокол не содержит явных шагов — требуется проверка менеджером",
      source: { type: "meeting_protocol", id: protocolRow.id },
    });
  }
  actions.push({
    type: "timeline_comment",
    title: "Сохранить протокол в CRM",
    reason: "Зафиксировать протокол комментарием",
    source: { type: "meeting_protocol", id: protocolRow.id },
  });
  return actions;
}
