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
  let allowedVariables = null;
  if (row.allowed_variables_json) {
    try {
      allowedVariables = JSON.parse(row.allowed_variables_json);
    } catch {
      allowedVariables = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description || "",
    companyContext: row.company_context || "",
    userContext: row.user_context || "",
    responseRules: row.response_rules || "",
    crmMethodology: row.crm_methodology || "",
    baseInstruction: row.base_instruction || "",
    responseLanguage: row.response_language || "ru",
    responseStyle: row.response_style || "",
    formattingRules: row.formatting_rules || "",
    allowedVariables,
    version: row.version != null ? Number(row.version) : 1,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function snapshotProfile(profile) {
  return JSON.stringify({
    name: profile.name,
    description: profile.description,
    companyContext: profile.companyContext,
    userContext: profile.userContext,
    responseRules: profile.responseRules,
    crmMethodology: profile.crmMethodology,
    baseInstruction: profile.baseInstruction,
    responseLanguage: profile.responseLanguage,
    responseStyle: profile.responseStyle,
    formattingRules: profile.formattingRules,
    allowedVariables: profile.allowedVariables,
    version: profile.version,
  });
}

function saveVersion(db, profile, actorUserId) {
  db.prepare(
    `INSERT INTO prompt_profile_versions (id, profile_id, version, snapshot_json, created_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(uid(), profile.id, profile.version, snapshotProfile(profile), actorUserId || null, now());
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

export function createProfile(data = {}, actorUserId = null) {
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
        response_rules, crm_methodology, base_instruction, response_language,
        response_style, formatting_rules, allowed_variables_json, version,
        is_active, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`
    ).run(
      id,
      data.name || "Базовый профиль",
      data.description || "",
      data.companyContext || "",
      data.userContext || "",
      data.responseRules || "",
      data.crmMethodology || "",
      data.baseInstruction || "",
      data.responseLanguage || "ru",
      data.responseStyle || "",
      data.formattingRules || "",
      data.allowedVariables ? JSON.stringify(data.allowedVariables) : null,
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

  const profile = getProfileById(id);
  try {
    saveVersion(getDatabase(), profile, actorUserId);
  } catch {
    /* versions table may be mid-migrate in tests */
  }
  return profile;
}

export function updateProfile(id, patch = {}, actorUserId = null) {
  const current = getProfileById(id);
  if (!current) throw new WorkspaceError("PROFILE_NOT_FOUND", "Профиль не найден.");

  const db = getDatabase();
  const ts = now();
  const nextVersion = (current.version || 1) + 1;

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
        base_instruction = ?,
        response_language = ?,
        response_style = ?,
        formatting_rules = ?,
        allowed_variables_json = ?,
        version = ?,
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
      patch.baseInstruction ?? current.baseInstruction,
      patch.responseLanguage ?? current.responseLanguage,
      patch.responseStyle ?? current.responseStyle,
      patch.formattingRules ?? current.formattingRules,
      patch.allowedVariables !== undefined
        ? JSON.stringify(patch.allowedVariables)
        : current.allowedVariables
          ? JSON.stringify(current.allowedVariables)
          : null,
      nextVersion,
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

  const profile = getProfileById(id);
  try {
    saveVersion(db, profile, actorUserId);
  } catch {
    /* ignore */
  }
  return profile;
}

export function activateProfile(id) {
  return updateProfile(id, { isActive: true });
}

export function duplicateProfile(id, actorUserId = null) {
  const src = getProfileById(id);
  if (!src) throw new WorkspaceError("PROFILE_NOT_FOUND", "Профиль не найден.");
  return createProfile(
    {
      ...src,
      name: `${src.name} (копия)`,
      isActive: false,
    },
    actorUserId
  );
}

export function listProfileVersions(profileId) {
  return getDatabase()
    .prepare(
      `SELECT id, profile_id, version, created_by_user_id, created_at
       FROM prompt_profile_versions WHERE profile_id = ? ORDER BY version DESC`
    )
    .all(profileId)
    .map((r) => ({
      id: r.id,
      profileId: r.profile_id,
      version: r.version,
      createdByUserId: r.created_by_user_id,
      createdAt: r.created_at,
    }));
}

export function restoreProfileVersion(profileId, versionId, actorUserId = null) {
  const row = getDatabase()
    .prepare(`SELECT * FROM prompt_profile_versions WHERE id = ? AND profile_id = ?`)
    .get(versionId, profileId);
  if (!row) throw new WorkspaceError("PROFILE_NOT_FOUND", "Версия профиля не найдена.");
  let snap;
  try {
    snap = JSON.parse(row.snapshot_json);
  } catch {
    throw new WorkspaceError("DATABASE_WRITE_FAILED", "Повреждённый снимок версии.");
  }
  return updateProfile(profileId, snap, actorUserId);
}

export function assignPromptProfile({ profileId, scopeType, scopeId, isDefault = false }) {
  const id = uid();
  getDatabase()
    .prepare(
      `INSERT INTO prompt_profile_assignments (id, profile_id, scope_type, scope_id, is_default, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(id, profileId, scopeType, scopeId || null, isDefault ? 1 : 0, now());
  return { id, profileId, scopeType, scopeId, isDefault };
}

export function countActiveProfiles() {
  return (
    getDatabase().prepare("SELECT COUNT(*) AS c FROM profiles WHERE is_active = 1").get()?.c || 0
  );
}
