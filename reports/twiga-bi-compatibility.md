# TWIGA BI Compatibility

**Baseline:** `config/crm/twiga-fields.json` + enums/stages  
**Purpose:** совместимость исторических BI / Sales Com / KPI требований

## Confidence legend

| Tag | Meaning |
|-----|---------|
| imported from Excel | Коды полей из «Поля из битрикса для дашбордов» |
| needs_confirmation | Нет человекочитаемого имени / типа в seed |
| verified from live Bitrix | После capture портала TWIGA (если доступен) |
| inferred | Эвристика (не использовать в prod BI без проверки) |

## Deal fields used in BI

| Field code | Role | Status |
|------------|------|--------|
| ID | key | imported from Excel |
| TITLE | label | imported from Excel |
| UF_CRM_1727864870 | market (deal) | imported from Excel |
| UF_CRM_64FA17C1E8AD3 | business_unit (deal) | imported from Excel |
| UF_CRM_1719232278820 | unknown | **needs_confirmation** |
| UF_CRM_1703674933 | unknown | **needs_confirmation** |
| LEAD_ID | link | imported from Excel |
| COMPANY_ID | link | imported from Excel |
| OPPORTUNITY | amount | imported from Excel |
| UF_CRM_672CDC45401F9 | unknown | **needs_confirmation** |
| STAGE_ID | funnel | imported from Excel |
| DATE_CREATE | timeline | imported from Excel |
| UF_CRM_658DA84B3F318 | unknown | **needs_confirmation** |
| UF_CRM_1738567433801 | unknown | **needs_confirmation** |
| UF_CRM_1739187904922 | unknown | **needs_confirmation** |
| SOURCE_ID | source | imported from Excel |

## Lead / company / contact BI fields

Аналогично перечислены в seed; критично:

- Lead market: `UF_CRM_1703779558`
- Company market: `UF_CRM_1723710339`
- Lead BU: `UF_BU_TEXN`
- Contact BU: `UF_BU_TEXN`

## Critical rule: entity-scoped enum IDs

**Нельзя** использовать ID справочника рынка/БУ одной сущности для другой.

| Entity | Market field | Example enum IDs (seed) | canonical_value |
|--------|--------------|-------------------------|-----------------|
| deal | UF_CRM_1727864870 | 101, 102, 103 | market.ru / .cis / .intl |
| lead | UF_CRM_1703779558 | 201, 202, 203 | same canonical |
| company | UF_CRM_1723710339 | 301, 302, 303 | same canonical |

| Entity | BU field | Example enum IDs | canonical_value |
|--------|----------|------------------|-----------------|
| deal | UF_CRM_64FA17C1E8AD3 | 401–403 | bu.sens / .tech / .other |
| lead | UF_BU_TEXN | 501–503 | same canonical |
| contact | UF_BU_TEXN | 601–603 | same canonical |

Seed enum IDs — **иллюстративные / imported from Excel structure**; реальные ID нужно сверить live Bitrix TWIGA (`verified from live Bitrix`).

## TWIGA stages (BI funnel)

### Leads

Target → Лид до встречи → Лид после встречи → Некачественный лид / Успешный лид

### Deals

Получена задача → Готовим предложение → Предложение сдано → Устное подтверждение → Законтрактовано / Сделка провалена

`stage_id` в seed — provisional Bitrix-like codes; **requires business confirmation** against live portal.

## Compatibility checks implemented

`CrmSchemaDiffService.detectBiCompatibilityProblems`:

- missing BI fields in target schema
- type mismatches
- enum ID collisions across entities for `market` / `business_unit`

## Data to request

1. Official UF_* titles for all `needs_confirmation` deal/lead fields  
2. Live enum dictionaries per entity (ID, XML_ID, VALUE)  
3. Confirmation that BI dashboards join markets via **labels/canonical**, not raw IDs across entities  
4. Live STAGE_ID list for default and any additional deal categories
