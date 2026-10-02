---
id: LATTICE-DOC-00
title: LATTICE — реестр принятых решений
status: normative
maturity: later
version: 0.1.0
---

# 00. LATTICE — реестр принятых решений

Единый список решений по LATTICE, собранный из трёх источников: [substrate](01-object-substrate.md), [Q&A](02-architecture-qa.md) и [06-decisions](03-substrate-decisions.md). Назначение — не потерять решения при выделении LATTICE в отдельный проект и не уйти в сторону при реализации.

Правило: **реализация LATTICE MUST NOT противоречить строке со статусом `ACCEPTED`**. Изменение такой строки — только через architecture change procedure (substrate §61, Q&A §57) с новой версией этого реестра. `PROPOSED` — согласовано как направление, ждёт подтверждения реальным кейсом.

Нумерация `LD-<область>-<NN>` стабильна: строка не удаляется, а получает статус `SUPERSEDED` со ссылкой.

## 1. Граница и назначение

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-B-01 | LATTICE — инфраструктурный субстрат (как kernel), не сервис и не отдельный агент | ACCEPTED | Q&A §1 |
| LD-B-02 | Отвечает на: что существует, как классифицировано, как связано, откуда, как менялось. Не отвечает: как компилировать, исполнять, выбирать архитектуру, выводить бизнес-семантику | ACCEPTED | Q&A §36 |
| LD-B-03 | Candidate filter (I16): объект в LATTICE только если на него ссылаются, он в audit trail, участвует в decisions или имеет свою provenance/history. Иначе property, edge property или операционный артефакт | ACCEPTED | Q&A §00, substrate §44 |
| LD-B-04 | Domain-neutral: code intelligence, парсеры, LLM-семантика — adapters, не core | ACCEPTED | Q&A §35, §43 |
| LD-B-05 | Graph — projection, не knowledge SSOT; source остаётся SSOT; каждое поле graph имеет owner | ACCEPTED | substrate §1.6 |
| LD-B-06 | LATTICE проектируется параллельно с OpenSpec/WARRANT, внедряется через один vertical slice на объектах OpenSpec, не строится полностью заранее | ACCEPTED | substrate «Итог» |

## 2. Identity

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-I-01 | Identity = `<context>/<name>`, ровно два сегмента; уникальность по паре `(context, name)` | ACCEPTED | 06 D1, Q&A §22, §68 |
| LD-I-02 | Identity не содержит classification; `platform/component/dispatcher` — невалидный id | ACCEPTED | substrate §14.1 |
| LD-I-03 | `name` MAY нести конвенциональный префикс (`INV-4`, `REQ-ING-001`); lint MUST NOT выводить из него type | ACCEPTED | 06 D1 |
| LD-I-04 | Внешние stable ID (WARRANT, OpenSpec) принимаются как `name` без mapping | ACCEPTED | 06 D1 |
| LD-I-05 | `name` стабилен; `display_name` свободно изменяем; rename — отдельная операция `RenameObject`: identity-preserving либо new identity + lineage | ACCEPTED | Q&A §21 |
| LD-I-06 | Legacy addresses — aliases; alias резолвится ровно в одну identity; SEQ не входит в identity | ACCEPTED | substrate §14.3, §58 |
| LD-I-07 | Reclassification сохраняет identity; смена semantic identity = новый объект + `evolves_from` | ACCEPTED | substrate §14.4 |
| LD-I-08 | Provenance ≠ identity: commit, hash, path, line — не identity | ACCEPTED | substrate §1.5 |
| LD-I-09 | Один объект — один canonical owner-context; другие contexts имеют reference, projection, mapping | ACCEPTED | Q&A §23 |
| LD-I-10 | Физическое удаление canonical object запрещено; retirement через `currency`; delete только для технических артефактов, никогда не бывших semantic fact | ACCEPTED | Q&A §20 |

