---
name: group-done
description: Закрыть группу задач tasks.md активного Change — проверка ветки и worktree, прогон проверок репозитория, галочки, коммит. Использовать, когда задачи группы выполнены и её нужно закрыть коммитом, или просят «/group-done N».
argument-hint: "<номер группы>"
---

# Закрыть группу задач

Проверяет, где идёт работа, прогоняет проверки репозитория, отмечает задачи группы в tasks.md и коммитит. Правила —
[docs/process/rules.md](../../../docs/process/rules.md).

## Вход

- `$ARGUMENTS` — номер группы `N` (целое). Пусто — спросить и остановиться.
- Ветка `worktree/<change>` в своём worktree; `openspec/changes/<change>/tasks.md` с заголовком `## N.`.

## Шаги

1. Ветка и worktree — шаг «где я» навыка `git-start`; ветка `worktree/<change>` → `<change>`.
2. Проверки — по порядку, до первой неудачи:
   ```bash
   npm run typecheck
   npm test
   node packages/cli/dist/bin/warrant.js validate
   node packages/cli/dist/bin/warrant.js fmt --check
   node packages/cli/dist/bin/warrant.js sync --check
   npm run versions:check
   ```
   `npm test` собирает `dist` и идёт до команд `warrant`; без флагов раннера (ADR-0025 п. 8). Успех JSON-вывода —
   `"ok": true` (у `sync --check` ещё `changed: []`) и код 0.
3. Галочки: в tasks.md под `## N.` каждую `- [ ] N.<k>` → `- [x] N.<k>`; другие группы не трогать.
4. Состав коммита:
   ```bash
   git status --short
   ```
   Добавлять явными путями.
5. Коммит через файл сообщения вне рабочего дерева (scratchpad или `$(git rev-parse --git-dir)/GROUP_DONE_MSG`;
   не `-m`: PowerShell портит `$` и переводы строк):
   ```text
   <change>: group N — <что сделано по задачам группы>; I-<a>…I-<b>

   Co-Authored-By: <атрибуция сессии>
   ```
   Хвост `; I-…` — строки, добавленные в design.md за группу (`git diff --cached` по design.md); нет — без хвоста.
   ```bash
   git commit -F <файл>
   git log -1 --format='%h %s'
   ```

## Стоп

- Любая неудача шагов 1–2 — показать вывод; ничего не отмечать и не коммитить.
- Ветка не `worktree/<change>` или worktree не тот — назвать, где находится ветка, и остановиться.
- В группе N остались `- [ ]` после шага 3 — спросить, закрывать ли группу.
- В `git status` файлы не из группы — спросить до `git add`.

## Отчёт

Hash и subject коммита; результат каждой проверки шага 2 одной строкой. Не пушить.
