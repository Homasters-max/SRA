# Design: no-claude-md

## Context

База — `main` на `v0.8.1`. Архитектурный вход — снимок аудита [2026-09-26-phase-4c](../../../docs/process/audits/2026-09-26-phase-4c.md): Change не фаза roadmap, модулей и связей не добавляет, только снимает цель внутри `core/sync`.

Что уже есть:
- `claudeMdTarget` (`core/sync/claude.ts`) — `linesTarget("CLAUDE.md", ["@AGENTS.md"])`; `subsetTargets` (`core/sync/plan.ts`) добавляет его при `frontends ∋ claude` и сгенерированном `AGENTS.md`. Та же цель — источник проверки `validate` (управляемое подмножество, `GENERATED_DRIFT`).
- `readAtSessionStart` (`core/sync/claude.ts`) — список файлов для `FRONTEND_RESTART_REQUIRED`, в нём `CLAUDE_MD_REL` (I-200 `lattice-fixes`).
- `linesTarget` (`core/sync/subset.ts`) остаётся: им держится `.gitignore`.

Нормы: REQ-KRN-033; ADR-0022 п. 2, 5 (`AGENTS.md`), ADR-0034 п. 3 (управляемое подмножество), ADR-0025, ADR-0030.

Ограничения: kernel-схемы и pack `core-sdd` не меняются; после группы зелёные `warrant validate`, `fmt --check`, `sync --check`, `versions:check`.

## Goals / Non-Goals

**Goals:**
- `sync`, `init` и `validate` не знают о `CLAUDE.md`: пользователь удаляет файл — ничего не возвращается и не дрейфует;
- правила доставляются одним `AGENTS.md`.

**Non-Goals:** — proposal, раздел Non-Goals.

## Decisions

### 1. Решения

| # | Решение |
|---|---|
| D1 | `CLAUDE.md` вне управляемых файлов: Claude Code читает `AGENTS.md` сам (maintainer, 2026-09-28) |
| D2 | Прежнюю строку `@AGENTS.md` не удалять: файл пользователя; миграция не нужна — внешних пользователей нет |
| D3 | Одна группа: код, тесты, bump CLI `0.8.2`, документы |

### 2. Группа 1

- `core/sync/claude.ts`: удалить `claudeMdTarget` и `CLAUDE_MD_REL`; `readAtSessionStart` — `.claude/agents/**`, `.claude/settings.json`, `AGENTS.md`.
- `core/sync/plan.ts`: `subsetTargets` — `.gitignore` всегда, `.claude/settings.json` при `frontends ∋ claude`; параметр `agentsGenerated` уходит.
- Тесты: SCN-KRN-132 — `CLAUDE.md` не создан, существующий не изменён (байт в байт); SCN-KRN-134 — без изменений; SCN-KRN-154 — находки без `CLAUDE.md`; `validate` без `CLAUDE.md` при сгенерированном `AGENTS.md` — без ошибок.
- Bump CLI `0.8.2`: `package.json`, `package-lock.json`, `kernel` в `warrant.lock.json` репозитория и golden-фикстур.
- Документы: `README.md` и `docs/04-lifecycle.md` — строки `warrant sync` без `CLAUDE.md`; `backlog.md` BL-20 — механизм без `CLAUDE.md`.

### 3. Dogfooding

В репозитории WARRANT `frontends` не включён, `CLAUDE.md` уже нет (PR #87) — `sync --check` не меняется.

## Risks / Trade-offs

- [Проект со своим `CLAUDE.md` и без строки `@AGENTS.md`] → правила приходят через `AGENTS.md`, который Claude Code читает сам (D1); если конкретная версия Claude Code его не прочтёт — строку пользователь добавит сам, `sync` ей не мешает.
- [Сгенерированный ранее `CLAUDE.md` из одной строки остаётся в проекте] → безвреден; удалить может пользователь, `sync` не вернёт.

## Migration Plan

1. **Spec-PR:** артефакты, record, `classify`, review субагентом; `transition SPECIFIED` по «merge #N».
2. **Impl-PR:** первым коммитом `APPROVED --ref <URL spec-PR> --by` и `IMPLEMENTING`; группа 1; последним — `VERIFYING`. Вердикт — job `warrant`.
3. **Archive-PR:** `warrant ci fetch <impl-PR>`, `transition MERGED --ref <URL impl-PR>`, `warrant archive no-claude-md`, тег `v0.8.2`.
4. **Откат:** `git revert`; схемы не менялись.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
