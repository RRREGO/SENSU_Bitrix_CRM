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
      (p) => !["users.manage", "roles.manage", "settings.manage"].includes(p)
    ).concat(["settings.view"]),
  },
  manager: {
    name: "Менеджер",
    description: "Свой CRM scope, чаты, drafts, own operations",
    permissions: [
      "crm.read.own",
      "crm.context.read",
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
    ],
  },
  analyst: {
    name: "Аналитик",
    description: "Read-only CRM и отчёты",
    permissions: [
      "crm.read.all",
      "crm.context.read",
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
