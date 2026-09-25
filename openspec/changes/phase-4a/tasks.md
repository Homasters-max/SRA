# Tasks

После каждой группы: `npm test`, `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`,
`npm run versions:check` зелёные (`/group-done`); коммит на группу в `worktree/phase-4a`; после группы — `/group-stats`.
§N — разделы design.md, F-N — решения §1, A-N и BL-N — [docs/backlog.md](../../../docs/backlog.md). Правка ожидаемого значения
golden вне групп 2 и 6 — остановка и строка I-N.

## 1. Bump и швы (A-9, A-21, A-22)

- [x] 1.1 Bump CLI `0.5.0` (`package.json`, `package-lock.json`, `.warrant/warrant.lock.json`, lock golden-фикстур — как
  I-142). Проверка: `npm run versions:check` зелёный.
- [x] 1.2 A-22: NUL в `core/schemas/loader.ts` — экранирование в строке; мета-тест «файлы `packages/**`, `scripts/**`,
  `docs/**` без NUL». Проверка: `git grep -I -L "" -- packages/cli/src` пуст; временный NUL роняет тест.
- [x] 1.3 A-9: реестр проверок `core/validate/registry.ts` (§3), `runValidate` — проход по реестру. Проверка: golden, `app`
  и `e2e` `validate` без правок ожидаемых значений.
- [x] 1.4 A-21: помощник `validate` уровня `app` в `test/app/helpers/`, 10 копий и `codes` — через него; строки
  `test_helpers`. Проверка: `cs dups --in packages/cli/test` без `validate`, `validateErrors`.

## 2. Контракт CLI: hint и --dry-run (REQ-KRN-002, REQ-KRN-034)

- [x] 2.1 `hint` в `CliError`, `WarrantError`, `cliError` (§10); перенос готового текста исправления (~20 мест). Проверка:
  SCN-KRN-125; `grep "; run \`" packages/cli/src` пуст; golden ошибок обновлён одним коммитом.
- [x] 2.2 `ctx.writes` и `--dry-run` у `transition`, `archive`, `waive` (§10). Проверка: SCN-KRN-135…137; `app`-тест: после
  dry-run каждой команды дерево проекта байт в байт прежнее.
- [x] 2.3 `--help` `transition`, `archive`, `waive` — пример с `--dry-run` (линза `cli-contract`). Проверка: e2e `--help`.

## 3. validate --files и путь проекта (REQ-KRN-032, A-20)

- [x] 3.1 A-20: `projectPath` в `core/fs.ts` (§4), реестр `helpers`; 5 копий — через него, `immutable.ts` — через
  `toProjectPaths`. Проверка: unit `projectPath` (корень, `..cache`, другой диск); `grep "path.relative(" packages/cli/src`
  — только владелец и места без вопроса «внутри»; golden без правок.
- [x] 3.2 `warrant validate --files <paths>` по реестру (§3): `checked[]`, `skipped[]` (`no-check`, `missing`, `outside`),
  без дочерних процессов, кроме `git show HEAD:<path>`. Проверка: SCN-KRN-127…129; unit — на фейках без процессов.

## 4. Run (REQ-ENF-001…003, A-12)

- [ ] 4.1 Схема `run.1.schema.json` (+ копия в `.warrant/schemas/` через `sync`), реестр `enums`: `run-state`,
  `run-operation`, `guard-decision`. Проверка: SCN-ENF-001…003.
- [ ] 4.2 A-12: `core/lock.ts` (§5), замок `check` через него, `onInterrupt` за портом `ctx.signals`; исключение A-12 снято.
  Проверка: тесты `check` (`BUSY`, прерывание) без правок ожидаемых значений; `exceptions` в `architecture.json` пуст.
- [ ] 4.3 `core/run/` (§2): `write_scope` по операции, `current`, запись под замком, Context Pack (`rules[]`, `items[]`,
  `context_hash`). Проверка: unit сужения и `rules[]` (SCN-ENF-007).
