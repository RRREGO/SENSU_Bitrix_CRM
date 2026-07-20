import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";
import { getActionRegistryEntries } from "../src/actions/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const EXCEL_PATH = path.join(ROOT, "docs", "bitrix_actions.xlsx");
const REPORTS_DIR = path.join(ROOT, "reports");

const ACTION_COLUMN_NAMES = [
  "action",
  "Action",
  "method",
  "Метод",
  "Код",
  "code",
  "function",
  "Функция",
];

const CATEGORY_COLUMN_NAMES = [
  "category",
  "Category",
  "раздел",
  "Раздел",
  "категория",
  "Категория",
  "блок",
  "Блок",
];

const DESCRIPTION_COLUMN_NAMES = [
  "description",
  "Description",
  "описание",
  "Описание",
  "назначение",
  "Назначение",
  "зачем",
  "Зачем",
];

const ACTION_SPLIT_RE = /[/,;\n\r]+/;

const STATUS_RU = {
  implemented_exact: "Реализовано точным совпадением",
  implemented_alias: "Реализовано через alias",
  registered_not_implemented: "Зарегистрировано, но пока не реализовано",
  missing: "Отсутствует в коде",
  extra_in_code: "Есть в коде, но нет в Excel",
  duplicate_in_excel: "Дубликат в Excel",
};

const MATCH_TYPE_RU = {
  exact: "Точное совпадение",
  alias: "Через alias",
};

function getStatusRu(status) {
  return STATUS_RU[status] || status;
}

function getMatchTypeRu(matchType) {
  return MATCH_TYPE_RU[matchType] || matchType;
}

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase();
}

function findColumnName(headers, candidates) {
  const normalizedHeaders = headers.map((header) => ({
    header,
    normalized: normalizeHeader(header),
  }));

  for (const candidate of candidates) {
    const normalizedCandidate = normalizeHeader(candidate);
    const match = normalizedHeaders.find((item) => item.normalized === normalizedCandidate);
    if (match) return match.header;
  }

  return null;
}

function parseActionNames(cellValue) {
  const text = String(cellValue ?? "").trim();
  if (!text) return [];

  return text
    .split(ACTION_SPLIT_RE)
    .map((part) => part.trim())
    .filter(Boolean);
}

function escapeCsv(value) {
  const text = String(value ?? "");
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function escapeMdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function buildRegistryIndex(entries) {
  const byCanonicalName = new Map();
  const aliasToCanonical = new Map();

  for (const entry of entries) {
    byCanonicalName.set(entry.name, entry);
    for (const alias of entry.aliases) {
      aliasToCanonical.set(alias, entry.name);
    }
  }

  return { byCanonicalName, aliasToCanonical, entries };
}

function resolveRegistryMatch(actionName, index) {
  const { byCanonicalName, aliasToCanonical } = index;

  if (byCanonicalName.has(actionName)) {
    const entry = byCanonicalName.get(actionName);
    return {
      matchedAction: entry.name,
      entry,
      matchType: "exact",
    };
  }

  if (aliasToCanonical.has(actionName)) {
    const canonicalName = aliasToCanonical.get(actionName);
    const entry = byCanonicalName.get(canonicalName);
    return {
      matchedAction: canonicalName,
      entry,
      matchType: "alias",
    };
  }

  return null;
}

function getRequirementStatus(match, isDuplicate) {
  if (isDuplicate) return "duplicate_in_excel";
  if (!match) return "missing";

  if (!match.entry.implemented) {
    return "registered_not_implemented";
  }

  if (match.matchType === "exact") {
    return "implemented_exact";
  }

  return "implemented_alias";
}

function readExcelRequirements(excelPath) {
  if (!fs.existsSync(excelPath)) {
    throw new Error(`Файл Excel не найден: ${path.relative(ROOT, excelPath)}`);
  }

  const workbook = XLSX.readFile(excelPath);
  const requirements = [];
  const actionOccurrences = new Map();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    if (rows.length === 0) continue;

    const headers = Object.keys(rows[0]);
    const actionColumn = findColumnName(headers, ACTION_COLUMN_NAMES);

    if (!actionColumn) continue;

    const categoryColumn = findColumnName(headers, CATEGORY_COLUMN_NAMES);
    const descriptionColumn = findColumnName(headers, DESCRIPTION_COLUMN_NAMES);

    rows.forEach((row, rowIndex) => {
      const rawAction = String(row[actionColumn] ?? "").trim();
      const parsedNames = parseActionNames(rawAction);
      if (parsedNames.length === 0) return;

      const sourceRow = `${sheetName}#${rowIndex + 2}`;
      const category = categoryColumn ? String(row[categoryColumn] ?? "").trim() : "";
      const description = descriptionColumn ? String(row[descriptionColumn] ?? "").trim() : "";

      const duplicateNames = parsedNames.filter((name) => actionOccurrences.has(name));
      const isDuplicate = duplicateNames.length > 0;

      for (const name of parsedNames) {
        const count = actionOccurrences.get(name) || 0;
        actionOccurrences.set(name, count + 1);
      }

      requirements.push({
        category,
        description,
        rawAction,
        parsedNames,
        sourceRow,
        duplicateNames,
        isDuplicate,
      });
    });
  }

  if (requirements.length === 0) {
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    const firstRows = XLSX.utils.sheet_to_json(firstSheet, { defval: "" });
    const headers = firstRows[0] ? Object.keys(firstRows[0]) : [];

    throw new Error(
      [
        "Не удалось найти колонку с названием action.",
        `Поддерживаемые названия колонок:\n${ACTION_COLUMN_NAMES.join(", ")}`,
        `Найденные колонки:\n${headers.length > 0 ? headers.join(", ") : "(пусто)"}`,
      ].join("\n\n"),
    );
  }

  return { requirements, actionOccurrences };
}

