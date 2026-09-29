# Design: identities

## Context

База — `main` после `release-path` (CLI 0.8.3). Машинный пользователь `homasters` (id 52467145, имя профиля «WARRANT agent») — collaborator `Homasters-max/SRA`, `write`; `gh` в Claude Code авторизован его PAT (`gh api user` → `homasters`, scopes `repo`, `workflow`). Схема `config.1`: `identities.agents[]` — `login` (обязателен), `kind`, `description`. `warrant validate`: логин и в `identities.agents`, и в `roles` — `CONFIG_INVALID`.

Судья при непустом `identities.agents` базы (`core/ci/refs.ts:129-146`): `merged_by` ∈ роли одобрения, ∉ agents, ≠ автор PR; решение UNKNOWN — автор ∉ agents (`ci/decisions.ts`).

## Goals / Non-Goals

**Goals:** акт агента под своим аккаунтом не засчитывается как акт человека.

**Non-Goals:** — proposal.

## Decisions

### 1. Решения

| # | Решение |
|---|---|
| D1 | `kind: "machine-user"` — не `bot`: это аккаунт пользователя GitHub, не GitHub App (ADR-0049 п. 3) |
| D2 | Change действует с merge impl-PR: судья берёт policy из базы (ADR-0038). Сам impl-PR ещё судится без agents; archive-PR — уже с ними: ref `MERGED` — impl-PR, его сливает maintainer, автор — `homasters` |
| D3 | Git-автор коммитов агента — переменные `GIT_AUTHOR_*` / `GIT_COMMITTER_*` в `env` пользовательских настроек Claude Code (как `GH_TOKEN`), не `git config`: конфигурация worktree общая с основным checkout, и коммиты maintainer'а стали бы коммитами бота. Настраивает maintainer, вне репозитория |

### 2. Группа 1

- `.warrant/warrant.json`: `identities` после `roles`, `warrant fmt`, `warrant validate`.
