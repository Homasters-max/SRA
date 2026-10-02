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
- Gate `analyze-clean` (`core/transition/facts.ts` `analyzeAt`) читает те же входы с оцениваемого commit: `commitFiles(ctx, commit, analyzePaths(changeDir, config))`. `analyzePaths` (`input.ts`) — `[changeDir, openspec/specs, paths.tests]`, `openspec/changes` в нём нет. `commitFiles` читает всё перечисленное одним `git ls-tree` и одним `git cat-file --batch`.
- Diff — `base...HEAD`, base как у `scope-valid`. На archive-ветке от `main` после слитого чужого impl-PR тесты чужого Change попадают в diff Change.
- Каталог Change может быть каталогом архива (BL-43). Тогда «другие открытые» — все каталоги `openspec/changes/*` кроме `archive`.

## Goals / Non-Goals

**Goals:** `ORPHAN` не ловит SCN, объявленный другим открытым Change.

**Non-Goals:** сужение diff; `CONFLICT` и `UNSATISFIED`.

## Decisions

### 1. Решения

- **D1. `openIds` во входе `analyze`.** `readAnalyzeInput` собирает REQ и SCN из `ADDED`/`MODIFIED` delta specs каждого каталога `openspec/changes/<имя>/`, где `<имя>` ≠ `archive` и ≠ имя Change. Имя Change — последний сегмент `changeDir` без даты архива. Разбор — тем же `parseDelta`, что и своей delta.
  - Record не читается: каталог без record тоже открыт. Так же и `ABANDONED`, чей каталог не удалён (`ABANDONED_DIR_PRESENT` в `status`).
  - Путь, который не каталог, каталог без `specs/` и delta, которая не разбирается, ID не дают.
  - Читает их тот же `ProjectFiles`, что и main specs, поэтому `analyzePaths` добавляет `openspec/changes` (review раунда 1, F-1). Иначе gate на commit их не видит, и `warrant archive` из #141 по-прежнему падает. `analyze` пропускает `ORPHAN` для SCN из `openIds`. `defined` не меняется, поэтому `UNSATISFIED` и `CONFLICT` прежние.
- **D2. Не сужать diff.** Второй вариант #141 — `analyze-clean` судит только ID, которые трогает сам Change. Отвергнут: diff `base...HEAD` общий с `scope-valid`. Пути «своего» Change пришлось бы выводить из истории коммитов, а git этого не даёт: merge-коммит чужого impl-PR — тоже коммит ветки. Сам `ORPHAN` защищает от тега без требования, и это остаётся.
- **D3. Объявление другого открытого Change сильнее своего `REMOVED`.** SCN, который Change удаляет (`REMOVED`), а другой открытый Change объявляет, — не `ORPHAN`: он объявлен там, где его тест ещё нужен. Противоречие двух delta ловит `ids-valid`, а не `analyze`.
- **D4. Сообщение gate и 06 §5.** `analyze-clean` (`core/gates/l0/analyze-clean.ts`) называет `ORPHAN` «declared in no spec». Сообщение дополняется словами «nor in the delta of an open Change». Строка `ORPHAN` в [06 §5](../../../docs/06-verification.md) — тоже.

### 2. Риски

- **Опечатка, совпавшая с SCN чужого Change**, не будет пойманной `ORPHAN`. Вероятность мала: ID проекта уникальны (`ids-valid`).
- **Устаревший открытый Change** (брошенный без `ABANDONED`) продлевает жизнь своим SCN в тестах. Его ловят `brief.js`, `status` и гигиена, а не `analyze`.
- **Тег на SCN чужого Change, который потом станет `ABANDONED`.** Свой новый тест Change с тегом SCN чужого открытого Change проходит `ORPHAN`. Если чужой Change бросят, тег останется в `main`: `ORPHAN` смотрит только diff. Ловит его следующий Change, который тронет этот тест.
- **Объём чтения gate на commit.** `openspec/changes` с архивом читается целиком одним `git cat-file --batch`. В SRA это сотни файлов Markdown — единицы мегабайт, а gate вызывается на переход.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
| I-1 | Review spec раунда 1 (PROVEN, MAJOR 1, MINOR 5, INFO 1, RUN-01M3Y3ZPVX1YRFTH8M8EP9A4HB) закрыт правкой spec и раундом 2 (прецедент I-248 `guard-recovery`), а не waiver в impl-PR: F-1 (MAJOR) — входы читаются из одного дерева, `analyzePaths` ∋ `openspec/changes`, SCN-VER-153 на gate (D1); F-2 — сообщение gate и 06 §5 (D4); F-3 — D3 переименован, правило в REQ; F-4 — `path`, `counts`, код в SCN-VER-152; F-5 — вход в «Входы»; F-6 — границы каталогов в REQ и D1; F-7 — риск | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
