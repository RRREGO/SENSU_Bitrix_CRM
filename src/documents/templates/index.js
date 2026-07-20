import * as funnelReport from "./funnelReport.js";
import * as dealSummary from "./dealSummary.js";
import * as commercialProposal from "./commercialProposal.js";
import * as meetingProtocol from "./meetingProtocol.js";
import * as taskReport from "./taskReport.js";

export const DOCUMENT_TEMPLATES = {
  funnel_report: funnelReport,
  deal_summary: dealSummary,
  commercial_proposal: commercialProposal,
  meeting_protocol: meetingProtocol,
  task_report: taskReport,
};

export function getTemplate(type) {
  return DOCUMENT_TEMPLATES[type] || null;
}

export function listTemplates() {
  return Object.entries(DOCUMENT_TEMPLATES).map(([id, template]) => ({
    type: id,
    title: template.title,
  }));
}
