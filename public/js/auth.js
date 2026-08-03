import { apiFetch, apiGet, apiPost, setCsrfToken, clearCsrfToken } from "../apiClient.js";
import { escapeHtml } from "./utils.js";

let permissions = new Set();
let currentUser = null;
let listenersBound = false;

export function hasUiPermission(p) {
  return permissions.has(p);
}

function showLogin(show) {
  document.getElementById("loginGate")?.classList.toggle("hidden", !show);
  document.getElementById("appRoot")?.classList.toggle("auth-blocked", show);
}

function showChangePassword(show) {
  document.getElementById("changePasswordGate")?.classList.toggle("hidden", !show);
  if (show) {
    document.getElementById("appRoot")?.classList.add("auth-blocked");
  }
}

function applyPermissionUi() {
  const usersTab = document.getElementById("usersTab");
  if (usersTab) usersTab.hidden = !hasUiPermission("users.manage");

  const systemTab = document.getElementById("systemTab");
  if (systemTab) {
    systemTab.hidden = !(hasUiPermission("settings.view") && hasUiPermission("audit.view"));
  }

  document.getElementById("userBarName").textContent = currentUser?.displayName || "";
  document.getElementById("userBarRole").textContent = currentUser?.role || "";
}

function bindAuthListeners() {
  if (listenersBound) return;
  listenersBound = true;

  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("loginError");
    err?.classList.add("hidden");

    const res = await apiFetch("/auth/login", {
      method: "POST",
      body: {
        username: document.getElementById("loginUsername").value,
        password: document.getElementById("loginPassword").value,
      },
    });

    const data = res.data;
    if (!res.ok || data.success === false) {
      err.textContent = data?.error?.message || "Неверный логин или пароль.";
      err.classList.remove("hidden");
      return;
    }

    setCsrfToken(data.csrfToken);
    permissions = new Set(data.permissions || []);
    currentUser = data.user;
    showLogin(false);
    applyPermissionUi();

    if (data.user?.mustChangePassword) {
      showChangePassword(true);
      return;
    }

    location.reload();
  });

  async function doLogout() {
    await apiFetch("/auth/logout", { method: "POST", body: {} });
    clearCsrfToken();
    location.reload();
  }

  document.getElementById("logoutBtn")?.addEventListener("click", doLogout);
  document.getElementById("changePasswordLogoutBtn")?.addEventListener("click", doLogout);

  document.getElementById("changePasswordForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("changePasswordError");
    err?.classList.add("hidden");

    const res = await apiFetch("/auth/change-password", {
      method: "POST",
      body: {
        currentPassword: document.getElementById("currentPassword").value,
        newPassword: document.getElementById("newPassword").value,
      },
    });

    const data = res.data;
    if (!res.ok) {
      err.textContent = data.error?.message || "Ошибка смены пароля";
      err.classList.remove("hidden");
      return;
    }

    showChangePassword(false);
    location.reload();
  });

  document.getElementById("createUserForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    await apiPost("/users", {
      username: document.getElementById("newUserUsername").value,
      displayName: document.getElementById("newUserDisplayName").value,
      password: document.getElementById("newUserPassword").value,
      roleCode: document.getElementById("newUserRole").value,
      bitrixUserId: document.getElementById("newUserBitrixId").value || null,
      dataScope: document.getElementById("newUserScope").value,
    });
    loadUsers();
  });
}

export async function initAuth() {
  bindAuthListeners();

  const me = await apiFetch("/auth/me");
  if (me.ok) {
    const data = me.data;

    if (data.mode === "local_only") {
      showLogin(false);
      permissions = new Set(data.permissions || []);
      currentUser = data.user;
      applyPermissionUi();
      return;
    }

    if (data.success && data.user) {
      currentUser = {
        displayName: data.user.displayName,
        role: data.user.role,
        mustChangePassword: data.user.mustChangePassword,
      };
      permissions = new Set(data.permissions || []);
      showLogin(false);
      if (data.user.mustChangePassword) showChangePassword(true);
      applyPermissionUi();

      const csrfRes = await apiFetch("/auth/csrf");
      if (csrfRes.ok) {
        setCsrfToken(csrfRes.data.csrfToken);
      }
      return;
    }
  }

  showLogin(true);
}

export async function loadUsers() {
  if (!hasUiPermission("users.manage")) return;

  const data = await apiGet("/users");
  const list = document.getElementById("usersList");
  if (!list) return;

  const users = data.users || [];
  if (!users.length) {
    list.innerHTML = `<div class="empty-state empty-state--lg"><p class="empty-state-title">Нет пользователей</p></div>`;
    return;
  }
  list.innerHTML = users
    .map(
      (u) =>
        `<div class="user-card">
          <div>
            <div class="user-card-name">${escapeHtml(u.displayName || u.username)}</div>
            <div class="user-card-meta">${escapeHtml(u.username)} · ${escapeHtml(u.role)} · ${escapeHtml(u.dataScope)}</div>
          </div>
          <span class="chip ${u.isActive ? "" : "chip-muted"}">${u.isActive ? "active" : "disabled"}</span>
        </div>`
    )
    .join("");
}

export function onUsersTabOpen() {
  loadUsers();
}
