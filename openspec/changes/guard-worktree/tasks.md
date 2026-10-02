# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/guard-worktree`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. Корень события (D1)

- [ ] 1.1 `core/guard/guard.ts`: `guardRoot(cwd, fallback)` — ближайший предок с `.warrant/warrant.json`, иначе `fallback`; `guard` и `guardFrontend` разбирают вход, затем решают в `ctx` корня события (`at(root)`, по умолчанию `{ ...ctx, root }`) с абсолютным `cwd`; вход, который не разбирается, — в `ctx.root`, как сейчас.
- [ ] 1.2 `commands/guard.ts`, `bin/warrant.ts`: `at` — `productionCtx` корня события (адаптеры от него же).
- [ ] 1.3 Тесты `app/commands/guard.test.ts`: SCN-ENF-056 (каталог процесса — проект без Run, `cwd` другого checkout'а и его подкаталога: `deny` вне `write_scope`, события в его Run, в каталоге процесса Run нет, `post` без hint `run start`), SCN-ENF-057 (`cwd` вне проектов — каталог процесса), SCN-ENF-016 (ни у `cwd`, ни у процесса нет проекта; вход не JSON); `app/commands/guard-frontend.test.ts` — SCN-ENF-056 через адаптер `claude`. SCN-ENF-011…016, 026, 027, 036, 041, 044 — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts guard`.

## 2. Версия (D3)

- [ ] 2.1 `package.json` — 0.10.1; `CHANGELOG.md` — `## 0.10.1`: guard судит Run и policy checkout'а `cwd` события.
- [ ] 2.2 `docs/backlog.md` — строка: зонд хуков Claude Code в worktree-сессии (`cwd` входа и каталог процесса, допущение A-1 design), акт maintainer'а.

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
