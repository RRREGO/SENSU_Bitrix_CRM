import { PROJECT_COLORS } from "../helpers.js";

/**
 * @returns {Promise<{ name: string, description?: string, instruction?: string, colorKey?: string }|null>}
 */
export function openCreateProjectModal() {
  return new Promise((resolve) => {
    const colorOptions = PROJECT_COLORS.map(
      (c, i) =>
        `<label class="color-swatch-option">
          <input type="radio" name="projectColor" value="${c.key}" ${i === 0 ? "checked" : ""}>
          <span class="color-swatch color-swatch--${c.key}" title="${c.label}"></span>
        </label>`
    ).join("");

    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-dialog modal-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="createProjectTitle">
        <h3 id="createProjectTitle" class="modal-title">Новый проект</h3>
        <p class="modal-text">Рабочее пространство для связанных чатов, файлов и CRM-контекста.</p>
        <label class="modal-field">
          <span>Название <abbr title="обязательно">*</abbr></span>
          <input type="text" class="modal-input" data-name placeholder="Например: SENSU CRM" autocomplete="off" required>
        </label>
        <label class="modal-field">
          <span>Описание</span>
          <textarea class="modal-input" data-description rows="2" placeholder="Кратко, о чём этот проект"></textarea>
        </label>
        <label class="modal-field">
          <span>Инструкции для ассистента</span>
          <textarea class="modal-input" data-instruction rows="3" placeholder="Как ассистенту работать в этом проекте"></textarea>
        </label>
        <fieldset class="modal-field">
          <legend>Цвет</legend>
          <div class="color-swatch-row">${colorOptions}</div>
        </fieldset>
        <p class="modal-hint">Файлы, CRM и шаблон протокола можно добавить в настройках проекта.</p>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" data-cancel>Отмена</button>
          <button type="button" class="btn btn-primary" data-confirm>Создать</button>
        </div>
      </div>`;

    const nameInput = overlay.querySelector("[data-name]");
    const finish = (value) => {
      overlay.remove();
      document.removeEventListener("keydown", onKey);
      resolve(value);
    };
    const submit = () => {
      const name = nameInput?.value?.trim() || "";
      if (!name) {
        nameInput?.focus();
        nameInput?.classList.add("is-invalid");
        return;
      }
      finish({
        name,
        description: overlay.querySelector("[data-description]")?.value?.trim() || "",
        instruction: overlay.querySelector("[data-instruction]")?.value?.trim() || "",
        colorKey: overlay.querySelector('input[name="projectColor"]:checked')?.value || "violet",
      });
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(null);
    };

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });
    overlay.querySelector("[data-cancel]")?.addEventListener("click", () => finish(null));
    overlay.querySelector("[data-confirm]")?.addEventListener("click", submit);
    nameInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
    nameInput?.focus();
  });
}
