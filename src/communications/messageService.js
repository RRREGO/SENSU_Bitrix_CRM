/**
 * Drafts + client_message_send handler (write only via Safety commit).
 */

import crypto from "crypto";
import { CommunicationError } from "./config.js";
import { resolveMessageRecipient } from "./recipientResolver.js";
import {
  assertSingleRecipient,
  assertMessageLength,
  assertContactAllowed,
  assertChannelSendAvailable,
  buildConfirmationPhrase,
  requiresStrongConfirmation,
} from "./communicationPolicy.js";
import { assertNoDuplicate } from "./duplicateGuard.js";
import { getAdapterByChannel } from "./channelRegistry.js";
import { listStoredChannels } from "./capabilityService.js";
import {
  createMessageDraft,
  getMessageDraft,
  updateMessageDraft,
  createOutboundMessage,
  getOutboundByDraftAndOperation,
  hashBody,
} from "../database/repositories/messageDraftsRepository.js";
import { client_message_draft as legacyDraftText } from "../clientContext/clientActions.js";
import { BitrixAppError } from "../bitrix/errors.js";
import { getSafetyExecutionContext } from "../safety/executionContext.js";

function publicRecipient(recipient) {
  if (!recipient) return null;
  return {
    contactId: recipient.contactId,
    userId: recipient.userId || null,
    name: recipient.name,
    maskedAddress: recipient.maskedAddress,
    optionId: recipient.optionId || null,
    kind: recipient.kind || null,
  };
}

function channelSendFlag(channel) {
  const stored = listStoredChannels().find((c) => c.channel === channel);
  if (stored) return Boolean(stored.capabilities?.canSend);
  return Boolean(getAdapterByChannel(channel)?.capabilities?.canSend);
}

/**
 * Application-level draft creation (extends client_message_draft).
 */
export async function createClientMessageDraft(params = {}) {
  assertSingleRecipient(params);
  const channel = String(params.channel || "whatsapp").toLowerCase();

  // Reuse text generation / block rules from legacy draft for CRM client channels
  let generated;
  if (channel === "bitrix_chat") {
    if (!params.userId) {
      throw new CommunicationError(
        "MESSAGE_RECIPIENT_NOT_FOUND",
        "Для внутреннего чата укажите userId."
      );
    }
    generated = {
      success: true,
      body: params.body || String(params.text || "Здравствуйте!"),
      subject: null,
      basedOn: params.basedOn || [],
      warnings: [{ code: "INTERNAL_CHAT", message: "Внутренний чат Bitrix24 (не клиент)." }],
      recipient: { name: params.recipientName || `user ${params.userId}` },
    };
  } else {
    generated = await legacyDraftText({
      ...params,
      channel,
      allowPersonal: params.allowPersonal,
    });
  }

  const body = params.body != null ? String(params.body) : generated.body;
  assertMessageLength(channel, body);

  if (channel === "email" && !(params.subject || generated.subject)) {
    throw new CommunicationError("MESSAGE_TOO_LONG", "Для email обязателен subject.", {
      code: "EMAIL_SUBJECT_REQUIRED",
    });
  }

  let recipient;
  try {
    recipient = await resolveMessageRecipient({
      entityType: params.entityType,
      entityId: params.entityId,
      contactId: params.contactId,
      channel,
      recipientOptionId: params.recipientOptionId || null,
      userId: params.userId || null,
    });
  } catch (error) {
    if (error instanceof CommunicationError) throw error;
    throw new CommunicationError("MESSAGE_RECIPIENT_NOT_FOUND", error.message);
  }

  assertContactAllowed(recipient.statusValue, {
    allowPersonal: params.allowPersonal,
    personalCommunicationReason: params.personalCommunicationReason,
  });

  const sendAvailable = channelSendFlag(channel);
  const warnings = [...(generated.warnings || [])];
  if (!sendAvailable) {
    warnings.push({
      code: "CHANNEL_SEND_NOT_SUPPORTED",
      message: "Отправка через этот канал недоступна — можно скопировать текст.",
    });
  }

  const draft = createMessageDraft({
    chatId: params.chatId,
    projectId: params.projectId,
    entityType: params.entityType,
    entityId: params.entityId,
    contactId: recipient.contactId,
    channel,
    recipientReference: recipient.reference,
    subject: channel === "email" ? params.subject || generated.subject : null,
    body,
    status: sendAvailable ? "ready" : "draft",
    basedOn: generated.basedOn || [],
    warnings,
    recipient: publicRecipient(recipient),
    sendAvailable,
  });

  return {
    success: true,
    draftId: draft.id,
    channel: draft.channel,
    recipient: draft.recipient,
    subject: draft.subject,
    body: draft.body,
    basedOn: draft.basedOn,
    warnings: draft.warnings,
    sendAvailable: draft.sendAvailable,
    status: draft.status,
  };
}

