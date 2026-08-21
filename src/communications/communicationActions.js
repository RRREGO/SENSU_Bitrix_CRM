/**
 * High-level LLM actions for Communications Hub.
 * Read actions execute immediately. Send/mutate go through Safety prepare packages.
 * On Safety commit (__execute), handlers enqueue / mutate — never call provider.send directly.
 */

import { CommunicationError, getCommunicationsConfig } from "./config.js";
import * as service from "./communicationService.js";
import * as repo from "./communicationRepository.js";
import * as campaignRunner from "./campaignRunner.js";
import * as sequenceRunner from "./sequenceRunner.js";
import { getDeliveryReport, getUnansweredReport } from "./metricsService.js";
import { lintTemplate } from "./templateRenderer.js";
import { buildCampaignPreparePreview } from "./communicationSafety.js";

function requireHubEnabled() {
  if (!getCommunicationsConfig().enabled) {
    throw new CommunicationError(
      "COMMUNICATIONS_DISABLED",
      "Communications Hub выключен (COMMUNICATIONS_ENABLED=false)."
    );
  }
}

/** Read: list channels / sync status */
export async function communication_channels_list(params = {}) {
  requireHubEnabled();
  if (params.sync) {
    await service.syncChannels();
  }
  return {
    success: true,
    channels: repo.listHubChannels().map((c) => ({
      id: c.id,
      transport: c.transport,
      displayName: c.displayName,
      state: c.state,
      capabilities: c.capabilities,
      lastSyncedAt: c.lastSyncedAt,
    })),
  };
}

export async function communication_thread_get(params = {}) {
  requireHubEnabled();
  if (!params.threadId && !params.id) {
    throw new CommunicationError("THREAD_ID_REQUIRED", "Укажите threadId.");
  }
  return service.getThread(params.threadId || params.id);
}

export async function communication_contact_context(params = {}) {
  requireHubEnabled();
  if (!params.contactId) {
    throw new CommunicationError("CONTACT_ID_REQUIRED", "Укажите contactId.");
  }
  return {
    success: true,
    context: service.getContactCommunicationContext(params.contactId, params),
  };
}

export async function communication_message_draft(params = {}) {
  requireHubEnabled();
  if (params.threadId) {
    return service.draftThreadMessage(params.threadId, params);
  }
  const prepared = await service.prepareMessageSend(params);
  return {
    success: true,
    body: prepared.preview.bodyPreview,
    policy: prepared.policy,
    draft: prepared.preview,
  };
}

/**
 * Prepare only unless __execute (Safety commit) — then enqueue outbox.
 */
export async function communication_message_send_prepare(params = {}) {
  requireHubEnabled();
  if (params.__execute) {
    if (!params.outboxDraft) {
      throw new CommunicationError("OUTBOX_DRAFT_REQUIRED", "Нет outboxDraft для commit.");
    }
    if (params.policy && params.policy.allowed === false) {
      throw new CommunicationError(
        params.policy.code || "POLICY_BLOCKED",
        params.policy.message || "Отправка запрещена политикой."
      );
    }
    const job = service.enqueuePreparedMessage(params.outboxDraft, {
      operationId: params.operationId || null,
    });
    return {
      success: true,
      enqueued: true,
      outboxId: job.id,
      dryRun: Boolean(job.dryRun),
      status: job.status,
    };
  }

  const result = await service.prepareMessageSend(params);
  if (!result.policy.allowed) {
    return {
      success: false,
      blocked: true,
      ...result,
    };
  }
  return {
    success: true,
    accessType: "write",
    requiresConfirmation: true,
    risk: "high",
    ...result,
  };
}

export async function communication_campaign_preview(params = {}) {
  requireHubEnabled();
  if (!params.campaignId) {
    throw new CommunicationError("CAMPAIGN_ID_REQUIRED", "Укажите campaignId.");
  }
  return campaignRunner.previewCampaign(params.campaignId, {
    contacts: params.contacts || [],
  });
}

export async function communication_campaign_start_prepare(params = {}) {
  requireHubEnabled();
  if (params.__execute) {
    const campaign = campaignRunner.confirmAndStartCampaign(params.campaignId, {
      phrase: params.confirmationPhrase || params.phrase,
      userId: params.userId || null,
      planHash: params.planHash,
    });
    return { success: true, campaign };
  }

  const campaign = repo.getCampaign(params.campaignId);
  if (!campaign) throw new CommunicationError("CAMPAIGN_NOT_FOUND", "Кампания не найдена.");
  if (!campaign.plan) {
    throw new CommunicationError("CAMPAIGN_NO_PLAN", "Сначала сделайте preview.");
  }
  const preview = buildCampaignPreparePreview(campaign, {
    planHash: campaign.planHash,
    allowedCount: campaign.confirmedRecipientCount,
    excludedCount: campaign.stats?.excluded || 0,
    channelBreakdown: campaign.plan.channelBreakdown,
    samples: campaign.plan.samples,
    exclusions: campaign.plan.exclusions,
  });
  return {
    success: true,
    accessType: "write",
    requiresConfirmation: true,
    risk: "high",
    confirmationPhrase: preview.confirmationPhrase,
    planHash: campaign.planHash,
    preview,
    note: "Подтверждение: точная фраза ПОДТВЕРЖДАЮ РАССЫЛКУ N ПОЛУЧАТЕЛЯМ. LLM не может отправить сам.",
  };
}

