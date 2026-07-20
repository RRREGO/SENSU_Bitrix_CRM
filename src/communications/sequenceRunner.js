/**
 * Sequence enrollments, step scheduling, stop on reply/status/suppression.
 */

import { getDatabase } from "../database/index.js";
import { CommunicationError, getCommunicationsConfig, POLICY_VERSION } from "./config.js";
import { evaluateSendPolicy } from "./communicationPolicy.js";
import { renderTemplate } from "./templateRenderer.js";
import * as repo from "./communicationRepository.js";
import { assertSendCertified } from "./certification/certificationService.js";
import { hashBody } from "./certification/certificationValidator.js";

function addDelay(fromDate, step) {
  const d = new Date(fromDate);
  const value = Number(step.delayValue || 0);
  const unit = step.delayUnit || "days";
  if (unit === "hours") d.setHours(d.getHours() + value);
  else if (unit === "minutes") d.setMinutes(d.getMinutes() + value);
  else {
    let left = value;
    if (left === 0) return d.toISOString();
    while (left > 0) {
      d.setDate(d.getDate() + 1);
      if (step.businessDays) {
        const day = d.getDay();
        if (day === 0 || day === 6) continue;
      }
      left -= 1;
    }
  }
  return d.toISOString();
}

function listIdentitiesForContact(contactId) {
  return getDatabase()
    .prepare(
      `SELECT * FROM communication_identities WHERE contact_id = ? ORDER BY updated_at DESC`
    )
    .all(String(contactId))
    .map((row) => ({
      id: row.id,
      externalChatId: row.external_chat_id,
      phoneNormalized: row.phone_normalized,
      username: row.username,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) : {},
    }));
}

export function enrollContact(sequenceId, contactId, { userId, vars = {}, address = {} } = {}) {
  const sequence = repo.getSequence(sequenceId);
  if (!sequence) throw new CommunicationError("SEQUENCE_NOT_FOUND", "Цепочка не найдена.");
  if (sequence.status !== "active") {
    throw new CommunicationError(
      "SEQUENCE_NOT_ACTIVE",
      "Подключение возможно только к активной цепочке."
    );
  }

  const active = repo.listActiveEnrollmentsForContact(contactId);
  if (active.some((e) => e.sequenceId === sequenceId)) {
    throw new CommunicationError("ALREADY_ENROLLED", "Контакт уже в этой цепочке.");
  }

  const firstStep = (sequence.steps || [])[0];
  const immediate =
    !firstStep || Number(firstStep.delayValue || 0) === 0
      ? new Date().toISOString()
      : addDelay(new Date().toISOString(), firstStep);

  const enrollment = repo.createEnrollment({
    sequenceId,
    contactId,
    status: "active",
    nextRunAt: immediate,
    enrolledByUserId: userId || null,
  });

  if (address.chatId || address.phone || address.username) {
    repo.upsertIdentity({
      contactId: String(contactId),
      provider: "wazzup",
      transport: firstStep?.channel || null,
      chatType: firstStep?.channel || null,
      externalChatId: address.chatId || address.phone || null,
      username: address.username || null,
      phoneNormalized: address.phone || null,
      source: "sequence_enroll",
      resolutionStatus: "resolved",
      metadata: { enrollVars: vars, firstContactGround: address.firstContactGround || "manual_consent" },
    });
  }

  return enrollment;
}

export function stopEnrollment(enrollmentId, reason = "stopped_manually") {
  const e = repo.getEnrollment(enrollmentId);
  if (!e) throw new CommunicationError("ENROLLMENT_NOT_FOUND", "Enrollment не найден.");
  repo.cancelOutboxForEnrollment(enrollmentId);
  return repo.updateEnrollment(enrollmentId, {
    status: reason,
    stopReason: reason,
    stoppedAt: new Date().toISOString(),
  });
}

export function stopContactSequences(contactId, reason = "stopped_by_reply") {
  return repo.stopEnrollmentsForContact(contactId, reason);
}

/**
 * Process due enrollments: queue next step into outbox (never calls provider directly).
 */
