# SENSU CRM Schema Diff

**Status:** draft — Excel seed vs expected live SENSU  
**Labels:** verified from live Bitrix | imported from Excel | inferred | requires business confirmation

## Summary

На момент этапа 1 live snapshot тестового Bitrix SENSU может быть снят через  
`POST /api/crm-schema/snapshots/capture` (`portalKey=sensu`).  
Ниже — расхождения **seed Excel SENSU** относительно **ожидаемой** модели и TWIGA BI baseline.

## Imported from Excel (SENSU draft)

### Lead stages

| Stage name | Placeholder stage_id | canonical_stage | Status |
|------------|----------------------|-----------------|--------|
| Target | SENSU_L_TARGET | lead.target | imported from Excel |
| Готовность ко встрече | SENSU_L_READY | lead.meeting_ready | imported from Excel |
| Первичная встреча | SENSU_L_MEETING | lead.first_meeting | imported from Excel |
| В работе | SENSU_L_WORK | lead.in_progress | imported from Excel |
| Пауза | SENSU_L_PAUSE | lead.pause | imported from Excel |
| Холод | SENSU_L_COLD | lead.cold | imported from Excel |
| Успешный лид | SENSU_L_SUCCESS | lead.success | imported from Excel |

### Deal stages

| Stage name | Placeholder stage_id | canonical_stage | Status |
|------------|----------------------|-----------------|--------|
| NDA | SENSU_D_NDA | deal.nda | imported from Excel |
| ЭО, подготовка КП | SENSU_D_EO | deal.eo_proposal_prep | imported from Excel |
| Подача КП | SENSU_D_KP | deal.proposal_submitted | imported from Excel |
| Тендер | SENSU_D_TENDER | deal.tender | imported from Excel |
| Устное подтверждение | SENSU_D_VERBAL | deal.verbal_confirm | imported from Excel |
| Контракт на обследование | SENSU_D_SURVEY | deal.contract_survey | imported from Excel |
| Контракт на проект | SENSU_D_PROJECT | deal.contract_project | imported from Excel |
| Отложен | SENSU_D_DEFERRED | deal.deferred | imported from Excel |
| Сделка провалена | SENSU_D_LOSE | deal.failed | imported from Excel |

## Requires business confirmation

1. **Все `SENSU_*` stage_id** — placeholders до live capture; реальные STATUS_ID/STAGE_ID Bitrix неизвестны.
2. **Поле `UF_CRM_MARKET`** в draft компаний SENSU — код предположителен.
3. **Stage-specific mandatory fields** — REST не даёт надёжного источника; в snapshot только `is_required_globally` + warning `STAGE_MANDATORY_FIELDS_UNRELIABLE`.
4. Карточки company/contact/lead/deal в CRM SENSU.xlsx описаны неполно — полный перечень UF_* нужен с портала.

## Inferred

- Business goals / triggers / recommended actions взяты из `sales-process-ontology.json` (Отчетность Sales_).
- Recommended next stages — только рекомендации, **переход не выполняется**.

## Verified from live Bitrix

- Появится после успешного `capture` на тестовом портале SENSU.
- Diff: `GET /api/crm-schema/diff?baseSnapshotId=<excel_sensu>&targetSnapshotId=<live_bitrix>`.

## Expected diff themes after live capture

| Theme | Likely finding |
|-------|----------------|
| Missing fields | Draft fields not present under guessed codes |
| Extra fields | Full UF_* set from portal not in Excel |
| Changed stage IDs | Placeholder ≠ real STATUS_ID |
| Unmapped stages | Custom semantics without canonical_stage |

## Action for CRM owner

Предоставить экспорт `crm.*.fields` / скрин стадий или доступ к тестовому webhook для capture, затем подтвердить canonical mappings.
