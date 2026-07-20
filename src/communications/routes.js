import { Router } from "express";
import {
  detectCommunicationChannels,
  listStoredChannels,
  getStoredChannel,
} from "./capabilityService.js";
import {
  createClientMessageDraft,
  patchMessageDraft,
  cancelMessageDraft,
  buildSendPrepareParams,
} from "./messageService.js";
import {
  getMessageDraft,
  listMessageDrafts,
  listOutboundMessages,
  getOutboundMessage,
} from "../database/repositories/messageDraftsRepository.js";
import { verifyOutboundMessage, ingestCommunicationEvent } from "./deliveryService.js";
import { CommunicationError, getCommunicationsPublicConfig } from "./config.js";
import { prepareAction, commitAction } from "../safety/executor.js";
import * as service from "./communicationService.js";
import * as repo from "./communicationRepository.js";
import * as campaignRunner from "./campaignRunner.js";
import {
  getDeliveryReport,
  getUnansweredReport,
  getCommunicationsMetricsSummary,
} from "./metricsService.js";
import { linkIdentityToContact } from "./contactResolver.js";
import {
  verifyWazzupWebhookSecret,
  verifyMaxWebhookSecret,
  queueWazzupWebhook,
  queueMaxWebhook,
  scheduleWebhookProcessing,
} from "./webhookHandler.js";
import {
  startCertification,
  runCertificationStep,
  getCertificationStatus,
  revokeCertification,
  recordProviderSnapshot,
  getEmergencyStopState,
  setEmergencyStop,
  computeAccountFingerprint,
} from "./certification/certificationService.js";
import { getLatestProviderSnapshot } from "./certification/certificationRepository.js";
import { getProvider } from "./providers/index.js";
import { recordAuthEvent } from "../auth/authorizationService.js";

