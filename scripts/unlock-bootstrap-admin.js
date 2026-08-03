/**
 * Unblock bootstrap admin: clear must_change_password and revoke sessions.
 * Usage: node scripts/unlock-bootstrap-admin.js
 */
import "dotenv/config";
import { getDatabase } from "../src/database/index.js";

const db = getDatabase();
const now = new Date().toISOString();
const username = (process.env.APP_BOOTSTRAP_ADMIN_USERNAME || "admin").trim();

const user = db
  .prepare("SELECT id, username, must_change_password FROM app_users WHERE username = ? COLLATE NOCASE")
  .get(username);

if (!user) {
  console.error(`User "${username}" not found in app_users`);
  process.exit(1);
}

db.prepare(
  "UPDATE app_users SET must_change_password = 0, updated_at = ? WHERE id = ?"
).run(now, user.id);

const revoked = db
  .prepare(
    "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL"
  )
  .run(now, user.id);

console.log(
  JSON.stringify(
    {
      ok: true,
      username: user.username,
      clearedMustChangePassword: true,
      revokedSessions: revoked.changes,
    },
    null,
    2
  )
);
