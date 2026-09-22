---
id: SEF-INT-01
title: LATTICE — semantic contract для потребителей
status: proposed
maturity: deferred
version: 0.1.0
---

# 01. LATTICE — semantic contract

Что любой потребитель (SRA, WARRANT, JEV, SEF) MAY предполагать о LATTICE и чего MUST NOT делать.
Storage, API и schema базы намеренно не определяются (§11).

## 1. Назначение

LATTICE — **canonical semantic substrate**: устойчивая семантическая картина проекта.
Отвечает на вопрос «что это за объект и как он связан» ([ADR-0008](../adr/WARRANT-ADR-0008-naming.md)).

```text
LATTICE stores and validates semantic state.
Everyone else reads it and proposes changes to it.
```

## 2. Владение

| Слой | Владеет |
|---|---|
| OpenSpec | Нормативная спецификация (текст требований) |
| WARRANT | Policy, gates, authorization, evidence |
| SRA | Reasoning и proposals |
| LATTICE | Identity, classification, relations, grounding, provenance, history, мутация canonical state |
| Git | История реализации |

Потребитель MUST NOT: мутировать canonical state напрямую; менять правила LATTICE; молча разрешать семантические
конфликты; превращать inference в fact. Разрешено: READ, REASON, PROPOSE ([02](02-proposal-contract.md)).

## 3. Элементы

| Элемент | Своя identity | Своя history | Может быть canonical target |
|---|---|---|---|
| Object | да | да | да |
| Edge | обычно нет | через provenance object / edge | ограниченно |
| Attribute | нет | нет | нет |
| Projection | нет | нет | нет |
| Operational state | нет | runtime-only | нет |

Потребитель MUST NOT превращать attribute, projection или operational state в object без отдельного semantic justification.

**Тест на object.** Понятие становится object, только если на него можно: ссылаться по stable ID, отслеживать историю,
связывать relations, приписывать grounding и epistemic state. Если хотя бы одно «нет» — это не object.
Набор полей у объектов разный и определяется его type; потребитель MUST NOT предполагать единый набор.

## 4. Identity

```text
stable identity ≠ file path ≠ line number ≠ content hash ≠ git commit
```

- Identity объекта не меняется никогда; heading, путь и содержимое — label и provenance ([02 §3](../02-vocabulary.md)).
- Потребитель MAY предложить: new object, revision, reclassification, merge, split, replacement, retirement.
  Потребитель MUST NOT переиспользовать или переназначать identity сам.
- Identity = `<context>/<name>`, уникальность по паре `(context, name)`. Внешние stable ID (`REQ-ING-001`, `ADR-004`,
  `TERM-customer`) принимаются как `name` без mapping ([06 D1](../../lattice/docs/03-substrate-decisions.md)); spike S6 закрыт этим решением.

## 5. Classification

Собственный детерминированный минимум LATTICE, независимый от внешних источников (иначе `LATTICE → JEV → LATTICE`):

```text
root_kind · context · type · subtype · properties · state axes
```

Внешние источники (JEV, SRA, human) поставляют только **candidate classification**; canonical значение записывает
LATTICE после валидации ([04](04-jev-classifier.md)). LATTICE MUST быть валидной и полной без внешних классификаторов.

## 6. Оси объекта

Две независимые оси, которые MUST NOT смешиваться между собой и с маркерами высказываний WARRANT ([02 §1](../02-vocabulary.md)):

| Ось | Значения | Смысл |
|---|---|---|
| `grounding` | `declared`, `derived`, `observed`, `inferred` | На каком основании объект или утверждение существует |
| `epistemic_state` | `settled`, `contested`, `unresolved` | Согласовано ли это основание |

```json
{ "grounding": { "kind": "inferred", "source": { "actor": "llm", "run": "RUN-000417" } }, "epistemic_state": "unresolved" }
```

После подтверждения:

