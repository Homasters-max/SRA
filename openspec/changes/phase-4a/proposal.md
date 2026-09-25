# Proposal: phase-4a

## Why

Фаза 3 дала WARRANT всё, что судит работу после неё: `check`, `gate`, `verify`, `transition`, `archive`, CI. Во время работы
агента WARRANT пока не участвует: `write_scope` существует только в документах (03 §4), `warrant guard` нет, правило «сначала
`run start`» и запрет прямого запуска тяжёлых checks держатся на тексте prompt (INV-04). Ошибка в артефакте обнаруживается на
`validate` в CI — через PR после того, как агент закончил.

Change 4a ([ADR-0034](../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6) — первая половина MVP frontend: Run, guard
и адаптер `claude` в локальном режиме. Выход: сессия Claude Code в sample-проекте получает `deny` вне `write_scope` и hints
после правки. Решения — ADR-0014, ADR-0017…0019, ADR-0022, ADR-0034; уточнения этого Change — grilling F1–F20 (design.md).
Вход — аудит [2026-09-25-core-seams](../../../docs/process/audits/2026-09-25-core-seams.md): A-9, A-12, A-20…A-22 лежат на пути
`validate --files` и `guard`.

## What Changes

- **Run** — схема `warrant://run/1` (03 §4, F15, F16): файл `<state>/runs/<RUN-id>.json` коммитится вместе с работой,
  указатель `<state>/runs/current` — нет (F3). `warrant run start <change> --operation specify|implement [--scope <globs>]
  [--task <label>]`: `write_scope` — по операции, `--scope` только сужает (F1); `specify` — в `PROPOSED`, `implement` — в
  `IMPLEMENTING` (F2); JSON-вывод — Context Pack с `rules[]` (ADR-0022 п. 6, F17). `warrant run finish [--state …]` (F4). Один
  активный Run на worktree (F5).
- **`warrant guard`** — нормализованный контракт `{phase, action, paths[], argv?, cwd}` → `{decision, reason?, hints[]}`
  (ADR-0018 п. 2). `pre` правки: вне `write_scope` активного Run — `deny`; без Run — `deny` для путей `paths.src`,
  `paths.tests`, `openspec/changes/**` и policy-путей, иначе `allow` с подсказкой (ADR-0022 п. 7). `pre` shell — только
  `execution.guard_prefixes` (ADR-0017 п. 5, F8). `post` — hints из `validate --files` и текст правил по путям раз за Run
  (ADR-0019, ADR-0022 п. 3). Сбой `pre` — `deny` (F9). События — в `guard_events[]` под замком (F18).
- **Адаптер `claude`** — `warrant guard --frontend claude`: родной вход хуков Claude Code (`Edit`, `Write`, `NotebookEdit`,
  `Bash`) → событие; решение → родной ответ (`permissionDecision`, `additionalContext`). Имени frontend нет ни в `run/1`, ни в
  событии (ADR-0034 п. 2).
- **`warrant validate --files <paths>`** (ADR-0019): проверки одного файла из реестра проверок `validate` (A-9), без проверок
  уровня проекта; `data.skipped[]` с причиной.
- **`sync` и frontend**: ключ `frontends: ["claude"]` в `warrant.json` (F6, `warrant init --frontend claude`); `sync` держит в
  `.claude/settings.json` управляемое подмножество — static deny ADR-0014 п. 1 и хуки `warrant guard --frontend claude` (ADR-0034
  п. 3, F19), в `CLAUDE.md` — строку `@AGENTS.md` (F7), в `.gitignore` — `.warrant/runs/current`; `AGENTS.md` — из правил с
  `paths: ["**"]`, не больше 16 KiB (ADR-0022 п. 5). `validate` сверяет своё подмножество, а не файлы побайтно.
- **`FRONTEND_HOOKS_INACTIVE`** (ADR-0018 п. 5, F10): путь diff под `paths.src` ∪ `paths.tests` без события `post` в Runs
  Change — finding в `status` и `verify` на `VERIFYING->MERGED`; не `FAIL`.
- **Контракт CLI** (ADR-0034 п. 8): `errors[].hint` — как исправить; новые ошибки 4a рождаются с `hint`, у существующих
  готовый текст исправления переносится из `message` в `hint` (F11). `--dry-run` у `transition`, `archive`, `waive`,
  `run start`, `run finish` (F12).
- **Швы**: реестр проверок `validate` (A-9); `projectPath` — владелец «путь проекта» (A-20); помощник `validate` в тестах
  (A-21); NUL в `core/schemas/loader.ts` и мета-тест (A-22); общий замок `check` и Run с `onInterrupt` за портом (A-12).
- CLI `0.4.3 → 0.5.0` (F20); pack `core-sdd` без изменений.

## Capabilities

### New Capabilities
- `enforcement`: Run (`run/1`, `run start`, `run finish`), `warrant guard` (нормализованный контракт, `pre` / `post`,
  `guard_prefixes`, `guard_events[]`), адаптер `claude`.

### Modified Capabilities
- `kernel`: REQ-KRN-002 (`errors[].hint`), REQ-KRN-004 (`frontends`); новые требования — `validate --files`, файлы frontend и
  `AGENTS.md` в `sync` / `validate` / `init`, режим `--dry-run`.
- `verification`: новое требование — живость hooks, finding `FRONTEND_HOOKS_INACTIVE` в `status` и `verify`.

## Non-Goals

- `run submit`, `warrant://skill-result/1`, `analyze`, `warrant ci`, `ForgePort`, producers gates, субагент `warrant-reviewer`
  — Change 4b (ADR-0034 п. 6, 9–14).
- Адаптер `codex` (`.codex/hooks.json`, spike S8), слой ACP — до среза S1 SEF; `opencode` — фаза 7.
- Guard на разработке самого WARRANT (ADR-0034 п. 4, BL-27): репозиторий не включает `frontends`.
- Несколько активных Runs в одном worktree (F5); запись через shell вне `write_scope` — предел INV-07, его закрывают static deny
  и CI; числовой бюджет 500 мс и `skipped: budget` `validate --files` (ADR-0019 п. 6, D-23); проверка (f) pragma mutation —
  фаза 5.
- `hint` у всех кодов ошибок: только новые и перенос готового текста (F11).

## Impact

- `packages/cli/src`: новые `commands/{run,guard}.ts`, `core/run/*` (Run, Context Pack, `write_scope`), `core/guard/*`
  (решение, события, `guard_prefixes`, hints), `core/hooks/*` (`FRONTEND_HOOKS_INACTIVE`), `adapters/frontend/claude*`,
  порт замка; реестр проверок `core/validate/*`; правки `commands/{validate,sync,init,status,verify,gate,transition,archive,
  waive}.ts`, `core/sync/*`, `core/errors.ts` (`hint`), `core/fs.ts` (`projectPath`), `core/schemas/loader.ts`, `bin/warrant.ts`.
- `packages/cli/schemas/`: `run.1.schema.json` (новая), `config.1.schema.json` (`frontends`) и копии в `.warrant/schemas/`.
- `packages/cli/test`: unit, app, contract (адаптер `claude` на записанном родном входе — ADR-0034 п. 2), e2e; `test_helpers` и
  `enums` (статус Run) в `architecture.json`; `scripts/dev/probe-hooks.js` — перезапись фикстур родного входа.
- `docs/`: 03 §4 и 04 §6–7 — Run, guard, адаптер `claude` (MVP); 02 — термины Run и события guard; 13 §2 — строка 4a;
  `backlog.md` — закрытые BL-3 (часть `run/1`), BL-5, BL-7, BL-9 (часть), BL-10, BL-13 (часть), BL-14, BL-20, A-9, A-12,
  A-20…A-22.
- **BREAKING** (внешних пользователей нет, ADR-0013): `message` ошибок, где был текст исправления, короче — исправление в
  `hint`; golden ошибок меняется один раз этим Change.
