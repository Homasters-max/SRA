# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6: process-PR
инструментов аудита → Change `core-seams` (3e) → 4a (Run, guard, адаптер `claude`) → 4b (producers, `warrant ci`) →
slice в отдельном репозитории. Grilling нарезки закрыт 2026-09-25 (N1–N17), ADR-0034 и ADR-0035 приняты; `core-seams`
закрыт (spec #42, impl #43, архив — v0.4.3).

## Готовый запрос

```text
Шаг 3 — Change 4a (ADR-0034 п. 6; навыки openspec-propose → change-spec-pr, линза cli-contract): spec-PR с delta specs —
Run (`warrant://run/1`, `run start`), `guard` pre / post с портом (A-12), `guard_prefixes`, guard без Run → deny,
`validate --files`, `FRONTEND_HOOKS_INACTIVE`, `sync` → `.claude/settings.json` (управляемое подмножество) и
`AGENTS.md`, `hint` в ошибках (`cliError` получает `hint`, ADR-0034 п. 8) и `--dry-run`; реестр проверок `validate`
(A-9) — первой группой, адаптер `claude` — последней. Перед spec-PR — архитектурный аудит, если hygiene.js покажет
audit-stale (после core-seams вероятно). Прочитай: ADR-0034, ADR-0014, ADR-0017…0019, ADR-0022, строки 4a в
docs/backlog.md (A-9, A-12, BL-3, BL-5, BL-7, BL-9, BL-10, BL-13, BL-14, BL-20).
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
