/**
 * Безопасное логирование LLM-запросов (без клиентских payload по умолчанию).
 */

import { getLlmTransportConfig, redactProxyUrl } from "./transport.js";
import { redactObject } from "../safety/redact.js";

export function logLlmRequest({
  model,
  requestChars,
  responseChars,
  durationMs,
  status = "success",
  payload = null,
}) {
  const cfg = getLlmTransportConfig();
  console.log(
    [
      "provider=anthropic",
      `model=${model || "—"}`,
      `requestChars=${requestChars ?? 0}`,
      `responseChars=${responseChars ?? 0}`,
      `durationMs=${durationMs ?? 0}`,
      `proxyMode=${cfg.mode}`,
      `status=${status}`,
    ].join(" ")
  );

  if (cfg.logPayloads && payload) {
    console.warn(
      "[LLM] LLM_LOG_PAYLOADS=true — режим только для локальной разработки. Payload проходит redaction."
    );
    console.warn("[LLM] payload=", JSON.stringify(redactObject(payload)).slice(0, 4000));
  }
}

export function estimateJsonChars(value) {
  try {
    return JSON.stringify(value)?.length || 0;
  } catch {
    return 0;
  }
}

export { redactProxyUrl };
