/**
 * LLM-facing communication context with strict limits.
 * Never includes secrets, raw webhooks, or other contacts' messages.
 */

import { getCommunicationsConfig } from "./config.js";
import { evaluateSendPolicy } from "./communicationPolicy.js";
import * as repo from "./communicationRepository.js";

export function buildCommunicationContext(contactId, options = {}) {
  const cfg = getCommunicationsConfig();
  const id = String(contactId);
  const limit = options.recentLimit || cfg.contextRecentMessages;
  const maxChars = options.maxChars || cfg.contextMaxChars;

  const threads = repo.listThreads({ contactId: id, limit: 10 });
  const messages = repo.listMessages({ contactId: id, limit });
  const enrollments = repo.listActiveEnrollmentsForContact(id);
  const suppression = repo.findActiveSuppression(id);
  const consent = repo.findActiveConsent(id);

  const inbound = [...messages].reverse().find((m) => m.direction === "inbound");
  const outbound = [...messages].reverse().find((m) => m.direction === "outbound" || m.direction === "outbound_echo");

  let recent = messages.map((m) => ({
    direction: m.direction,
    status: m.status,
    transport: m.transport,
    text: m.textSafe,
    at: m.providerTimestamp || m.createdAt,
  }));

  // Cap characters
  let chars = 0;
  const capped = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const t = String(recent[i].text || "");
    if (chars + t.length > maxChars) break;
    capped.unshift(recent[i]);
    chars += t.length;
  }
  recent = capped;

  let summary = null;
  if (cfg.autoSummaryEnabled && messages.length >= cfg.autoSummaryThreshold) {
    const older = messages.length - recent.length;
    summary = `Более ранняя переписка: ещё ~${Math.max(0, older)} сообщений не включены в контекст (лимит ${maxChars} символов).`;
  }

  const preferredThread = threads[0] || null;
  const policy = evaluateSendPolicy({
    contactId: id,
    channel: preferredThread?.chatType || preferredThread?.transport || "whatsapp",
    transport: preferredThread?.transport,
    chatType: preferredThread?.chatType,
    externalChatId: preferredThread?.externalChatId,
    channelState: "active",
    category: "follow_up",
    isFirstContact: !inbound,
    firstContactGround: consent?.ground || (inbound ? "inbound" : null),
    skipQuietHours: true,
    skipDailyLimit: true,
  });

  // Exclude ambiguous unresolved threads from other identities
  const safeThreads = threads.filter((t) => !t.contactId || String(t.contactId) === id);

  return {
    contactId: id,
    summary,
    recentMessages: recent,
    lastInbound: inbound
      ? { text: inbound.textSafe, at: inbound.providerTimestamp || inbound.createdAt, status: inbound.status }
      : null,
    lastOutbound: outbound
      ? { text: outbound.textSafe, at: outbound.sentAt || outbound.createdAt, status: outbound.status }
      : null,
    activeSequences: enrollments.map((e) => ({
      enrollmentId: e.id,
      sequenceId: e.sequenceId,
      status: e.status,
      currentStep: e.currentStep,
      nextRunAt: e.nextRunAt,
    })),
    preferredChannel: preferredThread?.chatType || preferredThread?.transport || null,
    unanswered: Boolean(preferredThread?.unanswered),
    delivery: {
      note: "Read receipt только если канал его предоставляет; иначе нет данных.",
    },
    restrictions: {
      suppression: suppression
        ? { reason: suppression.reason, source: suppression.source }
        : null,
      policy,
    },
    threads: safeThreads.map((t) => ({
      id: t.id,
      channel: t.chatType || t.transport,
      unanswered: t.unanswered,
      lastInboundAt: t.lastInboundAt,
      lastOutboundAt: t.lastOutboundAt,
    })),
    limits: {
      recentMessages: limit,
      maxChars,
      appliedChars: chars,
    },
  };
}
