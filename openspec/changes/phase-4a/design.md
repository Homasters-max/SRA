# Design: phase-4a

## Context

База — `main` на `v0.4.3` (`core-seams` закрыт). Что уже есть: схема `rule/1` и загрузка правил (`status` считает долю без
`enforced_by`); поле `execution.guard_prefixes` в `check/1` без исполнителя; `paths.src` / `paths.tests` в `config/1` и
типизированный `WarrantConfig` (`core/config.ts`); `<state>` = `WARRANT_STATE_DIR` или `.warrant` (`core/evidence/store.ts`,
D-2); замок `check` (`core/check/lock.ts`, `onInterrupt` из `core/check/interrupt.ts` — исключение храповика A-12);
`toProjectPaths`, `pathMatcher`, `cliError`; каталог `.warrant/runs/` пуст. `validate` — ручная последовательность 13 проверок
(A-9). Нормы — ADR-0014, ADR-0017…0019, ADR-0022, ADR-0034; нарезка и контракт CLI — ADR-0034 п. 6, 8. Аудит
[2026-09-25-core-seams](../../../docs/process/audits/2026-09-25-core-seams.md): A-20 (путь проекта в копиях) лежит на пути
решения `deny`, A-21 и A-22 — рядом с реестром проверок.

Решения этого Change приняты grilling'ом 2026-09-25 (F1–F20, maintainer принял все рекомендации) — §1.

Ограничения: kernel-схемы остаются `major = 1` (`config/1` — добавочное необязательное поле); `warrant validate` на
репозитории зелёный после каждой группы; guard на самом репозитории WARRANT не включается (ADR-0034 п. 4) — `warrant.json`
репозитория без `frontends`.

## Goals / Non-Goals

**Goals:**
- Критерий 4a (13 §2): сессия Claude Code в sample-проекте получает `deny` вне `write_scope` и hints после правки; контракт
  адаптера — на записанном родном входе; CI ubuntu + windows зелёная.
- Логика только в `warrant guard` на нормализованном событии; адаптер — трансляция (ADR-0018 п. 2, ADR-0034 п. 2).
- Швы A-9, A-12, A-20…A-22 закрыты до того, как через них пойдёт guard.

**Non-Goals:** — proposal «Non-Goals» (4b, `codex`, ACP, guard на WARRANT, параллельные Runs, бюджет 500 мс).

## Decisions

### 1. Решения grilling (F1–F20)

| # | Решение |
|---|---|
| F1 | `write_scope` по операции: `specify` → `openspec/changes/<change>/**`; `implement` → `<paths.src>/**`, `<paths.tests>/**`, `openspec/changes/<change>/tasks.md`. `--scope` только сужает — путь разрешён, если подходит и под `write_scope`, и под непустой `scope` |
| F2 | `specify` ⇐ `PROPOSED`, `implement` ⇐ `IMPLEMENTING`; иначе `STATE_INVALID` + `hint` |
| F3 | Файл Run коммитится; `<state>/runs/current` — в `.gitignore` (строку держит `sync`) |
| F4 | `run finish [--state …]` в 4a; второй `run start` — `RUN_ACTIVE` + `hint`; статусы Run — реестр `enums` |
| F5 | Один активный Run на worktree |
| F6 | `frontends: ["claude"]` в `warrant.json`; `warrant init --frontend claude` |
| F7 | `sync` держит строку `@AGENTS.md` в `CLAUDE.md` при сгенерированном `AGENTS.md` и `frontends ∋ claude` |
| F8 | `pre` shell — только `guard_prefixes`; «без Run → `deny`» — только для `edit` |
| F9 | `pre` fail-closed (`deny` + `hint: warrant validate`); нет `warrant.json` → `allow`; `post` всегда `allow` |
| F10 | `FRONTEND_HOOKS_INACTIVE` по пути, ≤ 10 + `more`; `status` и `verify` / `gate` на `VERIFYING->MERGED`; не `FAIL` |
| F11 | `hint` обязателен у новых ошибок 4a; у существующих — перенос готового текста исправления из `message` |
| F12 | `--dry-run`: тот же JSON + `dry_run`, `would_write[]`, тот же код, без записи; `archive` без `openspec archive` |
| F13 | A-22, A-21 — с реестром A-9 в группе 1; A-20 — до `guard`; A-12 — с замком Run |
| F14 | Capability `enforcement` (AREA `ENF`); delta `kernel`, `verification` |
| F15 | Поля `run/1` — REQ-ENF-001; имени frontend нет |
| F16 | Событие: `at, phase, action, paths, decision, reason?, findings[] (коды), rules_shown[], argv?` (только `deny` по префиксу) |
| F17 | Context Pack = JSON `run start`; `context_hash` — по `items` + `rules`; отдельного файла пакета нет |
| F18 | Замок `<state>/runs/<id>.lock` (O_EXCL, повтор ~2 с) + `writeJsonFile`; не взят: `pre` → `deny BUSY`, `post` → потеря + stderr |
| F19 | Matcher `PreToolUse` — `Edit\|Write\|NotebookEdit\|Bash`, `PostToolUse` — `Edit\|Write\|NotebookEdit`: уточнение ADR-0034 п. 3 (там `Edit\|Write\|Bash`) — `NotebookEdit` правит файл и без matcher был бы обходом `write_scope` |
| F20 | CLI `0.4.3 → 0.5.0`; `config/1` + `frontends`; `run/1` — новая схема; pack `core-sdd` не меняется |

