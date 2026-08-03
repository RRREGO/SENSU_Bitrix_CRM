/**
 * Encrypt/decrypt application secrets at rest.
 * Master key from SECRETS_MASTER_KEY (or APP_SECRETS_MASTER_KEY) — never stored in DB.
 */

import crypto from "crypto";
import { getSecretsMasterKey } from "./config.js";
import { ConnectionError, CONNECTION_ERROR_CODES } from "./errors.js";

const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

function deriveKey(master) {
  // Prefer raw 32-byte hex/base64; otherwise scrypt from passphrase.
  const raw = String(master || "");
  if (!raw) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "SECRETS_MASTER_KEY не задан. Укажите ключ в окружении."
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  try {
    const b64 = Buffer.from(raw, "base64");
    if (b64.length === KEY_LEN) return b64;
  } catch {
    /* fallthrough */
  }
  return crypto.scryptSync(raw, "bitrix-claude-secrets-v1", KEY_LEN);
}

export function isSecretsConfigured() {
  return Boolean(getSecretsMasterKey()?.trim());
}

export function encryptSecret(plaintext) {
  if (plaintext == null || plaintext === "") return null;
  const key = deriveKey(getSecretsMasterKey());
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload) {
  if (!payload) return null;
  const key = deriveKey(getSecretsMasterKey());
  const parts = String(payload).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Некорректный формат зашифрованного секрета."
    );
  }
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const data = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new ConnectionError(
      CONNECTION_ERROR_CODES.INVALID_CONFIGURATION,
      "Некорректный формат зашифрованного секрета."
    );
  }
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

export function maskSecret(value, visible = 4) {
  if (!value) return null;
  const s = String(value);
  if (s.length <= visible) return "***";
  return `${"*".repeat(Math.min(12, s.length - visible))}${s.slice(-visible)}`;
}

export function secretMeta(hasSecret, maskedHint = null) {
  return {
    configured: Boolean(hasSecret),
    mask: hasSecret ? maskedHint || "********" : null,
  };
}
