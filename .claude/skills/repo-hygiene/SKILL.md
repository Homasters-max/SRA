---
name: repo-hygiene
description: "Убрать лишнее в репозитории и worktree — слитые ветки и их worktree, остатки, битые ссылки, устаревшие снимок аудита и черновики, истекающие waivers, auto-memory; обратимое — само, остальное — hygiene-PR или одним вопросом. Использовать, когда brief.js показывает «Гигиена: N», перед spec-PR фазы roadmap, или просят «гигиена», «почисти», «/repo-hygiene»."
---

# Гигиена репозитория

Скрипт находит, навык исправляет ([ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 13). Обратимое —
без вопросов (п. 1); всё, что в git, — через hygiene-PR, merge которого и есть review; необратимое и решения
maintainer'а — одним вопросом на весь список. Имена и корень репозитория держит `structure.test.ts`, не этот навык.

## Вход

- Основной checkout `D:\project\SRA` на `main` (ветки и worktree удаляются из него). Ветки на origin — по последнему
  `fetch`, поэтому сначала он.

## Шаги

1. Находки:
   ```bash
   git fetch --prune
   node scripts/dev/hygiene.js
   ```
2. **Сам, без вопросов** (`auto`):
   - `merged-branch` — `git branch -d <ветка>`;
   - `merged-origin` — `git push origin --delete <ветка>` (одной командой на все);
   - `merged-worktree` — `git worktree remove <путь>`, затем ветка — как `merged-branch`;
   - `prunable-worktree` — `git worktree prune`;
   - `ignored-leftover` — удалить каталог (`rm -rf <путь>`), он в `.gitignore`.
3. **Через hygiene-PR** (`pr`) — навык `git-start start process/hygiene-<YYYY-MM-DD>`:
   - `broken-link` — исправить ссылку на существующий путь (файл переехал — новый путь; удалён — текст без ссылки);
     в ADR меняется только путь, не решение;
   - `audit-stale` — навык `architecture-audit` (снимок и отчёт в `docs/process/audits/`).
   Проверки и доставка — навык `git-land`; «merge #N» — maintainer.
4. **С подтверждением** (`confirm`) — один список, один ответ maintainer'а на весь список:
   - `merged-worktree-dirty` — показать `git -C <путь> status --short`; закоммитить или удалить — по ответу;
   - `waiver-expiring` — продлить (новый waiver, активация maintainer'ом) или закрыть producer'ом gate;
   - `stale-draft` — grilling (навык `grilling`) или удалить папку hygiene-PR;
   - `auto-memory` — сократить индекс, записи `type: project` — в ADR, backlog или удалить (ADR-0032 п. 9).
5. Повторить шаг 1: остались только пункты, ждущие ответа или merge hygiene-PR.

## Стоп

- `git branch -d` — «not fully merged», `worktree remove` отказал — не `-D` и не `--force`: пункт уходит в шаг 4.
- Неслитая ветка или чужой worktree — только в шаг 4, никогда в шаг 2.
- Находка непонятна или скрипт упал (код 2) — показать вывод и остановиться.

## Отчёт

Что удалено само; ссылка на hygiene-PR; список, ждущий ответа maintainer'а; итог повторного `hygiene.js`.
