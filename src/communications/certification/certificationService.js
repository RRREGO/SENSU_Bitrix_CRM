/**
 * Communications certification service — gates real sends.
 * Dry-run / send-disabled never blocked by missing certification.
 */

import {
  CommunicationError,
  getCommunicationsConfig,
  assertCommunicationFlagsOk,
  EMERGENCY_STOP_SETTING_KEY,
  EMERGENCY_STOP_PHRASE,
  EMERGENCY_RESUME_PHRASE,
  POLICY_VERSION,
} from "../config.js";
import { getSetting, setSetting } from "../../database/repositories/settingsRepository.js";
import * as certRepo from "./certificationRepository.js";
import {
  computeAccountFingerprint,
  buildProviderContractSnapshot,
  computeChannelsHash,
  computeCapabilitiesHash,
  detectContractChange,
} from "./certificationValidator.js";

const LEVEL_REQUIREMENTS = {
  single: {
    field: "singleSendVerifiedAt",
    minStatuses: [
      "single_send_verified",
      "delivery_verified",
      "campaign_verified",
      "sequence_verified",
      "certified",
    ],
  },
  campaign: {
    field: "campaignVerifiedAt",
    minStatuses: ["campaign_verified", "sequence_verified", "certified"],
  },
  sequence: {
    field: "sequenceVerifiedAt",
    minStatuses: ["sequence_verified", "certified"],
    requireInbound: true,
  },
};

function isExpired(cert) {
  if (!cert) return true;
  if (["expired", "revoked", "failed"].includes(cert.status)) return true;
  if (cert.expiresAt && new Date(cert.expiresAt).getTime() < Date.now()) return true;
  return false;
}

export function startCertification({
  provider,
  channel,
  transportId,
  accountFingerprint,
  environment,
  capabilities,
} = {}) {
  const cfg = getCommunicationsConfig();
  const env = environment || process.env.APP_ENV || "development";
  const fp =
    accountFingerprint ||
    computeAccountFingerprint({
      provider: provider || "wazzup",
      accountId: transportId || "default",
      channelIds: transportId ? [transportId] : [],
      transports: channel ? [channel] : [],
      environment: env,
    });

  const expiresAt = new Date(
    Date.now() + (cfg.certificationTtlDays || 90) * 86400000
  ).toISOString();

  return certRepo.createCertification({
    provider: provider || "wazzup",
    channel: channel || null,
    transportId: transportId || null,
    accountFingerprint: fp,
    environment: env,
    status: "not_started",
    capabilities: capabilities || {},
    expiresAt,
  });
}

export async function runCertificationStep(certId, testType, context = {}) {
  const { runStep } = await import("./certificationRunner.js");
  return runStep(certId, testType, context);
}

export function getCertificationStatus(idOrFilters) {
  if (typeof idOrFilters === "string") {
    const cert = certRepo.getCertification(idOrFilters);
    if (!cert) return null;
    return {
      certification: cert,
      runs: certRepo.listCertificationRuns(cert.id),
      expired: isExpired(cert),
      emergencyStop: getEmergencyStopState(),
    };
  }
  return {
    certifications: certRepo.listCertifications(idOrFilters || {}),
    summary: certRepo.certificationSummary(),
    emergencyStop: getEmergencyStopState(),
  };
}

export function revokeCertification(id, reason) {
  const cert = certRepo.getCertification(id);
  if (!cert) {
    throw new CommunicationError("CERTIFICATION_NOT_FOUND", "Сертификация не найдена.");
  }
  return certRepo.updateCertification(id, {
    status: "revoked",
    lastError: { code: "REVOKED", reason: reason || "manual", at: new Date().toISOString() },
  });
}

/**
 * Gate for real provider sends. Dry-run / disabled send → no-op (does not throw).
 */
