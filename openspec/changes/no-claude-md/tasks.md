# Tasks

После группы должны быть зелёными: `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`, `npm run versions:check`. Тесты — по уровням (`test:unit`, `test:app`, `test:contract`, `test:e2e`; BL-37). Закрытие — `/group-done`. Коммит — один на группу, в `worktree/no-claude-md`.

Обозначения: §N — разделы design.md; D-N — решения §1.

## 1. sync без CLAUDE.md (D1–D3)

- [ ] 1.1 `core/sync/claude.ts`, `core/sync/plan.ts` (§2): снять `claudeMdTarget`, `CLAUDE_MD_REL`, параметр `agentsGenerated` у `subsetTargets`; `readAtSessionStart` без `CLAUDE.md`; комментарий `core/sync/subset.ts`.

  Проверка: `npm run typecheck`; `cs` — других потребителей `claudeMdTarget` и `CLAUDE_MD_REL` нет.
- [ ] 1.2 Тесты: app `sync-frontend` — SCN-KRN-132 (`CLAUDE.md` не создан; существующий не изменён байт в байт), `validate` без `CLAUDE.md` при сгенерированном `AGENTS.md` без ошибок; app `init` — SCN-KRN-154 без `CLAUDE.md`; unit `subset` — пример пути `.gitignore`.
- [ ] 1.3 Bump CLI `0.8.2`: `package.json`, `package-lock.json`, `kernel` в `warrant.lock.json` репозитория и golden-фикстур.

  Проверка: `npm run versions:check` зелёный; e2e golden (SCN-SDD-015) — только `kernel` в lock.
- [ ] 1.4 Документы: `README.md`, `docs/04-lifecycle.md` — строки `warrant sync` без `CLAUDE.md`; `docs/backlog.md` BL-20 — механизм без `CLAUDE.md`.

  Проверка: `grep -n "CLAUDE.md" README.md docs/04-lifecycle.md` — пусто.
