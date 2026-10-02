# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/analyze-open`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. ORPHAN и открытые Change (D1, D3)

- [ ] 1.1 `core/analyze/input.ts`: `openIds` — REQ и SCN из `ADDED`/`MODIFIED` delta specs каталогов `openspec/changes/<имя>/` кроме `archive` и самого Change; `core/analyze/index.ts`: `AnalyzeInput.openIds`, `ORPHAN` пропускает SCN из него; комментарий модуля.
- [ ] 1.2 Тесты `unit/analyze/analyze.test.ts` и `app/commands/analyze.test.ts`: SCN-VER-152 (SCN открытого Change — не `ORPHAN`, SCN только из архивного Change — `ORPHAN`); SCN-VER-062…067, 072 — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts analyze`.

## 2. CHANGELOG

- [ ] 2.1 `CHANGELOG.md` — строка в разделе релиза: `ORPHAN` не даёт SCN другого открытого Change.

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
