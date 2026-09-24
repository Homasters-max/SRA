---
name: architecture-audit
description: Архитектурный аудит кода WARRANT (packages/cli/src, облегчённо — packages/cli/test) через граф cs — связность (coupling) и сцепленность (cohesion) модулей, циклы, god-объекты, нарушенные границы, размазанные понятия, вертикальные срезы сценариев, приоритет исправлений, долг A-N и тренд между аудитами. Использовать, когда просят аудит архитектуры, оценку связности, поиск циклов или god-объектов, «где архитектура деградирует», перед крупным рефакторингом и обязательно перед spec-PR каждой фазы roadmap.
---

# Архитектурный аудит через граф

Метрики графа → кандидаты → находки `A-N` с приоритетом → `docs/backlog.md` и храповик
[ADR-0030](../../../docs/adr/WARRANT-ADR-0030-module-boundaries.md). Подробный метод, пороги, таблица приоритета и
формат отчёта — [method.md](method.md) (§ — его разделы). Поиск по коду — по навыку
[code-search](../code-search/SKILL.md) целиком.

## Вход

- Область: `packages/cli/src` (по умолчанию), облегчённо — `packages/cli/test`.
- Прошлый аудит: последний `docs/process/audits/<дата>.json` и `.md`; открытые строки `A-N` в
  [docs/backlog.md](../../../docs/backlog.md).

## Шаги

1. Заявленная архитектура (method §0): ADR-0025, ADR-0030, `docs/03-architecture.md`, `test/unit/meta/architecture.json`
   с храповиком. Правило, которое держится тестом, — «держится», не перепроверять. Открытые `A-N` — перепроверить,
   закрытые не должны вернуться.
2. Структура и снимок (method §1):
   ```bash
   node scripts/dev/cs.js map
   node scripts/dev/arch-snapshot.js --out docs/process/audits/<дата>.json --against docs/process/audits/<прошлый>.json
   node scripts/dev/cs.js deps packages/cli/src --level 2 --cycles --runtime
   node scripts/dev/cs.js dups --in packages/cli/src
   git log --format= --name-only -- packages/cli/src | sort | uniq -c | sort -rn
   ```
   Разница со снимком — первое, что смотреть; кандидаты — по порогам method §1.
3. Вертикальные срезы (method §2): входы `runX()` в `commands/`; срез целиком —
   `node scripts/dev/cs.js callers <вход> --direction out -d all --json`. Срез заканчивается на порту.
4. Инвентарь понятий из словаря (method §3, обязательно): термины и перечисления `docs/02-vocabulary.md`,
   состояния `docs/04-lifecycle.md` → `cs grep '"<значение>"' --fixed`; владелец каждого понятия-сущности.
5. Тесты облегчённо (method §4):
   ```bash
   node scripts/dev/cs.js deps packages/cli/test --level 2
   node scripts/dev/cs.js dups --in packages/cli/test
   ```
6. Кандидат → находка (method §5): `cs skeleton`, `cs impact`, Read диапазона; не подтвердилось — выбросить.
7. Тип, приоритет P1–P3 по худшей из трёх осей, цена S/M/L, одна гипотеза причины, проверенная по git (method §6, §7).
8. Куда (method §8): каждой находке — `A-N` (после максимального номера в `backlog.md` и прошлых отчётах) и строка
   `docs/backlog.md`; не чинится сразу, а правило проверяемо — исключение с этим `A-N` в `architecture.json`.
9. Отчёт `docs/process/audits/<дата>.md` по формату method «Формат вывода»; проверить форму реестра:
   ```bash
   npx vitest run --config packages/cli/vitest.config.ts --project unit test/unit/meta/
   ```

## Стоп

- Отклонение от решения ADR — не находка, а вопрос к ADR: сформулировать и отдать maintainer'у.
- `cs` ошибся или промолчал и это повлияло на находку — отметить в отчёте и передать в регрессию Graft
  ([graft.md](../../../docs/process/graft.md)); качество графа аудит не оценивает.
- Исправление находки P1 меняет поведение или норму — не чинить в аудите: строка `A-N`, решение — на grilling.

## Отчёт

Путь отчёта и снимка; таблица находок `| A-N | Проблема | Локация | Тип | Приоритет | Гипотеза | Исправление (цена) |`
по приоритету; добавленные строки `backlog.md` и исключения `architecture.json`; результат мета-тестов.
