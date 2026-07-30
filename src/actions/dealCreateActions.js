import { buildCreateDealPlan } from "../deals/dealCreateService.js";

/** Read-only: подготовка создания сделки без записи в CRM. */
export async function deal_create_prepare(params = {}) {
  return buildCreateDealPlan(params, { step: "deal_create_prepare" });
}
