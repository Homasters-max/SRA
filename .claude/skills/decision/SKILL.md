---
name: decision
description: Записать решение по ходу реализации следующей строкой I-N в таблицу design.md активного Change. Использовать, когда в реализации принято отклонение или уточнение spec/design (после согласия maintainer'а) или просят «запиши решение», «/decision».
argument-hint: "<текст решения>"
---

# Решение → строка I-N

Дописывает строку `I-N` в таблицу «Решения по ходу реализации» design.md активного Change. Норма — pack `rules.design`
и [ADR-0032](../../../docs/adr/WARRANT-ADR-0032-dev-context.md) п. 1 (решения по Change — в его design.md).

## Вход

- `$ARGUMENTS` — текст решения. Пусто — спросить текст и остановиться.
- Ветка активного Change: `spec/<change>`, `worktree/<change>` или `archive/<change>`.

## Шаги

1. Активный Change — по ветке; пути — от корня (`git rev-parse --show-toplevel`):
   ```bash
   git branch --show-current
   ```
   Ветка вида `spec|worktree|archive/<change>` → `<change>`; существует `openspec/changes/<change>/design.md`.
2. Следующий номер — по всем design.md, включая архив:
   ```bash
   grep -ohE '^\| I-[0-9]+ ' openspec/changes/*/design.md openspec/changes/archive/*/design.md | grep -oE '[0-9]+' | sort -n | tail -1
   ```
   `N` = результат (нет строк — `0`), новый номер — `I-<N+1>`. Параллельная сессия в другом worktree могла занять
   номер: показать номер пользователю до записи.
3. Колонка «Где» — файлы/модули и задача tasks.md (например `core/gates/verdict.ts`, задача 2.2) — из текущей работы.
4. Дописать строку в конец таблицы `## Решения по ходу реализации`:
   ```markdown
   | I-<N+1> | <текст решения> | <где> |
   ```
   Только добавление: остальной текст design.md не трогать; `|` внутри текста — `\|`.
5. Проверить:
   ```bash
   node packages/cli/dist/bin/warrant.js validate
   ```

## Стоп

- Ветка не называет Change — сообщить ветку и спросить имя Change; не угадывать.
- Нет design.md или таблицы «Решения по ходу реализации» — сообщить и остановиться.
- «Где» неизвестно — спросить.
- Решение меняет норму (ADR, main spec) — это не I-N, а новый ADR: остановиться и сказать maintainer'у.

## Отчёт

`I-<N+1>`, Change, строка целиком, `ok` из `validate`. Не коммитить — коммит делает навык `group-done`.
