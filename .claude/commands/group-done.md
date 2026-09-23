---
description: "Закрыть группу задач tasks.md: проверка ветки и worktree, прогон проверок, галочки, коммит"
argument-hint: "<номер группы>"
---

Закрыть группу `N` задач активного Change: проверить, где идёт работа, прогнать проверки репозитория, отметить задачи
группы в tasks.md и закоммитить.

Вход: `$ARGUMENTS` — номер группы `N` (целое). Пусто — спросить и остановиться.

**Шаги** (любая неудача — остановиться, показать вывод, ничего не отмечать и не коммитить)

1. **Ветка и worktree.**
   ```bash
   git branch --show-current
   git rev-parse --show-toplevel
   pwd
   git worktree list
   ```
   Ветка вида `worktree/<change>` → `<change>`; иначе — остановиться. `--show-toplevel` совпадает с текущим каталогом,
   и `git worktree list` показывает этот каталог именно с этой веткой; иначе — остановиться и назвать, в каком worktree
   находится ветка. Существует `openspec/changes/<change>/tasks.md` с заголовком `## N.`.

2. **Проверки — по порядку, до первой неудачи.**
   ```bash
   npm run typecheck
   npm test
   node packages/cli/dist/bin/warrant.js validate
   node packages/cli/dist/bin/warrant.js fmt --check
   node packages/cli/dist/bin/warrant.js sync --check
   npm run versions:check
   ```
   `npm test` собирает `dist`, поэтому идёт до команд `warrant`. Для JSON-вывода успех — `"ok": true` (у `sync --check`
   дополнительно `changed: []`) и код 0.

3. **Галочки.** В `openspec/changes/<change>/tasks.md` под `## N.` каждую строку `- [ ] N.<k>` заменить на
   `- [x] N.<k>`; другие группы не трогать. Показать строки, которые остались `- [ ]` в группе N (если есть, спросить,
   закрывать ли группу).

4. **Что входит в коммит.**
   ```bash
   git status --short
   ```
   Показать список. Файлы, не относящиеся к группе, — спросить до `git add`. Добавлять явными путями.

5. **Коммит через файл сообщения** (не `-m`: PowerShell портит `$` и переводы строк). Файл — вне рабочего дерева,
   например в каталоге scratchpad сессии или `$(git rev-parse --git-dir)/GROUP_DONE_MSG`:
   ```text
   <change>: group N — <кратко, что сделано по задачам группы>; I-<a>…I-<b>

   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   ```
   Хвост `; I-…` — номера строк, добавленных в design.md за группу (`git diff --cached` по design.md); нет — без хвоста.
   ```bash
   git commit -F <файл>
   git log -1 --format='%h %s'
   ```
   Не пушить. Итог: hash, subject, результаты шага 2 одной строкой каждый.