## 3. Bounded contexts

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-C-01 | Contexts: `kernel`, `lexicon`, `method`, `meta`, `platform`, `runtime`, `evidence`, `spec` — восемь | ACCEPTED | substrate §3, 06 §8.1 |
| LD-C-02 | `kernel` — shared kernel только для identity, alias, version, provenance/history refs; без classification и domain semantics | ACCEPTED | substrate §3.1 |
| LD-C-03 | `meta` — метаязык classification и правила registry; не владеет concrete types | ACCEPTED | substrate §6, §11.2 |
| LD-C-04 | `spec` — объекты продукта из OpenSpec (change, requirement, scenario, task, decision, data_contract); owner OpenSpec через WARRANT-адаптер; LATTICE не хранит текст требований | ACCEPTED | 06 §8.1 |
| LD-C-05 | Граница `spec`: target для `depends_on`, `tests`, `denotes`, `cites` снаружи; source только для `part_of` внутри и `cites → evidence`; никогда source `depends_on` наружу | ACCEPTED | 06 §8.1 |
| LD-C-06 | `experiment` не context; hypothesis/question → `lexicon`, spike → `method`, baseline/oracle/observation → `evidence`, attempt → `runtime` | ACCEPTED | substrate §10 |
| LD-C-07 | Новый context — только architecture decision с доказательством языка, ownership, invariants, lifecycle, cross-context mismatch | ACCEPTED | substrate §62, Q&A §57 |
| LD-C-08 | Contexts взаимодействуют через identity, explicit contract, translation/ACL; не читают поля друг друга напрямую | ACCEPTED | substrate §11.4, Q&A §7 |
| LD-C-09 | Context lifecycle: proposed / active / deprecated / retired; удаление только после freeze → migrate → aliases → verify | ACCEPTED | Q&A §56 |

## 4. Classification

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-K-01 | Три root kinds: `concept`, `thing`, `event`. State и binding — не root kinds | ACCEPTED | substrate §13 |
| LD-K-02 | `classification = { root_kind, type, subtype? }`; `properties` — отдельный top-level блок со схемой из type registry | ACCEPTED | 06 D6 |
| LD-K-03 | Concrete types владеет context (distributed type registry); `classify(context, object)`, не `meta.classify(anything)` | ACCEPTED | substrate §12, Q&A §24 |
| LD-K-04 | Одна canonical classification на revision; `types: []` запрещён; множественность — через properties, roles, relations | ACCEPTED | Q&A §25 |
| LD-K-05 | Subtype только при самостоятельном semantic meaning, машинном/нормативном использовании и невозможности выразить property | ACCEPTED | substrate §12.2 |
| LD-K-06 | Confidence не в canonical model; хранится только как classifier output / provenance | ACCEPTED | Q&A §26 |
| LD-K-07 | Classifier — чистая функция без side effects; commit только через explicit mutation | ACCEPTED | Q&A §42 |
| LD-K-08 | Неклассифицируемый объект получает `null` + classification GAP с owner, due, condition; фиктивные типы `GENERAL`/`MISC` запрещены | ACCEPTED | substrate §25, §60 |
| LD-K-09 | Type registry объявляет `required_axes` и схему `properties`; GAP создаётся только по требуемой оси | ACCEPTED | 06 D3, D6 |

## 5. Оси состояния

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-S-01 | Единого `status` нет; четыре независимые оси: `acceptance`, `currency`, `grounding`, `epistemic_state` | ACCEPTED | substrate §16 |
| LD-S-02 | `acceptance`: draft / proposed / accepted / rejected | ACCEPTED | substrate §17 |
| LD-S-03 | `currency`: active / deprecated / retired | ACCEPTED | substrate §18 |
| LD-S-04 | `grounding`: declared / derived / observed / inferred; `disputed` не значение grounding | ACCEPTED | substrate §19, §54 |
| LD-S-05 | `epistemic_state`: settled / contested / unresolved | ACCEPTED | substrate §20 |
| LD-S-06 | `rejected ⇒ currency := retired` — производное, не хранится; `deprecated` только для `accepted`, хранится | ACCEPTED | 06 D2 |
| LD-S-07 | `contested` производно от открытого dispute record (≥2 claims разных акторов, owner, due, condition); вход `RecordDispute`, выход `RecordDecision` или эскалация owner. `unresolved` — claims нет; `settled` — ни того ни другого | ACCEPTED | 06 §10.2 |
| LD-S-08 | Check над артефактами в git — `derived`; runtime / data observation — `observed`; spec, ADR, decision — `declared`; LLM — `inferred` | ACCEPTED | 06 §10.2, WARRANT 02 §1 |
| LD-S-09 | Оси mutable и историзируются; переходы не кодируются сменой identity | ACCEPTED | substrate §21 |
| LD-S-10 | Всё, что не `accepted`, и каждый GAP/dispute имеют owner, due, condition; квартальное ревью unresolved | ACCEPTED | Q&A §14 |

