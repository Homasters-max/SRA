---
id: WARRANT-ADR-0035
title: Храповик границ — реестр внешних пакетов и помощники тестов в architecture.json
adr_state: ACCEPTED
date: 2026-09-25
supersedes: []
amends: [WARRANT-ADR-0030]
---

## Context

Аудит 2026-09-25 ([отчёт](../process/audits/2026-09-25.md) §3, §5) нашёл копии логики, которые храповик [ADR-0030](WARRANT-ADR-0030-module-boundaries.md) п. 4 не ловит, потому что реестр помощников сверяет **имя** функции:

- **A-16** — `picomatch(…, { dot: true })` в 3 местах (`classify`, `scope-valid`, `verdict`) под разными именами; `guard` фазы 4 добавил бы четвёртое и пятое;
- **A-14** — предикат «waiver в силе» в 2 копиях под разными именами (`waiverStatus`, `isWaiverInForce`);
- **A-18** — помощники тестов: spawn `git` — 9 копий в `e2e` / `contract` с разными `-c`, `write` — 10 копий при `test/helpers/synced.ts#write`; `architecture.json` описывает только `packages/cli/src`.

Копию под другим именем выдаёт импорт внешнего пакета: кто импортирует `picomatch`, тот и собирает свой matcher. Решение принято grilling'ом 2026-09-25 (N8, [ADR-0034](WARRANT-ADR-0034-phase-4-frontend.md) п. 6).

## Decision

1. **Реестр внешних пакетов** — секция `packages` в `architecture.json`: «пакет → файл-владелец» (`"picomatch": "core/glob.ts"`, далее по мере правок). Импорт пакета из реестра вне владельца роняет `architecture.test.ts`. В реестр входят пакеты с поведением, которое легко скопировать с расхождением (glob, разбор YAML / markdown, схемы); Node-модули (`node:*`) и `typescript` в мета-тестах — нет.
2. **Помощники тестов** — секция `test_helpers` в `architecture.json`: «имя → файл-владелец» в `packages/cli/test/helpers/` (`write` → `helpers/synced.ts`, spawn `git` с identity и `core.autocrlf=false` → `helpers/git.ts`). Объявление функции с этим именем в другом файле `packages/cli/test` — ошибка, как в ADR-0030 п. 4.
3. **Храповик** ADR-0030 п. 6 действует для обеих секций: известное нарушение — исключение с A-N, список только сокращается.
4. **Реализация** — Change `core-seams` (строка 3e [13 §2](../13-roadmap.md)) вместе с исправлением A-16 и A-18.

## Consequences

- ADR-0030 п. 4–5: мета-тест проверяет ещё импорты внешних пакетов и помощники `packages/cli/test`.
- Навык `architecture-audit`: кандидаты в реестр пакетов — из `cs deps` по внешним импортам; строка в навыке — вместе с Change `core-seams`.
- Копия логики без внешнего пакета и под другим именем (A-14) по-прежнему ловится только аудитом (`cs dups`).

## Alternatives

- **Сравнение тел функций в мета-тесте** — отвергнуто: эвристика с ложными срабатываниями; `cs dups` уже делает это в аудите, а мета-тест должен быть точным.
- **ESLint `no-restricted-imports`** — отвергнуто: ADR-0030 п. 5 не вводит внешних инструментов; правило — одна секция `architecture.json`.
- **Помощники тестов без проверки** — отвергнуто: 9 и 10 копий накопились именно так.
