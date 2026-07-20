/**
 * Explicit access policies for HTTP routes.
 */

/** @typedef {"public"|"session"|"service_token"|"system_only"|"local_only"|"blocked"} AccessType */

/**
 * @type {Array<{
 *  method: string,
 *  path: string,
 *  access: AccessType,
 *  permission?: string|string[],
 *  csrf?: boolean,
 *  rateLimit?: "api"|"login"|"llm"|"write"|"webhook"
 * }>}
 */
export const ROUTE_POLICIES = [
  { method: "GET", path: "/health", access: "public", csrf: false, rateLimit: "api" },
  { method: "GET", path: "/health/readiness", access: "public", csrf: false, rateLimit: "api" },
  { method: "GET", path: "/health/details", access: "session", permission: "settings.view", csrf: false },
  { method: "GET", path: "/admin/go-live-readiness", access: "session", permission: ["settings.view", "audit.view"], csrf: false },
  { method: "GET", path: "/admin/system/status", access: "session", permission: ["settings.view", "audit.view"], csrf: false },
  { method: "GET", path: "/admin/system/metrics", access: "session", permission: ["settings.view", "audit.view"], csrf: false },
  { method: "GET", path: "/admin/system/disk", access: "session", permission: ["settings.view", "audit.view"], csrf: false },
  { method: "GET", path: "/admin/errors", access: "session", permission: ["settings.view", "audit.view"], csrf: false },
  { method: "GET", path: "/admin/errors/:id", access: "session", permission: ["settings.view", "audit.view"], csrf: false },
  { method: "POST", path: "/admin/errors/:id/resolve", access: "session", permission: "settings.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/admin/system/read-only/enable", access: "session", permission: "settings.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/admin/system/read-only/disable", access: "session", permission: "settings.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/admin/system/maintenance/enable", access: "session", permission: "settings.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/admin/system/maintenance/disable", access: "session", permission: "settings.manage", csrf: true, rateLimit: "write" },

  { method: "POST", path: "/auth/login", access: "public", csrf: false, rateLimit: "login" },
  { method: "POST", path: "/auth/logout", access: "session", csrf: true },
  { method: "GET", path: "/auth/me", access: "session", csrf: false },
  { method: "GET", path: "/auth/csrf", access: "session", csrf: false },
  { method: "POST", path: "/auth/change-password", access: "session", csrf: true, rateLimit: "login" },
  { method: "GET", path: "/auth/sessions", access: "session", csrf: false },
  { method: "POST", path: "/auth/sessions/:id/revoke", access: "session", csrf: true },

  { method: "GET", path: "/users", access: "session", permission: "users.manage", csrf: false },
  { method: "POST", path: "/users", access: "session", permission: "users.manage", csrf: true },
  { method: "GET", path: "/users/:id", access: "session", permission: "users.manage", csrf: false },
  { method: "PATCH", path: "/users/:id", access: "session", permission: "users.manage", csrf: true },
  { method: "POST", path: "/users/:id/disable", access: "session", permission: "users.manage", csrf: true },
  { method: "POST", path: "/users/:id/enable", access: "session", permission: "users.manage", csrf: true },
  { method: "POST", path: "/users/:id/reset-password", access: "session", permission: "users.manage", csrf: true },
  { method: "POST", path: "/users/:id/revoke-sessions", access: "session", permission: "users.manage", csrf: true },
  { method: "GET", path: "/roles", access: "session", permission: "roles.manage", csrf: false },
  { method: "GET", path: "/roles/:id", access: "session", permission: "roles.manage", csrf: false },
  { method: "PATCH", path: "/roles/:id/permissions", access: "session", permission: "roles.manage", csrf: true },

  { method: "POST", path: "/chat", access: "session", permission: "chats.manage.own", csrf: true, rateLimit: "llm" },
  { method: "POST", path: "/chat/confirm", access: "session", permission: "operations.confirm.own", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/chat/reset", access: "session", permission: "chats.manage.own", csrf: true },

  { method: "GET", path: "/bitrix/actions", access: "session", csrf: false },
  { method: "POST", path: "/bitrix/action", access: "session", permission: "operations.prepare", csrf: true, rateLimit: "write" },
  { method: "GET", path: "/bitrix/deal/:id", access: "session", permission: "crm.read.own", csrf: false },
  { method: "POST", path: "/bitrix/deal/:id/analyze", access: "session", permission: "crm.context.read", csrf: true, rateLimit: "llm" },
  { method: "POST", path: "/bitrix/deal/:id/analyze/save/prepare", access: "session", permission: "operations.prepare", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/bitrix/event", access: "service_token", csrf: false, rateLimit: "webhook" },
  { method: "POST", path: "/test/claude", access: "session", permission: "settings.manage", csrf: true, rateLimit: "llm" },

  { method: "GET", path: "/operations", access: "session", permission: "operations.view.own", csrf: false },
  { method: "GET", path: "/operations/pending", access: "session", permission: "operations.view.own", csrf: false },
  { method: "GET", path: "/operations/:id", access: "session", permission: "operations.view.own", csrf: false },
  { method: "POST", path: "/operations/:id/cancel", access: "session", permission: "operations.confirm.own", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/operations/:id/recover", access: "session", permission: "operations.view.all", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/operations/:id/rollback/prepare", access: "session", permission: "operations.rollback", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/operations/rollback/commit", access: "session", permission: "operations.rollback", csrf: true, rateLimit: "write" },
  { method: "GET", path: "/actions/history", access: "session", permission: "audit.view", csrf: false },

  { method: "POST", path: "/settings/llm-transport/test", access: "session", permission: "settings.manage", csrf: true },
  { method: "GET", path: "/settings", access: "session", permission: "settings.view", csrf: false },
  { method: "GET", path: "/settings/:key", access: "session", permission: "settings.view", csrf: false },
  { method: "PUT", path: "/settings/:key", access: "session", permission: "settings.manage", csrf: true },

  { method: "GET", path: "/profiles", access: "session", permission: "profiles.view", csrf: false },
  { method: "POST", path: "/profiles", access: "session", permission: "profiles.manage", csrf: true },
  { method: "GET", path: "/profiles/:id", access: "session", permission: "profiles.view", csrf: false },
  { method: "PATCH", path: "/profiles/:id", access: "session", permission: "profiles.manage", csrf: true },
  { method: "POST", path: "/profiles/:id/activate", access: "session", permission: "profiles.manage", csrf: true },

  { method: "GET", path: "/projects", access: "session", permission: "projects.view", csrf: false },
  { method: "POST", path: "/projects", access: "session", permission: "projects.manage", csrf: true },
  { method: "GET", path: "/projects/:id", access: "session", permission: "projects.view", csrf: false },
  { method: "PATCH", path: "/projects/:id", access: "session", permission: "projects.manage", csrf: true },
  { method: "POST", path: "/projects/:id/archive", access: "session", permission: "projects.manage", csrf: true },
  { method: "POST", path: "/projects/:id/restore", access: "session", permission: "projects.manage", csrf: true },
  { method: "POST", path: "/projects/:id/duplicate", access: "session", permission: "projects.manage", csrf: true },
  { method: "DELETE", path: "/projects/:id", access: "session", permission: "projects.manage", csrf: true },
  { method: "GET", path: "/projects/:id/files", access: "session", permission: "projects.view", csrf: false },
  { method: "POST", path: "/projects/:id/files", access: "session", permission: "projects.manage", csrf: true },
  { method: "DELETE", path: "/projects/:id/files/:fileId", access: "session", permission: "projects.manage", csrf: true },
  { method: "PUT", path: "/projects/:id/meeting-protocol-template", access: "session", permission: "projects.manage", csrf: true },

  { method: "GET", path: "/chats", access: "session", permission: "chats.manage.own", csrf: false },
  { method: "POST", path: "/chats", access: "session", permission: "chats.manage.own", csrf: true },
  { method: "GET", path: "/chats/:id", access: "session", permission: "chats.manage.own", csrf: false },
  { method: "GET", path: "/chats/:id/messages", access: "session", permission: "chats.manage.own", csrf: false },
  { method: "PATCH", path: "/chats/:id", access: "session", permission: "chats.manage.own", csrf: true },
  { method: "DELETE", path: "/chats/:id", access: "session", permission: "chats.manage.own", csrf: true },
  { method: "POST", path: "/chats/:id/restore", access: "session", permission: "chats.manage.own", csrf: true },
  { method: "POST", path: "/chats/:id/duplicate", access: "session", permission: "chats.manage.own", csrf: true },
  { method: "GET", path: "/search", access: "session", permission: "chats.manage.own", csrf: false },

  { method: "GET", path: "/crm/context/:entityType/:entityId", access: "session", permission: "crm.context.read", csrf: false },
  { method: "POST", path: "/crm/context/summary", access: "session", permission: "crm.context.read", csrf: true },
  { method: "POST", path: "/meeting-transcripts", access: "session", permission: "crm.context.read", csrf: true },
  { method: "GET", path: "/meeting-transcripts/:id", access: "session", permission: "crm.context.read", csrf: false },
  { method: "GET", path: "/meeting-transcripts", access: "session", permission: "crm.context.read", csrf: false },
  { method: "POST", path: "/meeting-protocols/generate", access: "session", permission: "crm.context.read", csrf: true },
  { method: "GET", path: "/meeting-protocols/:id", access: "session", permission: "crm.context.read", csrf: false },
  { method: "GET", path: "/meeting-protocols", access: "session", permission: "crm.context.read", csrf: false },
  { method: "PATCH", path: "/meeting-protocols/:id", access: "session", permission: "crm.context.read", csrf: true },
  { method: "POST", path: "/meeting-protocols/:id/save-to-crm/prepare", access: "session", permission: "operations.prepare", csrf: true, rateLimit: "write" },
  { method: "GET", path: "/meeting-protocol-templates", access: "session", permission: "projects.view", csrf: false },
  { method: "POST", path: "/client-message/draft", access: "session", permission: "communications.draft", csrf: true },
  { method: "POST", path: "/client-next-action/recommend", access: "session", permission: "crm.context.read", csrf: true },

  { method: "GET", path: "/scheduled-report-types", access: "session", permission: "schedules.view", csrf: false },
  { method: "GET", path: "/scheduled-reports", access: "session", permission: "schedules.view", csrf: false },
  { method: "POST", path: "/scheduled-reports", access: "session", permission: "schedules.manage", csrf: true },
  { method: "GET", path: "/scheduled-reports/:id", access: "session", permission: "schedules.view", csrf: false },
  { method: "PATCH", path: "/scheduled-reports/:id", access: "session", permission: "schedules.manage", csrf: true },
  { method: "POST", path: "/scheduled-reports/:id/enable", access: "session", permission: "schedules.manage", csrf: true },
  { method: "POST", path: "/scheduled-reports/:id/disable", access: "session", permission: "schedules.manage", csrf: true },
  { method: "POST", path: "/scheduled-reports/:id/run-now", access: "session", permission: "schedules.manage", csrf: true },
  { method: "GET", path: "/scheduled-reports/:id/runs", access: "session", permission: "schedules.view", csrf: false },
  { method: "GET", path: "/scheduled-report-runs/:id", access: "session", permission: "reports.view", csrf: false },
  { method: "POST", path: "/scheduled-report-runs/:id/retry", access: "session", permission: "schedules.manage", csrf: true },

  { method: "GET", path: "/notifications", access: "session", permission: "notifications.view", csrf: false },
  { method: "GET", path: "/notifications/unread-count", access: "session", permission: "notifications.view", csrf: false },
  { method: "GET", path: "/notifications/:id", access: "session", permission: "notifications.view", csrf: false },
  { method: "POST", path: "/notifications/:id/read", access: "session", permission: "notifications.view", csrf: true },
  { method: "POST", path: "/notifications/read-all", access: "session", permission: "notifications.view", csrf: true },

  { method: "GET", path: "/communication-channels", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communication-channels/detect", access: "session", permission: "communications.view.own", csrf: true },
  { method: "GET", path: "/communication-channels/:id", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/message-drafts", access: "session", permission: "communications.draft", csrf: true },
  { method: "GET", path: "/message-drafts", access: "session", permission: "communications.view.own", csrf: false },
  { method: "GET", path: "/message-drafts/:id", access: "session", permission: "communications.view.own", csrf: false },
  { method: "PATCH", path: "/message-drafts/:id", access: "session", permission: "communications.draft", csrf: true },
  { method: "POST", path: "/message-drafts/:id/cancel", access: "session", permission: "communications.draft", csrf: true },
  { method: "POST", path: "/message-drafts/:id/send/prepare", access: "session", permission: "communications.send", csrf: true, rateLimit: "write" },
  { method: "GET", path: "/outbound-messages", access: "session", permission: "communications.view.own", csrf: false },
  { method: "GET", path: "/outbound-messages/:id", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/outbound-messages/:id/verify", access: "session", permission: "communications.view.own", csrf: true },
  { method: "POST", path: "/communication-events/:channel", access: "service_token", csrf: false, rateLimit: "webhook" },

  // Communications Hub + provider webhooks (secret in URL — public, no session)
  { method: "POST", path: "/webhooks/wazzup/:secret", access: "public", csrf: false, rateLimit: "webhook" },
  { method: "POST", path: "/webhooks/max/:secret", access: "public", csrf: false, rateLimit: "webhook" },

  { method: "GET", path: "/communications/overview", access: "session", permission: "communications.view.own", csrf: false },
  { method: "GET", path: "/communications/channels", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/channels/sync", access: "session", permission: "communications.manage", csrf: true },
  { method: "POST", path: "/communications/test-connection", access: "session", permission: "communications.manage", csrf: true },
  { method: "GET", path: "/communications/threads", access: "session", permission: "communications.view.own", csrf: false },
  { method: "GET", path: "/communications/threads/:id", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/threads/:id/draft", access: "session", permission: "communications.draft", csrf: true },
  { method: "POST", path: "/communications/messages/prepare", access: "session", permission: "communications.send", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/messages/commit", access: "session", permission: "operations.confirm.own", csrf: true, rateLimit: "write" },

  { method: "GET", path: "/communications/templates", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/templates", access: "session", permission: "communications.manage", csrf: true },
  { method: "PATCH", path: "/communications/templates/:id", access: "session", permission: "communications.manage", csrf: true },
  { method: "DELETE", path: "/communications/templates/:id", access: "session", permission: "communications.manage", csrf: true },

  { method: "GET", path: "/communications/sequences", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/sequences", access: "session", permission: "communications.manage", csrf: true },
  { method: "PATCH", path: "/communications/sequences/:id", access: "session", permission: "communications.manage", csrf: true },
  { method: "POST", path: "/communications/sequences/:id/activate/prepare", access: "session", permission: "communications.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/sequences/:id/enroll/prepare", access: "session", permission: "communications.send", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/enrollments/:id/stop/prepare", access: "session", permission: "communications.send", csrf: true, rateLimit: "write" },

  { method: "GET", path: "/communications/campaigns", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/campaigns", access: "session", permission: "communications.manage", csrf: true },
  { method: "PATCH", path: "/communications/campaigns/:id", access: "session", permission: "communications.manage", csrf: true },
  { method: "POST", path: "/communications/campaigns/:id/preview", access: "session", permission: "communications.send", csrf: true },
  { method: "POST", path: "/communications/campaigns/:id/start/prepare", access: "session", permission: "communications.send", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/campaigns/:id/pause/prepare", access: "session", permission: "communications.send", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/campaigns/:id/cancel/prepare", access: "session", permission: "communications.send", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/campaigns/:id/pause", access: "session", permission: "communications.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/campaigns/:id/resume", access: "session", permission: "communications.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/campaigns/:id/cancel", access: "session", permission: "communications.manage", csrf: true, rateLimit: "write" },

  { method: "GET", path: "/communications/certifications", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/certifications", access: "session", permission: "communications.manage", csrf: true },
  { method: "GET", path: "/communications/certifications/:id", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/certifications/:id/run", access: "session", permission: "communications.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/communications/certifications/:id/revoke", access: "session", permission: "communications.manage", csrf: true, rateLimit: "write" },
  { method: "GET", path: "/communications/provider-contract", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/provider-contract/refresh", access: "session", permission: "communications.manage", csrf: true },

  { method: "POST", path: "/admin/communications/emergency-stop", access: "session", permission: "settings.manage", csrf: true, rateLimit: "write" },
  { method: "POST", path: "/admin/communications/emergency-resume", access: "session", permission: "settings.manage", csrf: true, rateLimit: "write" },

  { method: "GET", path: "/communications/delivery", access: "session", permission: "communications.view.own", csrf: false },
  { method: "GET", path: "/communications/analytics", access: "session", permission: "communications.view.own", csrf: false },
  { method: "GET", path: "/communications/suppressions", access: "session", permission: "communications.view.own", csrf: false },
  { method: "POST", path: "/communications/identities/:id/resolve", access: "session", permission: "communications.manage", csrf: true },
  { method: "GET", path: "/communications/settings", access: "session", permission: "communications.view.own", csrf: false },

  { method: "GET", path: "/documents/templates", access: "session", permission: "reports.view", csrf: false },
  { method: "GET", path: "/documents/list", access: "session", permission: "reports.view", csrf: false },
  { method: "POST", path: "/documents/generate", access: "session", permission: "reports.run", csrf: true },
  { method: "POST", path: "/documents/export-html", access: "session", permission: "reports.view", csrf: true },
  { method: "GET", path: "/reports/quick", access: "session", permission: "reports.view", csrf: false },
  { method: "POST", path: "/reports/quick/:id/run", access: "session", permission: "reports.run", csrf: true },
];

export function normalizeRoutePath(path) {
  if (!path) return "/";
  // Express mounts may include regex; strip query
  return String(path).split("?")[0];
}

export function matchRoutePolicy(method, path) {
  const m = String(method || "GET").toUpperCase();
  const p = normalizeRoutePath(path);
  for (const policy of ROUTE_POLICIES) {
    if (policy.method !== m) continue;
    const re = new RegExp(
      "^" +
        policy.path
          .replace(/:[^/]+/g, "[^/]+")
          .replace(/\*/g, ".*") +
        "$"
    );
    if (re.test(p)) return policy;
  }
  return null;
}

/**
 * Collect Express stack routes (best-effort).
 */
export function collectExpressRoutes(app) {
  const routes = [];
  function walk(stack, prefix = "") {
    if (!stack) return;
    for (const layer of stack) {
      if (layer.route?.path) {
        const methods = Object.keys(layer.route.methods || {})
          .filter((k) => layer.route.methods[k])
          .map((k) => k.toUpperCase());
        for (const method of methods) {
          const path = (prefix + layer.route.path).replace(/\/+/g, "/");
          routes.push({ method, path });
        }
      } else if (layer.name === "router" && layer.handle?.stack) {
        const mount = layer.regexp?.fast_slash
          ? ""
          : (layer.regexp?.toString().match(/\\\/([^\\^$?]+)/)?.[1]
              ? `/${layer.regexp.toString().match(/\\\/([^\\^$?]+)/)[1]}`
              : "");
        walk(layer.handle.stack, prefix + (mount || ""));
      }
    }
  }
  walk(app?._router?.stack || app?.router?.stack);
  return routes;
}

export function auditRoutePolicies(app, { isProduction = false } = {}) {
  const registered = collectExpressRoutes(app);
  const missing = [];
  const covered = [];
  for (const r of registered) {
    if (r.path === "/" || r.path.startsWith("/public") || /\.[a-z0-9]+$/i.test(r.path)) continue;
    const policy = matchRoutePolicy(r.method, r.path);
    if (!policy) missing.push(r);
    else covered.push({ ...r, policy });
  }

  // Also ensure policies aren't orphans for critical POST without csrf
  const csrfGaps = ROUTE_POLICIES.filter(
    (p) =>
      ["POST", "PUT", "PATCH", "DELETE"].includes(p.method) &&
      p.access === "session" &&
      p.csrf !== true &&
      p.path !== "/auth/login"
  );

  if (missing.length && isProduction) {
    const err = new Error(
      `UNSAFE_PRODUCTION_ACCESS_CONFIGURATION: ${missing.length} routes without policy`
    );
    err.code = "UNSAFE_PRODUCTION_ACCESS_CONFIGURATION";
    err.details = { missing };
    throw err;
  }
  if (missing.length) {
    console.warn(
      `[RoutePolicy] CRITICAL: ${missing.length} routes without policy:`,
      missing.slice(0, 20)
    );
  }
  return {
    registeredCount: registered.length,
    coveredCount: covered.length,
    missing,
    csrfGaps,
  };
}
