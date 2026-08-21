/**
 * Background Bitrix / LLM health probes (read-only / technical).
 */

import { logger } from "./logger.js";
import { recordApplicationError } from "../database/repositories/applicationErrorsRepository.js";
import { notifySystemFailure } from "../scheduler/notificationService.js";
import { getDatabase } from "../database/index.js";
import { recordBitrixRead, recordLlmRequest } from "./metricsService.js";

let bitrixTimer = null;
let llmTimer = null;
let bitrixFailStreak = 0;
let llmFailStreak = 0;

function settingSet(key, value) {
  getDatabase()
    .prepare(
      `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}

export async function runBitrixProbe() {
  const started = Date.now();
  try {
    const { callReadMethod } = await import("../bitrixClient.js");
    await callReadMethod("user.current", {});
    const durationMs = Date.now() - started;
    recordBitrixRead({ ok: true, durationMs });
    settingSet("bitrix_probe_last_ok_at", new Date().toISOString());
    bitrixFailStreak = 0;
    logger.info("bitrix.probe.ok", { durationMs });
    return { ok: true, durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    recordBitrixRead({ ok: false, durationMs, code: error.code });
    bitrixFailStreak += 1;
    settingSet("bitrix_probe_last_error_at", new Date().toISOString());
    logger.warn("bitrix.probe.failed", { message: error.message, streak: bitrixFailStreak });
    if (bitrixFailStreak >= 3) {
      recordApplicationError({
        source: "bitrix",
        errorCode: error.code || "BITRIX_PROBE_FAILED",
        severity: "critical",
        messageSafe: "Повторный сбой проверки доступности Bitrix24.",
      });
      try {
        notifySystemFailure({
          title: "Bitrix24 недоступен",
          message: "Повторяющиеся ошибки probe Bitrix24.",
          data: { streak: bitrixFailStreak },
        });
      } catch {
        /* ignore */
      }
    }
    return { ok: false, error: error.message };
  }
}

export async function runLlmProbe() {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.LLM_HEALTH_PROBE_ENABLED || "false"))) {
    return { ok: true, skipped: true };
  }
  const started = Date.now();
  try {
    const { testLlmTransport } = await import("../llm/transport.js");
    const result = await testLlmTransport();
    const durationMs = Date.now() - started;
    const ok = Boolean(result?.success);
    recordLlmRequest({ ok, durationMs, requestChars: 16, responseChars: ok ? 8 : 0 });
    if (!ok) throw new Error(result?.error || "LLM probe failed");
    settingSet("llm_probe_last_ok_at", new Date().toISOString());
    llmFailStreak = 0;
    logger.info("llm.probe.ok", { durationMs });
    return { ok: true, durationMs };
  } catch (error) {
    const durationMs = Date.now() - started;
    recordLlmRequest({ ok: false, durationMs });
    llmFailStreak += 1;
    settingSet("llm_probe_last_error_at", new Date().toISOString());
    logger.warn("llm.probe.failed", { message: error.message, streak: llmFailStreak });
    if (llmFailStreak >= 3) {
      recordApplicationError({
        source: "llm",
        errorCode: "LLM_PROBE_FAILED",
        severity: "critical",
        messageSafe: "Повторный сбой проверки доступности LLM.",
      });
      try {
        notifySystemFailure({
          title: "LLM недоступен",
          message: "Повторяющиеся ошибки probe LLM.",
          data: { streak: llmFailStreak },
        });
      } catch {
        /* ignore */
      }
    }
    return { ok: false, error: error.message };
  }
}

export function startHealthProbes() {
  const bitrixMin = Number(process.env.BITRIX_HEALTH_PROBE_INTERVAL_MINUTES || 5);
  const llmMin = Number(process.env.LLM_HEALTH_PROBE_INTERVAL_MINUTES || 30);
  if (bitrixMin > 0) {
    bitrixTimer = setInterval(() => {
      runBitrixProbe().catch(() => {});
    }, bitrixMin * 60_000);
    bitrixTimer.unref?.();
  }
  if (/^(1|true|yes|on)$/i.test(String(process.env.LLM_HEALTH_PROBE_ENABLED || "false")) && llmMin > 0) {
    llmTimer = setInterval(() => {
      runLlmProbe().catch(() => {});
    }, llmMin * 60_000);
    llmTimer.unref?.();
  }
}

export function stopHealthProbes() {
  if (bitrixTimer) clearInterval(bitrixTimer);
  if (llmTimer) clearInterval(llmTimer);
  bitrixTimer = null;
  llmTimer = null;
}
