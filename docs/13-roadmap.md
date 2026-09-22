---
id: WARRANT-DOC-13
title: Roadmap и открытые вопросы
status: informative
maturity: MVP
version: 0.1.0
---

# 13. Roadmap

## 1. MVP

MVP = **kernel + pack `core-sdd` + один vertical slice** (WARRANT-ADR-0007, уточнён [ADR-0013](adr/WARRANT-ADR-0013-mvp-refinement.md): sample-проект Python + pytest, slice ведёт агент под hooks, фаза 4 входит в MVP).

Vertical slice — одно реальное FEATURE-изменение, проведённое от intent до archive:

```text
OpenSpec + warrant-sdd schema + profile feature
→ spec с stable ID → tasks → worktree → tests → warrant verify
→ evidence manifest → CI merge gate → archive
```

После этого новые возможности добавляются **по фактическим failure modes**.

## 2. Фазы

| Фаза | Содержание | Критерий выхода |
|---|---|---|
| **0. Spikes** | см. §3 | Все spikes закрыты решением |
| **1. Kernel** | JSON Schemas контрактов, CLI: `init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status` | `warrant validate` работает на core-sdd |
| **2. core-sdd** | schema `warrant-sdd`, profiles, core gates и checks, templates, controller rules, risk | Golden `feature`, `chore`, `factory-change` — snapshot effective policy (`resolve --explain`, `status`); прогон gates — фаза 3 |
| **3. Verification** | `check`, `gate`, `analyze`, evidence manifest, CI integration | Vertical slice пройден |
| **4. Frontend** (MVP) | Claude Code: static deny, `warrant guard`, reviewer-subagent (ADR-0014) | Агент проходит slice; в `guard_events[]` нет обойдённых `deny` |
| **5. bdd-tdd, arch** | Gherkin/SCN, red-first, ADR, glossary, adversarial review | Снижение spec defects после implementation |
| **6. data** | Contracts, compatibility engine, migration, rollback | Golden: breaking-data-change |
| **7. Orchestration** | Вызов агентов через ACP / API, retry policy, context packs | Два frontends на одном CLI |
| **8. Runtime** | Runtime evidence, drift detection | Runtime observation → новый Change |
| **9. Integrations** | LATTICE, SEF, JEV, SRA | [11](11-integrations.md) заполнен |

## 3. Spikes (до MVP)

| Spike | Вопрос |
|---|---|
| S1 | ~~HTML-комментарии ID через `openspec validate` и archive~~ — **закрыт** на OpenSpec 1.13.1: проходят при размещении строго под заголовком с непустым телом ([ADR-0012 §7](adr/WARRANT-ADR-0012-id-allocation.md)) |
| S2 | ~~Устройство project-local schema и `config.yaml`, что генерирует `warrant sync`~~ — **закрыт** на OpenSpec 1.13.1: `config.yaml` = `schema` + `context` + `rules` + `operations`; schema — `openspec/schemas/<name>/{schema.yaml, templates/}`; `.openspec.yaml` — metadata Change, WARRANT читает `schema` и `skip_specs` ([ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md)) |
| S3 | ~~Хранение `classification` и `change_state`~~ — **закрыт**: `.warrant/changes/<change>.json` ([04 §9](04-lifecycle.md), ADR-0009). Остаток (metadata Change у OpenSpec) закрыт в ADR-0015: `.openspec.yaml`, читаются `schema` и `skip_specs` |
| S4 | ~~Язык и распространение CLI~~ — **закрыт**: TypeScript на Node, monorepo, `npm i -g <git-tag>` ([ADR-0013](adr/WARRANT-ADR-0013-mvp-refinement.md)) |
| S5 | ~~Claude Code hooks / permissions~~ — **закрыт**: static deny из `warrant sync` + hook `warrant guard`, reviewer как subagent ([ADR-0014](adr/WARRANT-ADR-0014-claude-code-enforcement.md)) |
| S6 | Принимает ли LATTICE внешние stable ID (`REQ-ING-001`) как identity, или выдаёт свои и нужен mapping. Формат ID фиксируется в фазе 1, поэтому вопрос — до MVP, а не в фазе 9. Proposed ответ: identity LATTICE = `<context>/<name>`, name = stable ID WARRANT без mapping ([integrations/06 D1](../lattice/docs/03-substrate-decisions.md)) |

## 4. Не входит в MVP

```text
distributed event bus · graph database · Kafka · complex workflow engine
multi-agent swarm · 10+ specialized agents · automatic architecture generation
automatic policy evolution · semantic memory platform · autonomous production deployment
```

## 5. Шаблоны к созданию

| Шаблон | Pack | Фаза |
|---|---|---|
| proposal, spec, design, tasks | core-sdd | 2 |
| waiver | core-sdd | later (по failure mode) |
| experiment (hypothesis / result / decision) | core-sdd | later (по failure mode) |
| ADR | arch | 5 |
| glossary entry | arch | 5 |
| data contract, migration plan | data | 6 |
| behavior baseline | brownfield | 5 |

Proposal отвечает только на: WHY, WHAT changes, WHAT is affected, WHAT is NOT changing.
Разделы: Problem · Goal · Changes · Non-Goals · Impact · Risks · Verification. Proposal MUST NOT превращаться в design.

## 6. Открытые вопросы

| #   | Вопрос                                          | Состояние                                                                                                                                                                           | Где                                                                              |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Q1  | Содержание интеграций LATTICE / SEF / SRA / JEV | **Форма закрыта** (pack + адаптер + два канала, единый proposal envelope). Содержание LATTICE, JEV, SRA — proposed; SEF — открыт: вызывает ли SEF `warrant` как CLI или ожидает API | [11](11-integrations.md), [integrations/](integrations/00-readme.md)             |
| Q2  | Соответствие маркеров осям LATTICE              | **Proposed**: правило проекции задано; ждёт подтверждения семантики `contested` и `derived` со стороны LATTICE                                                                      | [02 §1](02-vocabulary.md), [integrations/05](integrations/05-warrant-lattice.md) |
| Q3  | Хранение состояния Change (S3)                  | **Закрыт**: Change record, пишет только CLI                                                                                                                                         | [04 §9](04-lifecycle.md), ADR-0009                                               |
| Q4  | Pack `security`: состав overlay и threat review | **Состав определён** (later). Kernel-зависимость закрыта: overlay `match` по любому полю classification                                                                             | [10-pack-security](10-pack-security.md), [05 §4](05-policy.md)                   |
| Q5  | Подписание evidence, полученного вне CI         | **Закрыт для MVP**: attestation по месту производства; `signature` — later                                                                                                          | [06a §3](06a-evidence.md), ADR-0009                                              |

Q3 и Q5 — один вопрос с двух сторон: кто имеет право писать состояние. Ответ один: authoritative записи делают
CLI в CI и человек через PR; локальный CLI пишет черновики ([ADR-0009](adr/WARRANT-ADR-0009-change-record-attestation.md)).
