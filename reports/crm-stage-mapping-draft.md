# CRM Stage Mapping Draft — SENSU ↔ TWIGA

**Status:** draft — **не утверждено бизнесом**  
**Source:** `config/crm/stage-mapping-draft.json`  
**All rows:** `verification_status=draft` + `confidence`

## How to read

| mapping_type | Meaning |
|--------------|---------|
| exact | Названия/смысл совпадают с высокой уверенностью |
| approximate | Близкий смысл, нужна проверка |
| one_to_many / many_to_one | Разная гранулярность воронок |
| unmapped | Прямого аналога нет |

## Lead mappings

| SENSU | TWIGA | type | confidence | Note |
|-------|-------|------|------------|------|
| Target | Target | exact | 0.90 | |
| Готовность ко встрече | Лид до встречи | approximate | 0.55 | |
| Первичная встреча | Лид после встречи | approximate | 0.50 | **requires confirmation** |
| В работе | Лид после встречи | many_to_one | 0.40 | |
| Пауза | — | unmapped | 0.20 | |
| Холод | — | unmapped | 0.20 | |
| Успешный лид | Успешный лид | exact | 0.85 | |
| — | Некачественный лид | unmapped | 0.30 | нет явного SENSU аналога |

## Deal mappings

| SENSU | TWIGA | type | confidence | Note |
|-------|-------|------|------------|------|
| NDA | Получена задача | approximate | 0.45 | |
| ЭО, подготовка КП | Готовим предложение | approximate | 0.70 | |
| Подача КП | Предложение сдано | approximate | 0.75 | |
| Тендер | — | unmapped | 0.25 | |
| Устное подтверждение | Устное подтверждение | exact | 0.85 | |
| Контракт на обследование | Законтрактовано | one_to_many | 0.40 | эвристика |
| Контракт на проект | Законтрактовано | many_to_one | 0.55 | |
| Отложен | — | unmapped | 0.20 | |
| Сделка провалена | Сделка провалена | exact | 0.90 | |

## Labels

- **imported from Excel** — имена стадий из CRM SENSU / TWIGA BI списков  
- **inferred** — confidence и mapping_type эвристикой  
- **requires business confirmation** — все строки до утверждения  
- **verified from live Bitrix** — появится после сопоставления реальных STAGE_ID

## Process rules (inferred)

Из `sales-process-ontology.json`: recommended transitions, conversion expectations.  
`getAllowedOrRecommendedNextStages` возвращает рекомендации и **не выполняет переход**.

## Ask CRM / Sales owners

1. Утвердить или отклонить каждую строку mapping  
2. Решить судьбу unmapped (Пауза, Холод, Тендер, Отложен, Junk)  
3. Развести «Контракт на обследование» vs «Контракт на проект» относительно единой TWIGA «Законтрактовано»  
4. Зафиксировать максимальные SLA (hours) по стадиям из отчётности Sales_

## Next stage (recommended)

Stage transition **validation** (dry-run): проверка обязательных полей и allowed next stages **без** записи в Bitrix.
