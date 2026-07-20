import { renderSection, renderSummaryGrid, renderTable, wrapDocumentHtml } from "../render/htmlShell.js";
import { deal_get, deal_product_rows_get } from "../../actions/dealActions.js";
import { contact_get } from "../../actions/crmActions.js";
import { company_get } from "../../actions/crmActions.js";
import { processText } from "../../utils/text.js";
import { extractDealFields } from "../../actions/helpers.js";

export const type = "commercial_proposal";
export const title = "Коммерческое предложение";

export async function build(params = {}) {
  if (!params.dealId && !params.id) {
    throw new Error("dealId is required for commercial_proposal");
  }

  const dealId = params.dealId || params.id;
  const dealRaw = await deal_get({ id: dealId });
  const deal = extractDealFields(dealRaw);

  let products = [];
  try {
    const rows = await deal_product_rows_get({ id: dealId });
    products = Array.isArray(rows) ? rows : rows?.productRows || [];
  } catch {
    products = [];
  }

  let contact = null;
  let company = null;

  const contactId = deal.CONTACT_ID || deal.contactId;
  const companyId = deal.COMPANY_ID || deal.companyId;

  if (contactId) {
    try {
      contact = await contact_get({ id: contactId });
    } catch {
      contact = null;
    }
  }

  if (companyId) {
    try {
      company = await company_get({ id: companyId });
    } catch {
      company = null;
    }
  }

  const total = products.reduce((sum, row) => {
    const price = Number(row.PRICE || row.price || 0);
    const qty = Number(row.QUANTITY || row.quantity || 1);
    return sum + price * qty;
  }, deal.opportunity || 0);

  const bodyHtml = [
    renderSection(
      "Получатель",
      `<p><strong>Компания:</strong> ${processText(company?.TITLE || company?.title || "—")}</p>
       <p><strong>Контакт:</strong> ${processText(contact?.NAME || contact?.name || contact?.TITLE || "—")}</p>`
    ),
    renderSection(
      "Предмет предложения",
      renderSummaryGrid([
        { label: "Сделка", value: deal.title || `№${dealId}` },
        { label: "Сумма", value: `${total.toLocaleString("ru-RU")} руб.` },
      ])
    ),
    products.length
      ? renderSection(
          "Позиции",
          renderTable(
            [
              { key: "PRODUCT_NAME", label: "Наименование", render: (r) => r.PRODUCT_NAME || r.productName || r.NAME },
              { key: "QUANTITY", label: "Кол-во", render: (r) => r.QUANTITY || r.quantity || 1 },
              { key: "PRICE", label: "Цена", render: (r) => r.PRICE || r.price || 0 },
            ],
            products
          )
        )
      : renderSection("Позиции", "<p>Товарные позиции не указаны. Сумма взята из поля сделки.</p>"),
    renderSection(
      "Условия",
      `<p>${processText(params.terms || "Предложение действительно в течение 14 календарных дней с даты формирования документа.")}</p>`
    ),
  ].join("");

  return {
    title: processText(`${title}: ${deal.title || `сделка №${dealId}`}`),
    bodyHtml,
    meta: { dealId, deal, products, total },
  };
}

export function toHtml(result) {
  return wrapDocumentHtml({
    title: result.title,
    bodyHtml: result.bodyHtml,
    meta: { generatedAt: new Date(), source: "Bitrix24" },
  });
}
