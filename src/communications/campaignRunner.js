/**
 * Campaign preview, plan hash, start/pause/cancel.
 * Preview and dry-run never call provider send.
 */

import crypto from "crypto";
import {
  CommunicationError,
  getCommunicationsConfig,
  POLICY_VERSION,
  normalizePhone,
  normalizeTelegramUsername,
  maskPhone,
} from "./config.js";
import { evaluateCampaignPolicy, evaluateSendPolicy } from "./communicationPolicy.js";
import { buildSegment } from "./segmentBuilder.js";
import { renderTemplate, assertRequiredVarsFilled } from "./templateRenderer.js";
import {
  buildCampaignConfirmationPhrase,
  hashCampaignPlan,
  assertCampaignConfirmationPhrase,
} from "./communicationSafety.js";
import * as repo from "./communicationRepository.js";
import { assertSendCertified } from "./certification/certificationService.js";
import { hashBody } from "./certification/certificationValidator.js";

function recipientKey(contact) {
  return String(contact.id || contact.ID || contact.contactId);
}

function resolveAddress(contact, channel, cfg) {
  const ch = String(channel || "").toLowerCase();
  if (contact.chatId) return { chatId: String(contact.chatId), phone: null, username: null };
  if (ch === "telegram") {
    return {
      chatId: contact.telegramChatId || null,
      username: normalizeTelegramUsername(contact.telegramUsername || contact.telegram),
      phone: normalizePhone(contact.phone),
    };
  }
  if (ch === "max") {
    const field = cfg.bitrixFields.max;
    return {
      chatId: contact.maxChatId || (field ? contact[field] : null) || null,
      phone: null,
      username: null,
    };
  }
  return {
    chatId: null,
    phone: normalizePhone(contact.phone || contact.PHONE),
    username: null,
  };
}

/**
 * Build immutable preview plan. Does not send.
 */
