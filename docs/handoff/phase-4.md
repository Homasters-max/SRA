# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, уточнённой
[ADR-0036](../adr/WARRANT-ADR-0036-phase-4b-producers.md): `phase-4a` закрыт (v0.5.0) → Change `phase-4b` (producers) →
Change `phase-4c` (CI) → slice в отдельном репозитории. Аудит перед 4b —
[2026-09-25-phase-4a](../process/audits/2026-09-25-phase-4a.md); spec 4b — решения N19–N28 (design.md `phase-4b` §1).

## Готовый запрос

```text
Impl-PR Change phase-4b (навыки change-impl-pr → change-coordinate → group-done → review-impl, линза cli-contract).
Условие: spec-PR phase-4b слит (SPECIFIED). Прочитай openspec/changes/phase-4b/ (proposal, specs enforcement / verification
/ kernel / core-sdd, design — §1 решения N19–N28, §2 швы, tasks — 7 групп), ADR-0036, ADR-0034 п. 10, ADR-0024, аудит
docs/process/audits/2026-09-25-phase-4a.md (A-19, A-23…A-27). Ветка worktree/phase-4b: первым коммитом transition APPROVED
--ref <review spec-PR> --by <maintainer> и IMPLEMENTING; группы 1–7 по одной (субагенты — навык change-coordinate); группа 1
— швы без правок ожидаемых значений; зонд 6.2 требует maintainer'а (сценарий с субагентом в Claude Code); последним
коммитом — VERIFYING, затем review-impl, CI, merge по слову maintainer'а.
```

## Открытые вопросы

нет

## Не забыть

- Задача 6.2: зонд — действует ли хук `PreToolUse` во frontmatter субагента на его `Bash` и доходит ли `deny`; итог —
  строкой `I-N` (ADR-0034 п. 10, design §6). Фикстуры — `test/contract/fixtures/claude/<версия>/`, `probe-hooks.js`.
- `analyze-clean` 4b судит собственный CLI в impl-PR без waiver'а (N28): находку `analyze phase-4b` чинить в `tasks.md`
  или тестах (задача 7.3).
- Приёмка 4b по dogfooding — spec-PR 4c первый без пары waivers: review субагентом до `transition SPECIFIED` (ADR-0036 п. 1).
- Sample-проект slice — `Homasters-max/warrant-slice` (Python + pytest), создаёт maintainer до slice.
- Субагенты под `PreToolUse deny` (ADR-0031): grep по `packages/` отклоняется и по JSON-фикстурам — в промпте
  разрешать инструмент Grep для не-кода.