- [ ] 4.4 `warrant run start` / `run finish` (+ `--dry-run`, `--help` с примером). Проверка: SCN-ENF-004…010.

## 5. Guard (REQ-ENF-004)

- [ ] 5.1 Нормализованное событие и `warrant guard` без `--frontend`: `pre` `edit` (Run, без Run, вне проекта, нет
  `warrant.json`), fail-closed (F9). Проверка: SCN-ENF-011, 012, 015, 016.
- [ ] 5.2 `pre` `shell`: `guard_prefixes` и токенайзер (§6). Проверка: SCN-ENF-013; unit токенайзера (кавычки, `&&`,
  `bash -c`, `VAR=1`).
- [ ] 5.3 `post`: hints из `validate --files` и правил раз за Run, лимит 10 + «и ещё N». Проверка: SCN-ENF-014.
- [ ] 5.4 `guard_events[]` под замком (F18): `pre` → `deny BUSY`, `post` → потеря + stderr. Проверка: `app`-тест с занятым
  замком.

## 6. Файлы frontend (REQ-KRN-004, REQ-KRN-033)

- [ ] 6.1 `config/1` — `frontends` (+ `WarrantConfig`, unit свойств схемы); `warrant init --frontend claude`. Проверка:
  SCN-KRN-126; e2e `init --frontend claude`.
- [ ] 6.2 Цель «подмножество» в плане `sync` (§8): `.claude/settings.json`, `CLAUDE.md`, `.gitignore`; `validate` — `drift`
  из плана. Проверка: SCN-KRN-130, 131, 134; повторный `sync` без изменений байт.
- [ ] 6.3 `AGENTS.md` из правил с `paths: ["**"]`, `GENERATED_TOO_LARGE`. Проверка: SCN-KRN-132, 133; golden `sync`
  обновлён (строка `.gitignore`).

## 7. Живость hooks (REQ-VER-009)

- [ ] 7.1 `core/liveness/` (§2) и finding `FRONTEND_HOOKS_INACTIVE` в `status`, `verify`, `gate`. Проверка: SCN-VER-053…055;
  код выхода и verdicts при finding те же.

## 8. Адаптер claude (REQ-ENF-005) и документы

- [ ] 8.1 Порт `core/ports/frontend.ts`, `adapters/frontend/claude.ts`, `--frontend` в `bin/warrant.ts` (§2, §7); мета-тест
  нейтральности (§9). Проверка: SCN-ENF-020; строка `claude` вне разрешённых мест роняет тест.
- [ ] 8.2 `scripts/dev/probe-hooks.js` и фикстуры родного входа с версией Claude Code (§7); зонд `additionalContext`
  `PreToolUse` и якоря путей deny — итог строкой I-N. Проверка: фикстуры `Edit`, `Write`, `NotebookEdit`, `Bash` для `pre`
  и `post` в `test/contract/fixtures/claude/`.
- [ ] 8.3 Контракт адаптера на записанном входе (ADR-0034 п. 2). Проверка: SCN-ENF-017…019, 021.
- [ ] 8.4 e2e: `init --frontend claude` → `sync` → `run start` → `guard --frontend claude` (deny вне scope, hints после
  правки) → `run finish` → `verify` без `FRONTEND_HOOKS_INACTIVE`. Проверка: e2e на ubuntu и windows.
- [ ] 8.5 Документы: 03 §4 (Run, `current`, коммит файла Run), 04 §6–7 (guard, адаптер `claude` — MVP, `run start|finish`),
  02 (Run, событие guard), 13 §2 (строка 4a), README CLI; `backlog.md` — закрыть BL-5, BL-7, BL-10, BL-14, BL-20, A-9, A-12,
  A-20…A-22, сузить BL-3, BL-9, BL-13. Проверка: `hygiene.js` без битых ссылок, `dev-context.test.ts` зелёный.
