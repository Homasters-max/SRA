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
| `npm test` локально (default workers) | 178 с, зелёный (17 forks на 18 ядрах, 1 прогон); `--maxWorkers=3` — 266 с | |
| шаг `npm test` CI ubuntu / windows | 346 с / 751 с | |
| `warrant validate` репозитория | 11–12,5 с (3 прогона; 13 процессов: 9 `openspec`, 4 `git`) | |
| тестов e2e / процессов на прогон | 216 (22 файла) / 2 280; всего тестов 693, процессов 2 300 | |

Замер «до» по файлам (группа 1, `v0.4.0` + bump; `--maxWorkers=3`, время файла — json-репортер vitest, процессы — все
порождения внутри файла, включая вложенные из `warrant` и `openspec`; метод — I-118). Файлы без процессов (37 unit, каждый
≤ 0,4 с, вместе 4,3 с) не показаны.

| Файл | Тестов | с | Процессов |
|---|---|---|---|
| e2e/validate-ids-head | 9 | 97,3 | 154 |
| e2e/validate-verification | 18 | 92,2 | 113 |
| e2e/validate | 21 | 77,7 | 100 |
| e2e/sync | 13 | 62,2 | 68 |
| e2e/gate | 13 | 59,6 | 469 |
| e2e/transition | 11 | 57,9 | 480 |
| e2e/check | 19 | 47,1 | 231 |
| e2e/waive | 5 | 29,7 | 115 |
| e2e/golden | 10 | 29,4 | 61 |
| e2e/init | 8 | 23,0 | 33 |
| e2e/archive | 3 | 21,0 | 59 |
| e2e/link | 5 | 19,7 | 32 |
| e2e/status | 16 | 13,7 | 56 |
| e2e/exit-criterion | 6 | 13,6 | 18 |
| e2e/verify | 5 | 13,6 | 100 |
| e2e/classify | 14 | 11,5 | 48 |
| e2e/resolve | 11 | 5,1 | 12 |
| e2e/versions | 5 | 4,3 | 104 |
| e2e/fmt | 9 | 4,0 | 10 |
| e2e/id | 8 | 3,0 | 10 |
| e2e/cli-skeleton | 3 | 0,9 | 3 |
| e2e/package-contents | 4 | 0,0 | 4 |
| unit/check/check-core (→ contract) | 12 | 1,1 | 4 |
| unit/gates/diff-prefix (→ contract) | 1 | 0,6 | 14 |
| unit/check/interrupt (→ contract) | 2 | 0,2 | 2 |

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
| I-117 | Версия CLI живёт только в корневом `package.json` (и `package-lock.json`): у `packages/cli/package.json` поля `version` нет (D-1), задача 1.1 его не добавляет. Bump `0.4.1` меняет `kernel` в `.warrant/warrant.lock.json` и в локах golden (`warrant sync`, `golden:update`) и строку `kernel@0.4.0` → `kernel@0.4.1` в выводе `status` и `resolve --explain` — единственное расхождение вывода CLI «до/после» группы 1; `validate` совпадает байт в байт. | `package.json`, `package-lock.json`, `.warrant/warrant.lock.json`, `packs/core-sdd/golden/*/.warrant/warrant.lock.json`; задача 1.1 |
| I-118 | Счётчик процессов для замера §10 — не в `runCli` и адаптерах, а preload `scripts/dev/spawn-count.cjs` (`NODE_OPTIONS=--require`, активен только при `WARRANT_SPAWN_LOG`): оборачивает функции `child_process`, файл теста берёт из стека в worker и передаёт потомкам через env, поэтому `openspec` и `git`, порождённые `warrant`, считаются за тот же файл. Запуск — `node scripts/dev/test-measure.js [аргументы vitest]` (время файла — json-репортер, таблица Markdown). `src` и `test` его не загружают; группа 6 повторяет замер той же командой. База «до» — 693 теста, а не 686 из ADR: после `v0.4.0` добавились `unit/dev/graft-metrics` и др. Проверка 1.3 «число тестов = 686» читается как «= 693». | `scripts/dev/spawn-count.cjs`, `scripts/dev/test-measure.js`, design §10; задачи 1.2, 1.3 |
| I-119 | Ограничение параллельности тяжёлых уровней: в vitest 3.2.7 `maxWorkers` — не опция project (`NonProjectOptions`), а `poolOptions` project допускает только `singleFork`/`isolate`; пул создаётся один на тип. Поэтому `unit`/`app` идут в пуле `threads` (workers по умолчанию), `contract`/`e2e` — в пуле `forks` с корневым `poolOptions.forks.maxForks = max(1, min(4, ядер − 1))`. Флаг `--maxWorkers=N` теперь ограничивает только `threads` (у `maxForks` приоритет). Запасной вариант из Risks (отдельный запуск тяжёлых projects) не нужен. | `packages/cli/vitest.config.ts`; задача 1.3 |
| I-120 | После 1.3 `npm test` локально без `--maxWorkers`: зелёный, 693 теста, 213 с (18 ядер: `threads` — 17, `forks` — 4; один прогон). До 1.3 тот же прогон с 17 forks был зелёным за 178 с — таймауты по умолчанию нестабильны, а не постоянны; критерий «3 раза подряд» — задача 6.3. `/group-done` группы 1 гоняет `npm test` без флага. | `packages/cli/vitest.config.ts`; задача 1.3 |
| I-121 | Проверки 1.4 — постоянные тесты, а не временные: `unit/meta/levels.test.ts` (каждый `*.test.ts` — в каталоге уровня; projects vitest = четыре каталога; `node:child_process`, `cross-spawn` и порождение из импортированного модуля бросают `SPAWN_FORBIDDEN_AT_LEVEL`) и `app/meta/spawn-guard.test.ts` — первый файл `app`, без него project пуст и `npm run test:app` падает «No test files found». Setup-файл `test/helpers/forbid-spawn.ts` подменяет все функции модуля; импорт `child_process` без `node:` ловится тем же `vi.mock` (проверено временным тестом). Временные файлы из проверки 1.4 (spawn в `unit/`, тест вне уровней) падали как ожидалось и удалены. | `packages/cli/test/helpers/forbid-spawn.ts`, `test/unit/meta/levels.test.ts`, `test/app/meta/spawn-guard.test.ts`; задача 1.4 |
| I-122 | `OpenSpecPort` отдаёт разобранное, а не JSON: `listChanges`/`listSpecs` — имена; `showChange`/`showSpec` — тексты requirements и scenarios (`text`/`rawText` в порядке вывода; `checkPlacement` берёт у них первую строку, как раньше рекурсивный обход JSON); `status` — `OpenspecStatusResult` (чистый `parseOpenspecStatus` остаётся в `core/openspec/status.ts`, адаптер его вызывает); `archive`/`newChange`/`schemaValidate` — `{ok, output}`, `output` = stderr, иначе stdout (у `schemaValidate` `ok` ложно и при `valid: false`). `version()` кэшируется в экземпляре адаптера (один `--version` на вызов CLI), `openspecAvailable` = `version() !== null` — отдельный `--version` для «доступен» ушёл (у `validate` один вызов вместо двух); расходится со старым только если `openspec --version` выходит с 0 без semver в выводе (было `OPENSPEC_FAILED`, стало «пропущено») — у 1.13.1 недостижимо. `requireOpenspec` (semver-проверка ответа порта) остаётся в `core/openspec/version.ts`, `resetOpenspecVersionCache` удалён. Общий асинхронный запуск процесса — `adapters/exec.ts` (`cross-spawn`, stdin `ignore`, если нет входа). | `src/core/ports/openspec.ts`, `src/adapters/{openspec-cli,exec}.ts`, `src/core/openspec/{version,status}.ts`, `src/core/ids/scan.ts`; задача 2.1 |
| I-123 | Вызовы `openspec` в подготовке тестов (`openspec init`, `new change`, `schema validate` и охранник `skipIf`) — не методы порта: они идут через `test/helpers/openspec.ts` (`openspecSync`, `openspecAvailable`; синхронно, только `contract`/`e2e`), а не через адаптер; e2e-файлы меняют только импорт. Помощник уходит с 4.3 (`globalSetup` с версией вместо `skipIf`) и 5.5 (`openspec init` → `useSyncedProject`). Проверка 2.1 «`grep runOpenspec` вне адаптера — пусто» выполняется во всём `packages/cli`: имени `runOpenspec` больше нет. | `packages/cli/test/helpers/openspec.ts`, `test/helpers/synced.ts`, `test/e2e/*`; задача 2.1 |
| I-124 | `GitPort` — по методу на смысл текущих вызовов: `prefix`, `commonDir`, `head`, `resolveCommit`, `branch`, `mergeBase`, `isAncestor`, `firstParents`, `parents`, `diffNameStatus`, `diffNames`, `tree`, `files`, `contents` (`cat-file --batch`); отказ — `null`/пусто/`{ok: false, detail}` с первой строкой вывода git. Функции `core/gates/diff.ts` принимают `Pick<Ctx, "git">` (им не нужно ничего, кроме git; `contract/gates/diff-prefix` строит `{ git: new GitCli(dir) }` без полного `ctx`), `checkImmutableIds` — полный `Ctx` (нужен `root`). Чистый `parseNameStatus` остаётся в `diff.ts`, адаптер его вызывает; типы `DiffEntry`/`DiffStatus`/`BlobTree` переехали в `ports/git.ts` (реэкспорт из `diff.ts`). `classify` проверяет «не git» через `prefix()` (`--show-prefix`) вместо `--show-toplevel` — в рабочем дереве и вне git ответы совпадают; родитель merge-коммита в `forkPointOf` — `resolveCommit("M^1")` (`^{commit}` для коммита ничего не меняет). | `src/core/ports/git.ts`, `src/adapters/git-cli.ts`, `src/core/gates/diff.ts`, `src/core/ids/immutable.ts`, `src/commands/classify.ts`; задача 2.2 |
| I-125 | `CheckRunnerPort.run(spec) → RunOutcome` — прежние `RunSpec`/`RunOutcome` (`exited{code, signal, stdout}` \| `timeout` \| `spawn-error`), а не набросок ADR п. 3 `{exit, timed_out, output}`: `check` различает сигнал, отказ запуска (`CHECK_NOT_CONFIGURED`) и пересылку незахваченного stdout — набросок их теряет. `runCommand`/`killTree` перенесены в `adapters/check-runner.ts` без изменений, класс `CheckRunner` — обёртка. `ClockPort` — только `today()`; `systemClock` лежит в `core/ports/clock.ts` (процесса нет — не адаптер). Метки времени записей (`created_at`, `at`) и год `warrant id WAV` на `clock` не переведены: задача 2.3 называет только `today`, метод `now` добавится с первым тестом, которому он нужен (ADR п. 3). | `src/core/ports/{checks,clock}.ts`, `src/adapters/check-runner.ts`, `src/commands/check.ts`; задача 2.3 |
| I-126 | `Ctx` первым аргументом получают все команды, и те, что портов не касаются (`fmt`, `id`, `link`, `resolve`): у `bin` одна сигнатура `Runner(ctx, args, opts)`. `env` остаётся последним необязательным параметром команд (`process.env` по умолчанию), в `Ctx` его нет — ADR п. 2 перечисляет поля без него. Production-`ctx` собирает `productionCtx()` в `src/bin/warrant.ts` на каждый вызов команды. Мета-тест формы (`unit/meta/levels.test.ts`): строковый литерал `child_process`/`node:child_process`/`cross-spawn` в `src/**` вне `src/adapters/` — падение (ловит `import`, `import type`, `require`, `import()`). Вывод `validate`, `status`, `status test-levels`, `resolve test-levels --explain`, `gate test-levels` репозитория до и после группы 2 совпадает байт в байт (stdout и stderr). | `src/bin/warrant.ts`, `src/commands/*.ts`, `test/unit/meta/levels.test.ts`; задача 2.4 |