export function processDueEnrollments({ limit = 20 } = {}) {
  const cfg = getCommunicationsConfig();
  const due = repo.listDueEnrollments(limit);
  const results = [];

  for (const enrollment of due) {
    const sequence = repo.getSequence(enrollment.sequenceId);
    if (!sequence || sequence.status !== "active") {
      stopEnrollment(enrollment.id, "stopped_manually");
      results.push({ enrollmentId: enrollment.id, action: "stopped_sequence_inactive" });
      continue;
    }

    if (repo.findActiveSuppression(enrollment.contactId)) {
      stopEnrollment(enrollment.id, "stopped_by_suppression");
      results.push({ enrollmentId: enrollment.id, action: "stopped_by_suppression" });
      continue;
    }

    const steps = sequence.steps || [];
    const nextIndex = enrollment.currentStep;

    if (nextIndex >= steps.length) {
      repo.updateEnrollment(enrollment.id, {
        status: "completed",
        completedAt: new Date().toISOString(),
        stopReason: "completed",
      });
      results.push({
        enrollmentId: enrollment.id,
        action: "completed",
        suggestStatus: sequence.completionAction || null,
        autoStatusChange: Boolean(cfg.autoChangeContactStatus),
      });
      continue;
    }

    const step = steps[nextIndex];
    const template = step.templateId ? repo.getTemplate(step.templateId) : null;
    const idRows = listIdentitiesForContact(enrollment.contactId);
    const chatId = idRows[0]?.externalChatId || null;
    const phone = idRows[0]?.phoneNormalized || null;
    const username = idRows[0]?.username || null;

    const policy = evaluateSendPolicy({
      contactId: enrollment.contactId,
      channel: step.channel,
      transport: step.channel,
      chatType: step.channel,
      externalChatId: chatId,
      phone,
      username,
      category: template?.category || "warmup",
      sequenceEnrollmentStatus: enrollment.status,
      wabaTemplateId: template?.wabaTemplateId,
      channelState: "active",
      isFirstContact: nextIndex === 0,
      firstContactGround: idRows[0]?.metadata?.firstContactGround || "manual_consent",
    });

    if (!policy.allowed) {
      if (["SUPPRESSION", "STATUS_SPAM", "STATUS_DONT_TOUCH", "OPT_OUT"].includes(policy.code)) {
        stopEnrollment(enrollment.id, "stopped_by_status");
      }
      results.push({
        enrollmentId: enrollment.id,
        action: "policy_blocked",
        code: policy.code,
      });
      // Push next attempt beyond quiet hours / daily limit
      repo.updateEnrollment(enrollment.id, {
        nextRunAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        lastErrorSafe: policy.message,
      });
      continue;
    }

    let body = "";
    try {
      if (template) {
        body = renderTemplate(template.body, {
          firstName: "",
          fullName: "",
          companyName: "",
          managerName: "",
          referrerName: "",
          meetingDate: "",
          lastContactDate: "",
          contextReason: `sequence:${sequence.name}:step${step.stepNumber}`,
          __category: template.category,
          __channel: step.channel,
          __wabaTemplateId: template.wabaTemplateId,
        });
      }
    } catch (error) {
      repo.updateEnrollment(enrollment.id, { lastErrorSafe: error.message });
      results.push({ enrollmentId: enrollment.id, action: "render_failed", message: error.message });
      continue;
    }

    const idempotencyKey = `seq:${enrollment.id}:step:${step.stepNumber}`;
    const dryRun = cfg.dryRun || !cfg.sendEnabled;
    if (!dryRun) {
      assertSendCertified({
        level: "sequence",
        provider: "wazzup",
        channel: step.channel,
        dryRun: false,
      });
    }
    repo.createOutboxJob({
      idempotencyKey,
      provider: "wazzup",
      transport: step.channel,
      chatType: step.channel === "max" ? "max" : step.channel,
      externalChatId: chatId || phone,
      contactId: enrollment.contactId,
      sequenceEnrollmentId: enrollment.id,
      sequenceStepNumber: step.stepNumber,
      templateId: template?.id || null,
      body,
      bodyHash: hashBody(body),
      policyVersion: POLICY_VERSION,
      templateVersion: template?.version != null ? String(template.version) : null,
      wabaTemplateId: template?.wabaTemplateId || null,
      crmMessageId: idempotencyKey,
      dryRun,
      payload: { phone, username },
    });

    const following = steps[nextIndex + 1];
    const completedSteps = nextIndex + 1;
    if (!following) {
      repo.updateEnrollment(enrollment.id, {
        currentStep: completedSteps,
        status: "completed",
        completedAt: new Date().toISOString(),
        stopReason: "completed",
        nextRunAt: null,
      });
      results.push({
        enrollmentId: enrollment.id,
        action: "queued_final",
        step: step.stepNumber,
        dryRun,
        suggestStatus: sequence.completionAction || null,
        autoStatusChange: Boolean(cfg.autoChangeContactStatus),
      });
    } else {
      repo.updateEnrollment(enrollment.id, {
        currentStep: completedSteps,
        nextRunAt: addDelay(new Date().toISOString(), following),
        status: "active",
      });
      results.push({
        enrollmentId: enrollment.id,
        action: "queued",
        step: step.stepNumber,
        dryRun,
      });
    }
  }

  return results;
}

export function activateSequence(sequenceId) {
  const sequence = repo.getSequence(sequenceId);
  if (!sequence) throw new CommunicationError("SEQUENCE_NOT_FOUND", "Цепочка не найдена.");
  if (!(sequence.steps || []).length) {
    throw new CommunicationError("SEQUENCE_NO_STEPS", "Добавьте шаги перед активацией.");
  }
  return repo.updateSequence(sequenceId, { status: "active" });
}
