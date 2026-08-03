/**
 * Системные роли и permissions.
 */

export const ALL_PERMISSIONS = [
  "crm.read.all",
  "crm.read.own",
  "crm.context.read",
  "analytics.run",
  "reports.view",
  "reports.run",
  "schedules.view",
  "schedules.manage",
  "notifications.view",
  "chats.manage.own",
  "chats.manage.all",
  "projects.view",
  "projects.manage",
  "profiles.view",
  "profiles.manage",
  "operations.view.own",
  "operations.view.all",
  "operations.prepare",
  "operations.confirm.own",
  "operations.confirm.any",
  "operations.rollback",
  "communications.draft",
  "communications.send",
  "communications.view.own",
  "communications.view.all",
  "communications.manage",
  "settings.view",
  "settings.manage",
  "users.manage",
  "roles.manage",
  "audit.view",
  "crm.schema.read",
  "crm.schema.capture",
  "manage_ai_providers",
  "use_ai_provider",
  "manage_ai_models",
  "select_chat_model",
  "manage_prompt_profiles",
  "assign_prompt_profiles",
  "manage_proxy_profiles",
  "use_proxy_profiles",
  "use_voice_input",
  "manage_communication_accounts",
  "send_wazzup_messages",
  "send_email_messages",
  "view_communication_audit",
  "approve_external_send",
];

export const ROLE_DEFINITIONS = {
  administrator: {
    name: "Администратор",
    description: "Полный доступ к системе",
    permissions: [...ALL_PERMISSIONS],
  },
  director: {
    name: "Директор",
    description: "CRM, аналитика, отчёты, коммуникации без управления пользователями",
    permissions: ALL_PERMISSIONS.filter(
      (p) =>
        !["users.manage", "roles.manage", "settings.manage", "crm.schema.capture"].includes(p)
    ).concat(["settings.view", "crm.schema.read"]),
  },
  manager: {
    name: "Менеджер",
    description: "Свой CRM scope, чаты, drafts, own operations",
    permissions: [
      "crm.read.own",
      "crm.context.read",
      "crm.schema.read",
      "analytics.run",
      "reports.view",
      "reports.run",
      "schedules.view",
      "notifications.view",
      "chats.manage.own",
      "projects.view",
      "profiles.view",
      "operations.view.own",
      "operations.prepare",
      "operations.confirm.own",
      "communications.draft",
      "communications.send",
      "communications.view.own",
      "communications.manage",
      "use_ai_provider",
      "select_chat_model",
      "use_proxy_profiles",
      "use_voice_input",
      "send_wazzup_messages",
      "send_email_messages",
      "approve_external_send",
      "manage_prompt_profiles",
      "assign_prompt_profiles",
    ],
  },
  analyst: {
    name: "Аналитик",
    description: "Read-only CRM и отчёты",
    permissions: [
      "crm.read.all",
      "crm.context.read",
      "crm.schema.read",
      "analytics.run",
      "reports.view",
      "reports.run",
      "schedules.view",
      "notifications.view",
      "projects.view",
      "profiles.view",
      "operations.view.own",
      "communications.view.own",
    ],
  },
  viewer: {
    name: "Наблюдатель",
    description: "Ограниченный просмотр отчётов и уведомлений",
    permissions: ["reports.view", "notifications.view", "projects.view"],
  },
};

/** Default authz for actions by access type when not overridden. */
export function defaultPermissionsForAccess(access) {
  if (access === "read") {
    return {
      requiredPermissions: ["crm.read.own"],
      confirmPermissions: [],
      dataScope: "crm_entity",
    };
  }
  if (access === "write" || access === "destructive") {
    return {
      requiredPermissions: ["operations.prepare"],
      confirmPermissions: ["operations.confirm.own"],
      dataScope: "crm_entity",
    };
  }
  return {
    requiredPermissions: ["settings.manage"],
    confirmPermissions: [],
    dataScope: "none",
  };
}
