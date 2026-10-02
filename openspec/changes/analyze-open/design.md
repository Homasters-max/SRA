# Design: analyze-open

## Context

База — `main` `20fa6d3`, CLI 0.10.0. Источник — [#141](https://github.com/Homasters-max/SRA/issues/141). Пути — от `packages/cli/src`.

- `core/analyze/input.ts` `readAnalyzeInput(files, changeDir, config, diff)` читает:
  - delta specs Change (`<changeDir>/specs/**/*.md` → `parseDelta`);
  - REQ и SCN main specs (`openspec/specs/**` → `scanMarkdown`) в `mainIds`;
  - `tasks.md`;
  - файлы `paths.tests`;
  - тесты, изменённые в diff (`changedTests`).
- `core/analyze/index.ts` `analyze` — чистая функция. `defined(id)` — `mainIds` или `ADDED`/`MODIFIED` delta, минус `REMOVED`. `ORPHAN` — SCN из изменённого теста, для которого `!defined(id)`.
- Diff — `base...HEAD`, base как у `scope-valid`. На archive-ветке от `main` после слитого чужого impl-PR тесты чужого Change попадают в diff Change.
- Каталог Change может быть каталогом архива (BL-43). Тогда «другие открытые» — все каталоги `openspec/changes/*` кроме `archive`.

## Goals / Non-Goals

**Goals:** `ORPHAN` не ловит SCN, объявленный другим открытым Change.

**Non-Goals:** сужение diff; `CONFLICT` и `UNSATISFIED`.

## Decisions

### 1. Решения

- **D1. `openIds` во входе `analyze`.** `readAnalyzeInput` собирает REQ и SCN из `ADDED`/`MODIFIED` delta specs каждого каталога `openspec/changes/<имя>/`, где `<имя>` ≠ `archive` и ≠ имя Change. Имя Change — последний сегмент `changeDir` без даты архива. Тот же `parseDelta`, что и для своей delta. `analyze` пропускает `ORPHAN` для SCN из `openIds`. `defined` не меняется, поэтому `UNSATISFIED` и `CONFLICT` прежние.
- **D2. Не сужать diff.** Второй вариант #141 — `analyze-clean` судит только ID, которые трогает сам Change. Отвергнут: diff `base...HEAD` общий с `scope-valid`. Пути «своего» Change пришлось бы выводить из истории коммитов, а git этого не даёт: merge-коммит чужого impl-PR — тоже коммит ветки. Сам `ORPHAN` защищает от тега без требования, и это остаётся.
- **D3. `REMOVED` своей delta сильнее.** SCN, который Change удаляет (`REMOVED`), а другой открытый Change объявляет, — не `ORPHAN`: он объявлен там, где его тест ещё нужен.

### 2. Риски

- **Опечатка, совпавшая с SCN чужого Change**, не будет пойманной `ORPHAN`. Вероятность мала: ID проекта уникальны (`ids-valid`).
- **Устаревший открытый Change** (брошенный без `ABANDONED`) продлевает жизнь своим SCN в тестах. Его ловят `brief.js`, `status` и гигиена, а не `analyze`.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
