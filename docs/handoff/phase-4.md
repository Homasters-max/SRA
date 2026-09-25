# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6: process-PR
инструментов аудита → Change `core-seams` (3e) → 4a (Run, guard, адаптер `claude`) → 4b (producers, `warrant ci`) →
slice в отдельном репозитории. Grilling нарезки закрыт 2026-09-25 (N1–N17), ADR-0034 и ADR-0035 приняты.

## Готовый запрос

```text
Шаг 2 — impl-PR Change core-seams (навык change-impl-pr; spec-PR — `gh pr list --state all --head spec/core-seams`;
раздача групп — change-coordinate). 8 групп tasks.md: 1 — bump 0.4.3, храповик ADR-0035 (packages, test_helpers),
диалект Ajv; 2 — A-15 WarrantConfig; 3 — A-16 pathMatcher, toProjectPaths; 4 — A-14 countingWaiverIds, waiver-state;
5 — A-17 cliError + A-8 findChangeDir; 6 — A-18 test/helpers/git.ts, write; 7 — BL-26 теги SCN; 8 — выход.
Решения по ходу — I-N с I-148. Прочитай: openspec/changes/core-seams/{proposal,design,tasks}.md, ADR-0035, ADR-0030.
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