```json
{ "grounding": { "kind": "declared", "source": { "decision": "ADR-004" } }, "epistemic_state": "settled" }
```

- `PROPOSAL` не является значением `grounding`; proposal — это канал, не состояние.
- `inferred → declared | observed | derived` только через grounding-событие (decision, evidence, check). Соответствует INV-05.
- Check над артефактами в git — `derived`; runtime / data observation — `observed`. `contested` производно от открытого
  dispute record; вход `RecordDispute`, выход `RecordDecision` ([07 LD-S-07](../../lattice/docs/00-decision-register.md)).

## 7. Relations

Relation — самостоятельное semantic statement `source --relation--> target` с полями meaning, direction, role, cardinality.

- Потребитель MUST NOT вводить новый relation type потому, что существующий термин «неудобен». Путь: proposal → review → LATTICE decision.
- Relation type — часть словаря LATTICE, versioned вместе с ним (§9).

## 8. Provenance и history

- Каждое существенное утверждение MUST иметь основание: object identity, source / reference, context.
- Hashes, timestamps, run id, commit SHA вычисляет инфраструктура (адаптер, CLI, CI), не reasoning ([06a §3](../06a-evidence.md)).
- History записывает, кто предложил и кто принял: `proposed_by`, `accepted_by`, `based_on`.
- Потребитель получает не всю историю, а **history window**:

```json
{ "history": { "scope": "changes_affecting_target", "limit": 10 } }
```

## 9. Read model и snapshot

Потребитель получает **semantic read model**, а не raw storage, и только минимальный достаточный subgraph под задачу:

```json
{
  "$schema": "sef://lattice-read-model/1",
  "snapshot": { "graph_format": 1, "meta_version": 3, "registry_versions": { "platform": 12, "lexicon": 17, "spec": 1 }, "taken_at": "2026-09-22T10:00:00Z" },
  "objects": [
    { "id": "REQ-ING-001", "type": "requirement", "grounding": { "kind": "declared" }, "epistemic_state": "settled" },
    { "id": "TERM-customer", "type": "term", "grounding": { "kind": "declared" }, "epistemic_state": "contested" }
  ],
  "relations": [
    { "source": "TASK-ING-002", "type": "implements", "target": "REQ-ING-001" }
  ],
  "history": []
}
```

- Snapshot неизменяем; все proposals ссылаются на него (`based_on`, [02 §5](02-proposal-contract.md)).
- Snapshot — это набор версий, отдельного id нет: `graph_format`, `meta_version` (правила и инварианты),
  `registry_versions` по каждому context (types, roles). Изменение любой затронутой версии делает proposal `STALE`.
- Потребитель MUST зависеть от этого контракта, а не от storage.

## 10. Failure modes и security boundary

| Ситуация | Поведение |
|---|---|
| LATTICE недоступен | Потребитель работает без semantic read model; proposals ставятся в очередь; ничего не мутируется локально |
| Snapshot устарел | Proposal → `STALE`; потребитель перечитывает read model |
| Нарушен инвариант графа | Proposal → `REJECTED` с причиной; LATTICE не «чинит» proposal сам |

Наружу LATTICE отдаёт только semantic read model. Код, данные, секреты через LATTICE не проходят.
Кто и какой subgraph может читать — вопрос authorization WARRANT / SEF, не LATTICE.

## 11. Non-goals

Контракт не определяет: storage и schema базы; indexing и projection implementation; mutation API; policy и gates
(WARRANT); evidence format ([06a](../06a-evidence.md)); OpenSpec lifecycle; result envelope skills ([07](../07-skills.md));
полный mapping артефактов OpenSpec в объекты ([05 §1](05-warrant-lattice.md)).

## 12. Открытые вопросы

- Закрыты: I1 (§4), I2 (§6), registry источников — ведёт WARRANT ([02 §6](02-proposal-contract.md)). Полный реестр — [07](../../lattice/docs/00-decision-register.md).
