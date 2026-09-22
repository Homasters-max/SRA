# Архив: исходные черновики (2026-09-22)

**Superseded.** Эти документы заменены новой структурой [docs/](../../00-readme.md) и не являются нормативными.
Хранятся для истории и проверки полноты переноса.

| Файл | Заменён |
|---|---|
| OpenSpec Integration & Specification Engineering.md | 01, 03, 04, 05, 06, 06a, 09, 10-*, 12, 13 |
| OpenSpec Methodology Extensions.md | 01, 04, 05, 08, 12 |
| OpenSpec Skills Architecture.md | 07, 11 (+ SRA) |

## Карта переноса

| Исходная тема | Куда |
|---|---|
| OpenSpec как kernel, границы ответственности, SSOT | 03, ADR-0001 |
| Lifecycle, Change ≠ Run, Git / worktree | 04, 03 §4 |
| Proposal, Specification, BDD, TDD, mutation | 13 §5, 10-pack-bdd-tdd |
| Adversarial review | 06 §7 |
| Glossary, ADR, C4 | 10-pack-arch |
| Brownfield | 10-pack-brownfield |
| Data process / contract / quality / migration / time semantics | 09-pack-data |
| Evidence model, manifest, context hash, versions | 06a |
| Verification matrix, traceability, IDs | 06 §6, 02 §3 |
| Unknowns, assumptions | 02 §1 |
| Change profiles, risk profile | 05 §2, §4 |
| Custom schema, config.yaml | 08 §8, ADR-0001 |
| Capabilities, guards, quality gates | 04 §6, 06 §3–4 |
| Constitution, где живут правила | 01 |
| Clarify, analyze, converge, controller | 04 §3–4, 06 §5 |
| Policy composition, priority | 05 §5 |
| Правило четырёх вопросов | 01 §3 (расширено до 7 шагов) |
| Skill contract, envelope, hierarchy, registry | 07, ADR-0002 |
| Конкретные skills (specification, domain, semantic, …) | SRA (вне WARRANT) |
| Mattpocock skills mapping | 07 §9 |
| Self-improvement, metrics, golden changes, OpenSpec upgrade | 12 |
| MVP, фазы, not-in-MVP | 13, ADR-0007 |

## Решения по блокам «рассмотреть!»

| Предложение | Решение | Где |
|---|---|---|
| YAML → JSON | Принято (кроме OpenSpec-файлов — генерируются) | ADR-0006, 08 §7–8 |
| Шаблоны | Список и фазы | 13 §5 |
| Skills mattpocock, c4, grilling | Кандидаты для SRA | 07 §9, 10-pack-arch §2 |
| Интеграция SEF / LATTICE / JEV | Каркас, deferred | 11 |
| Contract compatibility engine | Принято | 09 §4 |
| Controlled vocabulary статусов | Принято, расширено | 02 §2, ADR-0003 |
| Policy-as-code, policy tests | Принято | 12 §2 |
| Waiver lifecycle | Принято | 05 §7 |
| Rollback как тестируемый объект | Принято | 09 §7 |
| Схема profile, required / recommended / forbidden | Принято | 05 §3 |
| NOT_APPLICABLE | Принято, только по `applies_when` | 02 §2, 06 §3 |
| Конфликты overlays | Принято | 05 §5 |
| Policy compiler / EffectivePolicy | Принято | 05 §6 |
| factory-change | Принято | 12 §1 |
| Статусы WAIT / BLOCKED / WAIVED в skill result | **Отклонено**: skill не выносит verdict; только `run_state` | 07 §4, ADR-0003 |
| Раздельные массивы результата | Принято | 07 §4 |
| Authority skill | Принято | 07 §5 |
| Разделение implementation: operation vs skill | Принято | 04 §3 |
| Независимые review-режимы отдельными Run | Принято | 07 §6 |
| `specification/consistency` | Принято (SRA, L2) | 06 §5 |
| `semantic/evidence-reasoning` | Принято (SRA, L2) | 06a §4 |
| Версионирование skills, tools, аудит | Принято | 07 §6, §8 |
| Индексация LATTICE | Deferred | 11 |
| Factory memory, event log | Deferred | 12 §6 |
| Модель шести сущностей (Change, Run, Artifact, Policy, Evidence, RuntimeObservation) | Принято как основа | 03, 06a |