function sendError(res, error) {
  if (error instanceof CommunicationError) {
    return res.status(error.code?.includes("FORBIDDEN") ? 403 : 400).json(error.toJSON());
  }
  if (error?.code) {
    const status = String(error.code).includes("FORBIDDEN") ? 403 : 400;
    return res.status(status).json({
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
  }
  return res.status(500).json({
    success: false,
    error: { code: "INTERNAL", message: error.message },
  });
}

function safetyContext(req, source) {
  return {
    source,
    sessionId: req.body?.sessionId || null,
    chatId: req.body?.chatId || null,
    projectId: req.body?.projectId || null,
    user: req.user || null,
  };
}

export function createCommunicationsRouter() {
  const router = Router();

  // ---------- Legacy endpoints (keep all) ----------

  router.get("/communication-channels", (_req, res) => {
    res.json({ success: true, channels: listStoredChannels() });
  });

  router.post("/communication-channels/detect", async (_req, res) => {
    try {
      const result = await detectCommunicationChannels();
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communication-channels/:id", (req, res) => {
    const ch = getStoredChannel(req.params.id);
    if (!ch) {
      return res.status(404).json({
        success: false,
        error: { code: "CHANNEL_NOT_AVAILABLE", message: "Канал не найден." },
      });
    }
    res.json({ success: true, channel: ch });
  });

  router.post("/message-drafts", async (req, res) => {
    try {
      const result = await createClientMessageDraft(req.body || {});
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/message-drafts", (req, res) => {
    const list = listMessageDrafts({
      chatId: req.query.chatId,
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      limit: req.query.limit,
    });
    res.json({ success: true, drafts: list });
  });

  router.get("/message-drafts/:id", (req, res) => {
    const draft = getMessageDraft(req.params.id);
    if (!draft) {
      return res.status(404).json({
        success: false,
        error: { code: "DRAFT_NOT_FOUND", message: "Черновик не найден." },
      });
    }
    res.json({ success: true, draft });
  });

  router.patch("/message-drafts/:id", async (req, res) => {
    try {
      const draft = await patchMessageDraft(req.params.id, req.body || {});
      res.json({ success: true, draft });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/message-drafts/:id/cancel", (req, res) => {
    try {
      const draft = cancelMessageDraft(req.params.id);
      res.json({ success: true, draft });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/message-drafts/:id/send/prepare", async (req, res) => {
    try {
      const { publicParams } = await buildSendPrepareParams(req.params.id, req.body || {});
      const prepared = await prepareAction("client_message_send", publicParams, {
        source: "message_draft_prepare",
        sessionId: req.body?.sessionId || null,
        chatId: req.body?.chatId || null,
        projectId: req.body?.projectId || null,
        user: req.user || null,
      });
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/outbound-messages", (req, res) => {
    res.json({
      success: true,
      messages: listOutboundMessages({ limit: req.query.limit }),
    });
  });

  router.get("/outbound-messages/:id", (req, res) => {
    const msg = getOutboundMessage(req.params.id);
    if (!msg) {
      return res.status(404).json({
        success: false,
        error: { code: "OUTBOUND_NOT_FOUND", message: "Исходящее сообщение не найдено." },
      });
    }
    res.json({ success: true, message: msg });
  });

  router.post("/outbound-messages/:id/verify", async (req, res) => {
    try {
      const result = await verifyOutboundMessage(req.params.id);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communication-events/:channel", (req, res) => {
    try {
      const result = ingestCommunicationEvent(req.params.channel, req.body || {}, req.headers);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---------- Webhooks (fast 200, secret in URL) ----------

  router.post("/webhooks/wazzup/:secret", (req, res) => {
    try {
      verifyWazzupWebhookSecret(req.params.secret);
      if (req.body && req.body.test === true) {
        return res.status(200).json({ ok: true, test: true });
      }
      const queued = queueWazzupWebhook(req.body || {});
      res.status(200).json({
        ok: true,
        queued: queued.queued.length,
        warning: queued.warning || undefined,
      });
      scheduleWebhookProcessing(queued.queued);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/webhooks/max/:secret", async (req, res) => {
    try {
      const headerSecret =
        req.get("x-max-bot-api-secret") || req.get("X-Max-Bot-Api-Secret") || "";
      verifyMaxWebhookSecret(req.params.secret, headerSecret);
      const queued = await queueMaxWebhook(req.body || {});
      res.status(200).json({ ok: true, queued: queued.queued.length });
      scheduleWebhookProcessing(queued.queued);
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---------- Communications Hub REST ----------

  router.get("/communications/overview", (_req, res) => {
    try {
      res.json(service.getCommunicationsOverview());
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/channels", (_req, res) => {
    try {
      res.json({
        success: true,
        channels: repo.listHubChannels().map((c) => ({
          id: c.id,
          provider: c.provider,
          transport: c.transport,
          displayName: c.displayName,
          state: c.state,
          status: c.status,
          capabilities: c.capabilities,
          lastSyncedAt: c.lastSyncedAt,
        })),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/channels/sync", async (_req, res) => {
    try {
      res.json(await service.syncChannels());
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/test-connection", async (req, res) => {
    try {
      const provider = req.body?.provider || "wazzup";
      res.json(await service.testProviderConnection(provider));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/threads", (req, res) => {
    try {
      res.json(
        service.listThreads({
          unanswered: req.query.unanswered === "1" || req.query.unanswered === "true",
          contactId: req.query.contactId,
          limit: req.query.limit,
          offset: req.query.offset,
        })
      );
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/threads/:id", (req, res) => {
    try {
      res.json(service.getThread(req.params.id));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/threads/:id/draft", (req, res) => {
    try {
      res.json(service.draftThreadMessage(req.params.id, req.body || {}));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/messages/prepare", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_message_send_prepare",
        req.body || {},
        safetyContext(req, "communications_message_prepare")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/messages/commit", async (req, res) => {
    try {
      const confirmationId = req.body?.confirmationId || req.body?.operationId;
      if (!confirmationId) {
        throw new CommunicationError(
          "CONFIRMATION_ID_REQUIRED",
          "Укажите confirmationId (или используйте POST /operations/:id/commit)."
        );
      }
      const result = await commitAction(confirmationId, {
        source: "communications_message_commit",
        user: req.user || null,
        confirmed: req.body?.confirmed !== false,
        confirmationPhrase: req.body?.confirmationPhrase || null,
        bulkConfirmationPhrase: req.body?.bulkConfirmationPhrase || null,
      });
      res.status(result.success === false ? 400 : 200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/templates", (req, res) => {
    try {
      res.json({
        success: true,
        templates: repo.listTemplates({
          status: req.query.status,
          category: req.query.category,
        }),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/templates", (req, res) => {
    try {
      const body = req.body || {};
      const template = repo.createTemplate({
        ...body,
        createdByUserId: req.user?.userId || null,
      });
      res.status(201).json({ success: true, template });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/communications/templates/:id", (req, res) => {
    try {
      const template = repo.updateTemplate(req.params.id, {
        ...(req.body || {}),
        updatedByUserId: req.user?.userId || null,
      });
      if (!template) {
        return res.status(404).json({
          success: false,
          error: { code: "TEMPLATE_NOT_FOUND", message: "Шаблон не найден." },
        });
      }
      res.json({ success: true, template });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete("/communications/templates/:id", (req, res) => {
    try {
      const template = repo.deleteTemplate(req.params.id);
      if (!template) {
        return res.status(404).json({
          success: false,
          error: { code: "TEMPLATE_NOT_FOUND", message: "Шаблон не найден." },
        });
      }
      res.json({ success: true, template });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/sequences", (req, res) => {
    try {
      res.json({
        success: true,
        sequences: repo.listSequences({ status: req.query.status }),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/sequences", (req, res) => {
    try {
      const body = req.body || {};
      const sequence = repo.createSequence({
        ...body,
        createdByUserId: req.user?.userId || null,
      });
      if (Array.isArray(body.steps) && body.steps.length) {
        repo.replaceSequenceSteps(sequence.id, body.steps);
      }
      res.status(201).json({ success: true, sequence: repo.getSequence(sequence.id) });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/communications/sequences/:id", (req, res) => {
    try {
      const body = req.body || {};
      let sequence = repo.updateSequence(req.params.id, body);
      if (!sequence) {
        return res.status(404).json({
          success: false,
          error: { code: "SEQUENCE_NOT_FOUND", message: "Цепочка не найдена." },
        });
      }
      if (Array.isArray(body.steps)) {
        repo.replaceSequenceSteps(req.params.id, body.steps);
        sequence = repo.getSequence(req.params.id);
      }
      res.json({ success: true, sequence });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/sequences/:id/activate/prepare", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_sequence_activate_prepare",
        { ...(req.body || {}), sequenceId: req.params.id },
        safetyContext(req, "communications_sequence_activate")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/sequences/:id/enroll/prepare", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_sequence_enroll_prepare",
        { ...(req.body || {}), sequenceId: req.params.id },
        safetyContext(req, "communications_sequence_enroll")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/enrollments/:id/stop/prepare", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_enrollment_stop_prepare",
        { ...(req.body || {}), enrollmentId: req.params.id },
        safetyContext(req, "communications_enrollment_stop")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/campaigns", (req, res) => {
    try {
      res.json({
        success: true,
        campaigns: repo.listCampaigns({
          status: req.query.status,
          limit: req.query.limit,
        }),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/campaigns", (req, res) => {
    try {
      const campaign = campaignRunner.createCampaignDraft({
        ...(req.body || {}),
        createdByUserId: req.user?.userId || null,
      });
      res.status(201).json({ success: true, campaign });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch("/communications/campaigns/:id", (req, res) => {
    try {
      const campaign = repo.updateCampaign(req.params.id, req.body || {});
      if (!campaign) {
        return res.status(404).json({
          success: false,
          error: { code: "CAMPAIGN_NOT_FOUND", message: "Кампания не найдена." },
        });
      }
      res.json({ success: true, campaign });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/campaigns/:id/preview", (req, res) => {
    try {
      res.json(
        campaignRunner.previewCampaign(req.params.id, {
          contacts: req.body?.contacts || [],
        })
      );
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/campaigns/:id/start/prepare", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_campaign_start_prepare",
        { ...(req.body || {}), campaignId: req.params.id },
        safetyContext(req, "communications_campaign_start")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/campaigns/:id/pause/prepare", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_campaign_pause_prepare",
        { ...(req.body || {}), campaignId: req.params.id },
        safetyContext(req, "communications_campaign_pause")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/campaigns/:id/cancel/prepare", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_campaign_cancel_prepare",
        { ...(req.body || {}), campaignId: req.params.id },
        safetyContext(req, "communications_campaign_cancel")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/campaigns/:id/pause", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_campaign_pause_prepare",
        { ...(req.body || {}), campaignId: req.params.id, reason: req.body?.reason || null },
        safetyContext(req, "communications_campaign_pause_manage")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/campaigns/:id/resume", async (req, res) => {
    try {
      const campaign = campaignRunner.resumeCampaign(req.params.id);
      recordAuthEvent({
        userId: req.user?.userId,
        eventType: "communication_campaign_resume",
        result: "success",
        details: { campaignId: req.params.id, reason: req.body?.reason || null },
      });
      res.json({ success: true, campaign });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/campaigns/:id/cancel", async (req, res) => {
    try {
      const prepared = await prepareAction(
        "communication_campaign_cancel_prepare",
        { ...(req.body || {}), campaignId: req.params.id, reason: req.body?.reason || null },
        safetyContext(req, "communications_campaign_cancel_manage")
      );
      res.status(prepared.success === false ? 400 : 200).json(prepared);
    } catch (error) {
      sendError(res, error);
    }
  });

  // ---------- Certification ----------

  router.get("/communications/certifications", (req, res) => {
    try {
      res.json({
        success: true,
        ...getCertificationStatus({
          provider: req.query.provider,
          channel: req.query.channel,
          status: req.query.status,
          limit: req.query.limit,
        }),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/certifications", (req, res) => {
    try {
      const cert = startCertification(req.body || {});
      res.status(201).json({ success: true, certification: cert });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/certifications/:id", (req, res) => {
    try {
      const status = getCertificationStatus(req.params.id);
      if (!status?.certification) {
        return res.status(404).json({
          success: false,
          error: { code: "CERTIFICATION_NOT_FOUND", message: "Сертификация не найдена." },
        });
      }
      res.json({ success: true, ...status });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/certifications/:id/run", async (req, res) => {
    try {
      const testType = req.body?.testType || req.body?.step;
      if (!testType) {
        throw new CommunicationError("TEST_TYPE_REQUIRED", "Укажите testType.");
      }
      const result = await runCertificationStep(req.params.id, testType, req.body?.context || {});
      res.json({ success: true, ...result });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/certifications/:id/revoke", (req, res) => {
    try {
      const cert = revokeCertification(req.params.id, req.body?.reason || "manual");
      recordAuthEvent({
        userId: req.user?.userId,
        eventType: "communication_certification_revoked",
        result: "success",
        details: { certificationId: req.params.id, reason: req.body?.reason || null },
      });
      res.json({ success: true, certification: cert });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/provider-contract", (req, res) => {
    try {
      const provider = req.query.provider || "wazzup";
      const snap = getLatestProviderSnapshot({
        provider,
        accountFingerprint: req.query.accountFingerprint,
      });
      res.json({
        success: true,
        snapshot: snap,
        emergencyStop: getEmergencyStopState(),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/provider-contract/refresh", async (req, res) => {
    try {
      const providerName = req.body?.provider || "wazzup";
      const provider = getProvider(providerName === "max_bot" ? "max_bot" : "wazzup");
      const channels = req.body?.mockChannels || (await provider.listChannels());
      const accountFingerprint =
        req.body?.accountFingerprint ||
        computeAccountFingerprint({
          provider: providerName,
          accountId: req.body?.accountId || "default",
          channelIds: channels.map((c) => c.externalChannelId).filter(Boolean),
          transports: [...new Set(channels.map((c) => c.transport).filter(Boolean))],
        });
      const snap = recordProviderSnapshot({
        provider: providerName,
        accountFingerprint,
        channels,
        providerVersion: req.body?.providerVersion,
      });
      res.json({ success: true, snapshot: snap });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/delivery", (req, res) => {
    try {
      res.json(getDeliveryReport({ sinceDays: Number(req.query.sinceDays) || 30 }));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/analytics", (req, res) => {
    try {
      res.json({
        success: true,
        summary: getCommunicationsMetricsSummary(),
        unanswered: getUnansweredReport({ limit: Number(req.query.limit) || 20 }),
        delivery: getDeliveryReport({ sinceDays: Number(req.query.sinceDays) || 30 }),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/suppressions", (req, res) => {
    try {
      res.json({
        success: true,
        suppressions: repo.listSuppressions({
          limit: req.query.limit,
          activeOnly: req.query.active !== "0",
        }),
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post("/communications/identities/:id/resolve", (req, res) => {
    try {
      const contactId = req.body?.contactId;
      if (!contactId) {
        throw new CommunicationError("CONTACT_ID_REQUIRED", "Укажите contactId.");
      }
      const identity = linkIdentityToContact(req.params.id, contactId, {
        userId: req.user?.userId || null,
      });
      res.json({ success: true, identity });
    } catch (error) {
      sendError(res, error);
    }
  });

  router.get("/communications/settings", (_req, res) => {
    try {
      res.json({
        success: true,
        settings: {
          ...getCommunicationsPublicConfig(),
          emergencyStop: getEmergencyStopState(),
        },
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