function auditActions({ requirements, actionOccurrences }, registryIndex) {
  const auditedRequirements = requirements.map((requirement) => {
    const matches = requirement.parsedNames
      .map((name) => resolveRegistryMatch(name, registryIndex))
      .filter(Boolean);

    const bestMatch = matches.find((match) => match.matchType === "exact") || matches[0] || null;
    const status = getRequirementStatus(bestMatch, requirement.isDuplicate);

    return {
      ...requirement,
      matchedAction: bestMatch?.matchedAction || "",
      matchType: bestMatch?.matchType || "",
      status,
      statusRu: getStatusRu(status),
    };
  });

  const requiredCanonicalNames = new Set();

  for (const requirement of auditedRequirements) {
    for (const name of requirement.parsedNames) {
      const match = resolveRegistryMatch(name, registryIndex);
      if (match) {
        requiredCanonicalNames.add(match.matchedAction);
      } else {
        requiredCanonicalNames.add(name);
      }
    }
  }

  const extraInCode = registryIndex.entries
    .filter((entry) => !requiredCanonicalNames.has(entry.name))
    .map((entry) => ({
      action: entry.name,
      description: entry.description,
      aliases: entry.aliases,
      implemented: entry.implemented,
      status: "extra_in_code",
      statusRu: getStatusRu("extra_in_code"),
    }));

  const duplicateActions = [...actionOccurrences.entries()]
    .filter(([, count]) => count > 1)
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => a.action.localeCompare(b.action));

  const summary = {
    totalRequired: auditedRequirements.length,
    implementedExact: auditedRequirements.filter((item) => item.status === "implemented_exact").length,
    implementedAlias: auditedRequirements.filter((item) => item.status === "implemented_alias").length,
    registeredNotImplemented: auditedRequirements.filter(
      (item) => item.status === "registered_not_implemented",
    ).length,
    missing: auditedRequirements.filter((item) => item.status === "missing").length,
    extraInCode: extraInCode.length,
    duplicatesInExcel: duplicateActions.length,
  };

  return {
    summary,
    requirements: auditedRequirements,
    missing: auditedRequirements.filter((item) => item.status === "missing"),
    registeredNotImplemented: auditedRequirements.filter(
      (item) => item.status === "registered_not_implemented",
    ),
    implemented: auditedRequirements.filter((item) =>
      ["implemented_exact", "implemented_alias"].includes(item.status),
    ),
    extraInCode,
    duplicateActions,
  };
}

