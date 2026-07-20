/**
 * Production smoke tests against a running instance.
 * Disabled by default — set PRODUCTION_SMOKE_TESTS_ENABLED=true to run.
 * npm run smoke:production
 */
import "dotenv/config";

const BASE = (process.env.SMOKE_BASE_URL || process.env.APP_PUBLIC_ORIGIN || "http://127.0.0.1:3005").replace(
  /\/$/,
  ""
);

async function fetchJson(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data };
}

async function main() {
  if (process.env.PRODUCTION_SMOKE_TESTS_ENABLED !== "true") {
    console.log(
      "[smoke:production] Пропущено: PRODUCTION_SMOKE_TESTS_ENABLED не установлен в true.\n" +
        "  Для запуска: PRODUCTION_SMOKE_TESTS_ENABLED=true SMOKE_BASE_URL=https://crm.example.com npm run smoke:production"
    );
    process.exit(0);
  }

  let failed = 0;

  const health = await fetchJson("/health");
  if (!health.ok || health.data?.ok !== true) {
    console.error(`✗ GET /health — status=${health.status}`);
    failed += 1;
  } else {
    console.log("✓ GET /health");
  }

  const readiness = await fetchJson("/health/readiness");
  if (!readiness.ok || readiness.data?.ready !== true) {
    console.error(`✗ GET /health/readiness — status=${readiness.status}`, readiness.data?.critical || "");
    failed += 1;
  } else {
    console.log("✓ GET /health/readiness");
  }

  if (process.env.SMOKE_LOGIN_USERNAME && process.env.SMOKE_LOGIN_PASSWORD) {
    const login = await fetchJson("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: process.env.SMOKE_LOGIN_USERNAME,
        password: process.env.SMOKE_LOGIN_PASSWORD,
      }),
    });
    if (!login.ok || login.data?.success === false) {
      console.error("✗ POST /auth/login (smoke credentials)");
      failed += 1;
    } else {
      console.log("✓ POST /auth/login (optional smoke credentials)");
    }
  } else {
    console.log("○ POST /auth/login — пропущено (SMOKE_LOGIN_USERNAME/PASSWORD не заданы)");
  }

  console.log(`\n[smoke:production] ${failed ? "FAILED" : "OK"} (${failed} failures)\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
