import { callBitrixMethod, callBitrixMethodFull } from "../bitrixClient.js";
import {
  requireDestructiveConfirm,
  PAGINATION,
  applyListLimit,
  fetchAllPages,
  normalizeListResult,
  getAnalyticsMaxPages,
} from "./helpers.js";

/** Собрать fields для tasks.task.add/update из params. */
function buildTaskFields(params) {
  const fields = { ...(params.fields || {}) };

  if (params.title) fields.TITLE = params.title;
  if (params.description !== undefined) fields.DESCRIPTION = params.description;
  if (params.responsibleId) fields.RESPONSIBLE_ID = params.responsibleId;
  if (params.deadline !== undefined) fields.DEADLINE = params.deadline;
  if (params.groupId !== undefined) fields.GROUP_ID = params.groupId;
  if (params.accomplices) fields.ACCOMPLICES = params.accomplices;
  if (params.auditors) fields.AUDITORS = params.auditors;
  if (params.crmBindings) fields.UF_CRM_TASK = params.crmBindings;

  return fields;
}

/** Создать задачу. */
export async function create_task(params = {}) {
  const fields = buildTaskFields(params);
  if (!fields.TITLE) throw new Error("title is required");

  return callBitrixMethod("tasks.task.add", { fields });
}

/** Поиск задач (безопасный лимит по умолчанию). */
export async function search_tasks(params = {}) {
  const {
    filter = {},
    select = [],
    order = {},
    start = 0,
    limit = PAGINATION.DEFAULT_LIST_LIMIT,
  } = params;

  const requestParams = { filter, order, start };
  if (select?.length) requestParams.select = select;

  const { result, next, total } = await callBitrixMethodFull(
    "tasks.task.list",
    requestParams
  );
  const page = normalizeListResult(result, { next, total });
  const limited = applyListLimit(page, limit);

  return {
    ...limited,
    tasks: limited.items,
  };
}

/** Полная выборка задач для аналитики. */
export async function searchTasksAll(params = {}, options = {}) {
  const { filter = {}, select = [], order = {} } = params;
  const result = await fetchAllPages({
    actionName: options.actionName || "search_tasks_all",
    maxPages: options.maxPages ?? getAnalyticsMaxPages(),
    fetchPage: async (start) => {
      const requestParams = { filter, order, start };
      if (select?.length) requestParams.select = select;
      const { result: pageResult, next, total } = await callBitrixMethodFull(
        "tasks.task.list",
        requestParams
      );
      return normalizeListResult(pageResult, { next, total });
    },
  });

  return {
    ...result,
    tasks: result.items,
  };
}

/** Получить задачу по ID. */
export async function get_task_by_id(params = {}) {
  if (!params.id) throw new Error("id is required");
  return callBitrixMethod("tasks.task.get", { taskId: Number(params.id) });
}

/** Обновить задачу. */
export async function update_task(params = {}) {
  if (!params.id) throw new Error("id is required");
  const fields = buildTaskFields(params);
  if (!Object.keys(fields).length) throw new Error("fields or task properties are required");

  return callBitrixMethod("tasks.task.update", {
    taskId: Number(params.id),
    fields,
  });
}

/** Удалить задачу (требует confirm: true). */
export async function delete_task(params = {}) {
  requireDestructiveConfirm(params);
  if (!params.id) throw new Error("id is required");
  return callBitrixMethod("tasks.task.delete", { taskId: Number(params.id) });
}

/** Очистить дедлайн задачи. */
export async function clear_task_deadline(params = {}) {
  if (!params.id) throw new Error("id is required");

  try {
    return await callBitrixMethod("tasks.task.update", {
      taskId: Number(params.id),
      fields: { DEADLINE: "" },
    });
  } catch (error) {
    return callBitrixMethod("tasks.task.update", {
      taskId: Number(params.id),
      fields: { DEADLINE: null },
    });
  }
}

/** Отвязать задачу от группы/проекта. */
export async function detach_task_from_group(params = {}) {
  if (!params.id) throw new Error("id is required");

  try {
    return await callBitrixMethod("tasks.task.update", {
      taskId: Number(params.id),
      fields: { GROUP_ID: 0 },
    });
  } catch (error) {
    return callBitrixMethod("tasks.task.update", {
      taskId: Number(params.id),
      fields: { GROUP_ID: null },
    });
  }
}

/** Добавить результат работы в задачу. */
export async function add_task_result(params = {}) {
  const { taskId, text } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!text) throw new Error("text is required");

  try {
    return await callBitrixMethod("tasks.task.result.add", {
      taskId: Number(taskId),
      text,
    });
  } catch (error) {
    console.warn("tasks.task.result.add unavailable, using comment fallback:", error.message);

    const comment = `Результат работы:\n${text}`;
    try {
      return await callBitrixMethod("task.commentitem.add", {
        TASKID: Number(taskId),
        FIELDS: { POST_MESSAGE: comment },
      });
    } catch (fallbackError) {
      throw new Error(
        `Не удалось добавить результат задачи. Проверьте права «Задачи» у вебхука. ${fallbackError.message}`
      );
    }
  }
}

/** Написать сообщение в чат/комментарии задачи. */
export async function send_chat_message(params = {}) {
  const { taskId, message } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!message) throw new Error("message is required");

  // Пробуем современный метод чата задач
  try {
    return await callBitrixMethod("im.message.add", {
      DIALOG_ID: `chat${taskId}`,
      MESSAGE: message,
    });
  } catch (chatError) {
    console.warn("im.message.add failed, trying task.commentitem.add:", chatError.message);

    try {
      return await callBitrixMethod("task.commentitem.add", {
        TASKID: Number(taskId),
        FIELDS: { POST_MESSAGE: message },
      });
    } catch (commentError) {
      throw new Error(
        `Не удалось отправить сообщение в задачу. Проверьте права «Задачи» и «Чат». ` +
          `Chat: ${chatError.message}. Comment: ${commentError.message}`
      );
    }
  }
}
