# Proposal: no-claude-md

## Why

`warrant sync` при `frontends ∋ claude` и сгенерированном `AGENTS.md` держит строку `@AGENTS.md` в `CLAUDE.md`: нет файла — создаёт (F7 `phase-4a`, REQ-KRN-033). Claude Code читает `AGENTS.md` сам, так что `CLAUDE.md` для доставки правил не нужен (maintainer, 2026-09-28). Хуже того, удалённый пользователем `CLAUDE.md` следующий `sync` создаёт заново, а `validate` без него даёт `GENERATED_DRIFT`. Репозиторий WARRANT переходит на `AGENTS.md` PR #87 — он сливается до impl-PR этого Change.

## What Changes

- `sync` и `init --frontend claude` не создают и не меняют `CLAUDE.md`; цель `claudeMdTarget` снимается с плана.
- `validate` и `sync --check` не сверяют `CLAUDE.md`: его отсутствие или отсутствие строки `@AGENTS.md` — не `GENERATED_DRIFT` (SCN-KRN-155).
- `FRONTEND_RESTART_REQUIRED` — без `CLAUDE.md`: `sync` его больше не пишет.
- Строку `@AGENTS.md`, записанную прежними версиями, `sync` не трогает: файл пользователя.
- **Версии:** CLI `0.8.1 → 0.8.2`; pack `core-sdd` без изменений.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `kernel`:
  - REQ-KRN-033 — без `CLAUDE.md`; SCN-KRN-132, SCN-KRN-154 — ожидания без `CLAUDE.md`; SCN-KRN-155 — `CLAUDE.md` вне сверки.

## Non-Goals

- **Удаление строки `@AGENTS.md` из `CLAUDE.md` проектов** — файл пользователя, `sync` его не трогает ни в какую сторону.
- **Рукописный корневой `AGENTS.md` репозитория против сгенерированного** (BL-20) — решается с BL-20: `sync` пишет `AGENTS.md` целиком из правил на `**`.
- **Другие frontend** (`codex`) — фаза 5.

## Impact

- `packages/cli/src`: `core/sync/claude.ts` (`claudeMdTarget`, `CLAUDE_MD_REL`, `readAtSessionStart`), `core/sync/plan.ts` (`subsetTargets`), `core/sync/subset.ts` (комментарий).
- `packages/cli/test`: app `sync-frontend` (SCN-KRN-132, SCN-KRN-134), app `init` (SCN-KRN-154), unit `subset` — пример пути.
- `package.json`, `package-lock.json` (версия), `warrant.lock.json` репозитория и golden-фикстур (`kernel`).
- `docs/`: `README.md` (строка `warrant sync`), `04-lifecycle.md` (строка `warrant sync`), `backlog.md` (BL-20); ADR-0034 п. 6 (4a, «`@AGENTS.md` в `CLAUDE.md`») и ADR-0032, «Последствия» («`CLAUDE.md` ссылается на сгенерированный `AGENTS.md`») — пометка «снято Change `no-claude-md`, D1»: решение maintainer'а 2026-09-28 заменяет эти утверждения.
- **BREAKING** (внешних пользователей нет, ADR-0013): проект, где `CLAUDE.md` создал только `sync`, после обновления сохраняет файл, но `sync` его больше не держит.
