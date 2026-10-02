/**
 * MCP Streamable HTTP + OAuth (PKCE) against a temporary database.
 * npm run test:mcp
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import express from "express";

const tmpDb = path.join(os.tmpdir(), `mcp-test-${Date.now()}.sqlite`);
process.env.APP_DATABASE_PATH = tmpDb;
process.env.BITRIX_OPERATIONS_DB_PATH = tmpDb;
process.env.MCP_ENABLED = "true";
process.env.APP_ACCESS_MODE = "authenticated";
process.env.APP_BOOTSTRAP_ADMIN_USERNAME = "admin";
process.env.APP_BOOTSTRAP_ADMIN_PASSWORD = "Str0ng!Bootstrap#99";
process.env.APP_BOOTSTRAP_ADMIN_DISPLAY_NAME = "Администратор";
process.env.AUTH_PASSWORD_MIN_LENGTH = "12";
process.env.AUTH_PASSWORD_REQUIRE_COMPLEXITY = "true";
process.env.AUTH_COOKIE_SECURE = "false";
process.env.BITRIX_WRITE_ENABLED = "true";
process.env.NODE_ENV = "development";
delete process.env.APP_PUBLIC_ORIGIN;

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
  }
}

function storeCookies(jar, res) {
  const lines = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  for (const line of lines) {
    const part = line.split(";")[0];
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    jar.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
}

async function request(base, urlPath, { method = "GET", headers = {}, body, jar } = {}) {
  const h = { ...headers };
  if (jar?.size) h.cookie = [...jar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
  const res = await fetch(`${base}${urlPath}`, { method, headers: h, body, redirect: "manual" });
  if (jar) storeCookies(jar, res);
  return res;
}

async function main() {
  const { openDatabase, closeDatabase, getDatabase } = await import("../src/database/index.js");
  const { bootstrapAdminIfNeeded } = await import("../src/auth/bootstrapAdmin.js");
  const { createMcpRouter } = await import("../src/mcp/routes.js");
  const { isAllowedRedirectUri } = await import("../src/mcp/oauth.js");
  const { matchRoutePolicy } = await import("../src/auth/routePolicies.js");
  const { createPersonalAccessToken, revokePersonalAccessToken } = await import("../src/mcp/store.js");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");

  openDatabase({ dbPath: tmpDb, reopen: true });
  const version = getDatabase().prepare("SELECT MAX(version) AS v FROM schema_migrations").get()?.v;
  assert(version >= 18, "1. Миграция MCP");
  assert(matchRoutePolicy("POST", "/mcp")?.access === "service_token", "2. Политика POST /mcp");
  assert(matchRoutePolicy("POST", "/mcp/tokens")?.csrf === true, "3. Создание токена требует CSRF");
  assert(isAllowedRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect"), "4. Redirect ChatGPT разрешён");
  assert(!isAllowedRedirectUri("https://evil.example/steal"), "5. Чужой redirect запрещён");
  assert(isAllowedRedirectUri("http://127.0.0.1:9/callback"), "6. Loopback callback разрешён");

  await bootstrapAdminIfNeeded();
  getDatabase().prepare("UPDATE app_users SET must_change_password = 0 WHERE username = ?").run("admin");
  const admin = getDatabase().prepare("SELECT id FROM app_users WHERE username = ?").get("admin");

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(createMcpRouter());
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;

  try {
    const metadata = await (await request(base, "/.well-known/oauth-authorization-server")).json();
    assert(
      metadata.code_challenge_methods_supported?.includes("S256") &&
        metadata.authorization_response_iss_parameter_supported === true &&
        metadata.issuer === base,
      "7. Метаданные OAuth"
    );

    const anon = await request(base, "/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert(anon.status === 401 && (anon.headers.get("www-authenticate") || "").includes("oauth-protected-resource"), "8. Без токена 401 и подсказка OAuth");

    const evil = await request(base, "/oauth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "evil",
        redirect_uris: ["https://evil.example/steal"],
        token_endpoint_auth_method: "none",
      }),
    });
    assert(evil.status === 400, "9. Регистрация с чужим redirect отклонена");

    const redirectUri = "http://127.0.0.1:9/callback";
    const registered = await (
      await request(base, "/oauth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Test client",
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "none",
        }),
      })
    ).json();
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = "state-1";
    const jar = new Map();
    const authorize = await request(
      base,
      `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: registered.client_id,
        redirect_uri: redirectUri,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        scope: "mcp offline_access",
        resource: base,
      })}`,
      { jar }
    );
    assert(authorize.status === 302 && authorize.headers.get("location") === "/oauth/login", "10. Authorize ведёт на вход");

    const login = await request(base, "/oauth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: "admin", password: "Str0ng!Bootstrap#99" }),
      jar,
    });
    assert(login.status === 302 && login.headers.get("location") === "/oauth/consent", "11. Вход открывает согласие");

    const consentPage = await request(base, "/oauth/consent", { jar });
    const consentHtml = await consentPage.text();
    assert(consentPage.status === 200 && consentHtml.includes("Разрешить"), "12. Страница согласия");

    const approved = await request(base, "/oauth/consent", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ decision: "approve" }),
      jar,
    });
    const back = new URL(approved.headers.get("location"));
    assert(
      approved.status === 302 && back.searchParams.get("state") === state && back.searchParams.get("iss") === base,
      "13. Код возвращён с iss"
    );

    const tokenRes = await request(base, "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: back.searchParams.get("code"),
        redirect_uri: redirectUri,
        client_id: registered.client_id,
        code_verifier: verifier,
        resource: base,
      }),
    });
    const tokens = await tokenRes.json();
    assert(tokenRes.status === 200 && tokens.access_token && tokens.refresh_token, "14. Обмен кода на токен");

    const reused = await request(base, "/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: back.searchParams.get("code"),
        redirect_uri: redirectUri,
        client_id: registered.client_id,
        code_verifier: verifier,
        resource: base,
      }),
    });
    assert(reused.status === 400, "15. Код одноразовый");

    const refreshAsBearer = await request(base, "/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.refresh_token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert(refreshAsBearer.status === 401, "16. Refresh token не работает как access token");

    const pat = createPersonalAccessToken({ userId: admin.id, name: "test" });
    const client = new Client({ name: "mcp-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${pat.token}` } },
    });
    await client.connect(transport);
    const listed = await client.listTools();
    const names = (listed.tools || []).map((tool) => tool.name);
    assert(
      names.includes("search_crm_actions") &&
        names.includes("run_crm_action") &&
        names.includes("confirm_crm_operation"),
      "17. Клиент MCP видит инструменты"
    );
    const found = await client.callTool({ name: "search_crm_actions", arguments: { query: "сделки" } });
    const foundText = found.content?.map((part) => part.text || "").join("\n") || "";
    assert(foundText.includes("deal_list"), "18. Поиск действий находит сделки");
    const missing = await client.callTool({
      name: "confirm_crm_operation",
      arguments: { confirmationId: "missing-confirmation-id" },
    });
    const missingText = missing.content?.map((part) => part.text || "").join("\n") || "";
    assert(missing.isError === true && missingText.includes("OPERATION_NOT_FOUND"), "19. Чужое подтверждение не выполняется");
    await client.close();

    revokePersonalAccessToken(admin.id, pat.id);
    const revoked = await request(base, "/mcp", {
      method: "POST",
      headers: {
        authorization: `Bearer ${pat.token}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    assert(revoked.status === 401, "20. Отозванный токен не принимается");

    const oauthClient = new Client({ name: "mcp-oauth-test", version: "1.0.0" });
    const oauthTransport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
    });
    await oauthClient.connect(oauthTransport);
    const oauthTools = await oauthClient.listTools();
    assert((oauthTools.tools || []).some((tool) => tool.name === "run_crm_action"), "21. OAuth access token открывает MCP");
    await oauthClient.close();
  } finally {
    await new Promise((resolve) => server.close(resolve));
    closeDatabase();
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(tmpDb + suffix, { force: true });
    }
  }

  console.log(`\n[test:mcp] passed=${passed} failed=${failed}`);
  if (failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
