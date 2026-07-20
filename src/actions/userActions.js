import { callBitrixMethod } from "../bitrixClient.js";
import { get_task_by_id, update_task } from "./taskActions.js";

/** Поиск пользователей. */
export async function search_users(params = {}) {
  const requestParams = { ...(params.filter || {}) };
  if (params.query) requestParams.FIND = params.query;

  return callBitrixMethod("user.search", requestParams);
}

/** Получить пользователя по ID. */
export async function user_get(params = {}) {
  if (!params.id) throw new Error("id is required");
  const result = await callBitrixMethod("user.get", { ID: Number(params.id) });
  return Array.isArray(result) ? result[0] : result;
}

/** Список подразделений. */
export async function department_list(params = {}) {
  const requestParams = {};
  if (params.id !== undefined) requestParams.ID = params.id;
  return callBitrixMethod("department.get", requestParams);
}
