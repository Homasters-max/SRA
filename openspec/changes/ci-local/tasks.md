# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/ci-local`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. ci --no-record (D1, D2)

- [ ] 1.1 `core/writes.ts`: `restoringWrites()` — снимок цели до первой записи (нет / файл / каталог), отпечаток после записи, `restore()` в обратном порядке, пустые созданные предки удаляются, `notRestored()`.
- [ ] 1.2 `commands/ci.ts`: `CiOptions.noRecord`; `USAGE` с `dryRun` или `GITHUB_ACTIONS=true`; `restoringWrites`, `ctx.signals.onInterrupt(restore)`, `restore()` в `finally`; `data.no_record: true`, `data.not_restored[]` у любого вывода. `bin/warrant.ts`: `--no-record`, пример в `--help`.
- [ ] 1.3 Тесты: unit `restoringWrites` (файл, каталог, новая цель с предками, порядок, цель, изменённая другим процессом); `app/commands/ci.test.ts` — SCN-VER-154, SCN-VER-155.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts writes ci.test`.

## 2. data.untracked[] у ci fetch (D3)

- [ ] 2.1 `core/ci/fetch.ts`: manifest Change в HEAD через `ctx.git.contents`; `core/evidence/store.ts` `importRecords` — записи каталога вне него и вне попытки; `data.untracked[]`.
- [ ] 2.2 Тест `app/commands/ci-fetch.test.ts`: SCN-VER-156; SCN-VER-086…089, 096, 103 — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts ci-fetch`.

## 3. Документы

- [ ] 3.1 `docs/06-verification.md` §8 — локальный вердикт `warrant ci --no-record` и его ожидаемый исход; `CHANGELOG.md` — строки `## 0.10.1`; `docs/backlog.md` — `--no-record` в синопсисе REQ-VER-011 после `judge-law`.

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
