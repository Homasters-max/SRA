---

id: SRA-LATTICE-CONTRACT
title: SRA–LATTICE Integration Contract
status: normative
version: 0.1.0
---

# SRA–LATTICE Integration Contract

## 1. Purpose

LATTICE — semantic substrate, который предоставляет SRA устойчивую семантическую картину проекта.

SRA использует LATTICE для:

* semantic context;
* identity;
* classification;
* relations;
* provenance;
* semantic history.

SRA **не является владельцем LATTICE** и не заменяет его canonical state.

---

## 2. Boundary

```text
LATTICE
  = canonical semantic substrate

SRA
  = semantic reasoning over that substrate

SRA may:
  READ
  REASON
  PROPOSE

SRA may not:
  MUTATE canonical LATTICE
  change LATTICE rules
  silently resolve semantic conflicts
  turn inference into fact
```

Основной принцип:

```text
LATTICE stores semantic state.
SRA reasons about semantic state.
```

---

## 3. What SRA needs from LATTICE

SRA должен иметь возможность получить для relevant context:

```text
Objects
Relations
Identity
Classification
Grounding
Provenance
Epistemic state
Relevant history
```

SRA не должен получать весь LATTICE по умолчанию.

Context определяется текущей задачей и должен быть минимальным достаточным subgraph.

```text
task
  ↓
relevant LATTICE subgraph
  ↓
SRA reasoning
```

---

## 4. Semantic object model

SRA должен различать как минимум:

```text
object
edge
attribute
projection
operational state
```

Для semantic object существенны:

```text
identity
context
classification
grounding
provenance
history
```

Дополнительные semantic axes используются только если они определены соответствующим LATTICE type.

SRA не должен предполагать, что каждый объект имеет одинаковый набор полей.

---

## 5. Identity

Stable identity является частью семантики объекта.

```text
stable identity ≠ file path
stable identity ≠ line number
stable identity ≠ content hash
stable identity ≠ Git commit
```

SRA может предложить:

```text
new object
reclassification
revision
merge
split
replacement
```

но не должен самостоятельно переиспользовать или изменять stable identity.

---

## 6. Grounding and epistemic state

SRA обязан различать:

```text
declared
derived
observed
inferred
```

и не смешивать grounding с epistemic state.

В частности:

```text
LLM inference
    ≠
declared fact
```

Если семантическое утверждение недостаточно подтверждено, SRA должен вернуть:

```text
UNKNOWN
INCONCLUSIVE
or
decision required
```

а не угадывать значение.

---

## 7. Relations

Relations являются частью семантики LATTICE.

SRA должен рассматривать relation как отдельный semantic statement:

```text
source
  --relation-->
target
```

Для relation важны:

```text
meaning
direction
role
cardinality
```

SRA не должен создавать новый relation type только потому, что существующий термин кажется неудобным.

Если существующая relation не покрывает требуемый смысл:

```text
proposal
→ review
→ LATTICE decision
```

---

## 8. Provenance

Любое существенное semantic assertion должно иметь достаточное основание.

SRA должен уметь различать:

```text
source fact
derived fact
observation
inference
proposal
```

При reasoning SRA должен сохранять ссылку на использованный semantic context.

Минимально:

```text
object identity
source/reference
context
```

Технические hashes, timestamps и execution metadata являются ответственностью integration/runtime layer, а не reasoning logic SRA.

---

## 9. Read model

SRA получает не raw storage, а semantic read model.

Пример:

```yaml
context:
  objects:
    - id: REQ-001
      classification: requirement
      grounding: declared

  relations:
    - source: TASK-001
      type: implements
      target: REQ-001
```

Конкретный storage format LATTICE не является частью этого контракта.

SRA должен зависеть от semantic contract, а не от database/storage implementation.

---

## 10. Proposal boundary

Когда reasoning приводит к изменению semantic state, SRA возвращает proposal.

Минимально proposal должен содержать:

```text
target
operation
expected identity/version
rationale
basis/context
```

Например:

```yaml
proposal:
  target: OBJ-001
  operation: reclassify
  expected_version: 3
  rationale: ...
  based_on:
    context_hash: sha256:...
```

Proposal является **предложением**, а не mutation.

---

## 11. Conflict handling

SRA MUST NOT silently resolve:

```text
identity conflict
classification conflict
relation conflict
provenance conflict
semantic contradiction
stale context
```

Допустимый результат:

```text
INCONCLUSIVE
UNKNOWN
CONFLICT
DECISION_REQUIRED
```

Если конфликт требует нормативного решения, SRA формулирует вопрос и необходимые варианты решения.

---

## 12. Canonicalization

SRA должен проверять, не создаёт ли proposal второй semantic canonical.

Перед предложением нового object / relation SRA должен учитывать:

```text
existing identity
existing classification
existing relations
existing canonical owner
```

Если информация уже существует:

```text
update / revise / reclassify
```

предпочтительнее создания duplicate object.

---

## 13. Non-goals

Этот contract намеренно **не определяет**:

* LATTICE storage;
* database schema;
* indexing implementation;
* projection implementation;
* mutation API;
* policy/gates;
* evidence format;
* OpenSpec lifecycle;
* WARRANT controller;
* SRA skill result envelope;
* конкретный mapping всех OpenSpec artifacts в LATTICE.

Эти вопросы принадлежат соответствующим системам и integration adapters.

---

## 14. Integration principle

```text
OpenSpec
  = normative specification

WARRANT
  = governance and enforcement

SRA
  = semantic reasoning

LATTICE
  = semantic substrate

Git
  = implementation history
```

Для SRA достаточно следующей границы:

```text
LATTICE
   │
   │ semantic read model
   ▼
  SRA
   │
   │ proposal
   ▼
LATTICE / governing layer
   │
   ▼
canonical semantic state
```

SRA не должен знать внутреннее устройство LATTICE больше, чем необходимо для выполнения semantic reasoning.

---
---

