/**
 * Structured application logger (JSON Lines in production).
 */

import fs from "fs";
import path from "path";
import { redactObject } from "../safety/redact.js";
import { getLogDir, getReleaseMetadata } from "../config/paths.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

function configuredLevel() {
  const raw = String(process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function configuredFormat() {
  return String(process.env.LOG_FORMAT || (process.env.APP_ENV === "production" ? "json" : "text")).toLowerCase();
}

let fileStream = null;

function getFileStream() {
  if (process.env.LOG_TO_FILE !== "true") return null;
  if (fileStream) return fileStream;
  try {
    const dir = getLogDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "app.jsonl");
    fileStream = fs.createWriteStream(file, { flags: "a" });
    fileStream.on("error", () => {
      fileStream = null;
    });
    return fileStream;
  } catch {
    return null;
  }
}

/** Re-open log file after rotation (SIGHUP / journald preferred in prod). */
export function reopenLogFile() {
  try {
    fileStream?.end?.();
  } catch {
    /* ignore */
  }
  fileStream = null;
  getFileStream();
}

function safeDetails(details) {
  if (details == null) return undefined;
  try {
    return redactObject(typeof details === "object" ? details : { value: details });
  } catch {
    return { redacted: true };
  }
}

export function log(level, event, fields = {}) {
  const lvl = String(level || "info").toLowerCase();
  if ((LEVELS[lvl] ?? 99) < configuredLevel()) return;

  const meta = getReleaseMetadata();
  const entry = {
    timestamp: new Date().toISOString(),
    level: lvl,
    event: String(event || "event"),
    releaseId: meta.releaseId,
    ...safeDetails(fields),
  };

  // Never allow secrets-like keys to slip through if redaction missed nested strings
  for (const key of Object.keys(entry)) {
    if (/password|secret|token|cookie|authorization|api[_-]?key|webhook/i.test(key)) {
      entry[key] = "[REDACTED]";
    }
  }

  const line = configuredFormat() === "json" ? JSON.stringify(entry) : formatText(entry);
  if (lvl === "error" || lvl === "fatal") {
    console.error(line);
  } else if (lvl === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }

  const stream = getFileStream();
  if (stream) {
    try {
      stream.write(`${typeof line === "string" && line.startsWith("{") ? line : JSON.stringify(entry)}\n`);
    } catch {
      /* ignore */
    }
  }
}

function formatText(entry) {
  const { timestamp, level, event, ...rest } = entry;
  const restKeys = Object.keys(rest);
  return `[${timestamp}] ${level.toUpperCase()} ${event}${restKeys.length ? ` ${JSON.stringify(rest)}` : ""}`;
}

export const logger = {
  debug: (event, fields) => log("debug", event, fields),
  info: (event, fields) => log("info", event, fields),
  warn: (event, fields) => log("warn", event, fields),
  error: (event, fields) => log("error", event, fields),
  fatal: (event, fields) => log("fatal", event, fields),
};

export default logger;
