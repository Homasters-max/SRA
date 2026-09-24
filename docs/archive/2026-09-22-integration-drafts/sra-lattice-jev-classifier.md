**JEV стоит использовать в LATTICE-классификаторе, но не как часть самого классификатора**.
https://docs.typesafe.ai/introduction
Правильнее разделить роли:

```text
                 LATTICE
                    │
        ┌───────────┴───────────┐
        │                       │
   Classification          JEV knowledge
        │                       │
 root_kind                  concepts
 context                    terminology
 type                       definitions
 subtype                    semantic relations
 properties                 rules
        │                       │
        └───────────┬───────────┘
                    │
             classification
              proposal / aid
```

### Что я бы зафиксировал

**1. JEV не должен определять canonical classification.**

LATTICE должен иметь собственный минимальный механизм:

```text
root_kind
context
type
subtype
properties
state axes
```

Иначе получится скрытая зависимость:

```text
LATTICE → JEV → LATTICE
```

и фундамент перестанет быть независимым.

---

**2. JEV можно использовать как semantic classifier / knowledge source.**

Например, для объекта:

```text
platform/component/payment_gateway
```

JEV может помочь определить:

```text
candidate:
    root_kind = thing
    semantic concept = software component
    subtype = integration_component
```

Но результат:

```text
candidate classification
```

а не автоматически:

```text
canonical classification
```

Финальная запись проходит обычный LATTICE mutation pipeline:

```text
JEV
 ↓
candidate
 ↓
LATTICE validation
 ↓
invariants
 ↓
accept
 ↓
canonical classification
```

---

### 3. Особенно полезно использовать JEV на этапе discovery / reclassification

JEV может давать:

* терминологическое соответствие;
* candidate type/subtype;
* synonym/alias;
* semantic relation candidates;
* explanation/evidence;
* mapping legacy → new vocabulary.

То есть:

```text
LATTICE classifier
    = deterministic contract

JEV
    = semantic knowledge / proposal engine
```

---

### 4. Архитектурно я бы поставил JEV здесь

```text
                 ┌──────────────┐
                 │     JEV      │
                 │ knowledge    │
                 └──────┬───────┘
                        │ proposal
                        ▼
                 ┌──────────────┐
                 │  LATTICE     │
                 │ classifier   │
                 └──────┬───────┘
                        │
                 canonical object
                        │
                        ▼
                 ┌──────────────┐
                 │     SEF      │
                 └──────────────┘
```

Но зависимость должна быть **односторонней на уровне runtime-контрактов**:

```text
JEV → LATTICE classifier proposal
LATTICE → does not require JEV to validate its core invariants
```

То есть **LATTICE должен работать в полном объёме даже если JEV отключён**.

---
---
# Дополнение к LATTICE: JEV как ProposalSource

## 1. Роль JEV

JEV — **producer candidate classification**, не владелец canonical classification.

```
JEV → candidate classification → LATTICE validation → canonical
```

Это та же роль, что у LLM, human, legacy-importer, rules-engine. JEV — один из источников proposals.

---

## 2. Что JEV делает

| Делает | Не делает |
|---|---|
| Предлагает `root_kind`, `type`, `subtype` | Не пишет в canonical graph |
| Предлагает aliases, synonyms | Не мутирует LATTICE напрямую |
| Предлагает semantic relations | Не обходит validation |
| Объясняет предложение (`rationale`) | Не имеет authority |
| Читает snapshot LATTICE | Не читает «живые» данные |

---

## 3. Pipeline

```
JEV reads snapshot (lexicon_version, meta_version)
    ↓
JEV produces proposal
    ↓
Proposal stored in queue
    ↓
LATTICE validates against invariants
    ↓
Accept / Reject / Defer
    ↓
MutationEngine commits
    ↓
History records: proposed_by=jev-v1
```

---

## 4. Feedback loop

JEV читает LATTICE → предлагает → LATTICE принимает → JEV читает обновлённый LATTICE.

Это **не цикл**, а двусторонний поток. Закрывается явно:

```yaml
proposal:
  source: jev-v1
  based_on:
    lexicon_version: 17
    meta_version: 3
```

Если версия устарела — proposal помечается `stale` и не применяется.

---

## 5. Три уровня зависимости

| Уровень | Зависимость LATTICE от JEV |
|---|---|
| Core invariants | Не зависит |
| Validation | Не зависит |
| Classification workflow | Опционально зависит |

LATTICE **валидна без JEV**. Классификация **деградирует** без proposals, но остаётся работоспособной вручную.

---

## 6. ProposalSource contract

```yaml
proposal_source:
  id: jev-v1
  kind: classifier
  authority: none
  reads: [lexicon/@snapshot, meta/root_kind]
  writes: proposals_queue
  rationale: required
```

JEV регистрируется в `ProposalSourceRegistry` как одна запись. LLM, human, importer — другие записи.

---

## 7. Роль JEV в архитектуре SEF

JEV имеет **две роли**:

| Роль | Где | Статус |
|---|---|---|
| Runtime sensor (System One) | Reflex layer в SEF | Концепция, не реализован |
| Semantic advisor (offline) | ProposalSource для LATTICE | Новая роль, требует фиксации |

Обе роли независимы. LATTICE использует только вторую.

---

## 8. Запреты

- JEV **не** владеет canonical classification.
- JEV **не** мутирует LATTICE напрямую.
- JEV **не** имеет authority.
- JEV **не** входит в bootstrap primitives.
- LATTICE **не** зависит от JEV для валидности.
- Proposal без `based_on` version — не принимается.
- Proposal без `rationale` — не принимается.

---

## 9. Один принцип

> **JEV предлагает — LATTICE решает.**
> **JEV читает snapshot — LATTICE пишет canonical.**
> **JEV опционален — LATTICE самодостаточна.**
