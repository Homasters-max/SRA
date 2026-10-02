# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/guard-worktree`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. Корень события и вложенный checkout (D1, D2)

- [ ] 1.1 `core/guard/guard.ts`: `guardRoot(cwd, fallback)` — ближайший предок с `.warrant/warrant.json`; `guard` и `guardFrontend` решают в `ctx` найденного корня (`at(root)`, по умолчанию `{ ...ctx, root }`); `underWarrant` каталога процесса — только для входа, который не разобрался.
- [ ] 1.2 `core/guard/guard.ts`: `projectFile(root, absolute)` — путь во вложенном checkout'е под WARRANT вне проекта; им пользуются `projectFiles`, `outsidePaths`, `inProject` для `cd` под Run `review`.
- [ ] 1.3 `commands/guard.ts`, `bin/warrant.ts`: `at` — `productionCtx` корня события.
- [ ] 1.4 Тесты `app/commands/guard.test.ts`: SCN-ENF-056 (основной checkout без Run, `cwd` worktree'а и его подкаталога, `deny` вне `write_scope`, событие в Run worktree'а, `post` без hint `run start`), SCN-ENF-057 (правка вложенного checkout'а без Run и под Run `review`), SCN-ENF-016 (ни у `cwd`, ни у процесса нет проекта); `app/commands/guard-frontend.test.ts` — SCN-ENF-056 через адаптер `claude`. SCN-ENF-011…016, 026, 027, 036, 041, 044 — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts guard`.

## 2. Версия (D3)

- [ ] 2.1 `package.json` — 0.10.1; `CHANGELOG.md` — `## 0.10.1`: guard судит Run и policy checkout'а `cwd` события; путь вложенного checkout'а — вне проекта.

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
