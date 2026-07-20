import crypto from "crypto";
import path from "path";
import { getDatabase } from "../index.js";
import { getWorkspaceConfig, WorkspaceError } from "../../workspace/config.js";
import { getProjectById } from "./projectsRepository.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

const ALLOWED_EXT = new Set([".md", ".txt"]);
const ALLOWED_MIME = new Set(["text/markdown", "text/plain", "text/x-markdown"]);

function mapFile(row) {
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    mimeType: row.mime_type,
    contentText: row.content_text,
    contentHash: row.content_hash,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function normalizeProjectFilename(filename) {
  const base = path.basename(String(filename || "file.txt")).replace(/[^\w.\-() а-яА-ЯёЁ]+/gi, "_");
  if (!base || base === "." || base === "..") {
    throw new WorkspaceError("PROJECT_FILE_TYPE_NOT_SUPPORTED", "Некорректное имя файла.");
  }
  return base.slice(0, 180);
}

export function validateProjectFile({ filename, mimeType, contentText }) {
  const cfg = getWorkspaceConfig();
  const safeName = normalizeProjectFilename(filename);
  const ext = path.extname(safeName).toLowerCase();

  if (!ALLOWED_EXT.has(ext)) {
    throw new WorkspaceError(
      "PROJECT_FILE_TYPE_NOT_SUPPORTED",
      "Поддерживаются только файлы Markdown и TXT."
    );
  }

  if (mimeType && !ALLOWED_MIME.has(String(mimeType).toLowerCase()) && mimeType !== "application/octet-stream") {
    throw new WorkspaceError(
      "PROJECT_FILE_TYPE_NOT_SUPPORTED",
      "Поддерживаются только файлы Markdown и TXT."
    );
  }

  const text = String(contentText ?? "");
  const size = Buffer.byteLength(text, "utf8");
  if (size > cfg.projectFileMaxBytes) {
    throw new WorkspaceError("PROJECT_FILE_TOO_LARGE", "Файл превышает допустимый размер.", {
      maxBytes: cfg.projectFileMaxBytes,
      sizeBytes: size,
    });
  }

  return {
    filename: safeName,
    mimeType: mimeType || (ext === ".md" ? "text/markdown" : "text/plain"),
    contentText: text,
    contentHash: crypto.createHash("sha256").update(text, "utf8").digest("hex"),
    sizeBytes: size,
  };
}

export function listProjectFiles(projectId) {
  return getDatabase()
    .prepare("SELECT * FROM project_files WHERE project_id = ? ORDER BY filename")
    .all(projectId)
    .map(mapFile);
}

export function getProjectFile(projectId, fileId) {
  return mapFile(
    getDatabase()
      .prepare("SELECT * FROM project_files WHERE project_id = ? AND id = ?")
      .get(projectId, fileId)
  );
}

export function countProjectFiles(projectId) {
  return (
    getDatabase()
      .prepare("SELECT COUNT(*) AS c FROM project_files WHERE project_id = ?")
      .get(projectId)?.c || 0
  );
}

export function addProjectFile(projectId, input) {
  if (!getProjectById(projectId)) {
    throw new WorkspaceError("PROJECT_NOT_FOUND", "Проект не найден.");
  }

  const cfg = getWorkspaceConfig();
  if (countProjectFiles(projectId) >= cfg.projectFilesMaxCount) {
    throw new WorkspaceError(
      "PROJECT_FILES_LIMIT_REACHED",
      `Достигнут лимит файлов проекта (${cfg.projectFilesMaxCount}).`
    );
  }

  const validated = validateProjectFile(input);
  const id = uid();
  const ts = now();

  try {
    getDatabase()
      .prepare(
        `INSERT INTO project_files (
          id, project_id, filename, mime_type, content_text, content_hash, size_bytes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        projectId,
        validated.filename,
        validated.mimeType,
        validated.contentText,
        validated.contentHash,
        validated.sizeBytes,
        ts,
        ts
      );
  } catch (error) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }

  console.log(`[Workspace] project file added project=${projectId} file=${validated.filename}`);
  return getProjectFile(projectId, id);
}

export function deleteProjectFile(projectId, fileId) {
  const existing = getProjectFile(projectId, fileId);
  if (!existing) {
    throw new WorkspaceError("PROJECT_NOT_FOUND", "Файл проекта не найден.");
  }
  getDatabase()
    .prepare("DELETE FROM project_files WHERE project_id = ? AND id = ?")
    .run(projectId, fileId);
  console.log(`[Workspace] project file deleted project=${projectId} file=${existing.filename}`);
  return { success: true, deletedId: fileId };
}
