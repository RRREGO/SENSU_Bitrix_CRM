import { callBitrixMethod } from "../bitrixClient.js";
import { notImplementedAction } from "./helpers.js";

/** Создать чек-лист в задаче. */
export async function create_check_list(params = {}) {
  const { taskId, title } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!title) throw new Error("title is required");

  try {
    return await callBitrixMethod("task.checklist.add", {
      TASKID: Number(taskId),
      FIELDS: { TITLE: title },
    });
  } catch (error) {
    throw new Error(
      `Не удалось создать чек-лист. Проверьте REST-методы task.checklist.* в вашем портале. ${error.message}`
    );
  }
}

/** Добавить пункт чек-листа. */
export async function create_check_list_item(params = {}) {
  const { taskId, title, parentId = 0, sort = 100 } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!title) throw new Error("title is required");

  return callBitrixMethod("task.checklistitem.add", {
    TASKID: Number(taskId),
    FIELDS: {
      TITLE: title,
      PARENT_ID: parentId,
      SORT_INDEX: sort,
    },
  });
}

/** Обновить чек-лист. */
export async function update_check_list(params = {}) {
  const { id, title, sort } = params;
  if (!id) throw new Error("id is required");

  const fields = {};
  if (title) fields.TITLE = title;
  if (sort !== undefined) fields.SORT_INDEX = sort;

  return callBitrixMethod("task.checklist.update", { id, fields });
}

/** Обновить пункт чек-листа. */
export async function update_check_list_item(params = {}) {
  const { id, title, sort } = params;
  if (!id) throw new Error("id is required");

  const fields = {};
  if (title) fields.TITLE = title;
  if (sort !== undefined) fields.SORT_INDEX = sort;

  return callBitrixMethod("task.checklistitem.update", { id, fields });
}

/** Удалить чек-лист. */
export async function delete_check_list(params = {}) {
  if (!params.id) throw new Error("id is required");
  return callBitrixMethod("task.checklist.delete", { id: params.id });
}

/** Удалить пункт чек-листа. */
export async function delete_check_list_item(params = {}) {
  if (!params.id) throw new Error("id is required");
  return callBitrixMethod("task.checklistitem.delete", { id: params.id });
}

export const checklist_reorder = notImplementedAction("checklist_reorder");
