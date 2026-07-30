/**
 * Load CRM seed configs from config/crm/.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getAppRoot } from "../config/paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SOURCE_TYPES = Object.freeze({
  LIVE_BITRIX: "live_bitrix",
  EXCEL_SENSU: "excel_sensu",
  EXCEL_TWIGA: "excel_twiga",
  SALES_PROCESS: "sales_process",
});

export const SEED_FILES = Object.freeze({
  twigaFields: "twiga-fields.json",
  twigaEnums: "twiga-enums.json",
  twigaStages: "twiga-stages.json",
  sensuFields: "sensu-draft-fields.json",
  sensuStages: "sensu-draft-stages.json",
  salesProcess: "sales-process-ontology.json",
  stageMapping: "stage-mapping-draft.json",
});

export function getCrmConfigDir() {
  if (process.env.CRM_SCHEMA_CONFIG_DIR) {
    return path.resolve(process.env.CRM_SCHEMA_CONFIG_DIR);
  }
  return path.join(getAppRoot(), "config", "crm");
}

export function loadJsonConfig(filename) {
  const full = path.join(getCrmConfigDir(), filename);
  if (!fs.existsSync(full)) {
    throw new Error(`CRM config not found: ${full}`);
  }
  const raw = fs.readFileSync(full, "utf8");
  return JSON.parse(raw);
}

export function listSeedConfigFiles() {
  const dir = getCrmConfigDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
}

/** Stable stringify for hashing (sorted keys). */
export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(",")}}`;
}

export { __dirname as crmSchemaModuleDir };
