/**
 * Actions: клиентский контекст и meeting workflow.
 */

export { crm_context_get } from "../clientContext/crmContextGet.js";
export { crm_context_summary } from "../clientContext/crmContextSummary.js";
export { meeting_protocol_generate } from "../clientContext/meetingProtocolService.js";
export {
  client_message_draft,
  recommend_next_client_action,
} from "../clientContext/clientActions.js";
export { client_message_send } from "../communications/messageService.js";

export {
  communication_channels_list,
  communication_thread_get,
  communication_contact_context,
  communication_message_draft,
  communication_message_send_prepare,
  communication_campaign_preview,
  communication_campaign_start_prepare,
  communication_campaign_pause_prepare,
  communication_campaign_cancel_prepare,
  communication_sequence_list,
  communication_sequence_activate_prepare,
  communication_sequence_enroll_prepare,
  communication_enrollment_stop_prepare,
  communication_delivery_report,
  communication_unanswered_report,
} from "../communications/communicationActions.js";
