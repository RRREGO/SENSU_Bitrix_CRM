# Расхождение test:schedules (39 vs 40)

В предыдущем отчёте: `test:schedules → 39 passed` при ТЗ из 40 пунктов.

## Что отсутствовало

**Пункт 26 «Narrative success»** был реализован как no-op:

```js
assert(true, "26. Narrative success path exists (maybeAttachNarrative)");
```

Это не проверяло сохранение narrative без ошибки.

## Было ли объединено / пропущено

- Пункты **6** (enable/disable), **24** (read/unread), **35** (backup) дробились на `6`/`6b`, `24`/`24b`, `35`/`35b` — это не потеря проверки, а дробление.
- При `SCHEDULES_SKIP_REGRESSION=1` регрессии **36–40** не запускались (ожидаемое soft-skip), отсюда занижение счёта в отчёте относительно полного прогона.
- Реальная **дыра по смыслу ТЗ** — фиктивный assert на пункте **26**.

## Исправление

- Реализована проверка **26**: готовый narrative сохраняется при `maybeAttachNarrative(..., false)` (путь «числа без Claude»).
- Пункт **11** усилен: concurrent lock типа отчёта (`LOCK_NOT_ACQUIRED`), а не только `runningCount === 0`.
- Актуальный core-прогон: **`passed=40 failed=0`** при `SCHEDULES_SKIP_REGRESSION=1` (40 содержательных assert'ов сценария; суффиксы 6b/11a/11b/35b остаются доп. деталями).

Фиктивный 40-й тест «ради числа» не добавлялся.