export async function patchMessageDraft(id, patch = {}) {
  const current = getMessageDraft(id);
  if (!current) throw new CommunicationError("TRANSCRIPT_NOT_FOUND", "Черновик не найден.");
  if (current.status === "sent") {
    throw new CommunicationError("MESSAGE_TOO_LONG", "Отправленный черновик нельзя редактировать.", {
      code: "DRAFT_LOCKED",
    });
  }
  if (current.status === "cancelled") {
    throw new CommunicationError("MESSAGE_TOO_LONG", "Отменённый черновик нельзя редактировать.", {
      code: "DRAFT_CANCELLED",
    });
  }

  const channel = patch.channel || current.channel;
  const body = patch.body !== undefined ? String(patch.body) : current.body;
  assertMessageLength(channel, body);
  if (channel === "email") {
    const subject = patch.subject !== undefined ? patch.subject : current.subject;
    if (!subject) {
      throw new CommunicationError("MESSAGE_TOO_LONG", "Для email обязателен subject.", {
        code: "EMAIL_SUBJECT_REQUIRED",
      });
    }
  }

  let recipient = current.recipient;
  let recipientReference = current.recipientReference;
  let contactId = current.contactId;
  if (patch.recipientOptionId || patch.channel || patch.userId) {
    const resolved = await resolveMessageRecipient({
      entityType: current.entityType,
      entityId: current.entityId,
      contactId: current.contactId,
      channel,
      recipientOptionId: patch.recipientOptionId || current.recipient?.optionId,
      userId: patch.userId || current.recipient?.userId,
    });
    assertContactAllowed(resolved.statusValue, {
      allowPersonal: patch.allowPersonal,
      personalCommunicationReason: patch.personalCommunicationReason,
    });
    recipient = publicRecipient(resolved);
    recipientReference = resolved.reference;
    contactId = resolved.contactId;
  }

  const sendAvailable = channelSendFlag(channel);
  return updateMessageDraft(id, {
    channel,
    body,
    subject: patch.subject !== undefined ? patch.subject : current.subject,
    recipient,
    recipientReference,
    contactId,
    sendAvailable,
    status: sendAvailable ? "ready" : "draft",
    warnings: sendAvailable
      ? (current.warnings || []).filter((w) => w.code !== "CHANNEL_SEND_NOT_SUPPORTED")
      : [
          ...(current.warnings || []).filter((w) => w.code !== "CHANNEL_SEND_NOT_SUPPORTED"),
          {
            code: "CHANNEL_SEND_NOT_SUPPORTED",
            message: "Отправка через этот канал недоступна — можно скопировать текст.",
          },
        ],
  });
}

export function cancelMessageDraft(id) {
  const current = getMessageDraft(id);
  if (!current) throw new CommunicationError("TRANSCRIPT_NOT_FOUND", "Черновик не найден.");
  if (current.status === "sent") {
    throw new CommunicationError("MESSAGE_TOO_LONG", "Нельзя отменить отправленный черновик.", {
      code: "DRAFT_LOCKED",
    });
  }
  return updateMessageDraft(id, { status: "cancelled" });
}

/**
 * Build params for prepareAction — returns safe server params (no raw phone in returned audit later via redact).
 */
export async function buildSendPrepareParams(draftId, options = {}) {
  assertSingleRecipient(options);
  const draft = getMessageDraft(draftId);
  if (!draft) throw new CommunicationError("TRANSCRIPT_NOT_FOUND", "Черновик не найден.");
  if (["sent", "cancelled"].includes(draft.status)) {
    throw new CommunicationError("MESSAGE_TOO_LONG", "Черновик недоступен для отправки.", {
      code: "DRAFT_LOCKED",
    });
  }

  const adapter = assertChannelSendAvailable(draft.channel);
  assertMessageLength(draft.channel, draft.body);

  const recipient = await resolveMessageRecipient({
    entityType: draft.entityType,
    entityId: draft.entityId,
    contactId: draft.contactId,
    channel: draft.channel,
    recipientOptionId: options.recipientOptionId || draft.recipient?.optionId,
    userId: options.userId || draft.recipient?.userId,
  });

  assertContactAllowed(recipient.statusValue, {
    allowPersonal: options.allowPersonal,
    personalCommunicationReason: options.personalCommunicationReason,
  });

  const dup = assertNoDuplicate({
    contactId: recipient.contactId,
    channel: draft.channel,
    bodyHash: draft.bodyHash,
    excludeDraftId: draft.id,
    forceDuplicateReason: options.forceDuplicateReason,
  });

  const phrase = requiresStrongConfirmation(draft.channel)
    ? buildConfirmationPhrase(recipient.name)
    : null;

  // Keep secrets only inside __sendSecrets in execPlan, not in public params
  const publicParams = {
    draftId: draft.id,
    channel: draft.channel,
    provider: adapter.provider,
    entityType: draft.entityType,
    entityId: draft.entityId,
    contactId: recipient.contactId,
    bodyHash: draft.bodyHash,
    subject: draft.subject,
    body: draft.body,
    recipient: publicRecipient(recipient),
    affectedCount: 1,
    forceDuplicateReason: dup.forced ? dup.reason : null,
    personalCommunicationReason: options.personalCommunicationReason || null,
    allowPersonal: Boolean(options.allowPersonal),
    requiredConfirmationPhrase: phrase,
  };

  updateMessageDraft(draft.id, { status: "prepared" });

  return { publicParams, recipient, adapter, phrase };
}