### 2. Модули и ранги

- `core/ports/frontend.ts` (R0) — **порт guard**: типы `GuardEvent`, `GuardDecision` и интерфейс адаптера
  `{ name, toEvent(native) → GuardEvent | undefined, respond(decision, event) → { stdout, exit } }`. `adapters/frontend/claude.ts`
  реализует его, импортирует только `core/ports` и `core` (слой `adapters`); `bin/warrant.ts` выбирает адаптер по
  `--frontend`. Имя `claude` — только там и в `core/sync` (генератор), держится мета-тестом нейтральности (§9).
- `core/run/` (R2) — `run/1`: чтение, запись под замком, `current`, `write_scope` по операции, Context Pack. Hash effective
  policy передаёт вызывающий (`commands/run.ts` зовёт resolve) — `core/run` не зависит от `core/resolve`.
- `core/guard/` (R4, как `core/transition`) — решение `pre` / `post`, `guard_prefixes`, hints; использует `core/run`,
  реестр проверок `core/validate`, правила из `core/packs`.
- `core/liveness/` (R2) — `FRONTEND_HOOKS_INACTIVE`: чистая функция `(diffPaths, runs, config) → finding | undefined`;
  `status`, `verify`, `gate` дают ей пути diff (как `scope-valid`) и Runs.
- Ранги — строками `architecture.json` в группе, где модуль появляется; храповик держит.

### 3. Реестр проверок `validate` (A-9)

`core/validate/registry.ts`: `{ id, level: "file" | "project", appliesTo(path) → boolean, run(ctx, files?) → CliError[] }`,
порядок — нынешний порядок 13 проверок (golden и `app` байт в байт). Полный `validate` проходит все; `--files` — проверки
`file`, чей `appliesTo` принял хотя бы один путь, на этих путях. Проверки ADR-0019 п. 1 (a)–(e) — `file`; lock, hash, drift
сгенерированного, `openspec schema validate` — `project`. Путь без проверки → `skipped: no-check`. Группа 1 вводит реестр
без изменения поведения; `--files` — группа 3.

### 4. Путь проекта (A-20)

`projectPath(root, absolute): string | undefined` в `core/fs.ts` (реестр `helpers`): POSIX-путь внутри проекта, `""` для
корня, `undefined` вне (разный диск, `..` как сегмент — не префикс `..cache`). `reportPath`, `projectUri`, `inside`
(`core/sync/plan.ts`), `core/check/execute.ts`, `commands/resolve.ts` — через него; `core/ids/immutable.ts` — через
`toProjectPaths`. Путь события guard: абсолютный или от `cwd` события → абсолютный → `projectPath`; `undefined` → `allow`.

