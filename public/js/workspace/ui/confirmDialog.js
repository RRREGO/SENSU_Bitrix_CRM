/**
 * @param {{ title: string, message: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} opts
 * @returns {Promise<boolean>}
 */
export function confirmDialog({
  title,
  message,
  confirmLabel = "Подтвердить",
  cancelLabel = "Отмена",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.setAttribute("role", "presentation");
    overlay.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="confirmDialogTitle">
        <h3 id="confirmDialogTitle" class="modal-title">${escape(title)}</h3>
        <p class="modal-text">${escape(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-cancel>${escape(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? "btn-danger" : "btn-primary"}" data-confirm>${escape(confirmLabel)}</button>
        </div>
      </div>`;

    const finish = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
    };

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
    overlay.querySelector("[data-cancel]")?.addEventListener("click", () => finish(false));
    overlay.querySelector("[data-confirm]")?.addEventListener("click", () => finish(true));
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    overlay.querySelector(danger ? "[data-confirm]" : "[data-cancel]")?.focus();
  });
}

/**
 * @param {{ title: string, label?: string, defaultValue?: string, confirmLabel?: string, placeholder?: string }} opts
 * @returns {Promise<string|null>}
 */
export function promptDialog({
  title,
  label = "Название",
  defaultValue = "",
  confirmLabel = "Сохранить",
  placeholder = "",
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="promptDialogTitle">
        <h3 id="promptDialogTitle" class="modal-title">${escape(title)}</h3>
        <label class="modal-field">
          <span>${escape(label)}</span>
          <input type="text" class="modal-input" data-input value="${escapeAttr(defaultValue)}" placeholder="${escapeAttr(placeholder)}" autocomplete="off">
        </label>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-cancel>Отмена</button>
          <button type="button" class="btn btn-primary" data-confirm>${escape(confirmLabel)}</button>
        </div>
      </div>`;

    const input = overlay.querySelector("[data-input]");
    const finish = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(null);
      if (e.key === "Enter") {
        e.preventDefault();
        const v = input?.value?.trim() || "";
        finish(v || null);
      }
    };

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });
    overlay.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
    overlay.querySelector("[data-confirm]")?.addEventListener("click", () => {
      const v = input?.value?.trim() || "";
      finish(v || null);
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    input?.focus();
    input?.select();
  });
}

function escape(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(str) {
  return escape(str).replace(/'/g, "&#39;");
}
