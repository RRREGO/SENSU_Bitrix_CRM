import { selectRelevantActions, expandDiscoveryCatalog, measureFullCatalogChars } from "./actions/catalogSelector.js";

/**
 * Описание tool для Claude tool use.
 */
export function getBitrixActionTool() {
  return {
    name: "run_bitrix_action",
    description:
      "Выполняет действие в Bitrix24 через локальный action registry. Используй этот инструмент для чтения и изменения CRM. Если нужного action нет в списке — вызови action=__discover_actions с кратким описанием задачи в params.query.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          description:
            "Название action из списка ниже, либо __discover_actions для расширенного каталога.",
        },
        params: {
          type: "object",
          description: "Параметры для выбранного action",
        },
      },
      required: ["action", "params"],
    },
  };
}

function baseRules() {
  return `Ты CRM-ассистент внутри Bitrix24.
Пользователь пишет обычным русским языком.
Твоя задача — помогать работать с CRM, задачами, лидами, сделками, контактами, компаниями, воронками, стадиями, комментариями и аналитикой.

У тебя есть инструмент run_bitrix_action.
Используй его, когда нужно получить, найти, создать, изменить, посчитать или удалить данные в Bitrix24.

Не проси пользователя писать JSON.
Не называй пользователю внутренние action names без необходимости.
Не выдумывай данные.
Если для действия не хватает данных, задай короткий уточняющий вопрос.
Если пользователь просит опасное действие, например удалить, массово перенести, массово изменить — сначала объясни, что будет сделано, и запроси подтверждение.
Пиши кратко, ясно, на русском языке.
Не используй эмодзи, декоративные символы и чрезмерно рекламный стиль. Пиши строго и деловым языком.

Если пользователь спрашивает «что ты умеешь» или похожее — ответь простым списком возможностей на русском:
- искать сделки и лиды
- создавать сделки
- создавать задачи
- менять стадии
- добавлять комментарии
- считать сделки по стадиям
- искать пользователей
- работать с контактами и компаниями
Не показывай полный технический список actions, если пользователь сам не попросил.`;
}

/**
 * System prompt с релевантным (не полным) каталогом actions.
 */
export function buildChatSystemPrompt(userMessage = "", options = {}) {
  const selection = options.expandDiscovery
    ? expandDiscoveryCatalog(userMessage, options.previousActionNames || [])
    : selectRelevantActions(userMessage);

  const prompt = `${baseRules()}

Релевантные actions (неполный каталог, подобран под запрос):
${selection.catalogText}

Если подходящего action нет — вызови run_bitrix_action с action=__discover_actions и params.query=краткое описание задачи.`;

  return {
    prompt,
    diagnostics: {
      systemPromptChars: prompt.length,
      actionCatalogChars: selection.diagnostics.actionCatalogChars,
      actionCount: selection.diagnostics.actionCount,
      fullCatalogChars: measureFullCatalogChars(),
      ...selection.diagnostics,
    },
    selectedActions: selection.actions,
  };
}

/** Совместимость со старым API: строка prompt. */
export function buildChatSystemPromptText(userMessage = "") {
  return buildChatSystemPrompt(userMessage).prompt;
}