/**
 * Safety write handler — runs only inside commit with safety context.
 */
export async function client_message_send(params = {}) {
  const ctx = getSafetyExecutionContext();
  if (!ctx?.operationId) {
    throw new Error("client_message_send допускает вызов только через Safety Executor.");
  }

  assertSingleRecipient(params);
  const draft = getMessageDraft(params.draftId);
  if (!draft) throw new Error("Черновик не найден.");
  if (draft.bodyHash !== params.bodyHash) {
    throw new Error("Хэш текста черновика изменился. Сформируйте prepare заново.");
  }

  // Idempotent: already linked
  const existing = getOutboundByDraftAndOperation(draft.id, ctx.operationId);
  if (existing) {
    return {
      success: true,
      idempotent: true,
      outboundMessageId: existing.id,
      externalMessageId: existing.externalMessageId,
      status: existing.status,
    };
  }

  const adapter = assertChannelSendAvailable(draft.channel);
  const recipient = await resolveMessageRecipient({
    entityType: draft.entityType,
    entityId: draft.entityId,
    contactId: draft.contactId,
    channel: draft.channel,
    recipientOptionId: params.recipient?.optionId,
    userId: params.recipient?.userId,
  });
  assertContactAllowed(recipient.statusValue, {
    allowPersonal: params.allowPersonal,
    personalCommunicationReason: params.personalCommunicationReason,
  });
  assertNoDuplicate({
    contactId: recipient.contactId,
    channel: draft.channel,
    bodyHash: draft.bodyHash,
    excludeDraftId: draft.id,
    forceDuplicateReason: params.forceDuplicateReason,
  });

  const payload = await adapter.preparePayload({
    body: draft.body,
    subject: draft.subject,
    recipient,
  });

  let sendResult;
  try {
    sendResult = await adapter.send(payload);
  } catch (error) {
    if (error instanceof BitrixAppError && error.code === "WRITE_RESULT_UNKNOWN") {
      const { outbound } = createOutboundMessage({
        draftId: draft.id,
        operationId: ctx.operationId,
        channel: draft.channel,
        provider: adapter.provider,
        recipientReference: recipient.reference,
        bodyHash: draft.bodyHash,
        status: "verification_required",
        verificationStatus: "unknown",
      });
      updateMessageDraft(draft.id, {
        status: "failed",
        sentAt: new Date().toISOString(),
      });
      const err = new Error(
        "Запрос на отправку был передан провайдеру, но результат не удалось подтвердить."
      );
      err.code = "MESSAGE_SEND_RESULT_UNKNOWN";
      err.outboundMessageId = outbound.id;
      err.partial = true;
      throw err;
    }
    throw error;
  }

  const { outbound, created } = createOutboundMessage({
    draftId: draft.id,
    operationId: ctx.operationId,
    channel: draft.channel,
    provider: adapter.provider,
    recipientReference: recipient.reference,
    bodyHash: draft.bodyHash,
    externalMessageId: sendResult.externalMessageId,
    status: "sent",
    verificationStatus: adapter.capabilities?.supportsDeliveryStatus ? "pending" : "unavailable",
  });

  updateMessageDraft(draft.id, { status: "sent", sentAt: new Date().toISOString() });

  return {
    success: true,
    created,
    outboundMessageId: outbound.id,
    externalMessageId: sendResult.externalMessageId,
    status: "sent",
    verificationStatus: outbound.verificationStatus,
    channel: draft.channel,
    provider: adapter.provider,
    recipient: publicRecipient(recipient),
  };
}

export { hashBody, buildConfirmationPhrase, requiresStrongConfirmation };
