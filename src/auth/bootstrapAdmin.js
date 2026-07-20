/**
 * Bootstrap первого администратора из .env (однократно).
 */

import { getAuthConfig, AuthError } from "./config.js";
import { ensureSystemRoles } from "./authorizationService.js";
import { countUsers, createUser } from "./authService.js";

export async function bootstrapAdminIfNeeded() {
  ensureSystemRoles();
  if (countUsers() > 0) {
    return { created: false, reason: "users_exist" };
  }

  const cfg = getAuthConfig();
  const username = cfg.bootstrapUsername;
  const password = cfg.bootstrapPassword;

  if (!password || !String(password).trim()) {
    console.warn(
      "[Auth] Bootstrap admin не создан: задайте APP_BOOTSTRAP_ADMIN_PASSWORD (пусто запрещено)."
    );
    return { created: false, reason: "empty_password" };
  }

  try {
    const user = await createUser({
      username,
      password,
      displayName: cfg.bootstrapDisplayName,
      roleCode: "administrator",
      dataScope: "all",
      mustChangePassword: true,
    });
    console.warn(
      "[Auth] Создан bootstrap-администратор. Смените пароль и удалите APP_BOOTSTRAP_ADMIN_PASSWORD из .env."
    );
    return { created: true, userId: user.id, username: user.username };
  } catch (error) {
    if (error instanceof AuthError) {
      console.warn(`[Auth] Bootstrap не выполнен: ${error.code}`);
      return { created: false, reason: error.code };
    }
    throw error;
  }
}
