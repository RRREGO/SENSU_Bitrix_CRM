/**
 * Shared sidebar / context menu helpers.
 */

let portalSeq = 0;

function ensurePortalHome(menu) {
  if (menu.dataset.portalHome) return menu.dataset.portalHome;
  const wrap = menu.parentElement;
  const id = `mh-${++portalSeq}`;
  if (wrap) wrap.dataset.menuHome = id;
  menu.dataset.portalHome = id;
  return id;
}

function restorePortaledMenu(menu) {
  if (!menu || menu.parentElement !== document.body) return;
  const home = document.querySelector(`[data-menu-home="${menu.dataset.portalHome}"]`);
  if (home) home.appendChild(menu);
  menu.style.top = "";
  menu.style.left = "";
  menu.style.position = "";
}

export function positionDropdown(menu, triggerBtn) {
  if (!menu || !triggerBtn) return;
  const triggerRect = triggerBtn.getBoundingClientRect();
  const pad = 8;
  menu.style.position = "fixed";
  menu.style.visibility = "hidden";
  menu.classList.remove("hidden");
  const rect = menu.getBoundingClientRect();
  menu.style.visibility = "";

  let top = triggerRect.bottom + 4;
  let left = triggerRect.right - rect.width;

  if (left < pad) left = pad;
  if (left + rect.width > window.innerWidth - pad) {
    left = Math.max(pad, window.innerWidth - pad - rect.width);
  }
  if (top + rect.height > window.innerHeight - pad) {
    top = Math.max(pad, triggerRect.top - rect.height - 4);
  }

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
  menu.style.right = "auto";
}

export function openPortaledMenu(menu, triggerBtn) {
  if (!menu || !triggerBtn) return;
  ensurePortalHome(menu);
  document.body.appendChild(menu);
  positionDropdown(menu, triggerBtn);
  triggerBtn.setAttribute("aria-expanded", "true");
}

function findMenuForButton(btn, menuSelector) {
  const wrap = btn.parentElement;
  return (
    wrap?.querySelector(menuSelector) ||
    (wrap?.dataset.menuHome
      ? document.querySelector(`${menuSelector}[data-portal-home="${wrap.dataset.menuHome}"]`)
      : null)
  );
}

export function closeAllMenus() {
  closeFlyouts();
  document.querySelectorAll(".sidebar-dropdown").forEach((el) => {
    el.classList.add("hidden");
    restorePortaledMenu(el);
  });
  document
    .querySelectorAll(".sidebar-icon-btn[aria-expanded], .sidebar-item-menu-btn[aria-expanded]")
    .forEach((btn) => {
      btn.setAttribute("aria-expanded", "false");
    });
}

export function closeFlyouts() {
  document.querySelectorAll(".sidebar-flyout").forEach((el) => {
    el.classList.add("hidden");
    if (el.parentElement === document.body) {
      const wrap = document.querySelector(
        `.sidebar-menu-flyout-wrap[data-flyout-owner="${CSS.escape?.(el.dataset.flyoutFor) || el.dataset.flyoutFor}"]`
      );
      if (wrap) wrap.appendChild(el);
      else el.remove();
    }
  });
  document
    .querySelectorAll("[data-open-flyout][aria-expanded='true']")
    .forEach((btn) => btn.setAttribute("aria-expanded", "false"));
}

export function positionFlyout(flyout, triggerBtn) {
  if (!flyout || !triggerBtn) return;
  const triggerRect = triggerBtn.getBoundingClientRect();
  const pad = 8;
  flyout.style.visibility = "hidden";
  flyout.classList.remove("hidden");
  const rect = flyout.getBoundingClientRect();
  flyout.style.visibility = "";

  let top = triggerRect.top;
  let left = triggerRect.right + 6;

  if (left + rect.width > window.innerWidth - pad) {
    left = triggerRect.left - rect.width - 6;
  }
  if (top + rect.height > window.innerHeight - pad) {
    top = Math.max(pad, window.innerHeight - pad - rect.height);
  }
  if (top < pad) top = pad;
  if (left < pad) left = pad;

  flyout.style.top = `${top}px`;
  flyout.style.left = `${left}px`;
}

export function wireMenuToggle(root, btnSelector, menuSelector) {
  root.querySelectorAll(btnSelector).forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = findMenuForButton(btn, menuSelector);
      const wasOpen = menu && !menu.classList.contains("hidden");
      closeAllMenus();
      if (!wasOpen && menu) {
        openPortaledMenu(menu, btn);
      }
    });
  });
}

let documentClickWired = false;

export function ensureMenuDocumentClose() {
  if (documentClickWired) return;
  documentClickWired = true;
  document.addEventListener("click", (e) => {
    if (
      e.target.closest(".sidebar-section-actions") ||
      e.target.closest(".sidebar-item-menu-wrap") ||
      e.target.closest(".sidebar-dropdown") ||
      e.target.closest(".sidebar-flyout") ||
      e.target.closest(".chat-meta-menu-wrap")
    ) {
      return;
    }
    closeAllMenus();
  });
}
