# Design: data-paths

## Context

Понятие «код проекта» в CLI — одна функция `codeScope` (`core/run/scope.ts`): `<paths.src>/**` и `<paths.tests>/**`. Её зовут все читатели:

- `writeScopeOf` — `write_scope` Run `implement` (REQ-ENF-002);
- `core/guard/decide.ts` — `pathClasses` и `guardedWithoutRun`, классы путей guard (REQ-ENF-004);
- `core/liveness/index.ts` — `FRONTEND_HOOKS_INACTIVE` (REQ-VER-009);
- `core/ci/paths.ts` `judgePaths` — правило путей `warrant ci` (REQ-VER-011).

Тестовые правила (`ID_DANGLING` в файлах тестов, `id renumber`, покрытие SCN в `analyze` и gate) читают `paths.tests` отдельно (`config.ts` — файлы `paths.tests`) и `codeScope` не зовут.

## Goals / Non-Goals

Цель — каталог данных проекта, который пишет только Run `implement` и меняет только impl-PR Change, одним ключом `warrant.json`. Non-Goals — в proposal.

## Decisions

### 1. Решения

| # | Решение | Почему |
|---|---|---|
| D1 | `paths.data` — список каталогов; каждый — корень кода в `codeScope` | Одна точка, четыре читателя получают данные без правок; тестовые правила `codeScope` не зовут и данных не видят. Выбор maintainer'а из трёх вариантов (список данных, `paths.src` списком, объявление в Change) |
| D2 | Требование — ADDED REQ-KRN-037 со ссылками на REQ-KRN-004, REQ-ENF-002, REQ-ENF-004, REQ-VER-009, REQ-VER-011; их текст не меняется | REQ-VER-011 и REQ-ENF-007 в delta открытого Change `judge-law`: вторая delta того же REQ — `ID_DUPLICATE`. Образец — REQ-VER-017 (`ci-local`). Перенос `paths.data` в тексты этих REQ — строка backlog после archive `judge-law` |
| D3 | Схема отвергает `.`, `.warrant`, `openspec` и пути под ними — `not` с `pattern` у элемента | Корень сделал бы весь проект «кодом» (`directory()` сейчас молча снимает `.`); `.warrant/**` пишет только CLI (ADR-0009), `openspec/**` — spec и Changes со своими правилами. Ошибка схемы с путём `/paths/data/<i>` — как у `cli` (SCN-KRN-165) |
| D4 | Текст `CONFIG_INVALID` у `implement`: «needs paths.src, paths.tests or paths.data»; hint называет все три | Сообщение называет исправление (контракт CLI) |
| D5 | Выпуск 0.10.2, `kernel` 0.10 | Решение maintainer'а. Ключ аддитивный и необязательный; старый CLI отвергает новый `warrant.json` — порядок «сначала CLI, потом ключ» в «Миграции» CHANGELOG |

### 2. Риски

- **Каталог данных пересекается с policy-путём** (например, `paths.data: [".github"]`). Тогда Run `implement` может писать policy-путь. Тот же риск у `paths.src` уже есть, отдельного правила нет. Классификация по путям diff всё равно поднимет профиль impl-PR.
- **Пересечение с `paths.src` / `paths.tests`** безвредно: `codeScope` снимает повторы корней (`Set`).

## Решения по ходу реализации

| # | Решение |
|---|---|