export function assertSendCertified({
  level = "single",
  provider,
  channel,
  transportId,
  accountFingerprint,
  dryRun = false,
} = {}) {
  const cfg = getCommunicationsConfig();

  // Never block dry-run or when send is disabled
  if (dryRun || cfg.dryRun || !cfg.sendEnabled || !cfg.enabled) {
    return { required: false, ok: true, skipped: true };
  }

  if (!cfg.requireCertification) {
    return { required: false, ok: true, skipped: true, reason: "REQUIRE_CERTIFICATION_FALSE" };
  }

  assertFlagsAllowSend({ level });

  const req = LEVEL_REQUIREMENTS[level] || LEVEL_REQUIREMENTS.single;
  const cert =
    certRepo.findActiveCertification({
      provider: provider || "wazzup",
      channel,
      transportId,
      accountFingerprint,
      environment: process.env.APP_ENV || "development",
    }) || null;

  if (!cert && accountFingerprint) {
    const candidates = certRepo.listCertifications({
      provider: provider || "wazzup",
      accountFingerprint,
      limit: 5,
    });
    const revoked = candidates.find((c) => c.status === "revoked");
    if (revoked) {
      throw new CommunicationError("CERTIFICATION_REVOKED", "Сертификация отозвана.", {
        certificationId: revoked.id,
      });
    }
    const expired = candidates.find((c) => c.status === "expired" || isExpired(c));
    if (expired) {
      throw new CommunicationError("CERTIFICATION_EXPIRED", "Сертификация истекла.", {
        certificationId: expired.id,
        expiresAt: expired.expiresAt,
      });
    }
  }

  if (!cert) {
    throw new CommunicationError(
      "NOT_CERTIFIED",
      `Нет активной сертификации уровня «${level}» для provider/channel.`,
      { level, provider, channel, transportId }
    );
  }

  if (cert.status === "revoked") {
    throw new CommunicationError("CERTIFICATION_REVOKED", "Сертификация отозвана.", {
      certificationId: cert.id,
    });
  }

  if (isExpired(cert) || cert.status === "expired") {
    throw new CommunicationError("CERTIFICATION_EXPIRED", "Сертификация истекла.", {
      certificationId: cert.id,
      expiresAt: cert.expiresAt,
    });
  }

  if (accountFingerprint && cert.accountFingerprint !== accountFingerprint) {
    throw new CommunicationError(
      "CERTIFICATION_FINGERPRINT_MISMATCH",
      "Account fingerprint не совпадает с сертификацией.",
      { certificationId: cert.id }
    );
  }

  if (!cert[req.field]) {
    throw new CommunicationError(
      "NOT_CERTIFIED",
      `Уровень «${level}» не подтверждён (нет ${req.field}).`,
      { certificationId: cert.id, level, status: cert.status }
    );
  }

  if (req.requireInbound && !cert.inboundReplyVerifiedAt) {
    throw new CommunicationError(
      "NOT_CERTIFIED",
      "Для sequence нужна верификация inbound_reply.",
      { certificationId: cert.id }
    );
  }

  if (
    req.minStatuses?.length &&
    !req.minStatuses.includes(cert.status) &&
    !cert[req.field]
  ) {
    throw new CommunicationError("NOT_CERTIFIED", `Статус сертификации недостаточен: ${cert.status}`, {
      certificationId: cert.id,
      status: cert.status,
      required: req.minStatuses,
    });
  }

  return { required: true, ok: true, certification: cert };
}

export function expireIfFingerprintChanged({
  certificationId,
  provider,
  accountFingerprint,
  channels,
} = {}) {
  const cert = certificationId
    ? certRepo.getCertification(certificationId)
    : certRepo.findActiveCertification({ provider, accountFingerprint });
  if (!cert) return null;

  if (accountFingerprint && cert.accountFingerprint !== accountFingerprint) {
    return certRepo.updateCertification(cert.id, {
      status: "expired",
      lastError: {
        code: "FINGERPRINT_CHANGED",
        message: "Account fingerprint изменился.",
        at: new Date().toISOString(),
      },
    });
  }

  const latest = certRepo.getLatestProviderSnapshot({
    provider: provider || cert.provider,
    accountFingerprint: cert.accountFingerprint,
  });
  if (channels && latest) {
    const snap = buildProviderContractSnapshot(channels, { provider: cert.provider });
    const change = detectContractChange(
      {
        channelsHash: latest.channelsHash,
        capabilitiesHash: latest.capabilitiesHash,
        providerVersion: latest.providerVersion,
        ...latest.snapshot,
      },
      {
        channelsHash: computeChannelsHash(channels),
        capabilitiesHash: computeCapabilitiesHash(snap.capabilitiesSummary),
        providerVersion: snap.providerVersion,
        ...snap,
      }
    );
    if (change.changed) {
      return certRepo.updateCertification(cert.id, {
        status: "expired",
        lastError: {
          code: "PROVIDER_CONTRACT_CHANGED",
          reason: change.reason,
          at: new Date().toISOString(),
        },
      });
    }
  }
  return cert;
}

