# Тёмная фабрика: человек до запуска — индекс черновиков (2026-09-29)

Цель, сформулированная maintainer'ом 2026-09-29: **human starts a Change; machine owns the lifecycle until terminal outcome.** Вход — одобренная spec и tasks, выход — PASS или FAIL с полным отчётом; FAIL — тоже конечный результат. Решения Q1–Q7 приняты в grilling того же дня и меняют ADR-0049 (человек между стадиями). Черновики — вход ADR-0050, не норма.

## Уже решено (не гриллить)

- [01-accepted](01-accepted.md) — Q1–Q7 с поправками maintainer'а к Q4 (FAIL `spec` только при изменении утверждённой spec) и Q6 (ревью — advisory, не доказательство), порядок работ.

## Файлы

- [01-accepted](01-accepted.md) — решения Q1–Q7, Q8 (граница WARRANT и фабрики), порядок работ.
- [02-scheme-v2](02-scheme-v2.md) — схема фабрики v2 (этапы 1–8, контур управления, LATTICE, матрицы), перенесена из inbox; писалась до Q1–Q7.
- [03-open](03-open.md) — перестройка схемы, состояние Change `identities`, бот и разрешения, открытые решения, 3 малых вопроса.

## Порядок grilling

1. Q8 «Граница WARRANT и фабрики» ([01-accepted](01-accepted.md)): принцип принят maintainer'ом, раскладка — рекомендация агента, подтвердить первой.
2. Три малых вопроса [03-open](03-open.md) (`ready`, хранение advisory-ревью, формат отчёта) — можно принять рекомендациями при записи ADR-0050.

## Сквозные вопросы

- WARRANT — отдельный проект, компонент фабрики (Q8): ADR-0050 в WARRANT — только граница и обязательства судьи и policy; решения фабрики — `docs/process/dark-factory.md` (документ фабрики, переезжает в её проект), `docs/process/flow.md`. Папка удаляется PR с ADR-0050 (ADR-0033 п. 12).
- Поток — `stabilization` ([docs/handoff/stabilization.md](../../handoff/stabilization.md)).

## Проверенные факты (2026-09-29)

- `main` — `1941ef3` (PR #107), CLI 0.8.3, тег `v0.8.3`, канарейка на нём зелёная.
- Судья: ref `APPROVED` / `MERGED` — только merge члена `roles.maintainer` (`core/ci/refs.ts:129-146`, `core/roles.ts:42`).
- `gh` в Claude Code — бот `homasters` (`GH_TOKEN`, scopes `repo`, `workflow`), collaborator `write`.
- Spec-PR #106 (`identities`) зелёный, ждёт merge maintainer'а; правки impl — в `D:/project/SRA-identities`, не закоммичены.
