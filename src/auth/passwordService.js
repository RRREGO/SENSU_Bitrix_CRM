/**
 * Хеширование паролей: scrypt (Node crypto). Без plaintext / MD5 / SHA alone.
 */

import crypto from "crypto";
import { promisify } from "util";
import { AuthError, getAuthConfig } from "./config.js";

const scrypt = promisify(crypto.scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 64 };

export function validatePasswordPolicy(password) {
  const cfg = getAuthConfig();
  const p = String(password || "");
  if (p.length < cfg.passwordMinLength) {
    throw new AuthError(
      "PASSWORD_POLICY_VIOLATION",
      `Пароль должен быть не короче ${cfg.passwordMinLength} символов.`
    );
  }
  if (cfg.passwordRequireComplexity) {
    const ok =
      /[a-z]/.test(p) &&
      /[A-Z]/.test(p) &&
      /\d/.test(p) &&
      /[^A-Za-z0-9]/.test(p);
    if (!ok) {
      throw new AuthError(
        "PASSWORD_POLICY_VIOLATION",
        "Пароль должен содержать заглавные, строчные буквы, цифру и спецсимвол."
      );
    }
  }
  if (cfg.isProduction) {
    const weak = ["password", "admin", "123456", "qwerty"];
    if (weak.some((w) => p.toLowerCase().includes(w))) {
      throw new AuthError("PASSWORD_POLICY_VIOLATION", "Слабый пароль запрещён в production.");
    }
  }
}

export async function hashPassword(password) {
  validatePasswordPolicy(password);
  const salt = crypto.randomBytes(16).toString("base64url");
  const derived = await scrypt(String(password), salt, SCRYPT.keyLen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt}$${Buffer.from(derived).toString("base64url")}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || "").split("$");
  if (parts[0] !== "scrypt" || parts.length !== 6) return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = parts[5];
  const derived = await scrypt(String(password), salt, SCRYPT.keyLen, { N, r, p });
  const got = Buffer.from(derived).toString("base64url");
  try {
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function hashOpaqueToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

export function generateOpaqueToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}
