/**
 * Routes for proxy, AI providers/models, voice, SMTP, prompt preview.
 */

import express from "express";
import { ConnectionError } from "./errors.js";
import { getConnectionsFeatureFlags } from "./config.js";
import { isSecretsConfigured } from "./secretsService.js";
import {
  listAiProviders,
  getAiProviderById,
  createAiProvider,
  updateAiProvider,
  deleteAiProvider,
  listAiModels,
  getAiModelById,
  upsertAiModel,
  updateAiModel,
  deleteAiModel,
} from "../database/repositories/aiProvidersRepository.js";
import { testAiProvider, syncAiProviderModels, listSystemAnthropicModels } from "./ai/providerService.js";
import {
  listModelsGroupedForChat,
  resolveChatModel,
  getUserAiSettings,
  upsertUserAiSettings,
  validateModelCapabilities,
  systemModelSelectionId,
} from "./ai/modelResolver.js";
import { previewPromptCompilation, PROMPT_SAFE_VARIABLES } from "./prompts/promptCompiler.js";
import {
  duplicateProfile,
  listProfileVersions,
  restoreProfileVersion,
  assignPromptProfile,
  getProfileById,
} from "../database/repositories/profilesRepository.js";
import {
  listSmtpAccounts,
  getSmtpAccountById,
  createSmtpAccount,
  updateSmtpAccount,
  deleteSmtpAccount,
  testSmtpAccount,
  isEmailSendAllowed,
} from "../database/repositories/smtpAccountsRepository.js";
import { transcribeAudio } from "./speech/speechService.js";
import { hasPermission } from "../auth/authorizationService.js";
import { AuthError } from "../auth/config.js";
import * as commService from "../communications/communicationService.js";
import { getCommunicationsConfig } from "../communications/config.js";
import { getChatById, updateChat } from "../database/repositories/chatsRepository.js";
import { getProjectById } from "../database/repositories/projectsRepository.js";
import { authorizeChatAccess } from "../auth/resourceOwnership.js";

function sendErr(res, error, status = 400) {
  if (error instanceof AuthError) {
    return res.status(403).json(error.toJSON());
  }
  if (error instanceof ConnectionError) {
    return res.status(status).json(error.toJSON());
  }
  if (error?.code && error?.toJSON) {
    return res.status(status).json(error.toJSON());
  }
  return res.status(500).json({
    success: false,
    error: { code: "EXTERNAL_SERVICE_ERROR", message: "Внутренняя ошибка подключения." },
  });
}

function requirePerm(user, perm) {
  const aliases = {
    manage_prompt_profiles: ["profiles.manage", "settings.manage"],
    assign_prompt_profiles: ["profiles.manage", "settings.manage"],
    manage_proxy_profiles: ["settings.manage"],
    manage_ai_providers: ["settings.manage"],
    manage_ai_models: ["settings.manage"],
    use_ai_provider: ["settings.view", "settings.manage", "chats.manage.own"],
    select_chat_model: ["chats.manage.own", "settings.manage"],
    use_voice_input: ["chats.manage.own", "settings.manage"],
    manage_communication_accounts: ["communications.manage", "settings.manage"],
    send_wazzup_messages: ["communications.send", "settings.manage"],
    send_email_messages: ["communications.send", "settings.manage"],
    approve_external_send: ["operations.confirm.own", "communications.send", "settings.manage"],
  };
  if (hasPermission(user, perm) || hasPermission(user, "settings.manage")) return;
  for (const a of aliases[perm] || []) {
    if (hasPermission(user, a)) return;
  }
  throw new AuthError("FORBIDDEN", `Недостаточно прав: ${perm}`);
}

