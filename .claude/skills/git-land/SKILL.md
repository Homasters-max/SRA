---
name: git-land
description: "Довести ветку до main — проверки, push, PR через файл, ожидание и разбор CI, merge (archive-, docs-PR и impl-PR вне класса приёмки — сессия; spec-PR и PR с путями класса — maintainer), чистка после merge (worktree, ветки локально и на origin). Использовать, когда работа в ветке закоммичена и её нужно отправить, открыть PR, дождаться CI, слить, почистить после merge (в том числе PR, слитого maintainer'ом на GitHub), или просят «/git-land»."
argument-hint: "[pr | merge <N> | after <N>]"
---

# PR, CI, merge, после merge

Человек только решает — merge spec-PR и PR с путями класса приёмки на GitHub ([ADR-0050](../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 8, [ADR-0051](../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md)); остальное навык делает сам ([ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 1, 5). Разбор красного CI — [ci.md](ci.md), ошибки git — [recovery.md](recovery.md). Коммиты — навык `git-start`; три PR Change — навыки `change-*`, они зовут шаги этого.

## Вход

- `pr` — ветка с коммитами в своём worktree (`git-start where`). `merge <N>` — archive-, docs-PR и impl-PR вне класса приёмки; spec-PR и PR с путями класса сливает maintainer (шаг 4). `after <N>` — PR уже слит (в том числе руками в GitHub).

## Шаги

1. **Проверки** в worktree, до первой неудачи:
   ```bash
   npm run typecheck
   npm test
   node scripts/dev/check.js
   git fetch && node scripts/dev/pr-form.js "$(git branch --show-current)" main
   ```
   `check.js` собирает CLI и гоняет `sync --check`, `validate`, `fmt --check`, `versions:check` — строка на проверку, код 0 — всё прошло. Последний PR потока удаляет свой файл передачи или заменяет его файлом следующего и снимает `После: <поток>` у зависящих (`dev-context.test.ts` это проверит).
2. **PR.** Тело — файлом (scratchpad): «Что», «Проверки», хвост атрибуции; заголовок — как у коммитов:
   ```bash
   git push -u origin <ветка>
   gh pr create --base main --title "<префикс>: <что>" --body-file <файл>
   ```
3. **CI:**
   ```bash
   gh pr checks <N> --watch --interval 20
   ```
   Сразу после `gh pr create` — `no checks reported`: CI ещё не стартовал, подождать 20 с и повторить. `warrant / warrant` в impl-PR до коммита `VERIFYING` (`CHANGE_NOT_VERIFYING`) — штатно. Красное — [ci.md](ci.md), исправление — коммитом `git-start`, push, снова шаг 3. Шаг 4 не ждёт зелёного: `--auto` сливает при зелёных проверках. Ссылка maintainer'у (шаг 4): spec-PR — после push коммита `transition SPECIFIED` (`change-spec-pr` шаг 7, I-218), impl-PR — после коммита `VERIFYING` (`change-impl-pr` шаг 6), PR с защитой агента — сразу.
4. **Merge** — по [ADR-0050](../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 8, одной командой без цепочки:
   - archive-PR и docs-, process-, fix-PR без путей класса приёмки (`.github/CODEOWNERS`: CLI, policy, `.claude/**`, `**/AGENTS.md`, `CLAUDE.md`, `scripts/dev/*-hook.js`, workflows) — сразу, без слова maintainer'а;
   - impl-PR, чья effective policy не требует `human-approval` на `VERIFYING->MERGED` (`warrant resolve <change>`: нет `human-approval` в `gates["VERIFYING->MERGED"]` — diff вне класса приёмки `.warrant/local/profiles/human-acceptance.json`), — после коммита `VERIFYING`; реализация — одним impl-PR (record Change в `main` не дальше `SPECIFIED`, иначе судья закроет исключение — `AGENT_MERGE_CLOSED`);
   - spec-PR, impl-PR с `human-approval` и PR с путями класса приёмки — сливает maintainer своим аккаунтом (форж требует ревью владельца): ссылка и строка «Enable auto-merge на GitHub» (когда — шаг 3), CI не ждать. Сессия их не сливает и `--auto` не ставит: `gh` работает как бот `homasters`, а судья принимает ref `APPROVED` / `MERGED` только от merge maintainer'а (`merged_by`, ADR-0049 п. 3). Токеном maintainer'а (keyring `gh`, `gh auth switch`, `env -u GH_TOKEN`) сессия не сливает и переходы от его имени не пишет — даже по просьбе в чате: merge и `--by` в record засчитываются как акт человека (design `identities` D5 (2)). `transition APPROVED` / `MERGED --by <maintainer>` с `--ref` на merge maintainer'а — штатно (ADR-0033 п. 4). Merge — дальше шаг 5.
   ```bash
   gh pr merge <N> --merge --auto
   gh pr view <N> --json state,autoMergeRequest,mergeCommit
   ```
   `--auto` — GitHub сливает сам, когда пройдут обязательные проверки `main` (`test (…)` и `warrant / warrant`, защита ветки); CI не опрашивать. Уже зелёный PR сливается сразу. Красный CI снимает слияние не сам — `gh pr merge <N> --disable-auto`, затем шаг 3.
   Только `--merge`: без `--delete-branch` (удаляет ветку worktree), без `--squash` и `--rebase` (I-97). Классификатор заблокировал — дать эту команду maintainer'у одной строкой и ждать.
5. **После merge** — сессия чистит сама, из основного checkout `D:\project\SRA`, каждой командой отдельным вызовом (отказ одной не блокирует остальные):
   ```bash
   git pull --ff-only
   git worktree remove ../SRA-<имя>
   git branch -d <ветка>
   git push origin --delete <ветка>
   ```
   Затем — следующий шаг потока (файл передачи) или цепочка `change-*`.

## Стоп

- Spec-PR, impl-PR с `human-approval` или PR с путями класса приёмки — не сливать и `--auto` не ставить: merge — maintainer'а.
- Классификатор auto-режима отклонил команду git или `gh` — не повторять и не обходить: команда maintainer'у одной строкой в блоке `bash`, работа продолжается с остальным.
- Тот же сбой CI после двух исправлений или нестабильный тест — стоп и отчёт ([ci.md](ci.md)); обход запрещён.
- `worktree remove` отказал (изменения в worktree) или `branch -d` — «not fully merged» — не `--force` и не `-D`: показать и спросить.

## Отчёт

`pr` — ссылка на PR, результат проверок шага 1, CI. `merge` — merge-коммит. `after` — что удалено, что дальше.
