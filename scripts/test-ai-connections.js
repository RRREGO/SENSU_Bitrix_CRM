/**
 * Tests for AI connections: secrets, proxy validation, prompt compiler, model resolver, flags.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tmpDb = path.join(os.tmpdir(), `ai-conn-test-${Date.now()}.sqlite`);

process.env.SECRETS_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
process.env.CUSTOM_PROXY_ENABLED = "false";
process.env.PROMPT_PROFILES_ENABLED = "true";
process.env.USER_AI_PROVIDERS_ENABLED = "true";
process.env.CHAT_MODEL_SELECTION_ENABLED = "true";
process.env.VOICE_INPUT_ENABLED = "true";
process.env.EMAIL_SEND_ENABLED = "false";
process.env.EMAIL_DRY_RUN = "true";
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "sk-ant-test-not-real";

let passed = 0;
function ok(name) {
  passed += 1;
  console.log(`  OK ${name}`);
}

async function main() {
  console.log("test-ai-connections");

  const { openDatabase, closeDatabase } = await import("../src/database/index.js");
  openDatabase({ dbPath: tmpDb, reopen: true });

  // Secrets
  {
    const { encryptSecret, decryptSecret, maskSecret, isSecretsConfigured } = await import(
      "../src/connections/secretsService.js"
    );
    assert.equal(isSecretsConfigured(), true);
    const enc = encryptSecret("super-secret-key");
    assert.ok(enc.startsWith("v1:"));
    assert.equal(decryptSecret(enc), "super-secret-key");
    assert.ok(!String(maskSecret("abcdef1234")).includes("abcdef"));
    ok("secrets encrypt/decrypt/mask");
  }

  // Prompt compiler order + variables + unknown vars
  {
    const { compileSystemPrompt, interpolatePromptVariables } = await import(
      "../src/connections/prompts/promptCompiler.js"
    );
    assert.equal(interpolatePromptVariables("Hi {{user_name}}!", { user_name: "Ivan" }), "Hi Ivan!");
    assert.equal(interpolatePromptVariables("x {{evil_code}} y", {}), "x  y");
    const compiled = compileSystemPrompt({
      userMessage: "что ты умеешь",
      vars: { user_name: "Test" },
    });
    assert.ok(compiled.systemPrompt.includes("Правила безопасности"));
    assert.ok(compiled.systemPrompt.includes("run_bitrix_action") || compiled.layers.tools);
    assert.ok(compiled.layers.safety);
    assert.ok(compiled.layers.tools);
    // user cannot strip safety by empty profile
    assert.ok(compiled.systemPrompt.indexOf(compiled.layers.safety) >= 0);
    ok("prompt compiler hierarchy + variables");
  }

  // System proxy only (user profiles disabled)
  {
    const { validateProxyHostPort, resolveProxy } = await import("../src/connections/proxyResolver.js");
    validateProxyHostPort("proxy.example.com", 8080);
    let threw = false;
    try {
      validateProxyHostPort("http://bad", 80);
    } catch {
      threw = true;
    }
    assert.ok(threw, "reject scheme in host");
    const profileMode = resolveProxy({ mode: "profile", proxyProfileId: "x" });
    assert.equal(profileMode.mode, "system", "profile mode maps to system");
    const noneMode = resolveProxy({ mode: "none" });
    assert.equal(noneMode.mode, "none");
    ok("proxy is system-only (profile ignored)");
  }

  // AI provider create + mask
  {
    const { createAiProvider, getAiProviderById, getProviderApiKey, upsertAiModel, listAiModels } =
      await import("../src/database/repositories/aiProvidersRepository.js");
    const prov = createAiProvider({
      name: "Local OpenAI",
      providerType: "openai_compatible",
      baseUrl: "https://example.invalid/v1",
      apiKey: "sk-test-secret-key-value",
      proxyMode: "system",
    });
    assert.ok(prov.apiKey.configured);
    assert.ok(!JSON.stringify(prov).includes("sk-test-secret-key-value"));
    const raw = getProviderApiKey(prov.id);
    assert.equal(raw, "sk-test-secret-key-value");
    const model = upsertAiModel({
      providerId: prov.id,
      apiModelName: "gpt-test",
      displayName: "GPT Test",
      supportsTools: true,
      capabilitiesSource: "manual",
    });
    assert.equal(listAiModels({ providerId: prov.id }).length, 1);
    assert.equal(getAiProviderById(prov.id).id, prov.id);
    assert.ok(model.supportsTools);
    ok("ai provider encrypt + manual model");
  }

  // Model resolver hierarchy
  {
    const { resolveChatModel } = await import("../src/connections/ai/modelResolver.js");
    const withChat = resolveChatModel({
      chat: { aiModelId: null },
      project: null,
      userId: null,
    });
    // May pick DB provider first model if providers exist — source must be defined
    assert.ok(withChat.apiModelName);
    assert.ok(["system", "provider_first", "provider_default", "user", "chat", "project"].includes(withChat.source));
    ok("model resolver returns model name");
  }

  // Feature flags safe defaults
  {
    const { getConnectionsFeatureFlags } = await import("../src/connections/config.js");
    const f = getConnectionsFeatureFlags();
    assert.equal(f.emailSendEnabled, false);
    assert.equal(f.emailDryRun, true);
    assert.equal(f.customProxyEnabled, false);
    ok("feature flags safe email defaults");
  }

  // Profile versions
  {
    const { createProfile, updateProfile, listProfileVersions, duplicateProfile } = await import(
      "../src/database/repositories/profilesRepository.js"
    );
    const p = createProfile({ name: "Audit Profile", baseInstruction: "Be concise {{project_name}}" });
    const p2 = updateProfile(p.id, { baseInstruction: "v2 instruction" });
    assert.ok(p2.version >= 2);
    const versions = listProfileVersions(p.id);
    assert.ok(versions.length >= 1);
    const dup = duplicateProfile(p.id);
    assert.ok(dup.name.includes("копия"));
    ok("prompt profile versions + duplicate");
  }

  // Unified errors
  {
    const { ConnectionError, CONNECTION_ERROR_CODES } = await import("../src/connections/errors.js");
    const e = new ConnectionError(CONNECTION_ERROR_CODES.TIMEOUT, "timeout", {
      authorization: "Bearer secret",
    });
    const json = e.toJSON();
    assert.equal(json.error.code, "TIMEOUT");
    assert.ok(!JSON.stringify(json).includes("Bearer"));
    ok("connection errors redact details");
  }

  closeDatabase?.();
  try {
    fs.unlinkSync(tmpDb);
    fs.unlinkSync(`${tmpDb}-wal`);
    fs.unlinkSync(`${tmpDb}-shm`);
  } catch {
    /* ignore */
  }

  console.log(`\nPassed: ${passed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
