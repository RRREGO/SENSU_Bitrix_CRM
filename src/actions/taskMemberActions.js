import { search_users, user_get, department_list } from "./userActions.js";
import { get_task_by_id, update_task } from "./taskActions.js";

export { search_users, user_get, department_list };

/** Извлечь текущие ID из поля задачи (массив или строка). */
function extractUserIds(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(Number).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((v) => Number(v.trim())).filter(Boolean);
  }
  return [Number(value)].filter(Boolean);
}

/** Получить задачу и её поля. */
async function getTaskFields(taskId) {
  const response = await get_task_by_id({ id: taskId });
  const task = response?.task || response;
  return task;
}

/** Добавить соисполнителей. */
export async function add_accomplices(params = {}) {
  const { taskId, userIds } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!userIds?.length) throw new Error("userIds array is required");

  const task = await getTaskFields(taskId);
  const current = extractUserIds(task.ACCOMPLICES || task.accomplices);
  const merged = [...new Set([...current, ...userIds.map(Number)])];

  return update_task({ id: taskId, accomplices: merged });
}

/** Удалить соисполнителей. */
export async function delete_accomplices(params = {}) {
  const { taskId, userIds } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!userIds?.length) throw new Error("userIds array is required");

  const task = await getTaskFields(taskId);
  const current = extractUserIds(task.ACCOMPLICES || task.accomplices);
  const removeSet = new Set(userIds.map(Number));
  const filtered = current.filter((id) => !removeSet.has(id));

  return update_task({ id: taskId, accomplices: filtered });
}

/** Добавить наблюдателей. */
export async function add_auditors(params = {}) {
  const { taskId, userIds } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!userIds?.length) throw new Error("userIds array is required");

  const task = await getTaskFields(taskId);
  const current = extractUserIds(task.AUDITORS || task.auditors);
  const merged = [...new Set([...current, ...userIds.map(Number)])];

  return update_task({ id: taskId, auditors: merged });
}

/** Добавить текущего пользователя вебхука как наблюдателя. */
export async function add_current_user_as_auditor(params = {}) {
  const { taskId } = params;
  if (!taskId) throw new Error("taskId is required");

  // Входящий вебхук привязан к пользователю, создавшему его
  const profile = await user_get({ id: 1 }).catch(() => null);

  // Пробуем получить текущего пользователя через profile
  let currentUserId;
  try {
    const users = await search_users({ filter: { ACTIVE: true } });
    const list = Array.isArray(users) ? users : [];
    // Берём первого активного — вебхук работает от имени своего владельца
    if (list.length > 0) {
      currentUserId = list[0].ID || list[0].id;
    }
  } catch {
    // ignore
  }

  if (!currentUserId && profile) {
    currentUserId = profile.ID || profile.id;
  }

  if (!currentUserId) {
    throw new Error(
      "Не удалось определить текущего пользователя вебхука. " +
        "Передайте userId явно через add_auditors."
    );
  }

  return add_auditors({ taskId, userIds: [currentUserId] });
}

/** Удалить наблюдателей. */
export async function delete_auditors(params = {}) {
  const { taskId, userIds } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!userIds?.length) throw new Error("userIds array is required");

  const task = await getTaskFields(taskId);
  const current = extractUserIds(task.AUDITORS || task.auditors);
  const removeSet = new Set(userIds.map(Number));
  const filtered = current.filter((id) => !removeSet.has(id));

  return update_task({ id: taskId, auditors: filtered });
}