export function previewCampaign(campaignId, { contacts = [] } = {}) {
  const campaign = repo.getCampaign(campaignId);
  if (!campaign) throw new CommunicationError("CAMPAIGN_NOT_FOUND", "Кампания не найдена.");

  const cfg = getCommunicationsConfig();
  const template = campaign.templateId ? repo.getTemplate(campaign.templateId) : null;
  const segment = buildSegment(contacts, campaign.segment || {});
  const samples = [];
  const exclusions = [...segment.excluded];
  const allowed = [];
  const channelBreakdown = {};

  for (const contact of segment.included) {
    const contactId = recipientKey(contact);
    const channel = campaign.channel || template?.channel || "whatsapp";
    const addr = resolveAddress(contact, channel, cfg);
    const policy = evaluateSendPolicy({
      contactId,
      statusValue: contact.statusValue ?? contact.status,
      channel,
      transport: channel === "waba" ? "wapi" : channel,
      chatType: channel === "waba" ? "whatsapp" : channel,
      externalChatId: addr.chatId,
      phone: addr.phone,
      username: addr.username,
      category: template?.category || campaign.segment?.category || "newsletter",
      wabaTemplateId: template?.wabaTemplateId,
      isFirstContact: contact.isFirstContact,
      firstContactGround: contact.firstContactGround,
      channelState: "active",
      skipQuietHours: true,
      skipDailyLimit: false,
    });

    if (!policy.allowed) {
      exclusions.push({
        contact,
        contactId,
        code: policy.code,
        message: policy.message,
      });
      continue;
    }

    let rendered = null;
    try {
      if (template) {
        const vars = {
          firstName: contact.firstName || contact.NAME || "",
          fullName:
            contact.fullName ||
            [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") ||
            "",
          companyName: contact.companyName || "",
          managerName: contact.managerName || "",
          referrerName: contact.referrerName || "",
          meetingDate: contact.meetingDate || "",
          lastContactDate: contact.lastContactDate || "",
          contextReason: contact.contextReason || "",
          __category: template.category,
          __channel: template.channel,
          __wabaTemplateId: template.wabaTemplateId,
        };
        assertRequiredVarsFilled(template.body, vars);
        rendered = renderTemplate(template.body, vars);
      } else {
        rendered = campaign.segment?.body || "";
      }
    } catch (error) {
      exclusions.push({
        contact,
        contactId,
        code: error.code || "RENDER_FAILED",
        message: error.message,
      });
      continue;
    }

    const row = {
      contactId,
      channel,
      templateId: template?.id || null,
      renderedBody: rendered,
      scheduledAt: null,
      recipientMasked: addr.phone ? maskPhone(addr.phone) : addr.username || addr.chatId || "***",
      address: addr,
    };
    allowed.push(row);
    channelBreakdown[channel] = (channelBreakdown[channel] || 0) + 1;
    if (samples.length < 20) {
      samples.push({
        contactId,
        channel,
        template: template?.name || null,
        text: rendered.slice(0, 280),
        time: "as_scheduled",
        checkStatus: "ok",
      });
    }
  }

  const campaignPolicy = evaluateCampaignPolicy({
    recipientCount: allowed.length,
    status: campaign.status,
  });

  const plan = {
    campaignId,
    templateId: template?.id || null,
    channel: campaign.channel,
    allowedCount: allowed.length,
    excludedCount: exclusions.length,
    totalFound: contacts.length,
    channelBreakdown,
    samples,
    exclusions: exclusions.map((e) => ({
      contactId: e.contactId,
      code: e.code,
      message: e.message,
    })),
    recipients: allowed.map((r) => ({
      contactId: r.contactId,
      channel: r.channel,
      templateId: r.templateId,
      renderedBody: r.renderedBody,
      chatId: r.address.chatId,
      phone: r.address.phone,
      username: r.address.username,
    })),
    generatedAt: new Date().toISOString(),
    limits: {
      maxCampaignRecipients: cfg.maxCampaignRecipients,
      maxPerContactPerDay: cfg.maxMessagesPerContactPerDay,
    },
    estimatedDurationMinutes: Math.ceil(
      allowed.length / Math.max(1, cfg.maxMessagesPerMinute)
    ),
    policy: campaignPolicy,
  };
  plan.planHash = hashCampaignPlan({
    campaignId: plan.campaignId,
    templateId: plan.templateId,
    channel: plan.channel,
    recipients: plan.recipients,
  });

  repo.updateCampaign(campaignId, {
    status: "preview",
    plan,
    planHash: plan.planHash,
    confirmedRecipientCount: plan.allowedCount,
    confirmationPhrase: buildCampaignConfirmationPhrase(Math.max(1, plan.allowedCount || 1)),
    stats: {
      totalFound: plan.totalFound,
      allowed: plan.allowedCount,
      excluded: plan.excludedCount,
    },
  });

  // Persist recipient rows for audit (excluded + allowed)
  for (const e of exclusions) {
    if (!e.contactId) continue;
    repo.upsertCampaignRecipient({
      campaignId,
      contactId: e.contactId,
      recipientKey: e.contactId,
      status: "excluded",
      exclusionCode: e.code,
      exclusionMessage: e.message,
    });
  }
  for (const r of allowed) {
    repo.upsertCampaignRecipient({
      campaignId,
      contactId: r.contactId,
      recipientKey: r.contactId,
      channel: r.channel,
      renderedBody: r.renderedBody,
      status: "pending",
    });
  }

  return {
    success: true,
    campaign: repo.getCampaign(campaignId),
    plan,
    sent: false,
  };
}

export function confirmAndStartCampaign(campaignId, { phrase, userId, planHash } = {}) {
  const campaign = repo.getCampaign(campaignId);
  if (!campaign) throw new CommunicationError("CAMPAIGN_NOT_FOUND", "Кампания не найдена.");
  if (!campaign.plan || !campaign.planHash) {
    throw new CommunicationError("CAMPAIGN_NO_PLAN", "Сначала выполните preview.");
  }
  if (planHash && planHash !== campaign.planHash) {
    throw new CommunicationError(
      "PLAN_HASH_MISMATCH",
      "План изменился — повторите preview и подтверждение."
    );
  }
  assertCampaignConfirmationPhrase(phrase, campaign.confirmedRecipientCount);

  const cfg = getCommunicationsConfig();
  const dryRun = campaign.dryRun || cfg.dryRun || !cfg.sendEnabled;

  if (!dryRun) {
    assertSendCertified({
      level: "campaign",
      provider: "wazzup",
      channel: campaign.channel || null,
      dryRun: false,
    });
  }

  const recipients = campaign.plan.recipients || [];

  for (const r of recipients) {
    const idempotencyKey = `campaign:${campaignId}:${r.contactId}:1:${campaign.planHash.slice(0, 16)}`;
    repo.createOutboxJob({
      idempotencyKey,
      provider: "wazzup",
      channelId: r.channelId || null,
      transport: r.channel === "waba" ? "wapi" : r.channel,
      chatType: r.channel === "telegram" ? "telegram" : r.channel === "max" ? "max" : "whatsapp",
      externalChatId: r.chatId || r.phone || null,
      contactId: r.contactId,
      campaignId,
      body: r.renderedBody,
      bodyHash: hashBody(r.renderedBody),
      policyVersion: POLICY_VERSION,
      wabaTemplateId: campaign.plan.templateId ? repo.getTemplate(campaign.plan.templateId)?.wabaTemplateId : null,
      crmMessageId: idempotencyKey,
      dryRun,
      planHash: campaign.planHash,
      payload: {
        phone: r.phone || null,
        username: r.username || null,
      },
    });
  }

  return repo.updateCampaign(campaignId, {
    status: "running",
    confirmedByUserId: userId || null,
    confirmedAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    dryRun,
  });
}

export function pauseCampaign(campaignId) {
  const campaign = repo.getCampaign(campaignId);
  if (!campaign) throw new CommunicationError("CAMPAIGN_NOT_FOUND", "Кампания не найдена.");
  return repo.updateCampaign(campaignId, {
    status: "paused",
    pausedAt: new Date().toISOString(),
  });
}

export function resumeCampaign(campaignId) {
  const campaign = repo.getCampaign(campaignId);
  if (!campaign) throw new CommunicationError("CAMPAIGN_NOT_FOUND", "Кампания не найдена.");
  if (campaign.status !== "paused") {
    throw new CommunicationError(
      "CAMPAIGN_NOT_PAUSED",
      `Возобновить можно только paused кампанию (сейчас «${campaign.status}»).`
    );
  }
  return repo.updateCampaign(campaignId, {
    status: "running",
    pausedAt: null,
  });
}

export function cancelCampaign(campaignId) {
  const campaign = repo.getCampaign(campaignId);
  if (!campaign) throw new CommunicationError("CAMPAIGN_NOT_FOUND", "Кампания не найдена.");
  const cancelled = repo.cancelOutboxForCampaign(campaignId);
  return {
    campaign: repo.updateCampaign(campaignId, {
      status: "cancelled",
      cancelledAt: new Date().toISOString(),
    }),
    cancelledOutbox: cancelled,
  };
}

export function createCampaignDraft(params = {}) {
  return repo.createCampaign(params);
}
