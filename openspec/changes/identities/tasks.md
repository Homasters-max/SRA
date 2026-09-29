# Tasks

После группы должны быть зелёными: `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`). Коммит — один на группу, в `worktree/identities`.

## 1. Идентичность агента (D1, D2)

- [ ] 1.1 `.warrant/warrant.json`: `identities.agents` — `homasters`, `kind: "machine-user"`, `description`; `warrant fmt`.

  Проверка: `node scripts/dev/check.js`; `node packages/cli/dist/bin/warrant.js validate` — без `CONFIG_INVALID`.
