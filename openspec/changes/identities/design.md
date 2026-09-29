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
| D3 | Git-автор коммитов агента — переменные `GIT_AUTHOR_*` / `GIT_COMMITTER_*` в `env` пользовательских настроек Claude Code (как `GH_TOKEN`), не `git config`: конфигурация worktree общая с основным checkout, и коммиты maintainer'а стали бы коммитами бота. Это и есть «git-автор бота в worktree агента» ADR-0049 п. 3: переменные действуют в каждом worktree, где работает агент, и только там. Настраивает maintainer, вне репозитория; судья авторство коммитов не проверяет |
| D4 | С `GH_TOKEN` бота `gh pr merge` агента записывает `merged_by: homasters`, а ref `APPROVED` / `MERGED` требует `merged_by` из роли одобрения (`refs.ts:136`) уже сейчас, до этого Change. Поэтому spec-PR и impl-PR агент не сливает и `--auto` на них не ставит: даёт maintainer'у ссылку, maintainer сливает своим аккаунтом (кнопка GitHub или `gh` в своём терминале), агент продолжает после merge. Навыки `git-land` (шаг 4), `fast-mode` (шаг 4) — группа 2. Archive-PR и docs/process-PR без защиты агента сливает бот. PR открывает бот (F-7): PR, открытый и слитый maintainer'ом, — self-merge (INV-03) |
| D5 | Остаточные риски — класс B модели угроз (06 §8: обнаружение, не предотвращение). (1) Бот может слить spec- или impl-PR: `write` и нет required reviews; судья отказывает ref в следующем PR. Восстановление — revert merge-коммита отдельным PR, который сливает maintainer, затем те же правки новым PR, слитым maintainer'ом. (2) Агент и maintainer — один пользователь ОС: токен maintainer'а в keyring `gh` и Git Credential Manager агенту достижим (`gh auth switch`); `GH_TOKEN` только перекрывает его. Оба — строки backlog (WS-04), не предмет этого Change |

### 2. Группа 1

- `.warrant/warrant.json`: `identities` после `roles`, `warrant fmt`, `warrant validate`; логин сверен с `gh api users/homasters --jq .login` (судья сравнивает логины точно, F-5).
- Проверка результата (F-6): вывод `warrant ci` archive-PR этого Change — ref `MERGED` impl-PR проверен с agents, без `SHARED_IDENTITY`.

### 3. Группа 2

- `.claude/skills/git-land/SKILL.md` шаг 4, `.claude/skills/fast-mode/SKILL.md` шаг 4 — D4.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-217 | Review 2 spec, F-1 (MAJOR): правило merge D4 — во всех навыках, где оно звучит, не только в шаге 4: `git-land` (описание, вход, шаги 3–4, «Стоп»), `fast-mode` (шаги 1, 4), `change-spec-pr` (шаги 5, 7, «Стоп»), `change-impl-pr` (шаги 6, 7, «Стоп»), `change-archive-pr` (описание, шаг 5, «Стоп»); ссылка нормы — ADR-0050 п. 8 | `.claude/skills/**`, задача 2.1 |
| I-218 | Review 2 spec, F-2 (MAJOR): maintainer сливает spec-PR только после push коммита `transition SPECIFIED` — слитый без него spec-PR не несёт перехода, ref `APPROVED` отказывает; агент делает `SPECIFIED` до просьбы слить | `change-spec-pr` шаги 5, 7, задача 2.1 |
| I-219 | Review 2 spec, F-3 (MAJOR): восстановление D5 (1) через revert не работает — судья отказывает укороченной записи Change; путь через lifecycle (`VERIFYING->IMPLEMENTING`, `ABANDONED --supersedes`) проверить до записи в норму — строка WS-32 | `docs/backlog.md` |
| I-220 | Review 2 spec, F-5 (MINOR): риск D5 (2) — не класс B (обнаружение), а граница доверия 06 §8: токен maintainer'а на машине агента судья не отличает — строка WS-33 | `docs/backlog.md` |
| I-221 | Review 2 spec, F-6 (MINOR): archive-PR сливает бот `--auto`, «merge #N» не ждёт | `change-archive-pr`, `git-land` шаг 4, задача 2.1 |
