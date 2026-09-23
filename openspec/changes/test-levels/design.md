# Design: test-levels

## Context

Норма — [ADR-0025](../../../docs/adr/WARRANT-ADR-0025-test-levels.md) (grilling 2026-09-24, Q1–Q15 приняты maintainer'ом); этот
документ раскладывает её на код. Исходное состояние (`v0.4.0`):

- `packages/cli/test/unit/` — 39 файлов, `test/e2e/` — 22 файла; 20 e2e-файлов запускают CLI через `runCli`
  (`test/helpers/cli.ts`) или `validate()` из `test/helpers/synced.ts`; `package-contents` и `versions` порождают `npm`/`git`.
- Unit-файлы, порождающие процессы: `unit/gates/diff-prefix` (git), `unit/check/interrupt` (node child), `unit/check/check-core`
  (настоящий `runCommand`).
- Процессы в `src`: `core/openspec/cli.ts` (`openspecAvailable`, `runOpenspec` — `spawn.sync`), `core/openspec/version.ts`,
  `core/ids/immutable.ts`, `core/gates/diff.ts`, `commands/classify.ts`, `core/check/runner.ts`. Вызовы openspec: `list`,
  `show --type change|spec`, `status`, `archive`, `new change`, `schema validate`, `--version`.
- Сиды уже есть: `runValidate(root, warn, today)`, `WARRANT_PACKS_DIR`, `WARRANT_STATE_DIR`, `resetOpenspecVersionCache()`.
- `vitest.config.ts`: один набор `test/**/*.test.ts`, `testTimeout`/`hookTimeout` 30 с, без pool/projects.

Ограничения: поведение CLI и все findings не меняются; `warrant validate` репозитория зелёный после каждой группы; ≤ 6 групп
(G-8); версия поднимается первой задачей (R-14).

## Goals / Non-Goals

**Goals:**
- Логика команд проверяется без порождения процессов (`unit`, `app`); процессы — только в `contract` и `e2e` по причине.
- Правило уровней держится проверками, а не прозой.
- `warrant validate` репозитория ≤ ~5 с; `npm test` стабилен локально с параллелизмом по умолчанию и в CI на обеих ОС.

**Non-Goals:** см. proposal.

## Decisions

### 1. Раскладка и конфиг (ADR-0025 п. 1, 8)

`packages/cli/test/{unit,app,contract,e2e}/`, helpers — `test/helpers/` (общие) и `test/app/helpers/` (`ProjectBuilder`, фейки).
`vitest.config.ts` объявляет четыре project с `include` по каталогу; `unit`/`app` — `testTimeout` 5 с, `contract`/`e2e` — 60 с;
параллелизм тяжёлых projects ограничивается в конфиге (механизм — по возможностям установленной версии vitest; выбор — строкой
I-N). Скрипты корневого `package.json`: `test` (build + все projects), `test:unit`, `test:app`, `test:contract`, `test:e2e`,
`test:fast` (`unit` + `app`, без build).
Альтернатива — отдельные config-файлы на уровень: отвергнута, `npm test` должен оставаться одной командой для `tests-passed`.

### 2. Порты и адаптеры (ADR-0025 п. 2, 3)

`src/core/ports/{openspec,git,checks,clock}.ts` — интерфейсы; `src/adapters/{openspec-cli,git-cli,check-runner}.ts` —
реализации (перенос кода из `core/openspec/cli.ts`, `version.ts`, `ids/immutable.ts`, `gates/diff.ts`, `commands/classify.ts`,
`check/runner.ts`). Адаптеры асинхронные (закрывает I-64). `Ctx` — `src/core/ctx.ts`; production-`ctx` собирает
`src/bin/warrant.ts`. Проверка формы: мета-тест — `cross-spawn` и `node:child_process` импортируются только в `src/adapters/**`.
Альтернатива — порты внутри `core/openspec/` и т.п.: отвергнута, один каталог адаптеров делает мета-тест тривиальным.

### 3. Протягивание `Ctx`

Сверху вниз от команд: функция получает `ctx`, только если она сама или её вызываемые обращаются к порту; остальные получают
данные. Где функция смешивает вычисление и I/O, вычисление выносится в чистую функцию (кандидаты — `checkPlacement`, diff для
gates, неизменяемость id относительно `HEAD`). `warn` и `today` переезжают в `ctx`.

### 4. `validate` (ADR-0025 п. 9)

`checkPlacement`: сначала чтение текста файлов Changes и specs; `show` — только для тех, где встречается `REQ-` или `SCN-`; вызовы
через `Promise.all` с ограничителем (по умолчанию 6, как `--concurrency` OpenSpec). Порядок findings детерминирован (сортировка
по пути, как сейчас). Кэш — только если замер после этого > ~5 с (решение строкой I-N).

### 5. Фейки (ADR-0025 п. 4)

- `FakeOpenSpec` — модель `{changes, specs}` с requirements/scenarios и id, флаги validity и внедрения отказов; журнал вызовов.
  `archive` переносит Change в модели. Ничего не разбирает.
- `FakeGit` — `Map<rev, Map<path, content>>`, `HEAD`, prefix; `diffNames(base)` — разница снимков.
- `FakeCheckRunner` — заданные ответы по команде (`exit`, `timed_out`, `output`) и журнал.
- `FakeClock` — фиксированная дата.

### 6. `ProjectBuilder` (ADR-0025 п. 6)

Временный каталог + `ctx` с фейками. `withChange`, `withSpec({reqs, scns})`, `withRecord`, `withChecks`, `commit(label)`,
`synced()` (`runSync` в процессе). Файлы пишутся теми же функциями, что использует CLI (`writeJsonFile`), модель фейков
заполняется тем же вызовом. Методы добавляются по мере переноса.

### 7. Контракт соответствия (ADR-0025 п. 5)

`test/contract/openspec.contract.test.ts`, `git.contract.test.ts`, `checks.contract.test.ts`: общий набор сценариев
`describe.each([real, fake])`; для OpenSpec проект строится `ProjectBuilder` на диске, ответ настоящего адаптера сравнивается с
ответом фейка по каждому методу порта. Проверка версии: `contract` и `e2e` в `globalSetup` требуют `openspec --version` = 1.13.1,
иначе падают. `it.skipIf(!openspecAvailable())` удаляется из всех тестов.

### 8. Проверки уровней (ADR-0025 п. 7)

- setup-файл projects `unit`/`app`: `vi.mock` `cross-spawn` и `node:child_process` → бросают `SPAWN_FORBIDDEN_AT_LEVEL`;
- мета-тест (`test/unit/meta/levels.test.ts`): каждый `*.test.ts` лежит в одном из четырёх каталогов; каждый файл `test/e2e/`
  начинается `// e2e: <reason>` из закрытого списка; импорт процессов в `src` только из `src/adapters/**` (§2).

### 9. Перенос

По файлу: каждый тест — на самый дешёвый уровень, доказывающий его свойство. Порядок — от самых тяжёлых (замер §10). Что
остаётся в e2e: разбор argv и коды выхода команды (по одному-два теста на команду), вывод envelope, порождение на платформе
(`.cmd`, пути), golden, `package-contents`, `versions`, один сквозной lifecycle `init → … → archive`. Файлы e2e, где
`openspec init` идёт в каждом тесте (`validate`, `sync`, `init`, `exit-criterion`), переходят на `useSyncedProject`.

### 10. Замер

До переноса (группа 1) и после (группа 6): время по файлу (json-репортер vitest), число порождённых процессов по файлу (счётчик в
`runCli` и адаптерах под переменной окружения, только на время замера), `warrant validate` репозитория, шаг тестов CI на обеих ОС.

| Метрика | До | После |
|---|---|---|
| `npm test` локально (default workers) | | |
| шаг `npm test` CI ubuntu / windows | 346 с / 751 с | |
| `warrant validate` репозитория | ~30 с | |
| тестов e2e / процессов на прогон | ~250 / | |

## Risks / Trade-offs

- **Фейк расходится с OpenSpec** → контракт соответствия §7 в каждом CI-прогоне; смена версии OpenSpec — через ADR-0015.
- **Большой механический рефакторинг сигнатур** → по группам, `npm test` и `validate` зелёные после каждой; TypeScript ловит
  каждое место.
- **Потеря покрытия при переносе** → тест переносится с тем же assert по SCN; число SCN-тегов в тестах до и после сверяется.
- **Ограничение параллелизма vitest по project может быть недоступно** → тогда отдельный запуск тяжёлых projects внутри
  `npm test` (решение I-N).

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
