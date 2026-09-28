---
name: group-stats
description: Координатору — записать статистику закрытой группы задач по транскрипту субагента (метрики поиска по коду и карточка координатора). Использовать, когда субагент закрыл группу и координатор фиксирует наблюдение ADR-0028 п. 5, или просят «/group-stats N».
argument-hint: "<номер группы>"
disable-model-invocation: true
---

# Статистика группы

Метрики поиска по коду из транскрипта субагента плюс карточка координатора (наблюдение [ADR-0028](../../../docs/adr/WARRANT-ADR-0028-graft-adoption.md) п. 5). Процесс — шаг 4 навыка [change-coordinate](../change-coordinate/SKILL.md).

## Вход

- `$ARGUMENTS` — номер группы `N`. Пусто — спросить и остановиться.
- Ветка `worktree/<change>`; отчёт субагента с разделами «Поиск по коду» и «Проверки».

## Шаги

1. `<change>` — из ветки:
   ```bash
   git branch --show-current
   ```
2. Карточка — по отчёту субагента:
   - `red_runs` — сколько раз проверки `group-done` (шаг 2) были красными до зелёного;
   - `helped` — `yes` / `partly` / `no`;
   - `misled` — `none`, или что именно `cs` ответил неверно и к какой ошибке это привело;
   - `notes` — неполные, но безвредные ответы; отказы хука, мешавшие работе; почему группа нетипична.
3. Запись:
   ```bash
   node scripts/dev/graft-metrics.js run --change <change> --group <N> --mode on --red-runs <k> --helped <…> --misled "<…>" --notes "<…>"
   ```
   Группу делили — каждую часть `--part k --agent <путь>`; перезапускали — последний завершённый, `--agent <путь>`.

## Стоп

- Ветка не `worktree/<change>` — спросить имя Change.
- Сомнение в `red_runs` или `misled` — спросить пользователя.
- `graft-metrics` отказал из-за нескольких транскриптов — выбрать `--part`/`--agent` вместе с пользователем.

## Отчёт

Одной строкой: `ingest.explore_bytes`, `tokens.total`, `tool_calls.total`, `tool_calls.blocked`, `graft`, `deviations` (число), `compliant`, `red_runs`. `misled` ≠ `none` — условие пересмотра ADR-0028: сообщить и предложить вопрос в бенчмарк (`scripts/dev/bench/code-search.json`). `compliant: false` — сообщить: агент не следовал навыку `code-search`. Файл записи — в `.git`, коммитить нечего.