export function createConnectionsRouter() {
  const router = express.Router();

  router.get("/settings/connections/flags", (req, res) => {
    res.json({
      success: true,
      flags: getConnectionsFeatureFlags(),
      secretsConfigured: isSecretsConfigured(),
    });
  });

  // ---------- Proxy (user profiles disabled — use LLM_PROXY_* / ANTHROPIC_PROXY) ----------
  function proxyProfilesDisabled(res) {
    return res.status(410).json({
      success: false,
      disabled: true,
      error: {
        code: "PROXY_PROFILES_DISABLED",
        message:
          "Пользовательские прокси-профили отключены. Прокси задаётся администратором через LLM_PROXY_* / ANTHROPIC_PROXY.",
      },
    });
  }

  router.get("/settings/proxy-profiles", (req, res) => {
    try {
      requirePerm(req.user, "manage_proxy_profiles");
      return proxyProfilesDisabled(res);
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.post("/settings/proxy-profiles", (req, res) => {
    try {
      requirePerm(req.user, "manage_proxy_profiles");
      return proxyProfilesDisabled(res);
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.patch("/settings/proxy-profiles/:id", (req, res) => {
    try {
      requirePerm(req.user, "manage_proxy_profiles");
      return proxyProfilesDisabled(res);
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.delete("/settings/proxy-profiles/:id", (req, res) => {
    try {
      requirePerm(req.user, "manage_proxy_profiles");
      return proxyProfilesDisabled(res);
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.post("/settings/proxy-profiles/:id/test", async (req, res) => {
    try {
      requirePerm(req.user, "manage_proxy_profiles");
      return proxyProfilesDisabled(res);
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  // ---------- AI providers ----------
  router.get("/settings/ai/providers", (req, res) => {
    try {
      if (!hasPermission(req.user, "manage_ai_providers") && !hasPermission(req.user, "use_ai_provider") && !hasPermission(req.user, "settings.view")) {
        throw new AuthError("FORBIDDEN", "Недостаточно прав");
      }
      res.json({ success: true, providers: listAiProviders() });
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.post("/settings/ai/providers", (req, res) => {
    try {
      requirePerm(req.user, "manage_ai_providers");
      if (!isSecretsConfigured()) {
        throw new ConnectionError("INVALID_CONFIGURATION", "Задайте SECRETS_MASTER_KEY.");
      }
      const body = { ...(req.body || {}), proxyMode: "system", proxyProfileId: null };
      const provider = createAiProvider(body, req.user?.id);
      res.json({ success: true, provider });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get("/settings/ai/providers/:id", (req, res) => {
    try {
      requirePerm(req.user, "use_ai_provider");
      const provider = getAiProviderById(req.params.id);
      if (!provider) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Не найдено" } });
      res.json({ success: true, provider });
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.patch("/settings/ai/providers/:id", (req, res) => {
    try {
      requirePerm(req.user, "manage_ai_providers");
      const body = { ...(req.body || {}) };
      delete body.proxyMode;
      delete body.proxyProfileId;
      const provider = updateAiProvider(req.params.id, body);
      if (!provider) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Не найдено" } });
      res.json({ success: true, provider });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.delete("/settings/ai/providers/:id", (req, res) => {
    try {
      requirePerm(req.user, "manage_ai_providers");
      deleteAiProvider(req.params.id);
      res.json({ success: true });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post("/settings/ai/providers/:id/test", async (req, res) => {
    try {
      requirePerm(req.user, "manage_ai_providers");
      const result = await testAiProvider(req.params.id, {
        modelName: req.body?.modelName,
        actorUserId: req.user?.id,
      });
      res.json({ success: true, result });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post("/settings/ai/providers/:id/sync-models", async (req, res) => {
    try {
      requirePerm(req.user, "manage_ai_models");
      const result = await syncAiProviderModels(req.params.id, { actorUserId: req.user?.id });
      res.json(result);
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get("/settings/ai/models", (req, res) => {
    try {
      requirePerm(req.user, "use_ai_provider");
      res.json({
        success: true,
        models: listAiModels({
          providerId: req.query.providerId || undefined,
          onlyActive: req.query.active === "1",
        }),
      });
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.get("/settings/ai/models/available", async (req, res) => {
    try {
      requirePerm(req.user, "select_chat_model");
      const grouped = listModelsGroupedForChat(req.user?.id);
      const systemRemote = await listSystemAnthropicModels();
      const systemGroup = {
        providerId: null,
        providerName: "Claude (API)",
        providerType: "anthropic",
        models: systemRemote.map((m) => ({
          id: systemModelSelectionId(m.apiModelName),
          displayName: m.displayName || m.apiModelName,
          apiModelName: m.apiModelName,
          supportsTools: true,
          supportsVision: m.supportsVision !== false,
          contextWindow: m.contextWindow || null,
          isSystemApi: true,
        })),
      };
      const groups = systemGroup.models.length ? [systemGroup, ...grouped] : grouped;
      res.json({ success: true, groups });
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.post("/settings/ai/models", (req, res) => {
    try {
      requirePerm(req.user, "manage_ai_models");
      const model = upsertAiModel({ ...(req.body || {}), capabilitiesSource: "manual" });
      res.json({ success: true, model });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.patch("/settings/ai/models/:id", (req, res) => {
    try {
      requirePerm(req.user, "manage_ai_models");
      const model = updateAiModel(req.params.id, req.body || {});
      if (!model) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Не найдено" } });
      res.json({ success: true, model });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.delete("/settings/ai/models/:id", (req, res) => {
    try {
      requirePerm(req.user, "manage_ai_models");
      deleteAiModel(req.params.id);
      res.json({ success: true });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get("/settings/ai/user", (req, res) => {
    res.json({ success: true, settings: getUserAiSettings(req.user?.id) });
  });

  router.put("/settings/ai/user", (req, res) => {
    try {
      requirePerm(req.user, "select_chat_model");
      const settings = upsertUserAiSettings(req.user.id, req.body || {});
      res.json({ success: true, settings });
    } catch (e) {
      sendErr(res, e);
    }
  });

  // ---------- Prompt profiles extras ----------
  router.get("/profiles/variables", (_req, res) => {
    res.json({ success: true, variables: PROMPT_SAFE_VARIABLES });
  });

  router.post("/profiles/preview", (req, res) => {
    try {
      requirePerm(req.user, "manage_prompt_profiles");
      const reveal = hasPermission(req.user, "settings.manage");
      const preview = previewPromptCompilation(
        {
          userMessage: req.body?.userMessage || "пример",
          chat: req.body?.chatId ? getChatById(req.body.chatId) : null,
          project: req.body?.projectId ? getProjectById(req.body.projectId) : null,
          userId: req.user?.id,
          vars: req.body?.vars || {},
        },
        { revealSystem: reveal }
      );
      res.json({ success: true, preview });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post("/profiles/:id/duplicate", (req, res) => {
    try {
      requirePerm(req.user, "manage_prompt_profiles");
      const profile = duplicateProfile(req.params.id, req.user?.id);
      res.json({ success: true, profile });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.get("/profiles/:id/versions", (req, res) => {
    try {
      requirePerm(req.user, "manage_prompt_profiles");
      res.json({ success: true, versions: listProfileVersions(req.params.id) });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post("/profiles/:id/versions/:vid/restore", (req, res) => {
    try {
      requirePerm(req.user, "manage_prompt_profiles");
      const profile = restoreProfileVersion(req.params.id, req.params.vid, req.user?.id);
      res.json({ success: true, profile });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post("/profiles/:id/assign", (req, res) => {
    try {
      requirePerm(req.user, "assign_prompt_profiles");
      const assignment = assignPromptProfile({
        profileId: req.params.id,
        scopeType: req.body?.scopeType,
        scopeId: req.body?.scopeId,
        isDefault: Boolean(req.body?.isDefault),
      });
      res.json({ success: true, assignment });
    } catch (e) {
      sendErr(res, e);
    }
  });

  // ---------- Voice ----------
  router.post("/voice/transcribe", async (req, res) => {
    try {
      requirePerm(req.user, "use_voice_input");
      const result = await transcribeAudio({
        audioBase64: req.body?.audioBase64,
        mimeType: req.body?.mimeType,
        userId: req.user?.id,
        language: req.body?.language,
        durationSec: req.body?.durationSec,
      });
      console.log(
        `[Audit] voice_transcribe user=${req.user?.id} provider=${result.providerId} chars=${result.text?.length || 0}`
      );
      res.json(result);
    } catch (e) {
      sendErr(res, e);
    }
  });

  // ---------- SMTP ----------
  router.get("/settings/email/accounts", (req, res) => {
    try {
      requirePerm(req.user, "manage_communication_accounts");
      res.json({
        success: true,
        accounts: listSmtpAccounts(),
        sendFlags: isEmailSendAllowed(),
      });
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.post("/settings/email/accounts", (req, res) => {
    try {
      requirePerm(req.user, "manage_communication_accounts");
      if (!isSecretsConfigured()) {
        throw new ConnectionError("INVALID_CONFIGURATION", "Задайте SECRETS_MASTER_KEY.");
      }
      if (req.body?.verifyTls === false && !hasPermission(req.user, "settings.manage")) {
        throw new AuthError("FORBIDDEN", "Отключение проверки TLS доступно только администратору.");
      }
      const account = createSmtpAccount(req.body || {}, req.user?.id);
      res.json({ success: true, account });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.patch("/settings/email/accounts/:id", (req, res) => {
    try {
      requirePerm(req.user, "manage_communication_accounts");
      if (req.body?.verifyTls === false && !hasPermission(req.user, "settings.manage")) {
        throw new AuthError("FORBIDDEN", "Отключение проверки TLS доступно только администратору.");
      }
      const account = updateSmtpAccount(req.params.id, req.body || {});
      if (!account) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Не найдено" } });
      res.json({ success: true, account });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.delete("/settings/email/accounts/:id", (req, res) => {
    try {
      requirePerm(req.user, "manage_communication_accounts");
      deleteSmtpAccount(req.params.id);
      res.json({ success: true });
    } catch (e) {
      sendErr(res, e);
    }
  });

  router.post("/settings/email/accounts/:id/test", async (req, res) => {
    try {
      requirePerm(req.user, "manage_communication_accounts");
      const result = await testSmtpAccount(req.params.id);
      console.log(
        `[Audit] smtp_test user=${req.user?.id} account=${req.params.id} success=${result.success}`
      );
      res.json({ success: true, result });
    } catch (e) {
      sendErr(res, e);
    }
  });

  // ---------- Chat model + external send ----------
  router.get("/chats/:id/ai-resolution", (req, res) => {
    try {
      authorizeChatAccess(req.user, getChatById(req.params.id));
      const chat = getChatById(req.params.id);
      const project = chat?.projectId ? getProjectById(chat.projectId) : null;
      const resolved = resolveChatModel({ chat, project, userId: req.user?.id });
      const profile = chat?.promptProfileId ? getProfileById(chat.promptProfileId) : null;
      res.json({
        success: true,
        resolved: {
          source: resolved.source,
          apiModelName: resolved.apiModelName,
          modelId: resolved.model?.id || null,
          selectionId: resolved.model?.id || "",
          providerId: resolved.provider?.id || null,
          providerName: resolved.provider?.name || (resolved.useLegacyAnthropic ? "Claude (API)" : null),
          warnings: resolved.warnings,
        },
        promptProfile: profile ? { id: profile.id, name: profile.name } : null,
        flags: getConnectionsFeatureFlags(),
      });
    } catch (e) {
      sendErr(res, e, 403);
    }
  });

  router.post("/chat/external-send/prepare", (req, res) => {
    try {
      const channel = String(req.body?.channel || "").toLowerCase();
      const flags = getConnectionsFeatureFlags();
      if (channel === "email") {
        requirePerm(req.user, "send_email_messages");
        if (!flags.emailSendEnabled && !flags.emailDryRun) {
          throw new ConnectionError("INVALID_CONFIGURATION", "Отправка email отключена.");
        }
      } else {
        requirePerm(req.user, "send_wazzup_messages");
        if (!flags.wazzupChatSendEnabled) {
          throw new ConnectionError("INVALID_CONFIGURATION", "Отправка Wazzup из чата отключена.");
        }
        if (!getCommunicationsConfig().enabled) {
          throw new ConnectionError("INVALID_CONFIGURATION", "Communications Hub выключен.");
        }
      }

      // Reuse Hub prepare — returns preview; actual send goes through Safety via bitrix action / chat confirm
      const prepared = commService.prepareMessageSend({
        ...(req.body || {}),
        channel: channel === "email" ? "email" : req.body?.transport || channel,
        provider: channel === "email" ? "smtp" : req.body?.provider || "wazzup",
        transport: channel === "email" ? "email" : req.body?.transport || channel,
      });
      res.json({
        success: true,
        preview: prepared.preview,
        policy: prepared.policy,
        outboxDraft: prepared.outboxDraft,
        dryRun: prepared.dryRun ?? flags.emailDryRun,
        requiresConfirmation: true,
      });
    } catch (e) {
      sendErr(res, e);
    }
  });

  return router;
}
