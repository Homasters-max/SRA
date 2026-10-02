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
| D2 | ADDED REQ-KRN-037; MODIFIED REQ-KRN-004, REQ-ENF-002, REQ-VER-009; REQ-ENF-004 и REQ-VER-011 — явным исключением из их текста в REQ-KRN-037, включая условие пропуска проверки кода | `judge-law` меняет REQ-VER-011 и REQ-ENF-007: вторая delta REQ-VER-011 — `ID_DUPLICATE`. REQ-ENF-004 — 275 строк ради одного понятия, копия в delta — риск расхождения. Образец исключения — REQ-VER-017 (`ci-local`). Перенос в тексты REQ-ENF-004 и REQ-VER-011 — строка backlog после archive `judge-law`. Review spec раунда 1 (F-1) |
| D3 | Схема отвергает корень, `.warrant`, `openspec` и пути под ними без учёта регистра — `not` с `pattern` у элемента; нормализация снимает ведущие `./` и конечные `/` до неподвижной точки | Корень сделал бы весь проект «кодом» (`directory()` сейчас молча снимает `.`); `.warrant/**` пишет только CLI (ADR-0009), `openspec/**` — spec и Changes со своими правилами. Регистр — Windows и macOS не различают `.Warrant` и `.warrant`. Символы glob запрещены: `codeScope` делает из корня шаблон `<корень>/**`, и `["*"]` дал бы `*/**` поверх `.warrant/**` (review раунда 2, F-1); пустой сегмент и `.` — опечатка, которая молча выключила бы каталог (F-3). Ошибка схемы с путём `/paths/data/<i>` — как у `cli` (SCN-KRN-165). Review F-4, F-7 |
| D6 | `paths.data` в `warrant ci` — из `warrant.json` базы (`HEAD^1`), как `paths.src` | Иначе PR, который убирает `paths.data`, сам снимает с себя правило путей (ADR-0038). Review F-2 |
| D7 | Порядок `write_scope` `implement`: `paths.src`, `paths.tests`, каталоги `paths.data` по порядку списка, затем файлы Change; повтор корня — один раз | Точный массив в сценариях (SCN-ENF-036, SCN-KRN-172); `codeScope` уже так строит. Review F-5, F-6 |
| D4 | Текст `CONFIG_INVALID` у `implement`: «needs paths.src, paths.tests or paths.data»; hint называет все три | Сообщение называет исправление (контракт CLI) |
| D5 | Выпуск 0.10.2, `kernel` 0.10 | Решение maintainer'а. Ключ аддитивный и необязательный; старый CLI отвергает новый `warrant.json` — порядок «сначала CLI, потом ключ» в «Миграции» CHANGELOG |

### 2. Риски

- **Каталог данных пересекается с policy-путём** (например, `paths.data: [".github"]`). Тогда Run `implement` может писать policy-путь. Тот же риск у `paths.src` уже есть, отдельного правила нет. Классификация по путям diff всё равно поднимет профиль impl-PR.
- **Пересечение с `paths.src` / `paths.tests`** безвредно: `codeScope` снимает повторы корней (`Set`).
- **Данные, которые пишет команда оболочки** (генератор), guard не видит: событие `edit` есть только у инструментов правки. Такой путь даст `FRONTEND_HOOKS_INACTIVE` — информационная находка, вердикт не меняет. Review F-10.
- **Сегмент с точкой или пробелом в конце** (`.warrant.`, `openspec `) схема пропускает, а Windows отождествляет его с `.warrant` / `openspec`. Ущерб ограничен: такой путь без Run уже `allow`, в `warrant ci` корень ничего не совпадает. Строка backlog (review раунда 3, F-1).
- **Policy-путь под каталогом `paths.data`** (F-11) получает класс и hint кода, как такой же путь под `paths.src` сегодня; отдельного правила нет, risk-floor по путям diff поднимает профиль impl-PR.

## Решения по ходу реализации

| # | Решение |
|---|---|
| I-1 | Элемент `paths.data`, который называет файл, делает кодом только этот файл (`<файл>/**` в picomatch совпадает с самим файлом), как такой же `paths.src`; REQ-KRN-037 говорил «ни одного пути». Ревью реализации (агент `reviewer`), 🔴; решение maintainer'а 2026-10-03 через координатора — вариант 1: правка текста REQ-KRN-037 и SCN-KRN-175, поведение кода прежнее; waiver на `spec-approved` активирует maintainer (ADR-0024 п. 4) |
| I-2 | Схема держит правило D3 положительным `pattern` в `allOf` (допустимый элемент), а не `not` с `pattern`: поведение то же — ревью сверило 54 случая с правилом spec; положительная форма короче и даёт ошибку с путём элемента |
