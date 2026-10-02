# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/analyze-open`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. ORPHAN и открытые Change (D1, D3)

- [ ] 1.1 `core/analyze/input.ts`: `openIds` — REQ и SCN из `ADDED`/`MODIFIED` delta specs каталогов `openspec/changes/<имя>/` кроме `archive` и самого Change; `analyzePaths` ∋ `openspec/changes`; `core/analyze/index.ts`: `AnalyzeInput.openIds`, `ORPHAN` пропускает SCN из него; комментарий модуля; `core/gates/l0/analyze-clean.ts` — сообщение `ORPHAN` (D4).
- [ ] 1.2 Тесты `unit/analyze/analyze.test.ts` и `app/commands/analyze.test.ts`: SCN-VER-152 (SCN открытого Change — не `ORPHAN`, SCN только из архивного Change — `ORPHAN`; свой `REMOVED` и объявление другого — не `ORPHAN`); тест gate (`app/commands/gate.test.ts`): SCN-VER-153 на commit; SCN-VER-062…067, 072 — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts analyze gate`.

## 2. Документы

- [ ] 2.1 `CHANGELOG.md` — строка в разделе релиза: `ORPHAN` не даёт SCN другого открытого Change; `docs/06-verification.md` §5 — строка `ORPHAN` (D4).

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
