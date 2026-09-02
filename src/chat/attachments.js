import path from "path";
import XLSX from "xlsx";
import { getWorkspaceConfig, WorkspaceError } from "../workspace/config.js";

export const ATTACHMENT_MARKER = "\n\n---\nПрикреплённые файлы\n";
export const FILES_ONLY_PREFIX = "Пользователь прикрепил файлы без комментария.";

const ALLOWED_EXT = new Set([".txt", ".md", ".csv", ".tsv", ".xlsx", ".xls"]);
const SPREADSHEET_EXT = new Set([".xlsx", ".xls"]);

const MAX_SHEETS = 8;
const MAX_ROWS_PER_SHEET = 2000;

function attachmentLimits() {
  const cfg = getWorkspaceConfig();
  return {
    maxCount: cfg.chatAttachmentMaxCount,
    maxBytes: cfg.chatAttachmentMaxBytes,
    maxChars: cfg.chatAttachmentMaxChars,
    maxTotalChars: cfg.chatAttachmentMaxTotalChars,
  };
}

export function normalizeAttachmentFilename(filename) {
  const base = path.basename(String(filename || "file.txt")).replace(/[^\w.\-() а-яА-ЯёЁ]+/gi, "_");
  if (!base || base === "." || base === "..") {
    throw new WorkspaceError("ATTACHMENT_TYPE_NOT_SUPPORTED", "Некорректное имя файла.");
  }
  return base.slice(0, 180);
}

function decodeBase64(contentBase64, maxBytes) {
  const raw = String(contentBase64 || "").replace(/\s+/g, "");
  if (!raw) {
    throw new WorkspaceError("ATTACHMENT_EMPTY", "Файл пустой.");
  }
  if (raw.length > Math.ceil(maxBytes * 1.4) + 64) {
    throw new WorkspaceError("ATTACHMENT_TOO_LARGE", "Файл превышает допустимый размер.", {
      maxBytes,
    });
  }
  let buffer;
  try {
    buffer = Buffer.from(raw, "base64");
  } catch {
    throw new WorkspaceError("ATTACHMENT_PARSE_FAILED", "Не удалось прочитать файл.");
  }
  if (!buffer.length) {
    throw new WorkspaceError("ATTACHMENT_EMPTY", "Файл пустой.");
  }
  if (buffer.length > maxBytes) {
    throw new WorkspaceError("ATTACHMENT_TOO_LARGE", "Файл превышает допустимый размер.", {
      maxBytes,
      sizeBytes: buffer.length,
    });
  }
  return buffer;
}

function decodeTextBuffer(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.slice(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString("utf16le");
  }
  let text = buffer.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text;
}

function capText(text, maxChars) {
  const value = String(text || "").replace(/\u0000/g, "");
  if (value.length <= maxChars) {
    return { text: value.trimEnd(), truncated: false };
  }
  return {
    text: `${value.slice(0, maxChars).trimEnd()}\n\n[текст обрезан]`,
    truncated: true,
  };
}

function extractSpreadsheet(buffer, maxChars) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw new WorkspaceError(
      "ATTACHMENT_PARSE_FAILED",
      "Не удалось прочитать таблицу. Сохраните файл как xlsx или csv."
    );
  }
  const sheetNames = (workbook.SheetNames || []).slice(0, MAX_SHEETS);
  if (!sheetNames.length) {
    throw new WorkspaceError("ATTACHMENT_EMPTY", "В таблице нет листов.");
  }

  const parts = [];
  let rowCount = 0;
  let truncated = false;

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
    const limited = rows.slice(0, MAX_ROWS_PER_SHEET);
    if (rows.length > MAX_ROWS_PER_SHEET) truncated = true;
    const nonempty = limited.filter((row) =>
      Array.isArray(row) ? row.some((cell) => String(cell ?? "").trim()) : Boolean(row)
    );
    rowCount += nonempty.length;
    const csv = nonempty
      .map((row) => (Array.isArray(row) ? row : [row]).map((cell) => String(cell ?? "").trim()).join("\t"))
      .join("\n");
    if (!csv.trim()) continue;
    parts.push(sheetNames.length > 1 ? `# Лист: ${name}\n${csv}` : csv);
  }

  if (!parts.length) {
    throw new WorkspaceError("ATTACHMENT_EMPTY", "Таблица пустая.");
  }

  const capped = capText(parts.join("\n\n"), maxChars);
  return {
    extractedText: capped.text,
    truncated: truncated || capped.truncated,
    rowCount,
    sheetCount: sheetNames.length,
  };
}

