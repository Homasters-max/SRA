# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/ci-local`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. ci --no-record (D1, D2)

- [ ] 1.1 `core/writes.ts`: `restoringWrites()` — снимок цели до первой записи (нет / файл / каталог), `restore()` в обратном порядке, пустые созданные предки удаляются, ошибка возврата — в stderr.
- [ ] 1.2 `commands/ci.ts`: `CiOptions.noRecord`; `restoringWrites`, `ctx.signals.onInterrupt(restore)`, `restore()` в `finally`; `data.no_record: true`; с `dryRun` — `USAGE`. `bin/warrant.ts`: `--no-record`, пример в `--help`.
- [ ] 1.3 Тесты: unit `restoringWrites` (файл, каталог, новая цель с предками, порядок); `app/commands/ci.test.ts` — SCN-VER-154 (вывод равен `warrant ci` на копии, дерево проекта побайтно то же), SCN-VER-155.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts writes ci.test`.

## 2. Manifest ci fetch (D3)

- [ ] 2.1 `core/ci/fetch.ts`: manifest Change в HEAD через `ctx.git.contents`; `core/evidence/store.ts` `importRecords` — основа и `evidence[]` из него, плюс импортированные id.
- [ ] 2.2 Тест `app/commands/ci-fetch.test.ts`: SCN-VER-156; SCN-VER-086…089, 096, 103 — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts ci-fetch`.

## 3. Документы

- [ ] 3.1 `docs/06-verification.md` §8 — локальный вердикт `warrant ci --no-record`; `CHANGELOG.md` — строки раздела релиза.

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
