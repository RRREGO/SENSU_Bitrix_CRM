/**
 * Управленческая сводка по клиентскому контексту (факты + рекомендации отдельно).
 */

import { crm_context_get } from "./crmContextGet.js";
import { ClientContextError } from "./config.js";

/**
 * @param {{ entityType?: string, entityId?: number, context?: object }} params
 */
export async function crm_context_summary(params = {}) {
  const context =
    params.context ||
    (await crm_context_get({
      entityType: params.entityType,
      entityId: params.entityId,
      include: params.include || ["fields", "relations", "activities", "tasks", "timeline"],
      mode: params.mode || "standard",
    }));

  if (!context?.entity) {
    throw new ClientContextError("CRM_CONTEXT_ENTITY_NOT_FOUND", "Контекст CRM пуст.");
  }

  const facts = [];
  const agreements = [];
  const openQuestions = [];
  const overdueItems = [];
  const risks = [];
  const dataGaps = [];

  facts.push({
    text: `Сущность: ${context.entity.type} «${context.entity.title}»`,
    source: { type: "crm_entity", id: String(context.entity.id), url: context.entity.url },
  });

  if (context.entity.stage) {
    facts.push({
      text: `Стадия/статус: ${context.entity.stage.name}`,
      source: { type: "crm_field", id: "STAGE_ID", occurredAt: context.entity.updatedAt },
    });
  }

  if (context.entity.responsible?.name) {
    facts.push({
      text: `Ответственный: ${context.entity.responsible.name}`,
      source: { type: "crm_field", id: "ASSIGNED_BY_ID" },
    });
  }

  const last = context.timeline?.[0];
  const lastInteraction = last
    ? {
        text: `${last.title}: ${last.text || "—"}`,
        source: {
          type: last.source,
          id: String(last.id).split(":")[1] || last.id,
          occurredAt: last.occurredAt,
        },
      }
    : null;

  if (!lastInteraction) {
    dataGaps.push("Нет значимых событий во доступной истории (или источники недоступны).");
  }

  for (const ev of (context.timeline || []).slice(0, 30)) {
    if (/договор|согласован|решил|решили|отправ/i.test(`${ev.title} ${ev.text}`)) {
      agreements.push({
        text: ev.text || ev.title,
        source: {
          type: ev.source,
          id: String(ev.id),
          occurredAt: ev.occurredAt,
        },
      });
    }
    if (/\?|уточн|вопрос/i.test(ev.text || "")) {
      openQuestions.push({
        text: ev.text,
        source: { type: ev.source, id: String(ev.id), occurredAt: ev.occurredAt },
      });
    }
  }

  if (context.state?.overdueActivities > 0) {
    overdueItems.push({
      text: `Просроченных дел: ${context.state.overdueActivities}`,
      source: { type: "crm_activity", id: "aggregate" },
    });
    risks.push({
      text: "Есть просроченные CRM-дела.",
      source: { type: "derived", id: "overdue" },
    });
  }

  if (context.state?.openTasks > 0) {
    facts.push({
      text: `Открытых задач: ${context.state.openTasks}`,
      source: { type: "task", id: "aggregate" },
    });
  }

  for (const w of context.warnings || []) {
    dataGaps.push(w.message);
  }

  const recommendedNextSteps = [];
  if (context.state?.overdueActivities > 0) {
    recommendedNextSteps.push({
      action: "Закрыть или перенести просроченные дела",
      reason: "В карточке есть просроченные CRM-дела",
      basedOn: "overdueActivities",
    });
  }
  if (!context.state?.nextActivity) {
    recommendedNextSteps.push({
      action: "Назначить следующее CRM-дело",
      reason: "Не найдено незавершённого следующего дела",
      basedOn: "nextActivity",
    });
  }
  if (lastInteraction) {
    recommendedNextSteps.push({
      action: "Проверить, выполнен ли follow-up после последней коммуникации",
      reason: "Есть зафиксированное последнее взаимодействие",
      basedOn: lastInteraction.source,
    });
  }

  return {
    success: true,
    currentState: [
      context.entity.title,
      context.entity.stage ? `стадия «${context.entity.stage.name}»` : null,
      context.entity.responsible?.name ? `отв. ${context.entity.responsible.name}` : null,
    ]
      .filter(Boolean)
      .join(", "),
    lastInteraction,
    agreements,
    openQuestions,
    nextPlannedAction: context.state?.nextActivity || null,
    overdueItems,
    risks,
    recommendedNextSteps,
    dataGaps,
    facts,
    provenanceNote:
      "Рекомендации отделены от фактов. При недоступности источника отсутствие события не считается доказательством отсутствия коммуникации.",
    entity: {
      type: context.entity.type,
      id: context.entity.id,
      url: context.entity.url,
    },
    partial: Boolean(context.partial),
    warnings: context.warnings || [],
  };
}
