---
name: git-land
description: "Довести ветку до main — проверки, push, PR через файл, ожидание и разбор CI, merge по слову «merge #N», чистка после merge (worktree, ветки локально и на origin). Использовать, когда работа в ветке закоммичена и её нужно отправить, открыть PR, дождаться CI, слить, или когда maintainer пишет «merge #N», или просят «/git-land»."
argument-hint: "[pr | merge <N> | after <N>]"
---

# PR, CI, merge, после merge

Человек только решает — «merge #N» в чате; остальное навык делает сам ([ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 1, 5). Разбор красного CI — [ci.md](ci.md), ошибки git — [recovery.md](recovery.md). Коммиты — навык `git-start`; три PR Change — навыки `change-*`, они зовут шаги этого.

## Вход

- `pr` — ветка с коммитами в своём worktree (`git-start where`). `merge <N>` — только после «merge #N» maintainer'а в чате. `after <N>` — PR уже слит (в том числе руками в GitHub).

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
   Сразу после `gh pr create` — `no checks reported`: CI ещё не стартовал, подождать 20 с и повторить. `warrant / warrant` в impl-PR до коммита `VERIFYING` (`CHANGE_NOT_VERIFYING`) — штатно. Красное — [ci.md](ci.md), исправление — коммитом `git-start`, push, снова шаг 3. Зелёное — отчёт и «жду merge #N». «merge #N» пришло до конца CI — не ждать: шаг 4 с `--auto`.
4. **Merge** — только по «merge #N» в чате для этого N:
   ```bash
   gh pr merge <N> --merge --auto
   gh pr view <N> --json state,autoMergeRequest,mergeCommit
   ```
   `--auto` — GitHub сливает сам, когда пройдут обязательные проверки `main` (`test (…)` и `warrant / warrant`, защита ветки); CI не опрашивать. Уже зелёный PR сливается сразу. Красный CI снимает слияние не сам — `gh pr merge <N> --disable-auto`, затем шаг 3. Только `--merge`: без `--delete-branch` (удаляет ветку worktree), без `--squash` и `--rebase` (I-97). Классификатор заблокировал — дать эту команду maintainer'у одной строкой и ждать.
5. **После merge** — из основного checkout `D:\project\SRA`:
   ```bash
   git pull --ff-only
   git worktree remove ../SRA-<имя>
   git branch -d <ветка>
   git push origin --delete <ветка>
   ```
   Затем — следующий шаг потока (файл передачи) или цепочка `change-*`.

## Стоп

- Нет «merge #N» от maintainer'а в чате — не сливать; слово относится только к своему N.
- Тот же сбой CI после двух исправлений или нестабильный тест — стоп и отчёт ([ci.md](ci.md)); обход запрещён.
- `worktree remove` отказал (изменения в worktree) или `branch -d` — «not fully merged» — не `--force` и не `-D`: показать и спросить.

## Отчёт

`pr` — ссылка на PR, результат проверок шага 1, CI. `merge` — merge-коммит. `after` — что удалено, что дальше.
