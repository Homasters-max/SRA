# Tasks

После группы должны быть зелёными: `npm run typecheck`, `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`). Тесты — `workflows.test.ts`; полный набор — CI impl-PR, он же проверяет shard. Закрытие — `/group-done`. Коммит — один на группу, в `worktree/ci-shards`.

Обозначения: §N — разделы design.md; D-N — решения §1.

## 1. Windows по shard (D1–D4)

- [x] 1.1 `.github/workflows/ci.yml` (§2): matrix с `shard`, имя проверки с shard, `npm test -- --shard`, typecheck и validate только вне shard `2/2`, комментарий заголовка.

  Проверка: CI impl-PR — `test (ubuntu-latest)`, `test (windows-latest, 1/2)`, `test (windows-latest, 2/2)` зелёные; сумма `Tests` двух shard = `Tests` ubuntu (D6).
- [x] 1.2 `packages/cli/test/unit/meta/workflows.test.ts`: SCN-VER-124.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts workflows`.
