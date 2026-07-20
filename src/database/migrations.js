/**
 * Централизованные миграции SQLite.
 * Запускаются автоматически при открытии БД.
 */

export const migrations = [
  {
    version: 1,
    name: "create_operations_tables",
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  confirmation_id TEXT NOT NULL UNIQUE,
  action TEXT NOT NULL,
  access_type TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  status TEXT NOT NULL,
  reversible TEXT NOT NULL,
  source TEXT,
  session_id TEXT,
  params_json TEXT,
  preview_json TEXT,
  before_json TEXT,
  after_json TEXT,
  result_json TEXT,
  error_json TEXT,
  plan_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  confirmed_at TEXT,
  executed_at TEXT,
  cancelled_at TEXT,
  rolled_back_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_operations_status ON operations(status);
CREATE INDEX IF NOT EXISTS idx_operations_action ON operations(action);
CREATE INDEX IF NOT EXISTS idx_operations_session ON operations(session_id);
CREATE INDEX IF NOT EXISTS idx_operations_created ON operations(created_at);

CREATE TABLE IF NOT EXISTS operation_items (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  status TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  result_json TEXT,
  error_json TEXT,
  executed_at TEXT,
  rolled_back_at TEXT,
  FOREIGN KEY (operation_id) REFERENCES operations(id)
);

CREATE INDEX IF NOT EXISTS idx_operation_items_op ON operation_items(operation_id);

CREATE TABLE IF NOT EXISTS operation_events (
  id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (operation_id) REFERENCES operations(id)
);

CREATE INDEX IF NOT EXISTS idx_operation_events_op ON operation_events(operation_id);
CREATE INDEX IF NOT EXISTS idx_operation_events_created ON operation_events(created_at);
`,
  },
  {
    version: 2,
    name: "v2_user_workspace",
    sql: `
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  company_context TEXT,
  user_context TEXT,
  response_rules TEXT,
  crm_methodology TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  instruction TEXT,
  profile_id TEXT,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (profile_id) REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_archived ON projects(is_archived);
CREATE INDEX IF NOT EXISTS idx_projects_updated ON projects(updated_at);

CREATE TABLE IF NOT EXISTS project_files (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  mime_type TEXT,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_project_files_project ON project_files(project_id);
CREATE INDEX IF NOT EXISTS idx_project_files_hash ON project_files(project_id, content_hash);

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  crm_entity_type TEXT,
  crm_entity_id TEXT,
  model_name TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE INDEX IF NOT EXISTS idx_chats_status ON chats(status);
CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id);
CREATE INDEX IF NOT EXISTS idx_chats_session ON chats(session_id);
CREATE INDEX IF NOT EXISTS idx_chats_updated ON chats(updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'text',
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);

CREATE TABLE IF NOT EXISTS chat_summaries (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  through_message_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats(id)
);

CREATE INDEX IF NOT EXISTS idx_chat_summaries_chat ON chat_summaries(chat_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 3,
    name: "v3_production_hardening",
    sql: `
ALTER TABLE operations ADD COLUMN chat_id TEXT;
ALTER TABLE operations ADD COLUMN message_id INTEGER;
ALTER TABLE operations ADD COLUMN project_id TEXT;

CREATE INDEX IF NOT EXISTS idx_operations_chat ON operations(chat_id);
CREATE INDEX IF NOT EXISTS idx_operations_project ON operations(project_id);
CREATE INDEX IF NOT EXISTS idx_operations_status_created ON operations(status, created_at);
`,
  },
  {
    version: 4,
    name: "v4_client_context",
    sql: `
CREATE TABLE IF NOT EXISTS meeting_transcripts (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  project_id TEXT,
  crm_entity_type TEXT,
  crm_entity_id TEXT,
  title TEXT NOT NULL,
  meeting_date TEXT,
  content_text TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size_chars INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_chat ON meeting_transcripts(chat_id);
CREATE INDEX IF NOT EXISTS idx_meeting_transcripts_entity ON meeting_transcripts(crm_entity_type, crm_entity_id);

CREATE TABLE IF NOT EXISTS meeting_protocol_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  instruction TEXT,
  structure_json TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  project_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_protocol_templates_project ON meeting_protocol_templates(project_id);

CREATE TABLE IF NOT EXISTS meeting_protocols (
  id TEXT PRIMARY KEY,
  transcript_id TEXT,
  chat_id TEXT,
  project_id TEXT,
  template_id TEXT,
  crm_entity_type TEXT,
  crm_entity_id TEXT,
  title TEXT NOT NULL,
  protocol_json TEXT NOT NULL,
  protocol_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (transcript_id) REFERENCES meeting_transcripts(id),
  FOREIGN KEY (template_id) REFERENCES meeting_protocol_templates(id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_protocols_entity ON meeting_protocols(crm_entity_type, crm_entity_id);
CREATE INDEX IF NOT EXISTS idx_meeting_protocols_transcript ON meeting_protocols(transcript_id);
`,
  },
  {
    version: 5,
    name: "v5_scheduled_reports",
    sql: `
CREATE TABLE IF NOT EXISTS report_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  report_type TEXT NOT NULL,
  schedule_type TEXT NOT NULL,
  cron_expression TEXT,
  timezone TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  alert_rules_json TEXT NOT NULL DEFAULT '[]',
  narrative_enabled INTEGER NOT NULL DEFAULT 0,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  next_run_at TEXT,
  last_run_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_report_schedules_enabled_next
  ON report_schedules(is_enabled, next_run_at);

CREATE TABLE IF NOT EXISTS report_runs (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  status TEXT NOT NULL,
  report_json TEXT,
  summary_text TEXT,
  warnings_json TEXT,
  error_json TEXT,
  duration_ms INTEGER,
  idempotency_key TEXT NOT NULL,
  retry_of_run_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (schedule_id) REFERENCES report_schedules(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_runs_idempotency
  ON report_runs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_report_runs_schedule ON report_runs(schedule_id, created_at);
CREATE INDEX IF NOT EXISTS idx_report_runs_status ON report_runs(status);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  report_run_id TEXT,
  schedule_id TEXT,
  type TEXT NOT NULL,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY (report_run_id) REFERENCES report_runs(id),
  FOREIGN KEY (schedule_id) REFERENCES report_schedules(id)
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read, created_at);
CREATE INDEX IF NOT EXISTS idx_notifications_severity ON notifications(severity, created_at);

CREATE TABLE IF NOT EXISTS scheduler_locks (
  lock_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
`,
  },
  {
    version: 6,
    name: "v6_communications",
    sql: `
CREATE TABLE IF NOT EXISTS communication_channels (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  last_error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_communication_channels_channel
  ON communication_channels(channel);

CREATE TABLE IF NOT EXISTS message_drafts (
  id TEXT PRIMARY KEY,
  chat_id TEXT,
  project_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  contact_id TEXT,
  channel TEXT NOT NULL,
  recipient_reference TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  based_on_json TEXT,
  warnings_json TEXT,
  recipient_json TEXT,
  send_available INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_message_drafts_entity
  ON message_drafts(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_message_drafts_status ON message_drafts(status);

CREATE TABLE IF NOT EXISTS outbound_messages (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  recipient_reference TEXT,
  body_hash TEXT NOT NULL,
  external_message_id TEXT,
  status TEXT NOT NULL,
  verification_status TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  failed_at TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (draft_id) REFERENCES message_drafts(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_outbound_draft_operation
  ON outbound_messages(draft_id, operation_id);
CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_messages(status);

CREATE TABLE IF NOT EXISTS message_delivery_events (
  id TEXT PRIMARY KEY,
  outbound_message_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  provider_status TEXT,
  event_idempotency_key TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (outbound_message_id) REFERENCES outbound_messages(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_events_idempotency
  ON message_delivery_events(event_idempotency_key)
  WHERE event_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_delivery_events_outbound
  ON message_delivery_events(outbound_message_id);
`,
  },
  {
    version: 7,
    name: "v7_access_control",
    sql: `
CREATE TABLE IF NOT EXISTS app_roles (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  is_system INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL,
  permission TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (role_id, permission),
  FOREIGN KEY (role_id) REFERENCES app_roles(id)
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id TEXT NOT NULL,
  bitrix_user_id TEXT,
  data_scope TEXT NOT NULL DEFAULT 'own',
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  password_changed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  FOREIGN KEY (role_id) REFERENCES app_roles(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_app_users_username_nocase
  ON app_users(username COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  session_token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  idle_expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_hash TEXT,
  user_agent_hash TEXT,
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_events (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  result TEXT NOT NULL,
  ip_hash TEXT,
  user_agent_hash TEXT,
  details_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_events_created ON auth_events(created_at);

CREATE TABLE IF NOT EXISTS project_members (
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  access_level TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE TABLE IF NOT EXISTS notification_recipients (
  notification_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  read_at TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (notification_id, user_id),
  FOREIGN KEY (notification_id) REFERENCES notifications(id),
  FOREIGN KEY (user_id) REFERENCES app_users(id)
);

CREATE INDEX IF NOT EXISTS idx_notification_recipients_user
  ON notification_recipients(user_id, is_read);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

ALTER TABLE chats ADD COLUMN owner_user_id TEXT;
ALTER TABLE chats ADD COLUMN created_by_user_id TEXT;
ALTER TABLE projects ADD COLUMN owner_user_id TEXT;
ALTER TABLE projects ADD COLUMN created_by_user_id TEXT;
ALTER TABLE profiles ADD COLUMN created_by_user_id TEXT;
ALTER TABLE profiles ADD COLUMN updated_by_user_id TEXT;
ALTER TABLE operations ADD COLUMN initiated_by_user_id TEXT;
ALTER TABLE operations ADD COLUMN confirmed_by_user_id TEXT;
ALTER TABLE operations ADD COLUMN cancelled_by_user_id TEXT;
ALTER TABLE operations ADD COLUMN rolled_back_by_user_id TEXT;
ALTER TABLE report_schedules ADD COLUMN created_by_user_id TEXT;
ALTER TABLE report_schedules ADD COLUMN updated_by_user_id TEXT;
ALTER TABLE report_runs ADD COLUMN triggered_by_user_id TEXT;
ALTER TABLE report_runs ADD COLUMN trigger_source TEXT;
ALTER TABLE message_drafts ADD COLUMN created_by_user_id TEXT;
ALTER TABLE message_drafts ADD COLUMN updated_by_user_id TEXT;
ALTER TABLE outbound_messages ADD COLUMN sent_by_user_id TEXT;
`,
  },
  {
    version: 8,
    name: "v8_go_live_security",
    sql: `
ALTER TABLE report_schedules ADD COLUMN scope_type TEXT;
ALTER TABLE report_schedules ADD COLUMN scope_user_id TEXT;
ALTER TABLE report_schedules ADD COLUMN audience_json TEXT;
`,
    backwardCompatibleFrom: 7,
    description: "Schedule scope + audience for go-live security",
    destructive: false,
  },
  {
    version: 9,
    name: "v9_pilot_operations",
    sql: `
CREATE TABLE IF NOT EXISTS application_errors (
  id TEXT PRIMARY KEY,
  request_id TEXT,
  source TEXT NOT NULL,
  error_code TEXT NOT NULL,
  severity TEXT NOT NULL,
  message_safe TEXT NOT NULL,
  details_json TEXT,
  user_id TEXT,
  operation_id TEXT,
  report_run_id TEXT,
  release_id TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_application_errors_created ON application_errors(created_at);
CREATE INDEX IF NOT EXISTS idx_application_errors_unresolved
  ON application_errors(resolved_at, severity);

ALTER TABLE operations ADD COLUMN release_id TEXT;
ALTER TABLE report_runs ADD COLUMN release_id TEXT;
`,
    backwardCompatibleFrom: 8,
    description: "Error journal and release metadata for pilot operations",
    destructive: false,
  },
  {
    version: 10,
    name: "v10_communications_hub",
    sql: `
ALTER TABLE communication_channels ADD COLUMN external_channel_id TEXT;
ALTER TABLE communication_channels ADD COLUMN transport TEXT;
ALTER TABLE communication_channels ADD COLUMN display_name TEXT;
ALTER TABLE communication_channels ADD COLUMN plain_id TEXT;
ALTER TABLE communication_channels ADD COLUMN state TEXT;
ALTER TABLE communication_channels ADD COLUMN last_synced_at TEXT;

CREATE INDEX IF NOT EXISTS idx_communication_channels_external
  ON communication_channels(provider, external_channel_id);
CREATE INDEX IF NOT EXISTS idx_communication_channels_transport
  ON communication_channels(transport);

CREATE TABLE IF NOT EXISTS communication_identities (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  provider TEXT NOT NULL,
  transport TEXT,
  chat_type TEXT,
  external_chat_id TEXT,
  username TEXT,
  phone_normalized TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  verified INTEGER NOT NULL DEFAULT 0,
  resolution_status TEXT NOT NULL DEFAULT 'resolved',
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_identities_provider_chat
  ON communication_identities(provider, external_chat_id)
  WHERE external_chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_identities_contact
  ON communication_identities(contact_id);
CREATE INDEX IF NOT EXISTS idx_comm_identities_phone
  ON communication_identities(phone_normalized);
CREATE INDEX IF NOT EXISTS idx_comm_identities_username
  ON communication_identities(provider, username);
CREATE INDEX IF NOT EXISTS idx_comm_identities_resolution
  ON communication_identities(resolution_status);

CREATE TABLE IF NOT EXISTS communication_threads (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  entity_type TEXT,
  entity_id TEXT,
  provider TEXT NOT NULL,
  channel_id TEXT,
  transport TEXT,
  chat_type TEXT,
  external_chat_id TEXT,
  identity_id TEXT,
  last_inbound_at TEXT,
  last_outbound_at TEXT,
  unanswered INTEGER NOT NULL DEFAULT 0,
  last_message_preview TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (identity_id) REFERENCES communication_identities(id),
  FOREIGN KEY (channel_id) REFERENCES communication_channels(id)
);

CREATE INDEX IF NOT EXISTS idx_comm_threads_contact ON communication_threads(contact_id);
CREATE INDEX IF NOT EXISTS idx_comm_threads_entity ON communication_threads(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_comm_threads_chat
  ON communication_threads(provider, external_chat_id);
CREATE INDEX IF NOT EXISTS idx_comm_threads_unanswered
  ON communication_threads(unanswered, updated_at);

CREATE TABLE IF NOT EXISTS communication_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT,
  provider TEXT NOT NULL,
  external_message_id TEXT,
  direction TEXT NOT NULL,
  status TEXT NOT NULL,
  transport TEXT,
  chat_type TEXT,
  channel_id TEXT,
  contact_id TEXT,
  text_safe TEXT,
  text_hash TEXT,
  template_id TEXT,
  campaign_id TEXT,
  sequence_enrollment_id TEXT,
  outbox_id TEXT,
  operation_id TEXT,
  reply_to_external_id TEXT,
  crm_message_id TEXT,
  error_code TEXT,
  error_safe TEXT,
  sent_at TEXT,
  delivered_at TEXT,
  read_at TEXT,
  provider_timestamp TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES communication_threads(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_messages_provider_ext
  ON communication_messages(provider, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_messages_crm_message
  ON communication_messages(provider, crm_message_id)
  WHERE crm_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_comm_messages_thread ON communication_messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comm_messages_contact ON communication_messages(contact_id, created_at);
CREATE INDEX IF NOT EXISTS idx_comm_messages_status ON communication_messages(status);
CREATE INDEX IF NOT EXISTS idx_comm_messages_campaign ON communication_messages(campaign_id);

CREATE TABLE IF NOT EXISTS communication_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT,
  channel TEXT NOT NULL,
  category TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'ru',
  body TEXT NOT NULL,
  allowed_vars_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  waba_template_id TEXT,
  constraints_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT,
  updated_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comm_templates_category ON communication_templates(category);
CREATE INDEX IF NOT EXISTS idx_comm_templates_channel ON communication_templates(channel, status);

CREATE TABLE IF NOT EXISTS communication_campaigns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  channel TEXT,
  template_id TEXT,
  segment_json TEXT NOT NULL DEFAULT '{}',
  schedule_json TEXT NOT NULL DEFAULT '{}',
  plan_json TEXT,
  plan_hash TEXT,
  confirmed_recipient_count INTEGER,
  confirmation_phrase TEXT,
  dry_run INTEGER NOT NULL DEFAULT 1,
  stats_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT,
  confirmed_by_user_id TEXT,
  confirmed_at TEXT,
  started_at TEXT,
  paused_at TEXT,
  completed_at TEXT,
  cancelled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (template_id) REFERENCES communication_templates(id)
);

CREATE INDEX IF NOT EXISTS idx_comm_campaigns_status ON communication_campaigns(status);

CREATE TABLE IF NOT EXISTS communication_campaign_recipients (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  recipient_key TEXT NOT NULL,
  step_number INTEGER NOT NULL DEFAULT 1,
  channel TEXT,
  transport TEXT,
  identity_id TEXT,
  rendered_body TEXT,
  scheduled_at TEXT,
  exclusion_code TEXT,
  exclusion_message TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  outbox_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES communication_campaigns(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_campaign_recipient_step
  ON communication_campaign_recipients(campaign_id, recipient_key, step_number);
CREATE INDEX IF NOT EXISTS idx_comm_campaign_recipients_status
  ON communication_campaign_recipients(campaign_id, status);

CREATE TABLE IF NOT EXISTS communication_sequences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  target_crm_status TEXT,
  enroll_conditions_json TEXT NOT NULL DEFAULT '{}',
  stop_conditions_json TEXT NOT NULL DEFAULT '{}',
  completion_action_json TEXT NOT NULL DEFAULT '{}',
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comm_sequences_status ON communication_sequences(status);

CREATE TABLE IF NOT EXISTS communication_sequence_steps (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  delay_value INTEGER NOT NULL DEFAULT 0,
  delay_unit TEXT NOT NULL DEFAULT 'days',
  business_days INTEGER NOT NULL DEFAULT 1,
  channel TEXT NOT NULL,
  template_id TEXT,
  send_window_json TEXT NOT NULL DEFAULT '{}',
  conditions_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sequence_id) REFERENCES communication_sequences(id),
  FOREIGN KEY (template_id) REFERENCES communication_templates(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_sequence_steps_num
  ON communication_sequence_steps(sequence_id, step_number);

CREATE TABLE IF NOT EXISTS communication_sequence_enrollments (
  id TEXT PRIMARY KEY,
  sequence_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  current_step INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  stop_reason TEXT,
  last_error_safe TEXT,
  enrolled_by_user_id TEXT,
  enrolled_at TEXT NOT NULL,
  completed_at TEXT,
  stopped_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (sequence_id) REFERENCES communication_sequences(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_enrollment_active
  ON communication_sequence_enrollments(sequence_id, contact_id)
  WHERE status IN ('pending', 'active', 'paused');
CREATE INDEX IF NOT EXISTS idx_comm_enrollments_next
  ON communication_sequence_enrollments(status, next_run_at);
CREATE INDEX IF NOT EXISTS idx_comm_enrollments_contact
  ON communication_sequence_enrollments(contact_id, status);

CREATE TABLE IF NOT EXISTS communication_outbox (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  channel_id TEXT,
  transport TEXT,
  chat_type TEXT,
  external_chat_id TEXT,
  contact_id TEXT,
  thread_id TEXT,
  campaign_id TEXT,
  campaign_recipient_id TEXT,
  sequence_enrollment_id TEXT,
  sequence_step_number INTEGER,
  template_id TEXT,
  body TEXT,
  template_values_json TEXT,
  waba_template_id TEXT,
  crm_message_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  dry_run INTEGER NOT NULL DEFAULT 1,
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  locked_by TEXT,
  locked_at TEXT,
  lock_expires_at TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  last_error_safe TEXT,
  operation_id TEXT,
  plan_hash TEXT,
  scheduled_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_outbox_idempotency
  ON communication_outbox(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_comm_outbox_claim
  ON communication_outbox(status, next_attempt_at, lock_expires_at);
CREATE INDEX IF NOT EXISTS idx_comm_outbox_campaign ON communication_outbox(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_comm_outbox_enrollment
  ON communication_outbox(sequence_enrollment_id, status);

CREATE TABLE IF NOT EXISTS communication_webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,
  processing_status TEXT NOT NULL DEFAULT 'received',
  external_message_id TEXT,
  payload_redacted_json TEXT,
  error_safe TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comm_webhook_hash
  ON communication_webhook_events(event_hash);
CREATE INDEX IF NOT EXISTS idx_comm_webhook_status
  ON communication_webhook_events(processing_status, received_at);

CREATE TABLE IF NOT EXISTS communication_suppressions (
  id TEXT PRIMARY KEY,
  contact_id TEXT,
  phone_normalized TEXT,
  channel TEXT,
  transport TEXT,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  message_hash TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  lifted_at TEXT,
  lifted_by_user_id TEXT,
  lift_operation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_comm_suppressions_contact
  ON communication_suppressions(contact_id, active);
CREATE INDEX IF NOT EXISTS idx_comm_suppressions_phone
  ON communication_suppressions(phone_normalized, active);

CREATE TABLE IF NOT EXISTS communication_consents (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  channel TEXT,
  transport TEXT,
  ground TEXT NOT NULL,
  source TEXT NOT NULL,
  notes_safe TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_comm_consents_contact
  ON communication_consents(contact_id, active, channel);

CREATE TABLE IF NOT EXISTS communication_field_mappings (
  id TEXT PRIMARY KEY,
  mapping_key TEXT NOT NULL UNIQUE,
  bitrix_field TEXT,
  bitrix_enum_values_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  updated_at TEXT NOT NULL
);
`,
    backwardCompatibleFrom: 9,
    description: "Communications Hub: Wazzup, campaigns, sequences, outbox",
    destructive: false,
  },
  {
    version: 11,
    name: "v11_communications_certification",
    sql: `
CREATE TABLE IF NOT EXISTS communication_provider_certifications (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  channel TEXT,
  transport_id TEXT,
  account_fingerprint TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'development',
  status TEXT NOT NULL DEFAULT 'not_started',
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  connection_tested_at TEXT,
  channels_synced_at TEXT,
  webhook_verified_at TEXT,
  single_send_verified_at TEXT,
  delivery_status_verified_at TEXT,
  inbound_reply_verified_at TEXT,
  campaign_verified_at TEXT,
  sequence_verified_at TEXT,
  expires_at TEXT,
  last_error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comm_cert_provider
  ON communication_provider_certifications(provider, channel, transport_id);
CREATE INDEX IF NOT EXISTS idx_comm_cert_fingerprint
  ON communication_provider_certifications(account_fingerprint, status);
CREATE INDEX IF NOT EXISTS idx_comm_cert_status
  ON communication_provider_certifications(status, expires_at);

CREATE TABLE IF NOT EXISTS communication_certification_runs (
  id TEXT PRIMARY KEY,
  certification_id TEXT NOT NULL,
  test_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  started_at TEXT,
  completed_at TEXT,
  operation_id TEXT,
  draft_id TEXT,
  outbound_message_id TEXT,
  safe_result_json TEXT,
  error_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (certification_id) REFERENCES communication_provider_certifications(id)
);

CREATE INDEX IF NOT EXISTS idx_comm_cert_runs_cert
  ON communication_certification_runs(certification_id, created_at);

CREATE TABLE IF NOT EXISTS communication_provider_snapshots (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  account_fingerprint TEXT NOT NULL,
  channels_hash TEXT,
  capabilities_hash TEXT,
  provider_version TEXT,
  snapshot_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comm_provider_snap_fp
  ON communication_provider_snapshots(provider, account_fingerprint, created_at);

ALTER TABLE communication_outbox ADD COLUMN certification_id TEXT;
ALTER TABLE communication_outbox ADD COLUMN account_fingerprint TEXT;
ALTER TABLE communication_outbox ADD COLUMN channel_fingerprint TEXT;
ALTER TABLE communication_outbox ADD COLUMN recipient_snapshot_hash TEXT;
ALTER TABLE communication_outbox ADD COLUMN policy_version TEXT;
ALTER TABLE communication_outbox ADD COLUMN template_version TEXT;
ALTER TABLE communication_outbox ADD COLUMN body_hash TEXT;

CREATE INDEX IF NOT EXISTS idx_comm_outbox_cert
  ON communication_outbox(certification_id);
CREATE INDEX IF NOT EXISTS idx_comm_outbox_body_hash
  ON communication_outbox(body_hash);
`,
    backwardCompatibleFrom: 10,
    description: "Communications certification, provider snapshots, outbox cert metadata",
    destructive: false,
  },
  {
    version: 12,
    name: "v12_sidebar_pins",
    sql: `
ALTER TABLE chats ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_chats_pinned ON chats(is_pinned, updated_at);
CREATE INDEX IF NOT EXISTS idx_projects_pinned ON projects(is_pinned, updated_at);
`,
    backwardCompatibleFrom: 11,
    description: "Pinned chats and projects for sidebar ordering",
    destructive: false,
  },
  {
    version: 13,
    name: "v13_project_workspace_ux",
    sql: `
ALTER TABLE projects ADD COLUMN color_key TEXT;
ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN crm_bindings_json TEXT;
CREATE INDEX IF NOT EXISTS idx_projects_sort ON projects(sort_order, updated_at);
`,
    backwardCompatibleFrom: 12,
    description: "Project color tokens, sort order, and CRM bindings for workspace UX",
    destructive: false,
  },
];
