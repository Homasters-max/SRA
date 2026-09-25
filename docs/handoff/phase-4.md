# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6: process-PR
инструментов аудита → Change `core-seams` (3e) → 4a (Run, guard, адаптер `claude`) → 4b (producers, `warrant ci`) →
slice в отдельном репозитории. Grilling нарезки закрыт 2026-09-25 (N1–N17), ADR-0034 и ADR-0035 приняты.

## Готовый запрос

```text
Шаг 2 — archive-PR Change core-seams (навык change-archive-pr; impl-PR — `gh pr list --state all --head
worktree/core-seams`), тег v0.4.3. Затем шаг 3 — Change 4a (ADR-0034 п. 6): spec-PR с delta specs (Run, guard,
validate --files, sync → .claude/settings.json и AGENTS.md, hint и --dry-run; адаптер claude последней группой);
реестр проверок validate (A-9) первой группой; линза cli-contract. Аудит перед spec-PR 4a — по hygiene.js
(audit-stale после core-seams вероятен).
```

## Открытые вопросы

нет

## Не забыть

- Sample-проект slice — отдельный репозиторий (`Homasters-max/warrant-slice`, Python + pytest), создаёт maintainer
  до slice (ADR-0034 п. 7).
- 4b: сдача результата `warrant-reviewer` — строкой `I-N` после зонда; `SubagentStop` последний ответ не даёт,
  кандидат — хук `PreToolUse` во frontmatter субагента, из Bash только `warrant run submit` (ADR-0034 п. 10).
- 4a: dev-скрипт `scripts/dev/probe-hooks.js` перезаписывает фикстуры родного входа Claude Code (ADR-0034 п. 2).
- Субагенты работают под `PreToolUse deny` (ADR-0031): отказ хука, мешавший законной работе, — в `notes` карточки
  группы и maintainer'у.
- Пока нет producer'ов (BL-2, до 4b), каждый Change получает пару waivers в spec-PR, срок 2026-12-31.