### 5. Замок и сигналы (A-12, F18)

`core/lock.ts` (R0) — один примитив: создание файла `O_EXCL` с держателем `{pid, what, at}`, повтор с шагом до срока,
снятие. Замок `check` (`core/check/lock.ts`) и замок Run — через него. `onInterrupt` уходит за порт `ctx.signals`
(`core/ports`), реализация — адаптер; исключение `rank` A-12 снимается. Запись Run: замок → чтение → добавление события →
`writeJsonFile` → снятие.

### 6. Guard

- **Scope:** `pathMatcher(write_scope)` и `pathMatcher(scope)` (`dot: true`); `tasks.md` — точный путь.
- **Без Run** (ADR-0022 п. 7): множество — `<paths.src>/**`, `<paths.tests>/**`, `openspec/changes/**`, `match.paths` всех
  profiles подключённых packs.
- **`guard_prefixes`** (ADR-0017 п. 5): prefix по умолчанию — токены `run.command` до первого, начинающегося с `-` или
  содержащего `{` (`["pytest", "-q"]` → `["pytest"]`). Разбор shell — минимальный токенайзер: кавычки, `\`, операторы
  `&&`, `||`, `;`, `|`, перевод строки; префиксы `VAR=…` пропускаются; `bash -c` / `sh -c` с одной строкой разбираются
  рекурсивно на один уровень; `$(…)`, алиасы и скрипты не раскрываются — предел INV-07 (ADR-0017 Consequences).
- **Hints `post`:** находки `validate --files` строкой `CODE path: message — hint`, не больше 10 + «и ещё N»; затем текст
  правил, чьих id нет в `rules_shown` событий Run. Без Run — только находки.
- **Код выхода** `warrant guard` без `--frontend` — 0 при любом решении (решение — данные, не ошибка).

### 7. Адаптер `claude`

Родной вход (`PreToolUse` / `PostToolUse`): `Edit` / `Write` → `tool_input.file_path`, `NotebookEdit` →
`tool_input.notebook_path`, `Bash` → `tool_input.command` (argv — токенайзер §6). Ответ: `deny` →
`{hookSpecificOutput: {hookEventName, permissionDecision: "deny", permissionDecisionReason}}`; `allow` — без
`permissionDecision` (иначе хук обходил бы механизм разрешений Claude Code), hints — `additionalContext`. Неразборчивый вход
— код 2 и stderr: для `PreToolUse` это отмена действия (fail-closed), для `PostToolUse` — сообщение модели.
**Фикстуры:** `test/contract/fixtures/claude/<версия>/*.json` — записанный stdin хуков; `scripts/dev/probe-hooks.js`
(ADR-0034 п. 2) ставит временный хук-регистратор в пустой проект, maintainer выполняет сценарий в Claude Code, скрипт
перезаписывает фикстуры и печатает версию. Проверяются и две вещи, которые документация не гарантирует: доходит ли
`additionalContext` `PreToolUse` при `allow` до модели и как Claude Code якорит пути `permissions.deny` (§8). Расхождение —
строкой `I-N`: hints `pre` уходят только в `post`; написание deny — по факту зонда.

### 8. `sync`: управляемое подмножество

План `sync` получает второй вид цели — «подмножество»: `{ path, own(current) → записи, merge(current) → bytes,
drift(current) → [pointer] }`. `sync` пишет `merge`, `validate` берёт `drift` из того же плана — одно место знает, какие
записи наши (аудит §3.4). Свои записи: в `.claude/settings.json` — `permissions.deny` из ADR-0014 п. 1 (по `Edit(…)` и
`Write(…)` на каждый путь и три `Bash(…:*)`) и группы хуков `{matcher, hooks: [{type: "command", command: "warrant guard
--frontend claude"}]}`; своя группа — та, у которой команда ровно эта; `merge` заменяет свою группу с другим matcher.
`CLAUDE.md` — строка `@AGENTS.md` в конце, если её нет; `.gitignore` — строка `.warrant/runs/current`. `AGENTS.md` — обычная
цель «точные байты». `GENERATED_TOO_LARGE` — новый код.

### 9. Нейтральность и реестры

Мета-тест: строка `claude` в `packages/cli/src` — только в `adapters/frontend/**`, `core/sync/**` и таблице адаптеров
`bin/warrant.ts`. Реестр `enums`: `run-state` (`core/run`), `guard-decision`, `run-operation`. Реестр `test_helpers`:
помощник `validate` уровня `app` (A-21).

### 10. `hint` и `--dry-run`

`CliError.hint?`, `WarrantError(code, message, {path?, hint?})`, `cliError(code, message, {path?, hint?})`. Перенос
(~20 мест, `grep "; run \`\|; pass \|; use "`): часть после `; ` уходит в `hint`, `message` — до неё; golden ошибок
меняется один раз. Unit-тест: у кодов 4a (`RUN_ACTIVE`, `RUN_NOT_ACTIVE`, `GENERATED_TOO_LARGE`) и у ошибок команд `run`,
`guard` `hint` есть. **`--dry-run`:** запись меняющих команд идёт через `ctx.writes` (накопитель путей в dry-run, запись
иначе); `openspec archive` и `openspec new change` в dry-run не вызываются. Линза `cli-contract`: `--help` новых команд — с
примером.

### 11. Версии и порядок

Задача 1.1 — CLI `0.5.0` (`package.json`, `package-lock.json`, `.warrant/warrant.lock.json`, lock golden-фикстур, как I-142)
до любого другого изменения поставляемого (R-14). Порядок групп: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8; 5 зависит от 3 (hints) и 4
(Run); 7 — от 4; 8 (адаптер) — последней (ADR-0034 п. 6).

### 12. Dogfooding

`warrant classify phase-4a` по diff spec-PR. Producers `analyze-clean` и `adversarial-review` появятся в 4b (BL-2) — пара
waivers в spec-PR, срок 2026-12-31. Guard репозиторием не используется; `sync` добавит в `.gitignore` репозитория строку
`.warrant/runs/current`.

## Risks / Trade-offs

- [Fail-closed `pre` блокирует сессию при сломанной конфигурации] → reason и `hint: warrant validate`; проект без
  `warrant.json` не затронут; человек и сессия без hooks чинят файл.
- [Файл Run растёт на каждую правку и коммитится] → в событии только коды и id (F16); размер — по failure mode.
- [Параллельные вызовы инструментов конкурируют за Run] → замок F18; потеря события `post` видна как
  `FRONTEND_HOOKS_INACTIVE` — это сигнал, не молчание.
- [Поведение Claude Code меняется между версиями] → фикстуры с версией, `probe-hooks.js`; контракт падает на старой форме.
- [`FRONTEND_HOOKS_INACTIVE` на каждую правку человека] → finding не `FAIL`; критерий MVP проверяется на slice, где правит
  агент.
- [Токенайзер shell неполон] → предел INV-07 зафиксирован; гарантия — CI и static deny.

## Migration Plan

1. Spec-PR: артефакты, `areas.json` (`ENF`), record, classify, пара waivers; `transition SPECIFIED` по «merge #N».
2. Impl-PR: первым коммитом `APPROVED --ref <review spec-PR> --by` и `IMPLEMENTING`; группы 1–8; последним — `VERIFYING`.
3. Archive-PR: evidence CI, `transition MERGED`, `warrant archive phase-4a`, tag `v0.5.0`.
4. Откат: `git revert` группы; `frontends` необязателен — без него `sync` не трогает файлы Claude Code.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-156 | Уточнение F20 (решение maintainer'а 2026-09-25): CLI `0.5.0` не проходит диапазон `kernel` pack'ов `>=0.1 <0.5` (`CONFIG_INVALID` загрузчика), поэтому pack `core-sdd` меняется: `0.3.0 → 0.3.1`, `kernel` `>=0.1 <0.6`; тот же диапазон у 7 fixture-packs `test/fixtures/packs/*/pack.json`; `.warrant/warrant.json` `kernel` `0.5` (как `ab21952` при 0.3 → 0.4; диапазон `^0.3.0` принимает 0.3.1). Lock репозитория — `warrant sync`, lock и `expected/{resolve,status}.json` golden-фикстур — `npm run golden:update` (меняются только версия pack в `sources` и hash) — правка golden вне групп 2 и 6 по этому решению. Bump 0.5.0 — как I-148: `package.json`, `package-lock.json` (2 строки), `.warrant/warrant.lock.json`, `warrant.lock.json` трёх golden-фикстур. REQ-SDD-001 уточнён в delta spec core-sdd (решение maintainer'а): `kernel: ">=0.1 <0.6"`, тест каталога `core-sdd-catalog.test.ts` — под новый диапазон | `specs/core-sdd/spec.md`, `packs/core-sdd/pack.json`, `test/fixtures/packs/*/pack.json`, `.warrant/warrant.json`, `packs/core-sdd/golden/**`, задача 1.1 |
| I-157 | Группа 1 (1.2–1.4). **NUL (A-22):** кроме `loader.ts` литеральные управляющие символы нашлись в регулярных выражениях `core/openspec/yaml-emit.ts` (L74, L104, вне аудита) — экранированы `\u0000…`; мета-тест — в `structure.test.ts` (обход `packages/`, `scripts/`, `docs/` без игнорируемых имён). **Реестр (A-9, §3):** `ValidateCheck { id, level, appliesTo(file, config), run(v) }` — `appliesTo` получает `WarrantConfig`, потому что (d) зависит от `paths.tests`; `run(v, files?)` добавит группа 3. Загрузчик — первая запись `packs` (его ошибки — проверки (1), (3) конфигурации и packs), загрузка — в `validateRun`; общее состояние — `ValidateRun` (`checked`, `skipped`, `records()` один раз для (9)–(11), `declared` — id проверки (5) для (13)); проверка (4) — `core/validate/generated.ts`. **Помощник (A-21):** `test/app/helpers/validate.ts` — `validate`, `validateErrors`, `errorCodes` (не `codes`: имя занято `helpers/synced.ts` и `unit/packs/loader.test.ts` с другими телами), три строки `test_helpers`; e2e-помощник `helpers/synced.ts#validate` переименован в `validateCli` — иначе нарушение `test-helper` | `core/validate/registry.ts`, `core/validate/generated.ts`, `commands/validate.ts`, `core/openspec/yaml-emit.ts`, `test/app/helpers/validate.ts`, `test/unit/meta/{structure.test.ts,architecture.json}`, задачи 1.2–1.4 |
| I-158 | Группа 2 (2.1–2.3). **hint (F11, §10):** `CliError.hint?`, `ErrorOptions {path?, hint?}` у `cliError` и `WarrantError`, ключи — `code, message, path, hint`; общие тексты `SYNC_HINT`, `FMT_HINT` в `core/errors.ts`. В `hint` перенесён текст после `; ` в 25 ошибках (`LOCK_MISMATCH` ×7, дрейф `sync --check` и `validate` ×2, `NOT_CANONICAL` ×2, `CONFIG_MISSING` `fmt`, `ALREADY_INITIALIZED`, `CONFIG_INVALID` `init change`, `OPENSPEC_FAILED` ×2, `USAGE` ×4, `WAIVER_INVALID`, `CHECK_NOT_CONFIGURED`, `CHECK_LOCAL_FORBIDDEN` без `--paths`, `BUSY`, `CONFIG_INVALID` loader) и в двух `COMMIT_NOT_MERGED` (`notMergedHeadReason` → `{reason, hint?}`); обёртка `check <id>:` сохраняет `hint`. Не переносились: findings гейтов (`NO_EVIDENCE`, `BRANCH_NOT_ISOLATED` — не `errors[]`), `reason` `Availability` (`pass --base`), `: pass --by` в `transition` и `classify` (вне шаблона §10). Golden не изменился: в `expected/**` нет `errors[]` с текстом исправления. **`--dry-run` (F12, §10):** `core/writes.ts` (R0) — `Writes { dryRun, write(target \| targets, perform) → T \| undefined, collected() }`, поле `Ctx.writes`, `bin` строит его по `--dry-run`; через него идут record (`appendTransition`, `writeRecord` берут `Pick<Ctx, "root" \| "writes">`, также `link`), evidence и manifest (`storeRecord`, `recordVerdicts`), raw-каталог check, waiver, удаление каталога `ABANDONED` и `openspec archive` (цели — `archivePlan`: активный каталог, `archive/<clock.today()>-<change>`, `openspec/specs/<cap>/spec.md` по дельтам). Уточнение «тот же JSON»: записи, которые dry-run не пишет, гейты судят как записанные — `pending` (`PendingRecord`, `core/evidence/store.ts`) в `evaluateTransition` / `judgeGates`: записи checks (`ChecksRun.records`) и `human-approval`; `{out}` check в dry-run — временный каталог вне проекта. `withDryRun` (`commands/context.ts`) добавляет `dry_run: true` и отсортированный `would_write[]` к любому результату, и к брошенной ошибке (как `bin` — без `change`). Exclusive-замок check в dry-run берётся и снимается | `core/errors.ts`, `core/writes.ts`, `core/ctx.ts`, `core/record/write.ts`, `core/evidence/{write,store}.ts`, `core/transition/{gates,evaluate}.ts`, `core/check/execute.ts`, `core/openspec/changes.ts`, `commands/{context,transition,archive,waive,link}.ts`, `bin/warrant.ts`, `test/app/helpers/{dry-run,project-builder}.ts`, задачи 2.1–2.3 |
| I-159 | Группа 3 (3.1–3.2). **Путь проекта (A-20, §4):** `projectPath(root, absolute, platform = path)` — третий параметр только для unit-теста правил другой платформы (другой диск — `path.win32` на ubuntu); `reportPath` = `projectPath ?? posix(absolute)` (`..cache` теперь внутри); `projectUri`, `inside` (`core/sync/plan.ts`), `core/check/execute.ts` — через `projectPath`, `commands/resolve.ts` — через `reportPath` (та же семантика). `immutable.ts` через `toProjectPaths`: ранг `core/git` 2 → 1 (его импорты — `core/evidence` ранга 1 и ранг 0), иначе `core/ids` (1) не импортирует `core/git/paths.ts`. **`--files` (REQ-KRN-032, §3):** `ValidateCheck.run(v, files?)`, `runFileChecks` в реестре; путь — от корня проекта (абсолютный допустим), вне проекта — в `skipped[]` как дан, каталог — `no-check`; `checked[]`, `skipped[]` отсортированы; находки — код 1 (`FAIL`, SCN-KRN-127; полный `validate` — 3); ошибки загрузчика и проверок — только с `path` (без `#pointer`) из списка. (b): размещение (5d) — сверка с `openspec show` — под `--files` не выполняется (ADR-0019 п. 1: сверка с `openspec show` — только `validate`; REQ-KRN-032 запрещает процессы), `ID_DUPLICATE` — для id, объявленных в файлах, по скану всего проекта. (c): единственный процесс — `contents` порта git (`git cat-file --batch`, одним вызовом — то же, что `git show HEAD:<path>`) с путями `./<path>` от проекта — без `rev-parse --show-prefix`, `rev-parse HEAD`, `ls-tree`; порт `contents` принимает `./<path>` (адаптер без правки, `FakeGit`, сценарий контракта); без листинга `HEAD` исключение I-77 считает новым каждый каталог архива. (d): объявления — скан всего проекта (`ValidateRun.scan()`). `--files` без путей — `USAGE` с `hint`; `--help` — пример с `--files` | `core/fs.ts`, `core/evidence/store.ts`, `core/sync/plan.ts`, `core/check/execute.ts`, `commands/resolve.ts`, `core/ids/{immutable,scan}.ts`, `core/canon/files.ts`, `core/validate/{registry,dangling}.ts`, `core/ports/git.ts`, `commands/validate.ts`, `bin/warrant.ts`, `test/unit/meta/architecture.json`, `test/app/helpers/fakes/git.ts`, задачи 3.1–3.2 |
