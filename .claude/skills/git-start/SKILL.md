---
name: git-start
description: Начать поток в своём worktree, проверить «где я» (ветка, worktree, ahead/behind) и закоммитить через файл сообщения — git разработки WARRANT по ADR-0033. Использовать, когда начинают новую работу или поток, перед любым коммитом, когда нужно понять, в какой ветке и worktree идёт работа, или просят «/git-start».
argument-hint: "[start <префикс>/<имя> | where | commit]"
---

# Старт, где я, коммит

Git разработки WARRANT — автоматический процесс ([ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md)):
всё обратимое делает сессия сама, без вопросов. Основной checkout `D:\project\SRA` — только `main`: коммит и смену
ветки там запрещает хук `git-hook.js` (п. 9). PR, CI, merge и чистка — навык `git-land`; ошибки — его
[recovery.md](../git-land/recovery.md).

## Вход

- `start <префикс>/<имя>` — префикс (п. 10): `spec/`, `worktree/`, `archive/` + Change (навыки `change-*`);
  `process/` — ADR и реализация процесса; `docs/` — только документы; `fix/` — исправление вне Change. Имя
  kebab-case; имя потока — последний сегмент ветки.
- `where` — перед любым коммитом и по просьбе; `commit` — закоммитить готовое. Пусто — `where`.

## Шаги

1. **Старт.** Нет ли потока с той же целью (ADR-0033 п. 3):
   ```bash
   node scripts/dev/brief.js
   ls docs/drafts/
   grep -n "поток" docs/backlog.md
   ```
   Поток в «Потоки по порядку» или черновик с той же целью — продолжить его, не открывать второй. Затем из основного
   checkout:
   ```bash
   git fetch --prune
   git worktree add ../SRA-<имя> -b <префикс>/<имя> origin/main
   cd ../SRA-<имя> && npm ci && npm run build
   ```
   Новый поток — файл передачи `docs/handoff/<имя>.md` (навык `handoff`); ждёт другой поток — строка
   `После: <поток>` под заголовком.
2. **Где я.** Все команды — в каталоге работы:
   ```bash
   git branch --show-current
   git rev-parse --show-toplevel
   git worktree list
   git status --short --branch
   ```
   `--show-toplevel` = этот каталог, и `git worktree list` показывает его именно с этой веткой; ветка — не `main`.
   Первая строка `status` — ahead/behind относительно origin; PR ветки — `gh pr view --json number,state,url`
   (нет PR — не ошибка).
3. **Коммит.** Шаг 2 — первым. Текст — в файл вне рабочего дерева (scratchpad сессии или
   `$(git rev-parse --git-dir)/COMMIT_MSG`; не `-m`: PowerShell портит `$` и переводы строк):
   ```text
   <change | префикс>: <что сделано>

   <тело — по необходимости>

   Co-Authored-By: <атрибуция сессии>
   ```
   Заголовок — `<change>: …` в ветках Change, `<префикс>: …` в остальных (CI `pr-form.js`, п. 10). Файлы — явными
   путями:
   ```bash
   git status --short
   git add <пути>
   git commit -F <файл>
   git log -1 --format='%h %s'
   ```

## Стоп

- Шаг 2: ветка не та, каталог не её worktree или это `main` — назвать, где что, и остановиться; коммит в чужую
  ветку исправляет [recovery.md](../git-land/recovery.md).
- В `git status` файлы не этой работы — спросить до `git add`.
- Поток с той же целью уже есть — продолжить его или спросить; второй не открывать.

## Отчёт

`start` — путь worktree, ветка, файл передачи. `where` — ветка, worktree, ahead/behind, PR. `commit` — hash и
заголовок. Push и PR — навык `git-land`.
