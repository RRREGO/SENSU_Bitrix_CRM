export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function reportToCopyText(report) {
  const lines = [report.title];

  const from = report.period?.dateFrom || "—";
  const to = report.period?.dateTo || "—";
  lines.push(`Период: ${from} — ${to}`);

  if (report.funnel?.name) {
    lines.push(`Воронка: ${report.funnel.name}`);
  }

  lines.push("");

  if (report.summary?.length) {
    lines.push("Краткая сводка:");
    for (const item of report.summary) {
      lines.push(`${item.label}: ${item.value}`);
    }
    lines.push("");
  }

  for (const section of report.sections || []) {
    lines.push(section.title);
    lines.push(section.content);
    lines.push("");
  }

  for (const table of report.tables || []) {
    lines.push(table.title);
    lines.push(table.columns.join(" | "));
    for (const row of table.rows) {
      lines.push(row.join(" | "));
    }
    lines.push("");
  }

  if (report.recommendations?.length) {
    lines.push("Рекомендации:");
    for (const item of report.recommendations) {
      lines.push(`- ${item}`);
    }
  }

  return lines.join("\n");
}

export function reportToMarkdown(report) {
  if (!report) return "";
  const lines = [`# ${report.title || "Отчёт"}`, ""];

  const from = report.period?.dateFrom || "—";
  const to = report.period?.dateTo || "—";
  lines.push(`**Период:** ${from} — ${to}`);

  if (report.funnel?.name) {
    lines.push(`**Воронка:** ${report.funnel.name}`);
  }
  if (report.source) {
    lines.push(`**Источник:** ${report.source}`);
  }
  lines.push("");

  if (report.summary?.length) {
    lines.push("## Краткая сводка", "");
    for (const item of report.summary) {
      lines.push(`- **${item.label}:** ${item.value}`);
    }
    lines.push("");
  }

  for (const section of report.sections || []) {
    lines.push(`## ${section.title}`, "");
    lines.push(section.content || "");
    lines.push("");
  }

  for (const table of report.tables || []) {
    lines.push(`## ${table.title}`, "");
    const cols = table.columns || [];
    if (cols.length) {
      lines.push(`| ${cols.join(" | ")} |`);
      lines.push(`| ${cols.map(() => "---").join(" | ")} |`);
      for (const row of table.rows || []) {
        lines.push(`| ${(row || []).map((c) => String(c ?? "—")).join(" | ")} |`);
      }
      lines.push("");
    }
  }

  if (report.recommendations?.length) {
    lines.push("## Рекомендации", "");
    for (const item of report.recommendations) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim() + "\n";
}

export function openPrintWindow(html, title) {
  const win = window.open("", "_blank");
  if (!win) {
    alert("Разрешите всплывающие окна для сохранения PDF.");
    return;
  }
  win.document.write(html);
  win.document.title = title || "Документ";
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 400);
}

export function downloadBlob(content, filename, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const EMPTY_FILE_LABEL = "Файл не выбран";

/** Updates the visible filename next to a styled file input. Does not alter files/FormData. */
export function syncFileFieldName(input) {
  const root = input?.closest?.(".file-field");
  const nameEl = root?.querySelector(".file-field-name");
  if (!nameEl) return;
  const empty = nameEl.dataset.empty || EMPTY_FILE_LABEL;
  const files = input.files;
  if (!files?.length) {
    nameEl.textContent = empty;
    nameEl.classList.add("is-empty");
    return;
  }
  nameEl.textContent =
    input.multiple && files.length > 1 ? `Выбрано файлов: ${files.length}` : files[0].name;
  nameEl.classList.remove("is-empty");
}

/** Binds UI-only filename sync; existing change handlers remain untouched. */
export function enhanceFileField(input) {
  if (!input || input.dataset.fileFieldBound === "1") return;
  input.dataset.fileFieldBound = "1";
  input.addEventListener("change", () => syncFileFieldName(input));
  syncFileFieldName(input);
}

export function enhanceFileFields(root = document) {
  root.querySelectorAll("input.file-field-input[type='file']").forEach(enhanceFileField);
}
