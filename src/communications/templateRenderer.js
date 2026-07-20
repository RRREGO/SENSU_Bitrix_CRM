/**
 * Strict template renderer with allowlisted variables.
 */

import {
  CommunicationError,
  TEMPLATE_ALLOWED_VARS,
  TEMPLATE_CATEGORIES,
  getCommunicationsConfig,
} from "./config.js";

const VAR_RE = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;

export function extractTemplateVars(body) {
  const found = new Set();
  const text = String(body || "");
  let m;
  const re = new RegExp(VAR_RE.source, "g");
  while ((m = re.exec(text)) !== null) {
    found.add(m[1]);
  }
  return [...found];
}

export function lintTemplate({
  body,
  category,
  channel,
  wabaTemplateId = null,
  allowColdTelegram = false,
} = {}) {
  const errors = [];
  const warnings = [];
  const text = String(body || "");

  if (!text.trim()) {
    errors.push({ code: "EMPTY_BODY", message: "Текст шаблона пуст." });
  }

  if (!TEMPLATE_CATEGORIES.includes(String(category || ""))) {
    errors.push({
      code: "FORBIDDEN_CATEGORY",
      message: `Категория «${category}» не разрешена.`,
      allowed: TEMPLATE_CATEGORIES,
    });
  }

  const vars = extractTemplateVars(text);
  for (const v of vars) {
    if (!TEMPLATE_ALLOWED_VARS.includes(v)) {
      errors.push({
        code: "UNKNOWN_VARIABLE",
        message: `Неизвестная переменная {{${v}}}.`,
        allowed: TEMPLATE_ALLOWED_VARS,
      });
    }
  }

  // Forbid nested / expressions
  if (/\{\{[^}]*[.<(\[][^}]*\}\}/.test(text) || /\$\{/.test(text)) {
    errors.push({
      code: "FORBIDDEN_EXPRESSION",
      message: "Запрещены вложенные выражения и JS-интерполяция.",
    });
  }

  const cfg = getCommunicationsConfig();
  const max =
    cfg.maxChars[String(channel || "").toLowerCase()] ||
    cfg.maxChars.whatsapp ||
    4000;
  if (text.length > max) {
    errors.push({
      code: "MESSAGE_TOO_LONG",
      message: `Текст длиннее лимита канала (${max}).`,
      length: text.length,
      max,
    });
  }

  const ch = String(channel || "").toLowerCase();
  if ((ch === "telegram" || ch === "max") && !allowColdTelegram) {
    const coldCategories = ["warmup", "cycle", "newsletter", "meeting_invitation"];
    if (coldCategories.includes(category)) {
      warnings.push({
        code: "COLD_TELEGRAM_MAX",
        message:
          "Холодный текст для Telegram/MAX потребует структурированное основание first-contact.",
      });
    }
  }

  if (ch === "wapi" || ch === "waba") {
    if (!wabaTemplateId) {
      errors.push({
        code: "WABA_TEMPLATE_ID_REQUIRED",
        message: "Для WABA обязателен wabaTemplateId.",
      });
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    variables: vars,
  };
}

export function renderTemplate(body, vars = {}) {
  const lint = lintTemplate({
    body,
    category: vars.__category || "service",
    channel: vars.__channel || "whatsapp",
    wabaTemplateId: vars.__wabaTemplateId || null,
    allowColdTelegram: true,
  });
  // Only block on unknown vars / expressions for render path
  const blocking = lint.errors.filter((e) =>
    ["UNKNOWN_VARIABLE", "FORBIDDEN_EXPRESSION", "EMPTY_BODY"].includes(e.code)
  );
  if (blocking.length) {
    throw new CommunicationError("TEMPLATE_LINT_FAILED", blocking[0].message, {
      errors: blocking,
    });
  }

  const allowed = {};
  for (const key of TEMPLATE_ALLOWED_VARS) {
    if (vars[key] != null) allowed[key] = String(vars[key]);
  }

  return String(body || "").replace(VAR_RE, (_, name) => {
    if (!TEMPLATE_ALLOWED_VARS.includes(name)) {
      throw new CommunicationError(
        "UNKNOWN_VARIABLE",
        `Неизвестная переменная {{${name}}}.`
      );
    }
    return allowed[name] != null ? allowed[name] : "";
  });
}

export function assertRequiredVarsFilled(body, vars = {}) {
  const needed = extractTemplateVars(body);
  const missing = needed.filter((v) => vars[v] == null || String(vars[v]).trim() === "");
  if (missing.length) {
    throw new CommunicationError(
      "TEMPLATE_VARS_MISSING",
      `Не заполнены переменные: ${missing.join(", ")}`,
      { missing }
    );
  }
  return true;
}
