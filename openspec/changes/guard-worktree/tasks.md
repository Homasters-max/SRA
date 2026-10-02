# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/guard-worktree`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. Корень события и другой checkout (D1, D2)

- [x] 1.1 `core/guard/guard.ts`: `isCheckout(dir)` — `.warrant/warrant.json` и `.git`; `guardRoot(cwd, fallback)` — ближайший checkout от `cwd` вверх, иначе `fallback`; `guard` и `guardFrontend` разбирают вход, затем решают в `ctx` корня события (`at(root)`, по умолчанию `{ ...ctx, root }`) с абсолютным `cwd`; вход, который не разбирается, — в `ctx.root`, как сейчас.
- [x] 1.2 `core/guard/guard.ts`: путь другого checkout'а (`otherCheckout`) — вне проекта в `projectFiles`, `outsidePaths` и `inProject` для `cd` под Run `review`; запасной корень — подъём от каталога процесса; `core/guard/decide.ts`: при активном Run не `review` проекта события или того checkout'а правка такого пути — `deny` до policy, reason и hint без пути.
- [x] 1.3 `commands/guard.ts`, `bin/warrant.ts`: `at` — `productionCtx` корня события (адаптеры от него же).
- [x] 1.4 Тесты `app/commands/guard.test.ts`: SCN-ENF-056 (каталог процесса — проект без Run и каталог не под WARRANT), SCN-ENF-057, SCN-ENF-058, SCN-ENF-059, SCN-ENF-016 (вход не JSON); `app/commands/guard-frontend.test.ts`: SCN-ENF-056 через адаптер `claude`, SCN-ENF-021 (не-JSON в каталоге не под WARRANT). Проекты тестов — git-репозитории (`.git`). SCN-ENF-011…016, 026, 027, 036, 041, 044 — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts guard`.

## 2. Версия (D3)

- [x] 2.1 `package.json` — 0.10.1; `CHANGELOG.md` — `## 0.10.1`: guard судит Run и policy checkout'а `cwd` события; правка пути другого checkout'а под Run — `deny`.

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
