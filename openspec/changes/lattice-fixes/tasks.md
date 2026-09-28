# Tasks

После каждой группы должны быть зелёными: `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`,
`npm run versions:check`. Тесты — по уровням (`test:unit`, `test:app`, `test:contract`, `test:e2e`; BL-37). Закрытие — `/group-done`.
Коммит — один на группу, в `worktree/lattice-fixes`.

Обозначения: §N — разделы design.md; L-N — решения §1; BL-N, R-N — строки [docs/backlog.md](../../../docs/backlog.md).
Правка ожидаемого значения golden вне задачи 1.1 — остановка и строка I-N.

## 1. Parser junit и bump (W-3, L1, L2)

- [x] 1.1 Перенос `c51bfc1` ветки `fix/lattice-junit` (§2) с приоритетом исхода `skipped` → `failure` → `error`:
  `core/evidence/parsers/junit.ts`, тесты parser'а, bump CLI `0.8.1`
  (`package.json`, `package-lock.json`, `kernel` в `warrant.lock.json` репозитория и трёх golden-фикстур).

  Проверка: `npm run versions:check` зелёный; e2e golden (SCN-SDD-015) — только `kernel` в lock.
- [x] 1.2 Тест SCN-VER-117 — в `test/unit/evidence/parsers.test.ts` (фикстура `NODE_TEST`, токен в имени); SCN-VER-006, SCN-VER-040
  без правок ожидаемых значений.

## 2. Префикс guard (W-2, L3)

- [x] 2.1 `core/guard/shell.ts` (§3): `GuardPrefix`, `INTERPRETERS`, `defaultPrefix` с флагами режима, `matchesPrefix`; строка
  `enums` в `architecture.json`.

  Проверка: unit `shell.test.ts` — флаги в любом порядке, повтор флага, `=`-флаг и `{…}` не входят, `-m <модуль>` как прежде,
  интерпретатор без флагов, не-интерпретатор с флагами.
- [x] 2.2 `core/guard/decide.ts`: `guardedChecks` → `GuardPrefix[]` (явные `guard_prefixes` — `flags: []`), сопоставление —
  `matchesPrefix`.

  Проверка: app `guard` — SCN-ENF-040; SCN-ENF-013, SCN-ENF-037 без правок ожидаемых значений.

## 3. Сдача review (W-6, BL-46, R-22, L4)

- [x] 3.1 Guard (§4): `tmpDir` в `GuardInput` из `commands/guard.ts` (`os.tmpdir()`), `outsideFiles` и сравнение после
  `realpath` в `core/guard/guard.ts`, hint с путём каталога, пути вне проекта не в `guard_events[].paths`,
  решение правки под Run `review` в `decide.ts`.

  Проверка: app `guard` — SCN-ENF-041 с временным каталогом теста; SCN-ENF-026 без правок; без Run путь вне проекта — `allow`.
- [x] 3.2 Субагент (§4): `core/sync/claude.ts` — `tools` с `Write`, matcher `Bash|Write` (и в белом списке `dev-hooks.test.ts`),
  раздел «Сдача результата» с оговоркой о файле envelope, сдачей из корня проекта, `--file` и
  `--dry-run`, полный пример envelope; `warrant sync` перегенерирует `.claude/agents/warrant-reviewer.md` репозитория.

  Проверка: app `sync` — SCN-KRN-139 (пример из тела проходит схему `skill-result/1`); `warrant sync --check` зелёный.
- [x] 3.3 `data` ошибки (§4): `WarrantError.data` (`core/errors.ts`), `failure` (`io/output.ts`), `received` в `parseEnvelope`.

  Проверка: app `run submit` — SCN-ENF-042; SCN-ENF-033 без правок ожидаемых значений; прочие ошибки — `data: {}`.

## 4. Перезапуск сессии (W-5, L5)

- [x] 4.1 `FRONTEND_RESTART_REQUIRED` (§5): `SyncFinding` в `core/sync/plan.ts`, находки в `core/sync/apply.ts`, вывод `init`.

  Проверка: app `sync`, `init` — SCN-KRN-154; `sync --check` и `--dry-run` находку не дают; SCN-KRN-142 без правок.

## 5. Документы и закрытие

- [ ] 5.1 Документы (§6): 06 §2 «Execution», 06 §7, 07 §4; `backlog.md` — удалить BL-46, BL-78, BL-80, R-22, строка о фразе
  skill про guard Run `review`.
- [ ] 5.2 Ревью реализации — навык `review-impl`; `transition VERIFYING` последним коммитом impl-PR.
