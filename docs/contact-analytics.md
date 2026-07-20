# Аналитика контактов и качество ведения CRM

Документ описывает read-only контроль контактов в Bitrix24 CRM Assistant.

## Роль контакта в методологии

Контакт — ключевая сущность текущей методологии продаж. Статус контакта, привязка к компании, следующее CRM-дело и день рождения используются для регулярного контроля качества данных.

На этом этапе система **только читает** Bitrix24. Автоматическое изменение карточек, создание дел и поздравлений не выполняются.

## Необходимые пользовательские поля

Статусы и «теплота» обычно хранятся в пользовательских полях `UF_CRM_...`.  
**Нельзя угадывать ID** — их нужно определить через аудит.

Стандартные поля:

| Поле | Назначение |
|------|------------|
| `BIRTHDATE` | Дата рождения |
| `COMPANY_ID` / `COMPANY_IDS` | Привязка к компании |
| `ASSIGNED_BY_ID` | Ответственный |
| `NAME`, `SECOND_NAME`, `LAST_NAME` | ФИО |

## Как запустить `contact_field_audit`

Через API:

```bash
curl -X POST http://localhost:3005/bitrix/action \
  -H "Content-Type: application/json" \
  -d "{\"action\":\"contact_field_audit\",\"params\":{}}"
```

Или в чате ассистента: «проведи аудит полей контакта».

Результат содержит компактный список полей: `id`, `title`, `type`, `enumValues` (для enumeration).

## Как определить ID полей и enum

1. Запустите `contact_field_audit`.
2. Найдите поле с названием вроде «Статус» (`type: enumeration`).
3. Скопируйте `id` поля в `BITRIX_CONTACT_STATUS_FIELD`.
4. Из `enumValues` возьмите ID нужных значений:
   - «Цикл» → `BITRIX_CONTACT_STATUS_CYCLE_VALUES`
   - «Лид» → `BITRIX_CONTACT_STATUS_LEAD_VALUES`
   - «Личный» → `BITRIX_CONTACT_STATUS_PERSONAL_VALUES`
   - «Спам» → `BITRIX_CONTACT_STATUS_SPAM_VALUES`
   - «Не трогать» → `BITRIX_CONTACT_STATUS_DO_NOT_CONTACT_VALUES`
5. При необходимости укажите поле «Теплота» / прожарки в `BITRIX_CONTACT_WARMUP_FIELD`.

ID конкретного портала **не коммитьте** в git. Храните только в локальном `.env`.

## Переменные `.env`

См. `.env.example`:

```env
BITRIX_CONTACT_STATUS_FIELD=
BITRIX_CONTACT_WARMUP_FIELD=
BITRIX_CONTACT_BIRTHDAY_FIELD=BIRTHDATE
BITRIX_CONTACT_STATUS_CYCLE_VALUES=
BITRIX_CONTACT_STATUS_LEAD_VALUES=
BITRIX_CONTACT_STATUS_PERSONAL_VALUES=
BITRIX_CONTACT_STATUS_SPAM_VALUES=
BITRIX_CONTACT_STATUS_DO_NOT_CONTACT_VALUES=
BITRIX_BIRTHDAY_ACTIVITY_PATTERNS=день рождения,поздравить,поздравление
```

Если поле статуса не настроено, actions возвращают:

```json
{
  "success": false,
  "error": {
    "code": "CONTACT_STATUS_FIELD_NOT_CONFIGURED",
    "message": "Не настроено пользовательское поле статуса контакта.",
    "details": { "recommendedAction": "contact_field_audit" }
  }
}
```

## Список actions

| Action | Назначение |
|--------|------------|
| `contact_field_audit` | Диагностика полей контакта |
| `contact_count` | Общее количество |
| `contact_count_by_status` | Группировка по статусу |
| `contacts_without_status` | Контакты без статуса |
| `contacts_without_company` | Без компании |
| `contacts_missing_birthday` | Без даты рождения (`severity: warning`) |
| `contacts_cycle_without_next_activity` | «Цикл» без следующего CRM-дела |
| `contacts_birthday_activity_report` | Контроль поздравлений |
| `contact_quality_report` | Сводный отчёт качества |

Все actions — **read-only**.

## Быстрые отчёты

На вкладке «Отчёты» добавлены:

1. Контакты по статусам
2. Контакты без статуса
3. Контакты без компании
4. Цикл без следующего дела
5. Контроль дней рождения
6. Качество заполнения контактов

## Правила определения следующего дела

- Используются только **CRM-дела** (`crm.activity`), не задачи `tasks`.
- Владелец: `OWNER_TYPE_ID = 3` (контакт).
- «Следующее дело» — незавершённое (`COMPLETED = N`) с дедлайном сейчас/в будущем (или без дедлайна).
- Отдельно выделяются контакты, у которых есть только просроченные незавершённые дела.

## Правила определения поздравлений

1. Берутся контакты с заполненной датой рождения.
2. Считается ближайший день рождения в горизонте `daysAhead` (по умолчанию 30).
3. Среди незавершённых CRM-дел контакта ищутся совпадения по шаблонам названия (`BITRIX_BIRTHDAY_ACTIVITY_PATTERNS`).
4. В отчёте явно указано: определение по названию activity.

## Severity

| Нарушение | Severity |
|-----------|----------|
| Без статуса | critical |
| Цикл без дела / только просрочка | critical |
| Просроченное поздравление | critical |
| Без компании | warning |
| Без дня рождения | warning |
| Нет дела на ближайшее поздравление | warning |

## Права webhook

Для отчётов по CRM-делам нужны права CRM (чтение activities).

Если прав нет:

```json
{
  "success": false,
  "error": {
    "code": "CRM_ACTIVITIES_ACCESS_DENIED",
    "message": "У входящего вебхука недостаточно прав для чтения CRM-дел.",
    "details": { "requiredScope": "CRM" }
  }
}
```

Пустой результат **не подменяет** отсутствие доступа.

### Задачи (`overdue_tasks_report`)

Для отчёта просроченных **задач** нужны права модуля Tasks.  
Если webhook создан без Tasks — пересоздайте/обновите входящий вебхук с правом на задачи. Кодом эта проблема не обходится.

## Ограничения

- Sample ограничен 100 записями.
- Пагинация: `BITRIX_ANALYTICS_MAX_PAGES` (по умолчанию 200); свыше — `truncated: true`.
- Пользовательские поля `UF_CRM_*` читаются через legacy `crm.contact.list` (у `crm.item.list` Bitrix искажает имена UF).
- Сводный `contact_quality_report` делает один обход контактов через `collectContactQualityDataset()`.
- Поздравления — эвристика по названию дела, если нет отдельного типа/поля.
- Нагрузка менеджеров и дисциплина CRM: см. `docs/manager-analytics.md`.
- Телефоны, email и переписка в sample не включаются.

## Запуск тестов

```bash
npm run test:contacts
```

Только чтение. Не создаёт и не изменяет контакты, дела, задачи и комментарии.

Связанные тесты сделок:

```bash
npm run test:analytics
```
