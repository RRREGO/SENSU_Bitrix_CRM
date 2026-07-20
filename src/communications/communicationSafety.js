/**
 * Safety helpers for Hub prepare flows and campaign confirmation phrases.
 */

import crypto from "crypto";
import { CommunicationError } from "./config.js";

export function buildCampaignConfirmationPhrase(recipientCount) {
  const n = Number(recipientCount);
  if (!Number.isFinite(n) || n < 1) {
    throw new CommunicationError(
      "CAMPAIGN_CONFIRM_INVALID",
      "Число получателей для фразы подтверждения должно быть ≥ 1."
    );
  }
  return `ПОДТВЕРЖДАЮ РАССЫЛКУ ${n} ПОЛУЧАТЕЛЯМ`;
}

export function assertCampaignConfirmationPhrase(phrase, expectedCount) {
  const expected = buildCampaignConfirmationPhrase(expectedCount);
  const got = String(phrase || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (got !== expected) {
    throw new CommunicationError(
      "CAMPAIGN_CONFIRM_MISMATCH",
      `Фраза подтверждения должна быть точно: ${expected}`,
      { expected, got }
    );
  }
  return true;
}

export function hashCampaignPlan(plan) {
  const canonical = canonicalize(plan);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(value) {
  if (value == null) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(",")}}`;
}

export function buildSingleMessagePreparePreview({
  contactId,
  channel,
  transport,
  chatType,
  body,
  templateId,
  wabaTemplateId,
  recipientMasked,
  policy,
  dryRun,
}) {
  return {
    kind: "communication_message_send",
    contactId,
    channel,
    transport,
    chatType,
    templateId: templateId || null,
    wabaTemplateId: wabaTemplateId || null,
    bodyPreview: String(body || "").slice(0, 500),
    bodyLength: String(body || "").length,
    recipientMasked: recipientMasked || null,
    policyAllowed: policy?.allowed !== false,
    policyCode: policy?.code || null,
    policyMessage: policy?.message || null,
    dryRun: Boolean(dryRun),
    note: dryRun
      ? "Dry-run: реальной отправки не будет (COMMUNICATIONS_DRY_RUN или SEND выключен)."
      : "После подтверждения сообщение попадёт в outbox.",
  };
}

export function buildCampaignPreparePreview(campaign, plan) {
  return {
    kind: "communication_campaign_start",
    campaignId: campaign.id,
    name: campaign.name,
    planHash: plan.planHash,
    recipientCount: plan.allowedCount,
    excludedCount: plan.excludedCount,
    confirmationPhrase: buildCampaignConfirmationPhrase(plan.allowedCount),
    dryRun: Boolean(campaign.dryRun),
    channelBreakdown: plan.channelBreakdown || {},
    sample: (plan.samples || []).slice(0, 20),
    exclusions: (plan.exclusions || []).slice(0, 50),
  };
}