function extractPlain(buffer, maxChars) {
  const capped = capText(decodeTextBuffer(buffer), maxChars);
  if (!capped.text.trim()) {
    throw new WorkspaceError("ATTACHMENT_EMPTY", "Файл пустой.");
  }
  const rowCount = capped.text.split(/\r?\n/).filter((line) => line.trim()).length;
  return {
    extractedText: capped.text,
    truncated: capped.truncated,
    rowCount,
    sheetCount: 1,
  };
}

export function parseChatAttachment(input, limits = attachmentLimits()) {
  const filename = normalizeAttachmentFilename(input?.filename);
  const ext = path.extname(filename).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new WorkspaceError(
      "ATTACHMENT_TYPE_NOT_SUPPORTED",
      "Можно прикрепить txt, md, csv, tsv, xlsx или xls."
    );
  }

  const buffer = decodeBase64(input?.contentBase64, limits.maxBytes);
  const extracted = SPREADSHEET_EXT.has(ext)
    ? extractSpreadsheet(buffer, limits.maxChars)
    : extractPlain(buffer, limits.maxChars);

  return {
    filename,
    mimeType: String(input?.mimeType || "").slice(0, 120) || null,
    sizeBytes: buffer.length,
    extractedText: extracted.extractedText,
    truncated: extracted.truncated,
    rowCount: extracted.rowCount,
    sheetCount: extracted.sheetCount,
  };
}

export function parseChatAttachments(rawList) {
  const list = Array.isArray(rawList) ? rawList : [];
  if (!list.length) return [];

  const limits = attachmentLimits();
  if (list.length > limits.maxCount) {
    throw new WorkspaceError(
      "ATTACHMENT_LIMIT_REACHED",
      `Можно прикрепить не больше ${limits.maxCount} файлов за сообщение.`
    );
  }

  const parsed = [];
  let totalChars = 0;
  for (const item of list) {
    const file = parseChatAttachment(item, limits);
    totalChars += file.extractedText.length;
    if (totalChars > limits.maxTotalChars) {
      throw new WorkspaceError(
        "ATTACHMENT_TEXT_TOO_LARGE",
        "Суммарный текст вложений слишком большой. Разбейте список на несколько сообщений."
      );
    }
    parsed.push(file);
  }
  return parsed;
}

export function buildLlmUserMessage(userText, parsedFiles) {
  const trimmed = String(userText || "").trim();
  if (!parsedFiles?.length) return trimmed;

  const head = trimmed || FILES_ONLY_PREFIX;
  const blocks = parsedFiles.map((file) => {
    const extra = [];
    if (file.rowCount) extra.push(`${file.rowCount} строк`);
    if (file.truncated) extra.push("обрезано");
    const meta = extra.length ? ` (${extra.join(", ")})` : "";
    return `### Файл: ${file.filename}${meta}\n${file.extractedText}`;
  });

  const instruction =
    "Ниже извлечённый текст вложений. Опирайся на него и не выдумывай строки, которых нет в файле. Если это список компаний или ФИО — вызови один раз crm_match_list с пустыми params. Сервер сам возьмёт текст вложения. Не копируй таблицу в params.text. Не ищи по одной строке через contact_list/company_list. Подтверждение не нужно.";
  return `${head}${ATTACHMENT_MARKER}${instruction}\n\n${blocks.join("\n\n")}`;
}

export function catalogHintForAttachments(userText, parsedFiles) {
  if (!parsedFiles?.length) return String(userText || "").trim();
  const names = parsedFiles.map((f) => f.filename).join(" ");
  const base = String(userText || "").trim() || "Проверь вложенный список";
  return `${base}\nсверить список контактов компаний из вложения ${names}`;
}

export function visibleUserText(content, metadata) {
  if (Array.isArray(metadata?.attachments) && metadata.attachments.length) {
    if (typeof metadata.displayText === "string") return metadata.displayText;
  }
  const text = String(content || "");
  const idx = text.indexOf(ATTACHMENT_MARKER.trimEnd());
  if (idx >= 0) {
    const before = text.slice(0, idx).trim();
    if (before === FILES_ONLY_PREFIX) return "";
    return before;
  }
  return text;
}

export function attachmentPublicMeta(file) {
  return {
    filename: file.filename,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    rowCount: file.rowCount,
    sheetCount: file.sheetCount,
    truncated: Boolean(file.truncated),
  };
}