## 6. Relations

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-R-01 | Семь families: `part_of`, `denotes`, `cites`, `depends_on`, `evolves_from`, `tests`, `causes` | ACCEPTED | substrate §26 |
| LD-R-02 | Edge читается «source *verb* target»; canonical direction `test --tests--> target`; обратные (`contains`, `is_tested_by`) — projection | ACCEPTED | 06 D4 |
| LD-R-03 | Role — закрытый registry на family; расширение как новый type | ACCEPTED | Q&A §33 |
| LD-R-04 | Canonical edge key `(source, relation, target, canonical_role)`; дубликаты схлопываются; provenance не создаёт различия | ACCEPTED | Q&A §30–32 |
| LD-R-05 | Edge — не object; technical `edge_id` только для адресации/истории; relation object только при собственной identity и lifecycle | ACCEPTED | substrate §1.3, Q&A §30 |
| LD-R-06 | Temporal order — property edge/event, не relation | ACCEPTED | substrate §34 |
| LD-R-07 | Cross-context матрица — данные `meta/context-map.json`; всё вне матрицы — lint error; `kernel` и `meta` без instance edges | ACCEPTED | 06 D4 |
| LD-R-08 | Cross-context edge хранит source/target context и contract version при необходимости validation | ACCEPTED | Q&A §55 |
| LD-R-09 | Legacy `calls`, `implements`, `has-argument` — mapping в families через role по registry, не новые families | ACCEPTED | Q&A §34 |
| LD-R-10 | Новая family — только при доказательстве, что family + role не сохраняет семантику | ACCEPTED | substrate §35, §64 |

## 7. Provenance, REF, history

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-P-01 | Минимальная provenance: source, content_hash, git_commit, location | ACCEPTED | substrate §40 |
| LD-P-02 | REF — уникальная addressable source point; occurrences — provenance edge, не объекты | ACCEPTED | substrate §36–37 |
| LD-P-03 | SECTION: авторский number, anchor, path; искусственные ordinal ID запрещены; переупорядочивание — move | ACCEPTED | substrate §38 |
| LD-P-04 | Semantic version ≠ git; move и formatting версию не меняют; `semantic_hash` детерминирован и не включает commit, timestamp, line, block | ACCEPTED | substrate §40, Q&A §28–29 |
| LD-P-05 | History append-only; описывает semantic transition (old → new, operation, actor, provenance), не JSON diff | ACCEPTED | Q&A §46–47 |
| LD-P-06 | Не event-sourced: current state — operational truth, history — audit; `state = reduce(events)` не обязателен | ACCEPTED | Q&A §16 |
| LD-P-07 | `undo` нет; `RevertToRevision` — новая mutation в history | ACCEPTED | Q&A §47 |
| LD-P-08 | Раздельные версии: `object_version`, `graph_format`, `registry_version`, `migration_version`; универсального `version` нет | ACCEPTED | Q&A §48 |