export async function communication_campaign_pause_prepare(params = {}) {
  requireHubEnabled();
  if (!params.campaignId) {
    throw new CommunicationError("CAMPAIGN_ID_REQUIRED", "Укажите campaignId.");
  }
  if (params.__execute) {
    return { success: true, campaign: campaignRunner.pauseCampaign(params.campaignId) };
  }
  return {
    success: true,
    accessType: "write",
    requiresConfirmation: true,
    risk: "medium",
    preview: { kind: "communication_campaign_pause", campaignId: params.campaignId },
    executeHint: "pause",
  };
}

export async function communication_campaign_cancel_prepare(params = {}) {
  requireHubEnabled();
  if (!params.campaignId) {
    throw new CommunicationError("CAMPAIGN_ID_REQUIRED", "Укажите campaignId.");
  }
  if (params.__execute) {
    return { success: true, ...campaignRunner.cancelCampaign(params.campaignId) };
  }
  return {
    success: true,
    accessType: "write",
    requiresConfirmation: true,
    risk: "medium",
    preview: { kind: "communication_campaign_cancel", campaignId: params.campaignId },
  };
}

export async function communication_sequence_list(params = {}) {
  requireHubEnabled();
  return {
    success: true,
    sequences: repo.listSequences({ status: params.status }),
  };
}

export async function communication_sequence_activate_prepare(params = {}) {
  requireHubEnabled();
  if (!params.sequenceId) {
    throw new CommunicationError("SEQUENCE_ID_REQUIRED", "Укажите sequenceId.");
  }
  if (params.__execute) {
    const seq = repo.updateSequence(params.sequenceId, { status: "active" });
    if (!seq) throw new CommunicationError("SEQUENCE_NOT_FOUND", "Цепочка не найдена.");
    return { success: true, sequence: seq };
  }
  const sequence = repo.getSequence(params.sequenceId);
  if (!sequence) throw new CommunicationError("SEQUENCE_NOT_FOUND", "Цепочка не найдена.");
  return {
    success: true,
    accessType: "write",
    requiresConfirmation: true,
    risk: "medium",
    preview: {
      kind: "communication_sequence_activate",
      sequenceId: params.sequenceId,
      sequenceName: sequence.name,
      steps: (sequence.steps || []).length,
    },
  };
}

export async function communication_sequence_enroll_prepare(params = {}) {
  requireHubEnabled();
  if (params.__execute) {
    const enrollment = sequenceRunner.enrollContact(params.sequenceId, params.contactId, {
      userId: params.userId,
      vars: params.vars || {},
      address: params.address || {},
    });
    return { success: true, enrollment };
  }
  if (!params.sequenceId || !params.contactId) {
    throw new CommunicationError(
      "ENROLL_PARAMS_REQUIRED",
      "Нужны sequenceId и contactId."
    );
  }
  const sequence = repo.getSequence(params.sequenceId);
  if (!sequence) throw new CommunicationError("SEQUENCE_NOT_FOUND", "Цепочка не найдена.");
  return {
    success: true,
    accessType: "write",
    requiresConfirmation: true,
    risk: "high",
    preview: {
      kind: "communication_sequence_enroll",
      sequenceId: params.sequenceId,
      sequenceName: sequence.name,
      contactId: params.contactId,
      steps: (sequence.steps || []).length,
    },
  };
}

export async function communication_enrollment_stop_prepare(params = {}) {
  requireHubEnabled();
  if (!params.enrollmentId) {
    throw new CommunicationError("ENROLLMENT_ID_REQUIRED", "Укажите enrollmentId.");
  }
  if (params.__execute) {
    const enrollment = sequenceRunner.stopEnrollment(
      params.enrollmentId,
      params.reason || "stopped_manually"
    );
    return { success: true, enrollment };
  }
  const enrollment = repo.getEnrollment(params.enrollmentId);
  if (!enrollment) throw new CommunicationError("ENROLLMENT_NOT_FOUND", "Enrollment не найден.");
  return {
    success: true,
    accessType: "write",
    requiresConfirmation: true,
    risk: "medium",
    preview: {
      kind: "communication_enrollment_stop",
      enrollmentId: params.enrollmentId,
      sequenceId: enrollment.sequenceId,
      contactId: enrollment.contactId,
    },
  };
}

export async function communication_delivery_report(params = {}) {
  requireHubEnabled();
  return getDeliveryReport(params);
}

export async function communication_unanswered_report(params = {}) {
  requireHubEnabled();
  return getUnansweredReport(params);
}

export async function communication_template_lint(params = {}) {
  requireHubEnabled();
  return {
    success: true,
    lint: lintTemplate(params),
  };
}
