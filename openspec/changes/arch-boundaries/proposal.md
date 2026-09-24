# Proposal: arch-boundaries

## Why

Архитектурный аудит `packages/cli/src` на `v0.4.1` ([отчёт](../../../docs/process/audits/2026-09-24.md)) нашёл то, что
за три фазы накопилось без проверки направления зависимостей: цепочка состояний lifecycle в 4 копиях (A-1); конвейер
оценки перехода в слое команд, скопированный в `verify` / `archive` / `transition`, 26 импортов команда → команда (A-2);
god-модуль `core/packs/loader.ts` и цикл `core/canon ↔ core/packs` (A-3, A-4); 22 копии `isPlainObject` (A-5); git-факты
в `core/gates` (A-6); роли и waivers в модуле проверок (A-7). Причина у всех одна — группа заводила нужное по месту, и
ничто не ловило повтор.

Фаза 4 добавит входы (`guard`, `run`, `ci`, `analyze`). Без сценария в `core` и без проверки границ каждый из них
собрал бы конвейер A-2 в пятый раз. Делать это нужно до неё — как `test-levels` шёл строкой 3c.

## What Changes

- **Архитектурный мета-тест** `test/unit/meta/architecture.test.ts` + `architecture.json`
  ([ADR-0030](../../../docs/adr/WARRANT-ADR-0030-module-boundaries.md)): ранги модулей `core` R0–R4 и внешние слои,
  нет циклов модулей, команда не импортирует команду, реестр общих помощников, реестр перечислений словаря; храповик
  исключений с ID A-N.
- **`core/fs`, `core/json`**: пути и обход ФС уходят из `loader.ts`, общие guard'ы — в один файл; 22 копии
  `isPlainObject` удаляются (A-3, A-4, первый шаг A-5).
- **Один владелец lifecycle** (A-1) и перечислений, которые найдёт реестр (уровни риска, подмножества verdict'ов).
- **`core/git`** (A-6), **`core/waivers`**, **`core/roles`** (A-7); разбор вывода внешних инструментов — в адаптерах.
- **`core/transition`** (A-2): один сценарий оценки перехода; `verify`, `archive`, `transition`, `gate`, `status` — тонкие;
  `init` не зовёт `runSync`.
- ADR-0030; 13 §2 строка 3d; CLI `0.4.1 → 0.4.2` (bump первой задачей). Pack `core-sdd` не меняется.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет — наблюдаемое поведение CLI не меняется (`skip_specs: true`): вывод, коды выхода, findings и golden те же, меняется
только внутренняя структура `packages/cli/src` и мета-тесты.

## Impact

- `packages/cli/src/**`: новые `core/fs`, `core/json`, `core/git`, `core/waivers`, `core/roles`, `core/transition`,
  владелец lifecycle; перенос функций из `core/packs/loader.ts`, `core/gates/diff.ts`, `core/validate/waivers.ts`,
  `commands/{gate,check,transition,verify,archive,status,classify,init}.ts`.
- `packages/cli/test/**`: `unit/meta/architecture.test.ts` + `architecture.json`, `app`-тест `core/transition`; пути
  импорта в существующих тестах.
- Документы: ADR-0030 (+ строки 0029, 0030 в индексе ADR), 13 §2, NEXT-SESSION («Архитектурный долг», процессные правила).

## Non-Goals

- Изменение поведения команд, схем, pack `core-sdd`, main specs.
- Типизированные читатели документов (A-5 целиком) — отдельный ADR.
- A-8 (`findChangeDir` в `core/init`), A-9 (реестр проверок `validate`) — долг; A-10 — если не снимется попутно.
- Проверка порогов размера и fan-in файлов; внешние инструменты анализа зависимостей.
- Новый слой `src/app/`, публичный library-API, порт файловой системы.