export function recordProviderSnapshot({
  provider,
  accountFingerprint,
  channels,
  providerVersion,
} = {}) {
  const snap = buildProviderContractSnapshot(channels || [], {
    provider: provider || "wazzup",
    providerVersion,
  });
  // Strip any accidental secrets
  const redacted = JSON.parse(
    JSON.stringify(snap, (key, value) => {
      if (/api[_-]?key|secret|token|password|authorization/i.test(String(key))) return undefined;
      return value;
    })
  );
  return certRepo.insertProviderSnapshot({
    provider: provider || "wazzup",
    accountFingerprint:
      accountFingerprint ||
      computeAccountFingerprint({
        provider: provider || "wazzup",
        channelIds: (channels || []).map((c) => c.externalChannelId).filter(Boolean),
        transports: (channels || []).map((c) => c.transport).filter(Boolean),
      }),
    channelsHash: computeChannelsHash(channels || []),
    capabilitiesHash: computeCapabilitiesHash(redacted.capabilitiesSummary),
    providerVersion: providerVersion || null,
    snapshot: redacted,
  });
}

export function getEmergencyStopState() {
  const raw = getSetting(EMERGENCY_STOP_SETTING_KEY, null);
  if (!raw || typeof raw !== "object") {
    return { active: false, reason: null, userId: null, at: null };
  }
  return {
    active: Boolean(raw.active),
    reason: raw.reason || null,
    userId: raw.userId || null,
    at: raw.at || null,
  };
}

export function setEmergencyStop({ active, reason, userId, confirmationPhrase } = {}) {
  const phrase = String(confirmationPhrase || "").trim();
  if (active) {
    if (phrase !== EMERGENCY_STOP_PHRASE) {
      throw new CommunicationError(
        "CONFIRMATION_PHRASE_REQUIRED",
        `Нужна фраза: ${EMERGENCY_STOP_PHRASE}`
      );
    }
  } else if (phrase !== EMERGENCY_RESUME_PHRASE) {
    throw new CommunicationError(
      "CONFIRMATION_PHRASE_REQUIRED",
      `Нужна фраза: ${EMERGENCY_RESUME_PHRASE}`
    );
  }

  const state = {
    active: Boolean(active),
    reason: reason || null,
    userId: userId || null,
    at: new Date().toISOString(),
  };
  setSetting(EMERGENCY_STOP_SETTING_KEY, state);
  return getEmergencyStopState();
}

export function assertNotEmergencyStopped() {
  const state = getEmergencyStopState();
  if (state.active) {
    throw new CommunicationError(
      "COMMUNICATIONS_EMERGENCY_STOP",
      "Аварийная остановка коммуникаций активна. Реальная отправка запрещена.",
      state
    );
  }
  return true;
}

/**
 * Flags + conflict check for a send level.
 * Does not require certification (use assertSendCertified for that).
 */
export function assertFlagsAllowSend({ level } = {}) {
  const flags = assertCommunicationFlagsOk();
  const cfg = getCommunicationsConfig();
  if (cfg.flagsConflict || flags.flagsConflict) {
    throw new CommunicationError(
      "COMMUNICATION_FLAGS_CONFLICT",
      "Конфликт флагов отправки — реальная отправка заблокирована."
    );
  }
  if (!cfg.enabled) {
    throw new CommunicationError(
      "COMMUNICATIONS_DISABLED",
      "Communications Hub выключен (COMMUNICATIONS_ENABLED=false)."
    );
  }
  if (!cfg.sendEnabled) {
    throw new CommunicationError(
      "COMMUNICATIONS_SEND_DISABLED",
      "Отправка выключена (COMMUNICATIONS_SEND_ENABLED=false)."
    );
  }
  if (cfg.dryRun) {
    throw new CommunicationError(
      "COMMUNICATIONS_DRY_RUN",
      "Включён dry-run — реальная отправка запрещена.",
      { level: level || null }
    );
  }
  return true;
}

export function buildOutboxCertificationMeta({
  certificationId,
  accountFingerprint,
  channelFingerprint,
  recipientSnapshotHash,
  bodyHash,
  templateVersion,
} = {}) {
  return {
    certificationId: certificationId || null,
    accountFingerprint: accountFingerprint || null,
    channelFingerprint: channelFingerprint || null,
    recipientSnapshotHash: recipientSnapshotHash || null,
    policyVersion: POLICY_VERSION,
    templateVersion: templateVersion != null ? String(templateVersion) : null,
    bodyHash: bodyHash || null,
  };
}

export { computeAccountFingerprint, POLICY_VERSION };
