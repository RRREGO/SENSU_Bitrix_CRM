/**
 * Shared sidebar / context menu helpers.
 */

export function closeAllMenus() {
  closeFlyouts();
  document.querySelectorAll(".sidebar-dropdown").forEach((el) => el.classList.add("hidden"));
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
      const menu = btn.parentElement?.querySelector(menuSelector);
      const wasOpen = menu && !menu.classList.contains("hidden");
      closeAllMenus();
      if (!wasOpen && menu) {
        menu.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
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
      e.target.closest(".sidebar-flyout") ||
      e.target.closest(".chat-meta-menu-wrap")
    ) {
      return;
    }
    closeAllMenus();
  });
}