function buildMarkdownReport(report) {
  const lines = [
    "# Аудит Bitrix24 Actions",
    "",
    "## Сводка",
    "",
    `- Всего требований из Excel: ${report.summary.totalRequired}`,
    `- Реализовано точным совпадением: ${report.summary.implementedExact}`,
    `- Реализовано через alias: ${report.summary.implementedAlias}`,
    `- Зарегистрировано, но пока не реализовано: ${report.summary.registeredNotImplemented}`,
    `- Отсутствует в коде: ${report.summary.missing}`,
    `- Есть в коде, но нет в Excel: ${report.summary.extraInCode}`,
    `- Дубликаты в Excel: ${report.summary.duplicatesInExcel}`,
    "",
    "## Отсутствующие действия",
    "",
    "| Раздел | Требуемое действие | Описание |",
    "| --- | --- | --- |",
  ];

  if (report.missing.length === 0) {
    lines.push("| — | — | — |");
  } else {
    for (const item of report.missing) {
      lines.push(
        `| ${escapeMdCell(item.category)} | ${escapeMdCell(item.rawAction)} | ${escapeMdCell(item.description)} |`,
      );
    }
  }

  lines.push(
    "",
    "## Зарегистрировано, но пока не реализовано",
    "",
    "| Действие | Описание |",
    "| --- | --- |",
  );

  if (report.registeredNotImplemented.length === 0) {
    lines.push("| — | — |");
  } else {
    for (const item of report.registeredNotImplemented) {
      lines.push(`| ${escapeMdCell(item.matchedAction || item.rawAction)} | ${escapeMdCell(item.description)} |`);
    }
  }

  lines.push(
    "",
    "## Реализованные действия",
    "",
    "| Требуемое действие | Найденное действие | Тип совпадения | Раздел |",
    "| --- | --- | --- | --- |",
  );

  if (report.implemented.length === 0) {
    lines.push("| — | — | — | — |");
  } else {
    for (const item of report.implemented) {
      lines.push(
        `| ${escapeMdCell(item.rawAction)} | ${escapeMdCell(item.matchedAction)} | ${escapeMdCell(getMatchTypeRu(item.matchType))} | ${escapeMdCell(item.category)} |`,
      );
    }
  }

  lines.push("", "## Есть в коде, но нет в Excel", "", "| Действие | Описание |", "| --- | --- |");

  if (report.extraInCode.length === 0) {
    lines.push("| — | — |");
  } else {
    for (const item of report.extraInCode) {
      lines.push(`| ${escapeMdCell(item.action)} | ${escapeMdCell(item.description)} |`);
    }
  }

  lines.push("", "## Дубликаты в Excel", "", "| Действие | Количество повторов |", "| --- | --- |");

  if (report.duplicateActions.length === 0) {
    lines.push("| — | — |");
  } else {
    for (const item of report.duplicateActions) {
      lines.push(`| ${escapeMdCell(item.action)} | ${item.count} |`);
    }
  }

  lines.push(
    "",
    "## Детальная таблица",
    "",
    "| Раздел | Требуемое действие | Найденное действие | Статус | Описание | Строка Excel |",
    "| --- | --- | --- | --- | --- | --- |",
  );

  for (const item of report.requirements) {
    lines.push(
      `| ${escapeMdCell(item.category)} | ${escapeMdCell(item.rawAction)} | ${escapeMdCell(item.matchedAction)} | ${escapeMdCell(item.statusRu)} | ${escapeMdCell(item.description)} | ${escapeMdCell(item.sourceRow)} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

function buildCsvReport(report) {
  const header = [
    "category",
    "required_action",
    "matched_action",
    "status",
    "status_ru",
    "match_type",
    "description",
    "source_row",
  ];

  const rows = report.requirements.map((item) =>
    [
      item.category,
      item.rawAction,
      item.matchedAction,
      item.status,
      item.statusRu,
      item.matchType,
      item.description,
      item.sourceRow,
    ]
      .map(escapeCsv)
      .join(","),
  );

  return [header.join(","), ...rows].join("\n");
}

function writeReports(report) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const jsonPath = path.join(REPORTS_DIR, "actions-audit.json");
  const mdPath = path.join(REPORTS_DIR, "actions-audit.md");
  const csvPath = path.join(REPORTS_DIR, "actions-audit.csv");

  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(mdPath, buildMarkdownReport(report), "utf8");
  fs.writeFileSync(csvPath, buildCsvReport(report), "utf8");

  return { jsonPath, mdPath, csvPath };
}

function main() {
  const registryEntries = getActionRegistryEntries();
  const registryIndex = buildRegistryIndex(registryEntries);
  const { requirements, actionOccurrences } = readExcelRequirements(EXCEL_PATH);

  const report = auditActions({ requirements, actionOccurrences }, registryIndex);
  const reportPaths = writeReports(report);

  console.log("Аудит actions завершён.");
  console.log("");
  console.log(`Всего требований из Excel: ${report.summary.totalRequired}`);
  console.log(`Реализовано точным совпадением: ${report.summary.implementedExact}`);
  console.log(`Реализовано через alias: ${report.summary.implementedAlias}`);
  console.log(`Зарегистрировано, но пока не реализовано: ${report.summary.registeredNotImplemented}`);
  console.log(`Отсутствует в коде: ${report.summary.missing}`);
  console.log(`Есть в коде, но нет в Excel: ${report.summary.extraInCode}`);
  console.log(`Дубликаты в Excel: ${report.summary.duplicatesInExcel}`);
  console.log("");
  console.log("Отчёты:");
  console.log(path.relative(ROOT, reportPaths.mdPath));
  console.log(path.relative(ROOT, reportPaths.jsonPath));
  console.log(path.relative(ROOT, reportPaths.csvPath));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
