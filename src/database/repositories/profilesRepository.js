import crypto from "crypto";
import { getDatabase } from "../index.js";
import { WorkspaceError } from "../../workspace/config.js";

function uid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    companyContext: row.company_context || "",
    userContext: row.user_context || "",
    responseRules: row.response_rules || "",
    crmMethodology: row.crm_methodology || "",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listProfiles() {
  return getDatabase()
    .prepare("SELECT * FROM profiles ORDER BY is_active DESC, updated_at DESC")
    .all()
    .map(mapProfile);
}

export function getProfileById(id) {
  return mapProfile(getDatabase().prepare("SELECT * FROM profiles WHERE id = ?").get(id));
}

export function getActiveProfile() {
  return mapProfile(
    getDatabase().prepare("SELECT * FROM profiles WHERE is_active = 1 LIMIT 1").get()
  );
}

export function createProfile(data = {}) {
  const db = getDatabase();
  const id = uid();
  const ts = now();
  const makeActive = data.isActive !== false && !getActiveProfile();

  const run = db.transaction(() => {
    if (data.isActive === true) {
      db.prepare("UPDATE profiles SET is_active = 0").run();
    }
    db.prepare(
      `INSERT INTO profiles (
        id, name, description, company_context, user_context,
        response_rules, crm_methodology, is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      data.name || "Базовый профиль",
      data.description || "",
      data.companyContext || "",
      data.userContext || "",
      data.responseRules || "",
      data.crmMethodology || "",
      data.isActive === true || makeActive ? 1 : 0,
      ts,
      ts
    );
  });

  try {
    run();
  } catch (error) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }

  return getProfileById(id);
}

export function updateProfile(id, patch = {}) {
  const current = getProfileById(id);
  if (!current) throw new WorkspaceError("PROFILE_NOT_FOUND", "Профиль не найден.");

  const db = getDatabase();
  const ts = now();

  const run = db.transaction(() => {
    if (patch.isActive === true) {
      db.prepare("UPDATE profiles SET is_active = 0").run();
    }

    db.prepare(
      `UPDATE profiles SET
        name = ?,
        description = ?,
        company_context = ?,
        user_context = ?,
        response_rules = ?,
        crm_methodology = ?,
        is_active = ?,
        updated_at = ?
      WHERE id = ?`
    ).run(
      patch.name ?? current.name,
      patch.description ?? current.description,
      patch.companyContext ?? current.companyContext,
      patch.userContext ?? current.userContext,
      patch.responseRules ?? current.responseRules,
      patch.crmMethodology ?? current.crmMethodology,
      patch.isActive === true ? 1 : patch.isActive === false ? 0 : current.isActive ? 1 : 0,
      ts,
      id
    );
  });

  try {
    run();
  } catch (error) {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", error.message);
  }

  return getProfileById(id);
}

export function activateProfile(id) {
  return updateProfile(id, { isActive: true });
}

export function countActiveProfiles() {
  return (
    getDatabase().prepare("SELECT COUNT(*) AS c FROM profiles WHERE is_active = 1").get()?.c || 0
  );
}
