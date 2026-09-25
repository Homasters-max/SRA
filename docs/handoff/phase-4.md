# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, уточнённой
[ADR-0036](../adr/WARRANT-ADR-0036-phase-4b-producers.md): `core-seams` и `phase-4a` закрыты → Change `phase-4b`
(producers) → Change `phase-4c` (CI) → slice в отдельном репозитории.

## Готовый запрос

```text
Change phase-4b до spec-PR. Grilling нарезки проведён (N18–N26, ADR-0036), аудит — 2026-09-25-phase-4a (A-23…A-27).
Прочитай ADR-0036, ADR-0034 п. 10, ADR-0024, отчёт docs/process/audits/2026-09-25-phase-4a.md (§3, §3.4), 07 §4,
06 §3–5, архив openspec/changes/archive/2026-09-25-phase-4a/ (design — I-160…I-165), backlog: BL-2, BL-3, BL-13,
A-23…A-27. Навык openspec-propose: proposal, delta specs (verification — REQ-VER-003 и spec_tree, enforcement —
операция review и run submit, kernel — analyze, core-sdd — kernel-диапазон pack), design.md со строками N19, N20,
N22–N25 из ADR-0036, tasks.md (первая группа — A-24, A-23, A-25 + A-27, enums; CLI 0.6.0 первой задачей). Затем
навык change-spec-pr в ветке spec/phase-4b (пара waivers analyze-clean / adversarial-review ещё нужна).
```

## Открытые вопросы

нет

## Не забыть

- Сдача результата `warrant-reviewer` — строкой `I-N` в 4b после зонда (ADR-0034 п. 10): deny действует до
  `PreToolUse`, `additionalContext` `PreToolUse` доходит только после результата; кандидат — хук во frontmatter
  субагента, из Bash только `warrant run submit`. Фикстуры — `test/contract/fixtures/claude/<версия>/`, `probe-hooks.js`.
- CLI 0.6.0 не проходит `kernel` pack'ов `>=0.1 <0.6` — как I-156 `phase-4a`: pack `core-sdd` patch и 7 fixture-packs.
- Приёмка 4b по dogfooding — spec-PR 4c первый без пары waivers (ADR-0036 п. 1); провал — находка 4c.
- Sample-проект slice — `Homasters-max/warrant-slice` (Python + pytest), создаёт maintainer до slice.
- Субагенты под `PreToolUse deny` (ADR-0031): grep по `packages/` отклоняется и по JSON-фикстурам — в промпте
  разрешать инструмент Grep для не-кода.
