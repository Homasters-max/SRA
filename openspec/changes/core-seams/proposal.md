# Proposal: core-seams

## Why

Архитектурный аудит `packages/cli/src` на `v0.4.2` ([отчёт](../../../docs/process/audits/2026-09-25.md)) нашёл инварианты
в копиях, которые храповик [ADR-0030](../../../docs/adr/WARRANT-ADR-0030-module-boundaries.md) не ловит: `warrant.json`
читается по строковым ключам в 8 местах, правила «корень тестов» и «диапазон pack» — в двух копиях с разным разбором
(A-15); отрезание git-префикса — в 2 копиях, `picomatch(…, { dot: true })` — в 3 (A-16); предикат «waiver в силе» — в 2
копиях с разной строгостью (A-14). Ещё в копиях фабрика ошибки `err` (A-17), `findChangeDir` лежит в `core/init` при 5
импортёрах из других модулей (A-8), помощники тестов `git` и `write` скопированы в 9 и 10 файлов (A-18).

Фаза 4 кладёт на эти места `guard`: пути события → пути проекта, сверка с `write_scope`, `rules[].paths` и
`guard_prefixes`, чтение `paths.src` и `guard_prefixes`. Без общих швов это третья и четвёртая копии каждого правила.
[ADR-0034](../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6 ставит исправление отдельным Change перед 4a
(строка 3e 13 §2), чтобы spec 4a не смешивал рефакторинг с новыми командами;
[ADR-0035](../../../docs/adr/WARRANT-ADR-0035-ratchet-external-packages.md) расширяет храповик так, чтобы копия под
другим именем выдавала себя импортом внешнего пакета.

## What Changes

- **`core/config.ts`** — типизированный `WarrantConfig`, `loadConfig` переезжает из `core/packs/loader.ts`; 8 чтений
  `config["…"]` — через него (A-15).
- **`core/glob.ts`** — `pathMatcher(patterns)` с `dot: true`, единственный импорт `picomatch`; `toProjectPaths` и
  `changedFromGit` — в `core/git` (A-16).
- **`countingWaiverIds`** в `core/waivers/status.ts` для gate engine и `ensureApproval`; `isWaiverInForce` /
  `activeWaiverIds` удаляются; машина состояний waiver — в `core/waivers`, перечисление `waiver-state` — в реестр (A-14).
- **`cliError()`** в `core/errors.ts` вместо 4 копий `err` (A-17); **`findChangeDir`** — в `core/openspec` (A-8).
- **`test/helpers/git.ts`** — spawn `git` с identity и `core.autocrlf=false`; копии `git` и `write` в тестах удаляются
  (A-18).
- **Храповик ADR-0035**: секции `packages` (реестр внешних пакетов: `picomatch`, `ajv`, `ajv-formats`, `canonicalize`,
  `ulid`) и `test_helpers` в `architecture.json`; копия диалекта Ajv в `core/validate/evidence.ts` — через фабрику
  `core/schemas/loader.ts`; копия проверки диапазона `semver` — строка долга A-19.
- **Теги SCN** (BL-26): сценарии main specs без теста с id — тег в держащем тесте, непокрытые — тест или строка долга.
- CLI `0.4.2 → 0.4.3` (bump первой задачей); строка в навыке `architecture-audit` (кандидаты реестра пакетов). Pack
  `core-sdd` не меняется.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет — наблюдаемое поведение CLI не меняется (`skip_specs: true`): вывод, коды выхода, findings и golden те же;
меняются внутренняя структура `packages/cli/src`, помощники и теги тестов, мета-тест.

## Impact

- `packages/cli/src/**`: новые `core/config.ts`, `core/glob.ts`; правки `core/packs/{loader,hash}.ts`,
  `core/ids/renumber.ts`, `core/validate/{dangling,evidence}.ts`, `core/check/execute.ts`, `core/openspec/version.ts`,
  `core/roles.ts`, `core/classify/index.ts`, `core/gates/{l0/scope-valid,verdict,prefilter}.ts`, `core/git/`,
  `core/waivers/`, `core/errors.ts`, `core/resolve/layers.ts`, `core/sync/plan.ts`, `core/openspec/`, `core/init/`,
  `commands/{classify,transition,waive,archive,status}.ts`, `core/schemas/loader.ts`.
- `packages/cli/test/**`: `helpers/git.ts`; `unit/meta/architecture.{json,test.ts}`; unit-тест `WarrantConfig` ↔ схема
  `config/1`; удаление копий `git` / `write`; теги SCN в заголовках `it`.
- Документы: [backlog](../../../docs/backlog.md) (A-8, A-14…A-18, BL-26 закрываются, новая A-19), навык
  `architecture-audit`.

## Non-Goals

- Изменение поведения команд, схем, pack `core-sdd`, main specs; поле `hint` ошибки и `errors[].hint` (4a, ADR-0034
  п. 8).
- Типизированные читатели остальных документов (A-5): `WarrantConfig` — первый шаг, остальное — по мере правок.
- A-9 (реестр проверок `validate`) — первая группа 4a; A-12 (порт `guard`) — 4a.
- 32 литерала `{ code, … }` ошибок вне фабрики — не трогаются (аудит §5).
- Проверка диапазона `semver` в одном месте (A-19) — долг; реестр пакетов его не держит.
- Продуктовый check `scn-covered` (BL-25) — фаза 5.
