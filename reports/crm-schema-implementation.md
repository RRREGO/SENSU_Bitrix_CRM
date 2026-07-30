# CRM Schema Registry — Implementation Report

**Date:** 2026-07-20  
**Stage:** 1 — versioned schema registry + read-only audit  
**Migration:** v14 `v14_crm_schema_registry`

## Goal

Создан версионируемый реестр схем CRM (SENSU / TWIGA / sales process) и read-only аудит. Операции записи в Bitrix на этом этапе **не добавлялись**.

## Source priority (enforced in design)

1. **verified from live Bitrix** — `source_type=live_bitrix` via `capturePortalSchema`
2. Approved business rules — TBD (пока draft)
3. **imported from Excel** — `excel_sensu`, `excel_twiga`
4. **inferred** — `sales_process` ontology
5. TWIGA — BI compatibility baseline

## What was added

### Tables (migration v14)

- `crm_schema_snapshots`
- `crm_field_definitions`
- `crm_field_enum_values`
- `crm_pipeline_definitions`
- `crm_stage_definitions`
- `crm_stage_requirements`
- `crm_stage_mappings`
- `crm_process_rules`

### Seed configs (`config/crm/`)

| File | Confidence label |
|------|------------------|
| `twiga-fields.json` | imported from Excel |
| `twiga-enums.json` | imported from Excel (entity-scoped enum IDs) |
| `twiga-stages.json` | imported from Excel |
| `sensu-draft-fields.json` | imported from Excel / needs_confirmation |
| `sensu-draft-stages.json` | imported from Excel (placeholder stage_id) |
| `sales-process-ontology.json` | inferred |
| `stage-mapping-draft.json` | draft + confidence |

### Services

- `CrmSchemaSnapshotService` — capture / seed / hash / save / latest
- `CrmSchemaDiffService` — field/type/enum/stage/BI diffs
- `CrmProcessKnowledgeService` — explain / requirements / recommended next (no transition) / mappings

### API (RBAC)

| Method | Path | Permission |
|--------|------|------------|
| GET | `/api/crm-schema/portals` | `crm.schema.read` |
| GET | `/api/crm-schema/snapshots` | `crm.schema.read` |
| GET | `/api/crm-schema/entities` | `crm.schema.read` |
| GET | `/api/crm-schema/pipelines` | `crm.schema.read` |
| GET | `/api/crm-schema/stages` | `crm.schema.read` |
| GET | `/api/crm-schema/diff` | `crm.schema.read` |
| GET | `/api/crm-schema/stage-explanation` | `crm.schema.read` |
| POST | `/api/crm-schema/snapshots/capture` | `crm.schema.capture` (admin) |
| POST | `/api/crm-schema/seeds/import` | `crm.schema.capture` (admin) |

Capture performs **only** Bitrix read methods + local SQLite write.

### Safety

- No new Bitrix create/update/delete calls
- Capture uses `callReadMethod` / `callBitrixMethodFull` (read mode)
- Secrets redacted via `redactObject` in API responses and snapshot metadata
- Safety Layer / CRM write actions unchanged

## Confidence labels used in data

| Label | Meaning |
|-------|---------|
| `verified_from_live_bitrix` | Снято с портала REST |
| `imported_from_excel` | Из Excel seed |
| `inferred` | Из sales ontology / эвристик |
| `needs_confirmation` | Требует владельца CRM |
| `draft` | Не утверждено |

## Data to request from CRM owner

See bottom of related reports. Critical items:

1. Live SENSU field codes (replace draft placeholders)
2. Actual STATUS_ID / STAGE_ID for all SENSU stages
3. Stage-specific mandatory fields (недоступны надёжно через текущий REST)
4. Affirmation or correction of SENSU↔TWIGA stage mappings
5. Human-readable names for unresolved TWIGA UF_* BI fields
6. Confirm market / business_unit enum XML_ID and values per entity

## Next recommended stage

**Stage transition validation (read-only / dry-run)** — validate required fields and allowed next stages before any write, still without implementing Bitrix stage updates.
