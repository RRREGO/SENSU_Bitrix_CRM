import { apiFetch, apiGet, apiPost, setCsrfToken, clearCsrfToken, setSessionLive } from "../apiClient.js";
import { escapeHtml } from "./utils.js";
import { ROLE_LABELS, SCOPE_LABELS, labelOf } from "./uiLabels.js";

let permissions = new Set();
let currentUser = null;
let listenersBound = false;
let authReadyResolve = null;
let authReadyPromise = null;

function waitUntilAuthenticated() {
  if (!authReadyPromise) {
    authReadyPromise = new Promise((resolve) => {
      authReadyResolve = resolve;
    });
  }
  return authReadyPromise;
}

function showBoot(message = "Загрузка…") {
  const gate = document.getElementById("loginGate");
  const form = document.getElementById("loginForm");
  const boot = document.getElementById("loginBootStatus");
  if (boot) boot.textContent = message;
  boot?.classList.remove("hidden");
  form?.classList.add("hidden");
  gate?.classList.remove("hidden");
  document.getElementById("appRoot")?.classList.add("auth-blocked");
}

function finishAuthenticatedSession() {
  applyPermissionUi();
  showBoot("Загрузка…");
  authReadyResolve?.();
}

export function revealApp() {
  setSessionLive(true);
  document.getElementById("loginGate")?.classList.add("hidden");
  document.getElementById("changePasswordGate")?.classList.add("hidden");
  document.getElementById("appRoot")?.classList.remove("auth-blocked");
}

export function hasUiPermission(p) {
  return permissions.has(p);
}

function showLogin(show) {
  const gate = document.getElementById("loginGate");
  const form = document.getElementById("loginForm");
  const boot = document.getElementById("loginBootStatus");
  gate?.classList.toggle("hidden", !show);
  document.getElementById("appRoot")?.classList.toggle("auth-blocked", show);
  if (show) {
    boot?.classList.add("hidden");
    form?.classList.remove("hidden");
  }
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
  document.getElementById("userBarRole").textContent = labelOf(ROLE_LABELS, currentUser?.role, "");
}

function bindAuthListeners() {
  if (listenersBound) return;
  listenersBound = true;

  document.getElementById("loginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    const err = document.getElementById("loginError");
    const submitBtn = e.target.querySelector('button[type="submit"]');
    err?.classList.add("hidden");
    if (submitBtn) submitBtn.disabled = true;
    showBoot("Вход…");

    try {
      const res = await apiFetch("/auth/login", {
        method: "POST",
        skipCsrf: true,
        body: {
          username: document.getElementById("loginUsername").value,
          password: document.getElementById("loginPassword").value,
        },
      });

      const data = res.data;
      if (!res.ok || data.success === false) {
        err.textContent = data?.error?.message || "Неверный логин или пароль.";
        err.classList.remove("hidden");
        if (submitBtn) submitBtn.disabled = false;
        showLogin(true);
        return;
      }

      setCsrfToken(data.csrfToken);
      permissions = new Set(data.permissions || []);
      currentUser = data.user;

      if (data.user?.mustChangePassword) {
        if (submitBtn) submitBtn.disabled = false;
        showLogin(false);
        showChangePassword(true);
        return;
      }

      finishAuthenticatedSession();
    } catch (error) {
      err.textContent = error.message || "Не удалось войти.";
      err.classList.remove("hidden");
      if (submitBtn) submitBtn.disabled = false;
      showLogin(true);
    }
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

    finishAuthenticatedSession();
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
  waitUntilAuthenticated();

  const me = await apiFetch("/auth/me");
  if (me.ok) {
    const data = me.data;

    if (data.mode === "local_only") {
      permissions = new Set(data.permissions || []);
      currentUser = data.user;
      finishAuthenticatedSession();
      return;
    }

    if (data.success && data.user) {
      currentUser = {
        displayName: data.user.displayName,
        role: data.user.role,
        mustChangePassword: data.user.mustChangePassword,
      };
      permissions = new Set(data.permissions || []);

      const csrfRes = await apiFetch("/auth/csrf");
      if (csrfRes.ok) {
        setCsrfToken(csrfRes.data.csrfToken);
      }

      if (data.user.mustChangePassword) {
        showChangePassword(true);
        await waitUntilAuthenticated();
        return;
      }

      finishAuthenticatedSession();
      return;
    }
  }

  showLogin(true);
  await waitUntilAuthenticated();
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
            <div class="user-card-meta">${escapeHtml(u.username)} · ${escapeHtml(labelOf(ROLE_LABELS, u.role))} · ${escapeHtml(labelOf(SCOPE_LABELS, u.dataScope))}</div>
          </div>
          <span class="chip ${u.isActive ? "" : "chip-muted"}">${u.isActive ? "активен" : "отключён"}</span>
        </div>`
    )
    .join("");
}

export function onUsersTabOpen() {
  loadUsers();
}
