```
id: SRA-LATTICE-CONTRACT-ADDENDUM
parent: SRA-LATTICE-CONTRACT
status: normative
version: 0.1.0
```

## 1. Explicit ownership

```text
OpenSpec  = normative specification
SRA       = semantic reasoning and proposals
WARRANT   = governance, policy, gates and authorization
LATTICE   = canonical semantic substrate and mutation
Git       = implementation history
Evidence  = verification result and proof
```

SRA MUST NOT mutate canonical LATTICE state directly.

## 2. Canonical proposal flow

```text
LATTICE semantic read model
  → SRA reasoning
  → SRA proposal
  → WARRANT policy/authorization
  → LATTICE validation/mutation
  → Evidence
```

`LATTICE / governing layer` в основном документе следует заменить этой явной цепочкой.

## 3. Proposal contract

Каждый proposal MUST содержать:

```yaml
proposal:
  id: PROP-001

  source:
    system: sra
    capability: semantic
    mode: provenance
    version: 0.1.0

  target:
    object_id: OBJ-001
    expected_version: 3

  operation:
    type: reclassify
    patch: {}

  rationale: ...
  based_on:
    snapshot_id: SNAP-001
    context_hash: sha256:...
```

Proposal является предложением, а не mutation.

## 4. Proposal result

Governing layer MUST вернуть один результат:

```text
ACCEPTED
REJECTED
DEFERRED
CONFLICT
STALE
```

SRA не выносит эти решения самостоятельно.

## 5. Reasoning outcomes

SRA MAY вернуть:

```text
UNKNOWN
INCONCLUSIVE
CONFLICT
DECISION_REQUIRED
STALE
```

Значения различаются:

```text
UNKNOWN            = смысл или факт не установлен
INCONCLUSIVE       = evidence недостаточно
CONFLICT            = обнаружены несовместимые утверждения
DECISION_REQUIRED  = требуется нормативное решение
STALE              = использованный context устарел
```

## 6. Grounding and epistemic markers

Не смешивать:

```text
grounding:
  declared | derived | observed | inferred

epistemic/content marker:
  FACT | INFERENCE | ASSUMPTION | UNKNOWN | PROPOSAL | DECISION
```

`PROPOSAL` не является значением `grounding`.

Переходы:

```text
INFERENCE → FACT
  только при достаточном grounding

PROPOSAL → DECISION
  только через уполномоченного субъекта
```

## 7. Semantic element boundary

| Element | Own identity | Own history | Can be canonical target |
|---|---:|---:|---:|
| Object | Да | Да | Да |
| Edge | Обычно нет | Через object/edge provenance | Ограниченно |
| Attribute | Нет | Нет | Нет |
| Projection | Нет | Нет | Нет |
| Operational state | Нет | Runtime-only | Нет |

SRA MUST NOT превращать attribute, projection или operational state в LATTICE object без отдельного semantic justification.

## 8. Relevant history

SRA получает не всю историю LATTICE, а только history window, необходимую для текущего reasoning:

```yaml
history:
  scope: changes_affecting_target
  limit: 10
```

## 9. Consistency rule

При конфликте с более высоким контрактом применяется порядок:

```text
LATTICE invariants
  → WARRANT policy
  → SRA contract
  → SRA proposal
```

SRA proposal не может ослабить LATTICE invariant или WARRANT policy.

## 10. Non-duplication rule

Этот addendum не определяет:

```text
LATTICE storage
LATTICE mutation API
WARRANT gate catalog
OpenSpec lifecycle
Evidence schema
SRA skill registry
```

Эти вопросы остаются в соответствующих контрактах.

## Acceptance criterion

Контракт считается консистентным, если:

```text
SRA only reads and reasons;
WARRANT authorizes;
LATTICE validates and mutates;
Evidence records the result;
no layer silently changes another layer's authority.
```