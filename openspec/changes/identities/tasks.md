# Tasks

После группы должны быть зелёными: `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`). Коммит — один на группу, в `worktree/identities`.

## 1. Идентичность агента (D1, D2)

- [x] 1.1 `.warrant/warrant.json`: `identities.agents` — `homasters`, `kind: "machine-user"`, `description`; `warrant fmt`.

  Проверка: `node scripts/dev/check.js`; `node packages/cli/dist/bin/warrant.js validate` — без `CONFIG_INVALID`; `gh api users/homasters --jq .login` — `homasters` (F-5).

## 2. Merge spec- и impl-PR — maintainer (D4)

- [x] 2.1 `.claude/skills/git-land/SKILL.md` шаг 4 и «Стоп», `.claude/skills/fast-mode/SKILL.md` шаг 4: spec-PR и impl-PR агент не сливает и `--auto` не ставит — ссылка maintainer'у, продолжение после merge; archive-PR и docs/process-PR без защиты агента — бот `--auto`.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts dev-context`.
