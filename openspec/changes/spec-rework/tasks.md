# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/spec-rework`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. Переход назад (D1, D2)

- [x] 1.1 (REQ-VER-007) `core/record/lifecycle.ts`: `SPECIFIED->PROPOSED` в `BACKWARD_TRANSITIONS`, комментарий модуля; `commands/transition.ts` — `STATE_INVALID` при `APPROVED` в истории, сообщение о допустимых переходах; проверка мест, где ищется первый `PROPOSED` (`cs grep`).
- [x] 1.2 Тесты `app/commands/transition.test.ts`: SCN-VER-157 (переход без gates, evidence на месте, Run `specify` стартует; из `APPROVED` и после `IMPLEMENTING->SPECIFIED` — `STATE_INVALID`); `unit` `transitionKind`.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts transition lifecycle`.

## 2. Судья: вид PR и ref APPROVED (D2, D3)

- [x] 2.1 `core/ci/merge.ts` `locateMerge`: после переделки ref `APPROVED` — spec-PR последнего `SPECIFIED`, иначе `REF_NOT_VERIFIED` (`change`); `core/ci/record.ts` — переделка в видах `impl` и `archive` и после `APPROVED` — `chain`, abandon-PR может её нести, `unknownsRule` — по переходу `SPECIFIED` базы.
- [x] 2.2 Тесты `app/commands/ci.test.ts`: SCN-VER-158, SCN-VER-159; SCN-VER-073 и тесты ref `APPROVED` — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts ci.test`.

## 3. Документы

- [x] 3.1 `docs/04-lifecycle.md` §2 — переход `SPECIFIED → PROPOSED` до `APPROVED`; `CHANGELOG.md` — `## 0.10.1`.

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
