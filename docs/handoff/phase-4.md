# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6: `core-seams` закрыт
(v0.4.3) → Change `phase-4a` (Run, guard, адаптер `claude`) → 4b (producers, `warrant ci`) → slice в отдельном
репозитории. Аудит перед 4a — [2026-09-25-core-seams](../process/audits/2026-09-25-core-seams.md); spec 4a — решения
F1–F20 (design.md `phase-4a` §1).

## Готовый запрос

```text
Шаг 4 — impl-PR Change phase-4a (навыки change-impl-pr → change-coordinate → group-done → review-impl, линза
cli-contract). Условие: spec-PR phase-4a слит (SPECIFIED). Прочитай openspec/changes/phase-4a/ (proposal, specs
enforcement / kernel / verification, design — §1 решения F1–F20, tasks — 8 групп), ADR-0014, ADR-0017…0019, ADR-0022,
ADR-0034, аудит docs/process/audits/2026-09-25-core-seams.md (A-20…A-22). Ветка worktree/phase-4a: первым коммитом
transition APPROVED --ref <review spec-PR> --by <maintainer> и IMPLEMENTING; группы 1–8 по одной (субагенты — навык
change-coordinate); адаптер claude — группа 8, зонд probe-hooks.js в ней требует maintainer'а (сценарий в Claude Code);
последним коммитом — VERIFYING, затем review-impl, CI, merge по слову maintainer'а.
```

## Открытые вопросы

нет

## Не забыть

- Задача 8.2: зонд проверяет, доходит ли `additionalContext` `PreToolUse` при `allow` до модели и как Claude Code якорит
  пути `permissions.deny` — итог строкой `I-N` (design §7).
- Sample-проект slice — отдельный репозиторий (`Homasters-max/warrant-slice`, Python + pytest), создаёт maintainer до slice.
- 4b: сдача результата `warrant-reviewer` — строкой `I-N` после зонда; кандидат — хук `PreToolUse` во frontmatter
  субагента, из Bash только `warrant run submit` (ADR-0034 п. 10).
- Субагенты работают под `PreToolUse deny` (ADR-0031): отказ хука, мешавший законной работе, — в `notes` карточки
  группы и maintainer'у.
- Пока нет producer'ов (BL-2, до 4b), каждый Change получает пару waivers в spec-PR, срок 2026-12-31.