## 8. Mutation и proposals

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-M-01 | Единый mutation engine: Command → Validate → Invariants → Apply → History → Projection → Lint; одна логическая транзакция, atomic write (temp → fsync → rename) | ACCEPTED | Q&A §17–18 |
| LD-M-02 | Optimistic concurrency по `expected_version`; расхождение → `CONFLICT`, не overwrite | ACCEPTED | Q&A §19 |
| LD-M-03 | Один примитив на механизм: `CreateObject`, `RenameObject`, `ReclassifyObject`, `UpdateProperties`, `RecordDecision`, `SetCurrency`, `SetEpistemics`, `AddEdge`, `RemoveEdge`, `RevertToRevision`. Composite (supersede, merge, split, group) — batch примитивов | ACCEPTED | 06 §8.2 |
| LD-M-04 | Каждая mutation имеет actor: human / agent / system / migration / importer; actor — provenance, не объект | ACCEPTED | Q&A §45 |
| LD-M-05 | Все внешние источники (SRA, JEV, WARRANT, human, importer) — proposals с `authority: none`; единый envelope | ACCEPTED | 02 |
| LD-M-06 | Pipeline: source → proposal → WARRANT authorization → LATTICE validation → mutation → history → evidence | ACCEPTED | 02 §3 |
| LD-M-07 | Результаты proposal: ACCEPTED / REJECTED / DEFERRED / CONFLICT / STALE; вне enum → REJECTED | ACCEPTED | 02 §5 |
| LD-M-08 | `based_on` = набор версий (graph_format, meta_version, registry_versions, targets); отдельного snapshot_id нет; входит в `context_hash` WARRANT | ACCEPTED | 06 §8.3 |
| LD-M-09 | Очередь proposals и registry источников — вне persistent core LATTICE, в `.warrant/`, запись только CLI | ACCEPTED | 06 §10.1 |
| LD-M-10 | Human override — обычная mutation с actor provenance; не обходит invariants | ACCEPTED | Q&A §44 |
| LD-M-11 | Overlay — first-class semantic input с owner, reason, provenance, history; не projection и не второй SSOT | ACCEPTED | Q&A §40–41 |

## 9. Storage, API, projections

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-T-01 | SSOT разделён по осям: identity registry, context-owned classification, canonical state, edge store, provenance, history; graph — собранная projection | ACCEPTED | Q&A §15 |
| LD-T-02 | Persistent core: objects, aliases, edges, provenance, history, registries; остальное rebuildable | ACCEPTED | Q&A §51 |
| LD-T-03 | JSON first с чистым repository boundary; PostgreSQL / Anchor Modeling — будущий backend, не core | ACCEPTED | Q&A §52–53 |
| LD-T-04 | Sharding по context — физическая оптимизация; semantic graph един; cross-context edges — отдельная physical projection | ACCEPTED | Q&A §54 |
| LD-T-05 | API отражает semantic operations, не storage; `write_node_json` наружу запрещён | ACCEPTED | Q&A §37 |
| LD-T-06 | Query DSL не вводится; lookup по id, alias, context/type, traversal, provenance, history | ACCEPTED | Q&A §38 |
| LD-T-07 | Projections rebuildable; double-build byte-identical; ручное редактирование запрещено | ACCEPTED | Q&A §39–40 |
| LD-T-08 | Registries и правила — JSON с `$schema`, не YAML | PROPOSED | 06 §8.4 |

## 10. Governance, invariants, lint

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-G-01 | Core invariants I1–I15 + I16 (candidate filter); частные checks ссылаются на них, список не растёт | ACCEPTED | Q&A §62, §00 |
| LD-G-02 | Precedence R0–R6; конфликт одного уровня → explicit GAP/decision, не guess | ACCEPTED | substrate §46 |
| LD-G-03 | Lint read-only: detect / report / classify; `--fix` только для projection artifacts; self-test в sandbox | ACCEPTED | Q&A §63 |
| LD-G-04 | Lint выводится из модели (одно правило на ось/инвариант); legacy lint — regression fixtures; disposition вычисляется на M10 | ACCEPTED | 06 D7 |
| LD-G-05 | Правило без executable test (positive, negative, boundary) не введено | ACCEPTED | Q&A §64 |
| LD-G-06 | CI разделён: semantic gate (freeze vocabulary при FAIL), quality gate, informational metrics | ACCEPTED | Q&A §61 |
| LD-G-07 | Health metrics с трендом (classification, vocabulary, provenance, migration, graph); тренд важнее count | ACCEPTED | substrate §49 |
| LD-G-08 | Failure criteria F1–F10 — сигнал остановки, не «доработка по ходу» | ACCEPTED | substrate §47 |
| LD-G-09 | Изменение invariants — versioned architecture migration; invariant registry versioned | ACCEPTED | Q&A §60 |
| LD-G-10 | Self-description минимальна: bootstrap primitives (identity, context, edge, history) — implementation contract; `meta/*` не образует мета-вселенную | ACCEPTED | Q&A §58–59 |
| LD-G-11 | Architecture Change Record для new relation family / context / root kind: why, cases, rejected alternatives, migration cost, owner | ACCEPTED | Q&A §65 |

