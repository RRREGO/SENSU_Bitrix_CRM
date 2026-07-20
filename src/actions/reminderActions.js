import { callBitrixMethod } from "../bitrixClient.js";
import { notImplementedAction } from "./helpers.js";

/** Поставить напоминание по задаче. */
export async function add_task_reminder(params = {}) {
  const { taskId, userId, remindAt } = params;
  if (!taskId) throw new Error("taskId is required");
  if (!userId) throw new Error("userId is required");
  if (!remindAt) throw new Error("remindAt is required");

  try {
    return await callBitrixMethod("tasks.task.reminder.add", {
      taskId: Number(taskId),
      userId: Number(userId),
      remindDate: remindAt,
    });
  } catch (error) {
    throw new Error(
      `Метод напоминания недоступен на вашем портале. ` +
        `Проверьте REST-документацию tasks.task.reminder.*. ${error.message}`
    );
  }
}

/** Регулярные задачи — требуют поддержки портала, без локального планировщика. */
export const set_daily_task_recurrence = notImplementedAction("set_daily_task_recurrence");
export const set_weekly_task_recurrence = notImplementedAction("set_weekly_task_recurrence");
export const set_monthly_by_month_days_task_recurrence = notImplementedAction(
  "set_monthly_by_month_days_task_recurrence"
);
export const set_monthly_by_week_days_task_recurrence = notImplementedAction(
  "set_monthly_by_week_days_task_recurrence"
);
export const set_yearly_by_month_days_task_recurrence = notImplementedAction(
  "set_yearly_by_month_days_task_recurrence"
);
export const set_yearly_by_week_days_task_recurrence = notImplementedAction(
  "set_yearly_by_week_days_task_recurrence"
);
