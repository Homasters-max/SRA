# Tasks

После группы должны быть зелёными: `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`), `npm run typecheck` и тесты группы. Коммит — один на группу, в `worktree/exit-contract`.

## 1. Версии 0.10.0 (D11, D12)

- [ ] 1.1 `package.json` — `0.10.0`; `CHANGELOG.md` — `## 0.10.0` с разделами «Вердикт» и «Миграция для потребителя» по D12; `.warrant/warrant.json` — `kernel: "0.10"`.
- [ ] 1.2 Pack `core-sdd` 0.4.1, `kernel: ">=0.1 <0.11"` (REQ-SDD-001, SCN-SDD-001); тест `core-sdd-catalog`; `warrant sync` (lock), `scripts/golden-update.js` (golden).

  Проверка: `node scripts/dev/check.js`; `npx vitest run --config packages/cli/vitest.config.ts golden core-sdd`.

## 2. Классы кодов и одна функция (D1, D2, D4, D5)

- [ ] 2.1 `core/errors.ts`: карта «код → класс», коды `FORGE_ACCESS` и `PACK_VERSION_RANGE`, тип действия, `exitCodeFor(errors, outcome?)` с приоритетом `3 > 1 > 4 > 2 > 0`; `WarrantError` без `exitCode`; unit-тест таблицы приоритета и классов (REQ-KRN-003).
- [ ] 2.2 `io/output.ts`: `CommandResult.outcome?` вместо `exitCode`, код — `exitCodeFor`; `retryable: true` в `toEnvelope` по классу (REQ-KRN-002); `core/controller/evaluate.ts` — без `exitCodeOf`, тип действия из `core/errors.ts`. Тесты SCN-KRN-160 (часть `check`), unit `output`.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts output errors controller`; `npm run typecheck`.

## 3. Команды на одну функцию (D2, D3)

- [ ] 3.1 Места выбора кода `commands/**`, `core/check/execute.ts`, `core/transition/outcome.ts`, `core/sync/apply.ts`, `core/run/store.ts`, `core/canon/format-json.ts`: передают `outcome`, а не код; `Math.max` в `verify.ts`, `archive.ts`, `execute.ts` удалены (REQ-VER-005, REQ-VER-006). Тесты SCN-KRN-161, SCN-VER-008, SCN-VER-009, SCN-VER-028, SCN-VER-136, SCN-KRN-158, `run` `BUSY` → 4.
- [ ] 3.2 `validate`, `validate --files`, `fmt --check`, `sync --check` — код 3 (REQ-KRN-021, REQ-KRN-022, REQ-KRN-025, REQ-KRN-032). Тесты SCN-KRN-051, SCN-KRN-127, SCN-KRN-162.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts check verify run validate fmt sync format-json transition archive`.

## 4. Судья, форж, диапазон pack (D6, D7, D8)

- [ ] 4.1 `core/ci/judge.ts`, `core/ci/impl.ts`: код — `exitCodeFor` над всеми ошибками без `GATE_NOT_PASSED` `BLOCKED` при ошибке check (D6); `core/ci/fetch.ts` — `BUSY` класса `retry` (REQ-VER-011, REQ-VER-012). Тесты SCN-VER-095, SCN-VER-137, SCN-KRN-160 (часть `ci fetch`).
- [ ] 4.2 `adapters/forge-gh.ts` по D7: `FORGE_ACCESS`, `FORGE_UNAVAILABLE`, `USAGE` для `GITHUB_REPOSITORY` и `origin`; `ci/decisions.ts` — находка `DECISION_NOT_VERIFIED` и для `FORGE_ACCESS` (REQ-VER-013). Тесты SCN-VER-084, SCN-VER-138, contract `forge`, unit `forge-gh`.
- [ ] 4.3 `core/packs/loader.ts` — `PACK_VERSION_RANGE`; `core/ci/base.ts` `acceptChangedLaw` сверяет код и путь (D8). Тесты SCN-KRN-164, SCN-VER-139, unit `loader`.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts ci forge loader base`.

## 5. Падение до JSON и meta-тест (D9, D10)

- [ ] 5.1 `bin/warrant.ts`: обработчики `uncaughtException` и `unhandledRejection` по D9 — `INTERNAL` до вывода, только stderr после, код 2 в `guard --frontend`; тесты SCN-KRN-163 и REQ-ENF-005 (исключение адаптера) вызывают обработчик напрямую.
- [ ] 5.2 Meta-тест `test/unit/meta/`: `EXIT.` и сложение кодов — только в `core/errors.ts`, `io/output.ts`, `bin/warrant.ts`; тест падает на добавленной в `commands/` ссылке `EXIT.FAIL`.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts meta bin`; полный `npm test`.

## 6. Документы

- [ ] 6.1 `docs/04-lifecycle.md` (строка «Коды выхода»), `README.md`, `.claude/skills/cli-contract/SKILL.md` (коды 0…4, `retryable`); `docs/backlog.md` — WS-06, A-42, A-48 закрыты Change `exit-contract`; поправка факта ADR-0052 «`BUSY` в `fmt`» — строкой I-N.

  Проверка: `node scripts/dev/check.js`; `npx vitest run --config packages/cli/vitest.config.ts dev-context`.