## 11. Migration

| ID | Решение | Статус | Источник |
|---|---|---|---|
| LD-X-01 | Фазы M0–M10 с gate и abort criteria на каждой; compatibility period только после M1, M2, M6 | ACCEPTED | substrate §56, 06 D5 |
| LD-X-02 | Migration function детерминирована, versioned, idempotent, loss-aware; результат MIGRATED / MIGRATED_WITH_GAP / REJECTED_FOR_AMBIGUITY | ACCEPTED | substrate §24 |
| LD-X-03 | Правила для legacy status, включая open / disputed / unknown / reserved / deferred; GAP rate измеряется на выборке M0, пороги 0.9 / 0.2 / 0.5 | ACCEPTED | substrate §23, 06 D3 |
| LD-X-04 | Lossless = равенство legacy view на объявленном множестве полей минус список intentionally_dropped; status восстанавливается как множество кандидатов, различаемых lineage | ACCEPTED | 06 D5 |
| LD-X-05 | Silent fallback запрещён: unknown → GENERAL, missing → declared, legacy → accepted | ACCEPTED | substrate §60 |
| LD-X-06 | Compatibility: read legacy + read new, write new only | ACCEPTED | substrate §59, Q&A §50 |
| LD-X-07 | Schema migration LATTICE — отдельный механизм от domain object migration | ACCEPTED | Q&A §49 |

## 12. Открытые вопросы

| # | Вопрос | Владелец | Блокирует |
|---|---|---|---|
| I5 | Input envelope JEV и локальность запуска. Ограничение «snapshot read model, diff paths, proposal text» — **предлагаемое**, не доказанное | JEV | Security boundary [04 §7](../../docs/integrations/04-jev-classifier.md) |
| I6 | Runtime sensor JEV — отдельный контракт SEF↔JEV, не расширение LATTICE/WARRANT | SEF | Ничего в LATTICE |
| I7 | Текст legacy lint G-C11…G-C16 — только как fixtures в M10 | LATTICE | M10 |
| I8 | Факты фабрики (PATTERN, FAILURE, TRAP) — объекты LATTICE или `.warrant/` | WARRANT | 12 §6 |
| I9 | Glossary и ADR-индекс как projection LATTICE: кто пересобирает Markdown | WARRANT/arch | pack arch |

## 13. Выделение в отдельный проект

Рекомендация: **да**, LATTICE — отдельный репозиторий. Основания: LD-B-01 и LD-B-04 (domain-neutral субстрат), Q&A §12 (реализуется и тестируется изолированно), собственный lifecycle invariants (LD-G-09).

Что куда:

| Остаётся в SRA (интерфейс) | Уходит в LATTICE (реализация) |
|---|---|
| [01-lattice-contract](../../docs/integrations/01-lattice-contract.md) — что потребители вправе предполагать | substrate, Q&A, [06-decisions](03-substrate-decisions.md) — как устроено внутри |
| [02-proposal-contract](../../docs/integrations/02-proposal-contract.md) — канал proposals | этот реестр (копия; canonical — в LATTICE, здесь ссылка на версию) |
| [05-warrant-lattice](../../docs/integrations/05-warrant-lattice.md) — адаптер WARRANT | registries, lint, migration engine, storage |

Правило синхронизации: 01 и 02 версионируются semver; LATTICE объявляет, какую версию контракта реализует (`"contracts": { "lattice-contract": "^0.1", "proposal-contract": "^0.1" }`), WARRANT фиксирует её в lock pack `lattice`. Изменение контракта — `factory-change` с обеих сторон.

Структура репозитория LATTICE по образцу WARRANT: `docs/00-readme`, нумерованные kernel-документы по областям этого реестра (identity, contexts, classification, axes, relations, provenance, mutation, storage, governance, migration), `docs/adr/LATTICE-ADR-*`, `meta/*.json` как данные. Разработка самого LATTICE — через WARRANT с profile `factory-change`, как только у WARRANT есть MVP: это первый внешний dogfooding-проект.
