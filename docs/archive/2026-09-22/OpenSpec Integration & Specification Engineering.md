Да. Здесь я бы **не строил собственную SDD-систему поверх OpenSpec**. Правильнее сделать наоборот:

> **OpenSpec — готовый ядро управления спецификациями изменений.
> Dark Software Factory — orchestration / governance / verification layer вокруг OpenSpec.**

Это существенно упрощает фабрику и одновременно сохраняет возможность постепенно наращивать контроль.

Я изучил текущий OpenSpec, `intent-driven-template` и указанные материалы Intent-Driven Dev. Особенно полезны: custom schemas, Git discipline, BDD, adversarial authoring, glossary, ADR, brownfield-подход и разделение macro BDD / micro TDD. ([GitHub][1])
https://github.com/Fission-AI/OpenSpec/

найти хорошие скиллы! например:
https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md встроить в процесс
https://claudskills.com/skills/c4-diagram/SKILL.md доработать(убрать лишнее и добавить нужное) встроить в процесс, оценка для проекта:

| Критерий                               | Оценка |
| -------------------------------------- | ------ |
| Качество C4 guidance                   | 9/10   |
| Безопасность против выдуманных деталей | 9/10   |
| Structurizr DSL discipline             | 8.5/10 |
| Поддержка brownfield                   | 8/10   |
| Интеграция с ADR                       | 8.5/10 |
| Интеграция с OpenSpec                  | 6.5/10 |
| Интеграция с LATTICE                   | 5.5/10 |
| Data-platform coverage                 | 6.5/10 |
| Готовность как Dark Factory skill      | 7.5/10 |
| Ценность после адаптации               | 9/10   |
...
разработать инварианты, например:
SPEC-ADR-0001: Adopt OpenSpec as the canonical Specification Lifecycle Kernel

## OpenSpec Integration & Specification Engineering

**Status:** Proposed Architecture
**Purpose:** production-ready integration of OpenSpec into Dark Software Factory
**Principle:** use OpenSpec instead of rebuilding SDD
	
---

# 1. Главная идея



Dark Software Factory не должна реализовывать собственную альтернативу OpenSpec.

Она должна использовать OpenSpec как **движок управления изменениями и спецификациями**, а собственную логику сосредоточить вокруг него:

```text
                         HUMAN
                           │
                           ▼
                    ┌──────────────┐
                    │ DARK FACTORY │
                    │   CONTROL    │
                    └──────┬───────┘
                           │
                           ▼
                     ┌───────────┐
                     │ OpenSpec  │
                     │   SDD     │
                     └─────┬─────┘
                           │
          ┌────────────────┼────────────────┐
          ▼                ▼                ▼
       SPECIFICATION      DESIGN           TASKS
          │                │                │
          ▼                ▼                ▼
         BDD              ADR              TDD
          │                │                │
          └────────────────┼────────────────┘
                           ▼
                    IMPLEMENTATION
                           │
                           ▼
                    VERIFICATION
                           │
                           ▼
                         EVIDENCE
                           │
                           ▼
                         MERGE
                           │
                           ▼
                    RUNTIME / DATA
                           │
                           ▼
                      OBSERVATION
```

**OpenSpec отвечает за SDD lifecycle.**

**Dark Factory отвечает за то, чтобы этот lifecycle действительно был выполнен, проверен и не обходился агентом.**

---

# 2. Почему не нужно создавать собственный SDD Core

OpenSpec уже предоставляет:

* change-oriented workflow;
* proposal;
* specs;
* design;
* tasks;
* archive;
* validation;
* custom schemas;
* project configuration;
* skills / commands для AI coding tools;
* свободное движение между артефактами;
* version-controlled specifications.

OpenSpec специально позиционируется как лёгкий слой между намерением человека и AI coding agent, без тяжёлой фазовой модели. ([GitHub][1])

Особенно важно, что OpenSpec поддерживает **custom schemas**, которые находятся непосредственно в проекте и version-controlled вместе с кодом. Schema определяет набор артефактов и зависимости между ними. ([GitHub][2])

Следовательно:

### Не делать

```text
Dark Factory SDD Engine
    ├── собственный Proposal
    ├── собственный Spec
    ├── собственный Design
    ├── собственный Tasks
    ├── собственный Archive
    └── собственный workflow engine
```

### Делать

```text
Dark Factory
      │
      ├── OpenSpec
      │    ├── schemas
      │    ├── changes
      │    ├── specs
      │    └── archive
      │
      ├── Factory policies
      ├── Verification
      ├── Evidence
      ├── Data verification
      ├── Agent control
      └── Runtime observation
```

Это главный принцип всей архитектуры.

---

# 3. Граница ответственности

## 3.1 OpenSpec owns

OpenSpec является владельцем:

* Change;
* Proposal;
* Specification;
* Design;
* Tasks;
* spec deltas;
* archive lifecycle;
* schema workflow;
* project-level SDD context.

Текущий OpenSpec default workflow:

```text
proposal
    ↓
specs
    ↓
design
    ↓
tasks
```

Custom schemas позволяют менять этот pipeline без изменения самого OpenSpec. ([GitHub][2])

---

## 3.2 Dark Factory owns

Dark Factory добавляет:

* intake;
* change classification;
* risk classification;
* agent orchestration;
* context preparation;
* capability restrictions;
* worktree discipline;
* BDD/TDD enforcement;
* data-process verification;
* evidence collection;
* policy gates;
* adversarial review;
* mutation testing where appropriate;
* runtime conformance;
* metrics;
* factory memory;
* self-improvement.

При этом фабрика **не должна дублировать OpenSpec artifacts**.

---

# 4. Минимальная архитектура

Фабрика должна состоять из небольшого числа подсистем.

```text
                 DARK FACTORY
                       │
       ┌───────────────┼────────────────┐
       │               │                │
       ▼               ▼                ▼
   CHANGE CTRL     AGENT CTRL       VERIFY CTRL
       │               │                │
       └───────────────┼────────────────┘
                       │
                       ▼
                    OpenSpec
                       │
        ┌──────────────┼───────────────┐
        ▼              ▼               ▼
      Specs          Design           Tasks
        │              │               │
        └──────────────┼───────────────┘
                       ▼
                    Code/Data
                       │
                       ▼
                  Verification
                       │
                       ▼
                    Evidence
```

Не нужно вводить на первом этапе отдельные distributed event buses, graph databases, workflow engines, orchestration clusters и т.п.

---

# 5. OpenSpec как Specification Kernel

OpenSpec становится **Specification Kernel** фабрики.

Его основной объект:

```text
Change
```

Change является единицей работы.

Пример:

```text
openspec/changes/
    add-customer-search/
```

Внутри:

```text
proposal.md
specs/
design.md
tasks.md
```

Фабрика добавляет metadata и verification вокруг этого объекта, но не заменяет его.

---

# 6. Жизненный цикл Change

Базовый lifecycle:

```text
INTAKE
  ↓
EXPLORE
  ↓
PROPOSE
  ↓
SPECIFY
  ↓
REVIEW
  ↓
DESIGN
  ↓
ADR (если требуется)
  ↓
TASKS
  ↓
IMPLEMENT
  ↓
VERIFY
  ↓
EVIDENCE
  ↓
MERGE
  ↓
ARCHIVE
  ↓
OBSERVE
```

Но это **не жёсткий waterfall**.

OpenSpec специально допускает итеративное редактирование артефактов. Если design оказался неправильным, design должен быть исправлен, после чего implementation продолжается. ([GitHub][3])

Поэтому реальная модель:

```text
             ┌──────────────┐
             │    REVIEW    │
             └──────┬───────┘
                    │
             changes required
                    │
                    ▼
              SPEC / DESIGN
                    │
                    ▼
              IMPLEMENT
                    │
                    ▼
                VERIFY
                    │
             ┌──────┴──────┐
             │             │
           PASS           FAIL
             │             │
             ▼             ▼
          MERGE       FIX / REDESIGN
```

---

# 7. Change ≠ Run

Это важное дополнение Dark Factory.

OpenSpec Change:

```text
Change
```

не должен быть равен одной попытке агента.

Например:

```text
Change: add-customer-search

Run #1
  agent = model-A
  result = failed

Run #2
  agent = model-B
  result = failed

Run #3
  agent = model-A
  result = passed
```

Change остаётся один.

Factory Run — отдельная сущность:

```text
FactoryRun
├── change_id
├── agent
├── model
├── context_hash
├── policy_version
├── skill_version
├── worktree
├── start_time
├── end_time
├── result
└── evidence
```

Это позволяет анализировать качество самой фабрики.

---

# 8. Specification Stack

Спецификация должна быть многоуровневой, но не перегруженной.

Предлагается:

```text
Intent
  ↓
Proposal
  ↓
Specification
  ↓
BDD
  ↓
Design
  ↓
ADR
  ↓
Tasks
  ↓
Code
  ↓
Tests
```

Но не каждый Change требует всех уровней.

---

# 9. Proposal

Proposal отвечает только на:

```text
WHY?
WHAT changes?
WHAT is affected?
WHAT is explicitly NOT changing?
```

Минимальная структура:

```markdown
# Proposal

## Problem

## Goal

## Changes

## Non-Goals

## Impact

## Risks

## Verification
```

Proposal не должен превращаться в технический design.

---

# 10. Specification

Specification является главным описанием **ожидаемого поведения**.

Не:

> Add a CustomerService class.

А:

> When a customer searches by an exact identifier, the system returns the matching customer.

То есть specification описывает **observable behavior**, а не implementation.

---

# 11. BDD как macro verification

BDD следует использовать как мост:

```text
Specification
      ↓
Gherkin scenario
      ↓
Acceptance test
```

Например:

```gherkin
Feature: Customer search

Scenario: Search customer by exact identifier
  Given customer "C123" exists
  When the user searches for "C123"
  Then customer "C123" is returned
```

Это соответствует подходу Intent-Driven Dev: BDD фиксирует macro-level behavior и создаёт внешний feedback loop. ([intent-driven.dev][4])

---

# 12. TDD как micro verification

TDD не заменяет BDD.

Используем:

```text
SDD
 ↓
BDD
 ↓
TDD
```

### SDD

Определяет:

> Что система должна делать.

### BDD

Проверяет:

> Как это выглядит снаружи.

### TDD

Проверяет:

> Как маленькие внутренние компоненты выполняют контракт.

Intent-Driven Dev отдельно подчёркивает эту разницу: BDD задаёт macro constraints, а strict/mockist TDD — micro contracts и collaboration boundaries. ([intent-driven.dev][5])

---

# 13. TDD правило фабрики

Агент не должен получать инструкцию только:

> "Use TDD."

Это недостаточно.

Минимальный цикл:

```text
RED
 ↓
minimal implementation
 ↓
GREEN
 ↓
REFACTOR
 ↓
next behavior
```

Для каждого существенного поведения:

```text
failing test
    ↓
implementation
    ↓
passing test
    ↓
refactor
```

При этом фабрика проверяет не только наличие тестов.

Она проверяет:

* тест действительно падает до реализации;
* тест связан со specification;
* assertion meaningful;
* нет теста, который проверяет только implementation detail;
* implementation не содержит лишнего поведения.

---

# 14. Mutation Testing

Coverage нельзя считать достаточным доказательством.

Например:

```text
coverage = 98%
```

не означает:

```text
behavior protected = 98%
```

Mutation testing применяется как проверка силы тестов.

Но:

**не делать mutation testing обязательным для каждого изменения.**

Использовать risk-based policy:

```text
LOW
  ordinary tests

MEDIUM
  tests + selected mutation

HIGH
  tests + mutation + adversarial verification
```

Это сохраняет простоту фабрики.

---

# 15. Adversarial Specification Review

Одна из наиболее полезных идей `intent-driven-template`.

Схема:

```text
Author Agent
     │
     ▼
Draft
     │
     ▼
Reviewer Agent
     │
     ├── ambiguity
     ├── missing behavior
     ├── contradiction
     ├── over-specification
     └── hidden assumption
     │
     ▼
Revised Specification
```

Не нужно создавать "AI council" из 10 моделей.

Достаточно:

```text
Author
Reviewer
```

В материалах Intent-Driven Dev прямо рекомендуется ограничиваться двумя-тремя sub-agents, чтобы review не превращался в шум. ([intent-driven.dev][6])

---

# 16. Что именно должен искать adversarial reviewer

Reviewer проверяет:

### Ambiguity

```text
"quick response"
"appropriate error"
"normally"
"should support"
```

### Missing boundaries

```text
empty
null
duplicate
invalid
timeout
partial failure
concurrent request
retry
```

### Missing actors

```text
user
system
service
administrator
external source
```

### Missing error behavior

```text
What happens when dependency fails?
```

### Hidden assumptions

```text
Does the specification assume ordering?
Does it assume uniqueness?
Does it assume transactionality?
```

### Contradictions

```text
Spec A:
customer ID is unique

Spec B:
multiple customers may have same ID
```

### Implementation leakage

```text
"create a Redis cache"
```

если Redis не является частью business requirement.

---

# 17. Glossary

Glossary должен быть **маленьким и полезным**.

Он нужен там, где термин влияет на meaning.

Пример:

```yaml
customer:
  definition: A registered business customer.
  not_to_be_confused_with: account

account:
  definition: A billing relationship associated with a customer.
```

Glossary нужен прежде всего для предотвращения semantic drift между:

* человеком;
* агентом A;
* агентом B;
* будущим Change.

Именно эту проблему выделяет adversarial/glossary подход Intent-Driven Dev. ([intent-driven.dev][6])

---

# 18. Не делать глобальный огромный glossary

Нельзя превращать его в энциклопедию.

Правило:

> Если термин не влияет на решение или поведение — он не обязан находиться в glossary.

---

# 19. ADR

ADR нужен не для каждой задачи.

Создавать ADR только если появляется **durable architectural decision**.

Например:

```text
Use PostgreSQL as primary persistence layer.
```

или:

```text
Use event-driven integration instead of synchronous RPC.
```

Обычное:

```text
rename variable
add endpoint
add validation
```

ADR не требует.

---

# 20. Почему ADR должен сохраняться после Change

Это сильная идея из `spec-driven-with-adr`.

Обычный design описывает reasoning конкретного изменения.

После archive этот reasoning легко потерять.

ADR должен жить отдельно:

```text
architecture/
    adr/
        ADR-001-storage.md
        ADR-002-events.md
```

Таким образом:

```text
specs/
    = current functional behavior

ADR/
    = current architectural decisions
```

Это позволяет будущему Change учитывать уже принятые решения вместо повторного изобретения архитектуры. ([intent-driven.dev][7])

---

# 21. Brownfield

Для существующего проекта нельзя считать:

```text
code = specification
```

Код является evidence of current behavior, но не обязательно evidence of intended behavior.

Brownfield процесс:

```text
Existing code
     ↓
Discovery
     ↓
Current behavior
     ↓
Unknowns
     ↓
Human confirmation
     ↓
Baseline specification
     ↓
New change
```

AI не должен автоматически объявлять reverse-engineered specification истиной.

Intent-Driven Dev отдельно предупреждает, что AI-generated reverse-engineered specs могут не отражать исходный intent и скрытые особенности legacy behavior. ([intent-driven.dev][8])

---

# 22. Brownfield правило

Первый Change для legacy functionality:

```text
"describe / characterize current behavior"
```

а не:

```text
"refactor legacy subsystem"
```

Сначала фиксируется observable behavior.

После этого:

```text
Characterization
      ↓
Specification
      ↓
Tests
      ↓
Refactoring
```

---

# 23. Data Process Specification

Для data pipelines спецификация должна описывать **процесс и его контракт**, а не SQL.

Минимум:

```text
Trigger
Inputs
Outputs
Business semantics
Data constraints
Failure behavior
Recovery
Quality
Idempotency
Time semantics
```

---

# 24. Data specification example

```yaml
process: customer_import

trigger:
  type: scheduled
  frequency: daily

input:
  dataset: customer_source

output:
  dataset: customer

semantics:
  customer_id:
    required: true
    unique: true

quality:
  null_rate:
    customer_id: 0
  duplicate_rate:
    customer_id: 0

failure:
  invalid_records: quarantine
  source_unavailable: retry

recovery:
  idempotent: true
```

Но этот YAML не должен становиться вторым OpenSpec.

Если процесс является частью Change, его contract должен быть связан с соответствующим OpenSpec artifact.

---

# 25. Data Contract

Data Contract отвечает:

```text
What data enters?
What data leaves?
What does it mean?
What must always be true?
```

Минимальные элементы:

```text
Schema
Semantics
Keys
Nullability
Allowed values
Units
Time semantics
Freshness
Quality constraints
Compatibility
```

---

# 26. Data quality

Проверки делятся на уровни.

### Structural

```text
columns
types
nullability
schema
```

### Integrity

```text
unique keys
foreign keys
duplicates
referential integrity
```

### Semantic

```text
valid ranges
business rules
state transitions
```

### Temporal

```text
freshness
late arrival
event ordering
effective dates
```

### Reconciliation

```text
source count
target count
aggregates
checksums
```

---

# 27. Data process lifecycle

Каждый управляемый data process должен иметь состояние.

Минимальная модель:

```text
CREATED
  ↓
DISCOVERED
  ↓
VALIDATED
  ↓
EXECUTED
  ↓
COMMITTED
  ↓
PUBLISHED
```

Failure paths:

```text
FAILED
QUARANTINED
CANCELLED
ROLLED_BACK
SUPERSEDED
```

Однако эти состояния **не нужно дублировать в OpenSpec**.

OpenSpec отвечает за development change.

Data runtime отвечает за execution state.

---

# 28. Разделение Development и Runtime

Критически важно:

```text
OpenSpec Change
       │
       │ defines
       ▼
Data Process
       │
       │ executes
       ▼
Runtime
```

Не смешивать:

```text
"Change is complete"
```

и:

```text
"Pipeline execution succeeded"
```

Это разные факты.

---

# 29. Runtime evidence

После выполнения data process фабрика получает:

```text
Run
 ├── input version
 ├── output version
 ├── schema version
 ├── row counts
 ├── quality results
 ├── execution time
 ├── errors
 └── checksums
```

Это становится evidence для соответствующего Change.

---

# 30. Evidence model

Не использовать бинарное:

```text
PASS / FAIL
```

для всех случаев.

Минимально:

```text
PROVEN
NOT_PROVEN
INCONCLUSIVE
NOT_APPLICABLE
```

Например:

```text
BDD acceptance     PROVEN
Schema validation  PROVEN
Mutation testing   INCONCLUSIVE
Runtime freshness  NOT_PROVEN
```

Это предотвращает ложное ощущение завершённости.

---

# 31. Evidence ≠ Test result

Test:

```text
test passed
```

Evidence:

```text
claim:
  "customer_id remains unique after migration"

evidence:
  test_run_id
  dataset_version
  query
  result
  timestamp
```

Evidence должна быть воспроизводимой.

---

# 32. Verification Matrix

Для каждого Change фабрика строит:

```text
Requirement
    ↓
Scenario
    ↓
Test
    ↓
Execution
    ↓
Evidence
```

Пример:

```text
REQ-12
  ↓
BDD-04
  ↓
E2E-17
  ↓
RUN-921
  ↓
EVID-921
```

Таким образом можно ответить:

> Каким доказательством подтверждается это требование?

---

# 33. Artifact policy

Не требовать все artifacts для каждой задачи.

Вместо:

```text
Every change:
proposal
spec
design
ADR
BDD
TDD
data contract
mutation
threat model
C4
migration
```

использовать profile.

---

# 34. Change profiles

Минимально:

```text
BUGFIX
FEATURE
REFACTOR
DATA_CHANGE
ARCHITECTURE
SECURITY
MIGRATION
```

### BUGFIX

```text
proposal
spec delta
test
implementation
verify
```

### FEATURE

```text
proposal
spec
BDD
design
tasks
tests
verify
```

### REFACTOR

```text
proposal
behavior baseline
design (если нужно)
tests
verify
```

### DATA_CHANGE

```text
proposal
spec
data contract
migration/recovery
data tests
verify
```

### ARCHITECTURE

```text
proposal
spec
design
ADR
tests
verify
```

### SECURITY

```text
proposal
threat/security analysis
spec
tests
adversarial review
verify
```

---

# 35. Risk profile

Не использовать один магический числовой risk score как источник истины.

Risk profile:

```yaml
risk:
  data_loss: low
  security: medium
  reversibility: high
  blast_radius: medium
  compatibility: low
```

Из него выводится verification profile.

Например:

```text
LOW
  normal verification

MEDIUM
  + adversarial review

HIGH
  + adversarial review
  + mutation
  + explicit rollback
  + human approval
```

---

# 36. OpenSpec Schema

Основной custom schema фабрики не должен быть огромным.

Предлагается начать с:

```text
factory-sdd
```

на базе OpenSpec `spec-driven`.

OpenSpec официально поддерживает fork built-in schema и project-local schemas. ([GitHub][2])

Базовая схема:

```text
proposal
   ↓
specs
   ↓
design
   ↓
tasks
```

Дополнительные процессы реализуются skills и factory gates, а не раздуванием schema.

---

# 37. Почему не надо сразу включать BDD/TDD/ADR/Data Contract в schema

Потому что schema отвечает:

> какие artifacts нужны для workflow?

Factory policy отвечает:

> какие artifacts обязательны для данного класса изменения?

Например:

```text
factory policy:
if change.type == DATA_CHANGE
then data_contract required
```

Это существенно гибче.

---

# 38. OpenSpec config

Проект должен использовать:

```text
openspec/config.yaml
```

для:

* project context;
* default schema;
* artifact rules;
* project conventions.

OpenSpec поддерживает project context и per-artifact rules непосредственно через config. ([GitHub][3])

Пример:

```yaml
schema: factory-sdd

context: |
  This project uses:
  - Python
  - PostgreSQL
  - pytest
  - Docker

rules:
  proposal:
    - Identify non-goals
    - Identify affected boundaries

  specs:
    - Use observable behavior
    - Use Given/When/Then where applicable

  design:
    - Do not introduce infrastructure without justification

  tasks:
    - Keep tasks independently verifiable
```

---

# 39. Factory Skills

Dark Factory добавляет только skills, которые OpenSpec сам не обязан предоставлять.

Минимальный набор:

```text
factory-intake
factory-classify
factory-spec-review
factory-test-plan
factory-verify
factory-data-verify
factory-evidence
factory-release
```

Опционально:

```text
factory-adversarial-review
factory-mutation
factory-runtime-check
factory-retrospective
```

---

# 40. Skills должны быть тонкими

Skill не должен содержать всю архитектуру фабрики.

Правильно:

```text
skill
  ↓
invoke OpenSpec
  ↓
perform deterministic checks
  ↓
produce result
```

Неправильно:

```text
skill
  ↓
implements own SDD engine
  ↓
creates alternative specs
  ↓
creates own lifecycle
```

---

# 41. Git discipline

Очень хорошая идея из Intent-Driven template:

```text
PROPOSE → main
IMPLEMENT → worktree
MERGE → main
ARCHIVE → main
```

Proposal должен видеть актуальные authoritative specs и другие изменения.

Если делать proposal в worktree, агент может видеть только локальный delta и потерять контекст других изменений. Поэтому proposal должен выполняться на main, implementation — в worktree. ([intent-driven.dev][9])

---

# 42. Worktree lifecycle

```text
main
 │
 ├── OpenSpec proposal
 │
 ▼
change accepted
 │
 ▼
worktree/change-X
 │
 ├── implementation
 ├── tests
 ├── verification
 └── evidence
 │
 ▼
PR / merge
 │
 ▼
main
 │
 ▼
OpenSpec archive
```

---

# 43. Agent capabilities

Агенту нельзя доверять workflow только через prompt.

Factory должна определять capability:

```text
READ_REPO
READ_SPEC
WRITE_SPEC
WRITE_CODE
RUN_TEST
RUN_DATA_CHECK
GIT_COMMIT
GIT_PUSH
MERGE
PRODUCTION_WRITE
```

Обычный implementation agent:

```text
READ_REPO
READ_SPEC
WRITE_CODE
RUN_TEST
GIT_COMMIT
```

Spec author:

```text
READ_REPO
READ_SPEC
WRITE_SPEC
```

Verifier:

```text
READ_REPO
READ_SPEC
RUN_TEST
RUN_DATA_CHECK
READ_EVIDENCE
```

Verifier не получает:

```text
WRITE_CODE
WRITE_SPEC
MERGE
```

---

# 44. Specification Guard

Перед implementation:

```text
OpenSpec validate
+
Factory validation
```

Проверяются:

```text
proposal exists
spec exists when required
requirements are testable
BDD exists when required
design exists when required
ADR exists when required
tasks exist
```

Если нет:

```text
STOP
```

---

# 45. Implementation Guard

Агент не должен начинать реализацию, если:

```text
required specification incomplete
```

или:

```text
required review unresolved
```

или:

```text
required data contract missing
```

---

# 46. Verification Guard

Merge запрещён, если:

```text
required tests != PASS
```

или:

```text
required evidence != PROVEN
```

или:

```text
required review unresolved
```

или:

```text
required migration/recovery evidence missing
```

---

# 47. Data-change Guard

Если Change затрагивает данные:

```text
detect DATA_CHANGE
       ↓
require data contract
       ↓
require migration strategy
       ↓
require rollback/recovery
       ↓
require data validation
       ↓
require evidence
```

Это должно быть автоматическим.

---

# 48. Что считается DATA_CHANGE

Не только SQL migration.

Например:

```text
schema change
column semantics change
data type change
key change
ETL logic change
aggregation change
business rule change
source mapping change
historical backfill
retention change
partition change
published dataset change
```

---

# 49. Data migration specification

Каждая migration должна отвечать:

```text
Current state
Target state
Transformation
Compatibility
Backfill
Validation
Rollback
Recovery
Cutover
Post-cutover checks
```

---

# 50. Compatibility

Для data systems особенно важны:

```text
Backward compatible
Forward compatible
Breaking
```

Пример:

```text
ADD nullable column
    → compatible

RENAME column
    → breaking

CHANGE semantic meaning
    → breaking even if SQL type unchanged
```

---

# 51. Semantic compatibility

Фабрика не должна проверять только schema.

Например:

```text
DECIMAL(12,2)
```

может остаться тем же типом, но:

```text
old meaning = EUR
new meaning = RUB
```

Это breaking semantic change.

Поэтому Data Contract должен содержать semantics.

---

# 52. Time semantics

Для data systems обязательно явно определять:

```text
event time
business/effective time
load time
processing time
as-of time
```

Не позволять агенту молча выбирать:

```text
created_at
```

в качестве временной семантики.

---

# 53. Idempotency

Data process specification должна отвечать:

> Что произойдёт при повторном запуске?

Например:

```text
same input
same version
repeat execution
```

должно либо:

```text
produce same logical result
```

либо явно иметь другой defined behavior.

---

# 54. Late-arriving data

Для временных данных спецификация должна явно определить:

```text
late event
out-of-order event
correction
reprocessing
backfill
```

Если этого нет:

```text
spec incomplete
```

для соответствующего temporal process.

---

# 55. Data verification pipeline

Предлагается:

```text
Schema Check
     ↓
Structural Check
     ↓
Integrity Check
     ↓
Semantic Check
     ↓
Temporal Check
     ↓
Reconciliation
     ↓
Evidence
```

Каждый слой выдаёт machine-readable result.

---

# 56. Verification result

Например:

```json
{
  "check": "customer_id_unique",
  "status": "PASS",
  "dataset": "customer",
  "version": "2026-09-21",
  "rows": 182341,
  "violations": 0
}
```

Но JSON является **evidence artifact**, а не отдельным SSOT.

---

# 57. Evidence Bundle

Для Change:

```text
evidence/
    manifest.json
    tests/
    data/
    mutation/
    review/
    runtime/
```

`manifest.json` содержит:

```text
change_id
commit
spec_version
policy_version
factory_version
agent/model
context_hash
test results
data results
review results
```

---

# 58. Context

Agent не должен каждый раз получать весь repository.

Factory формирует Context Pack:

```text
Change
+
relevant specs
+
relevant ADRs
+
glossary
+
affected files
+
relevant tests
+
relevant data contracts
+
project rules
```

Именно этот context передаётся agent.

Концептуально:

```text
Agent = f(ContextPack, Command)
```

---

# 59. Context fingerprint

Каждый Run получает:

```text
context_hash
```

Например:

```text
change
specs
ADR
glossary
relevant code
policy
skill
```

→ canonical representation → SHA-256.

Тогда можно установить:

> На каком именно контексте агент принимал решение?

---

# 60. Версионирование

Evidence должна фиксировать:

```text
factory_version
openspec_version
schema_version
policy_version
skill_version
agent
model
tool versions
commit
context_hash
```

Это критически важно для воспроизводимости.

---

# 61. Factory Event Log

Не нужно заменять Git/OpenSpec event log огромной event-sourcing системой на первом этапе.

Достаточно фиксировать factory events:

```text
change.created
change.classified
proposal.created
spec.created
spec.reviewed
design.created
tasks.created
implementation.started
test.executed
verification.completed
evidence.created
merge.completed
archive.completed
runtime.observed
```

Event log отвечает:

> Что делала фабрика?

OpenSpec отвечает:

> Что является текущей спецификацией?

Git отвечает:

> Каков фактический source state?

Runtime отвечает:

> Что реально произошло в системе?

---

# 62. Четыре источника истины

Не создавать один гигантский SSOT.

```text
OpenSpec specs
    = intended/current functional behavior

ADR
    = durable architectural decisions

Git
    = actual source state

Runtime/Data
    = actual operational state
```

Factory event log:

```text
    = history of factory actions
```

Все остальные:

```text
reports
dashboards
summaries
graphs
indexes
```

являются projections.

---

# 63. Traceability

Минимальная traceability chain:

```text
Change
  ↓
Requirement
  ↓
BDD Scenario
  ↓
Task
  ↓
Code
  ↓
Test
  ↓
Execution
  ↓
Evidence
```

Для data:

```text
Change
  ↓
Data Contract
  ↓
Transformation
  ↓
Dataset
  ↓
Quality Check
  ↓
Evidence
```

Не требуется сразу строить graph database.

Обычные IDs + links в artifacts достаточно.

---

# 64. IDs

Минимальные IDs:

```text
CHG-xxx
REQ-xxx
SCN-xxx
TASK-xxx
TEST-xxx
DATA-xxx
EVID-xxx
ADR-xxx
RUN-xxx
```

Но ID не должны засорять каждый абзац.

Они нужны там, где существует traceability.

---

# 65. Unknowns

Очень полезное дополнение для AI factory:

```text
FACT
ASSUMPTION
UNKNOWN
DECISION
```

Если агент не знает:

```text
UNKNOWN
```

а не:

```text
guess
```

Пример:

```yaml
unknown:
  id: UNK-12
  question: "Can historical records be rewritten?"
  blocking: true
```

Blocking unknown:

```text
implementation forbidden
```

Non-blocking:

```text
may proceed with explicit assumption
```

---

# 66. Assumptions

Если решение принято на основании предположения:

```text
ASSUMPTION
```

оно должно быть видимым.

Например:

```text
ASSUMPTION:
Customer IDs are globally unique.
```

Если позднее это оказалось неверным:

```text
assumption invalidated
    ↓
new Change
```

---

# 67. Decision Ledger

ADR остаётся человекочитаемым документом.

Но factory может иметь лёгкий machine-readable record:

```yaml
decision: ADR-004
status: accepted

context: ...
decision: ...
alternatives:
  - ...
consequences:
  - ...
```

Это позволяет агенту быстро находить decisions.

Не создавать отдельную сложную database.

---

# 68. Factory workflow

Итоговый workflow:

```text
1. INTAKE
2. CLASSIFY
3. EXPLORE
4. PROPOSE
5. SPECIFY
6. ADVERSARIAL REVIEW
7. HUMAN REVIEW
8. DESIGN
9. ADR IF NEEDED
10. TASKS
11. WORKTREE
12. TDD / BDD IMPLEMENTATION
13. DATA VERIFICATION IF NEEDED
14. FACTORY VERIFY
15. EVIDENCE
16. HUMAN / POLICY APPROVAL
17. MERGE
18. ARCHIVE
19. RUNTIME OBSERVATION
```

---

# 69. Но это не обязательный pipeline

Для простого bugfix:

```text
PROPOSE
→ SPEC
→ TEST
→ IMPLEMENT
→ VERIFY
→ MERGE
```

Для архитектурной задачи:

```text
EXPLORE
→ PROPOSE
→ SPEC
→ DESIGN
→ ADR
→ TASKS
→ IMPLEMENT
→ VERIFY
```

Для data migration:

```text
PROPOSE
→ SPEC
→ DATA CONTRACT
→ MIGRATION DESIGN
→ TEST
→ IMPLEMENT
→ DATA VERIFY
→ EVIDENCE
→ MERGE
```

---

# 70. STOP / WAIT / CONTINUE

Factory должна уметь не только:

```text
PASS / FAIL
```

но:

```text
CONTINUE
WAIT
STOP
ESCALATE
```

### CONTINUE

Можно продолжать.

### WAIT

Нужна информация/решение человека.

### STOP

Нарушено обязательное правило.

### ESCALATE

Высокий риск требует human decision.

---

# 71. Human approval

AI может:

```text
draft
review
implement
test
verify
```

Но не должен быть единственным approver для:

```text
destructive migration
security-critical change
production data mutation
architecture-breaking decision
policy modification
```

---

# 72. Policy hierarchy

```text
Factory Policy
      ↓
OpenSpec Workflow
      ↓
Change-specific rules
      ↓
Agent Skill
      ↓
Agent Prompt
```

Чем ниже уровень, тем меньше ему доверия.

Prompt:

```text
"please don't modify production"
```

не является security boundary.

Capability guard:

```text
PRODUCTION_WRITE = false
```

является.

---

# 73. Verification hierarchy

```text
L0 — deterministic policy
L1 — deterministic tests/checks
L2 — AI review
```

L2 никогда не может отменить:

```text
L0 FAIL
```

или:

```text
L1 required check FAIL
```

AI review является дополнительным evidence, а не заменой deterministic verification.

---

# 74. Factory quality gates

Минимум:

```text
G1 Specification valid
G2 Required artifacts present
G3 No blocking unknowns
G4 Tests pass
G5 Required BDD passes
G6 Data checks pass
G7 Required review complete
G8 Evidence complete
G9 Worktree clean
G10 Commit linked
```

Не все gates активны для каждого Change.

---

# 75. Self-improvement

Фабрика может улучшаться, но не должна самостоятельно ослаблять свои правила.

Цикл:

```text
Failure
  ↓
Root cause
  ↓
Pattern
  ↓
Candidate improvement
  ↓
Benchmark
  ↓
Regression suite
  ↓
Human approval
  ↓
New skill/policy
```

Например:

```text
Failure:
agents repeatedly miss null boundary

Pattern:
specs lack null scenarios

Improvement:
gherkin-authoring rule

Benchmark:
20 historical changes

Result:
improvement accepted
```

---

# 76. Что НЕ делать автоматически

Factory не должна самостоятельно:

```text
remove a quality gate
lower verification level
ignore failed tests
delete required specification
weaken data contract
disable security check
change policy to make a run pass
```

Если правило мешает — создаётся Change:

```text
Improve factory policy
```

и проходит обычный SDD lifecycle.

---

# 77. Factory Memory

Memory должна быть структурированной.

Минимально:

```text
FACT
DECISION
PATTERN
FAILURE
SUCCESS
TRAP
```

Например:

```yaml
pattern:
  id: PAT-004
  title: "Do not infer temporal semantics"
  context: data analytics
  lesson: explicit as_of semantics required
  evidence:
    - CHG-124
    - CHG-151
```

Не использовать один бесконечный `memory.md`.

---

# 78. Metrics

Не измерять фабрику количеством generated Markdown.

Основные metrics:

```text
Specification defects found before implementation
Specification defects found after implementation
Requirement → test coverage
Change rework rate
Verification failure rate
Escaped defects
Data quality regressions
Agent retry count
Human intervention rate
Mutation survival rate
Runtime deviations
```

Особенно важен:

```text
escaped defect
```

То есть проблема, которую factory должна была поймать, но не поймала.

---

# 79. Основной KPI

Главный вопрос:

> Насколько хорошо спецификация предотвращает неправильную реализацию?

Поэтому важнее:

```text
target behavior
      ↓
implemented behavior
      ↓
observed behavior
```

и отклонение между ними.

---

# 80. OpenSpec upgrade policy

OpenSpec нельзя fork'ать без необходимости.

Предпочтительно:

```text
stock OpenSpec
+
project-local schema
+
project-local config
+
factory skills
```

OpenSpec уже поддерживает project-local schemas и validation. ([GitHub][2])

Это позволит обновлять OpenSpec независимо от Dark Factory.

---

# 81. Version pinning

Factory должна фиксировать версию OpenSpec.

Например:

```text
openspec:
  version: 1.13.x
```

При обновлении:

```text
OpenSpec upgrade
    ↓
factory compatibility tests
    ↓
schema validation
    ↓
sample changes
    ↓
acceptance
```

Не обновлять production factory вслепую.

---

# 82. OpenSpec schema compatibility test

В repository фабрики должен существовать:

```text
tests/openspec/
```

с несколькими эталонными Changes:

```text
simple-feature
bugfix
refactor
data-change
architecture-change
```

Для каждого проверяется:

```text
new OpenSpec version
+
factory schema
+
factory skills
```

не ломают lifecycle.

---

# 83. MVP

Первый production MVP должен быть очень маленьким.

## Phase 1 — OpenSpec Foundation

Установить:

```text
OpenSpec
openspec/config.yaml
factory-sdd schema
```

Использовать:

```text
proposal
specs
design
tasks
```

И стандартные:

```text
validate
apply
archive
```

---

# 84. Phase 2 — Factory Verification

Добавить:

```text
factory-verify
factory-evidence
```

и:

```text
required artifacts
test execution
traceability
evidence manifest
```

---

# 85. Phase 3 — BDD/TDD

Добавить:

```text
gherkin-authoring
tdd
```

Pipeline:

```text
Spec
 ↓
BDD
 ↓
Acceptance test
 ↓
TDD
 ↓
Implementation
```

---

# 86. Phase 4 — Adversarial authoring

Добавить:

```text
spec-author
spec-reviewer
glossary
```

Pipeline:

```text
draft
 ↓
adversarial review
 ↓
revision
 ↓
human approval
```

---

# 87. Phase 5 — Data

Добавить:

```text
data-contract
data-verify
migration-check
reconciliation
```

Только после того, как основной SDD lifecycle стабилен.

---

# 88. Phase 6 — Factory orchestration

Только теперь добавлять:

```text
agent orchestration
worktree automation
capability guards
retry policy
context packs
```

---

# 89. Phase 7 — Runtime

После этого:

```text
runtime observation
drift detection
production evidence
```

и связь:

```text
Change
 ↓
Release
 ↓
Runtime observation
 ↓
New Change
```

---

# 90. Что сознательно НЕ входит в MVP

Не делать сразу:

```text
distributed event bus
graph database
Kafka
complex workflow engine
multi-agent swarm
10+ specialized agents
automatic architecture generation
automatic policy evolution
persistent semantic memory platform
fully autonomous production deployment
```

Это всё может появиться позже.

Но не должно быть prerequisite для хорошего SDD.

---

# 91. Final repository structure

Предлагаемая структура:

```text
project/
│
├── openspec/
│   ├── config.yaml
│   │
│   ├── schemas/
│   │   └── factory-sdd/
│   │       ├── schema.yaml
│   │       └── templates/
│   │
│   ├── specs/
│   │
│   ├── changes/
│   │
│   └── changes/archive/
│
├── architecture/
│   └── adr/
│
├── .factory/
│   ├── policies/
│   ├── evidence/
│   ├── runs/
│   ├── memory/
│   └── config.yaml
│
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── acceptance/
│   └── data/
│
└── src/
```

---

# 92. Ownership

```text
openspec/
    OpenSpec

architecture/adr/
    Architecture

.factory/policies/
    Dark Factory

.factory/evidence/
    Verification

.factory/runs/
    Factory execution

tests/
    Engineering

src/
    Product
```

---

# 93. Самая важная граница

Не превращать `.factory/` в новую систему спецификаций.

Например, неправильно:

```text
.factory/specs/
openspec/specs/
docs/specs/
```

Три источника истины приведут к drift.

Правильно:

```text
openspec/specs/
```

является спецификацией.

`.factory/` только контролирует процесс вокруг неё.

---

# 94. Итоговая архитектура

```text
                         HUMAN INTENT
                              │
                              ▼
                     ┌─────────────────┐
                     │  DARK FACTORY   │
                     │ Intake / Policy │
                     └────────┬────────┘
                              │
                              ▼
                         ┌──────────┐
                         │ OpenSpec │
                         └────┬─────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
           PROPOSAL          SPEC            DESIGN
              │               │                │
              │               ▼                ▼
              │             BDD               ADR
              │               │                │
              └───────────────┼────────────────┘
                              ▼
                            TASKS
                              │
                              ▼
                         WORKTREE
                              │
                              ▼
                       TDD / IMPLEMENT
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
                  TESTS             DATA TESTS
                    │                   │
                    └─────────┬─────────┘
                              ▼
                         VERIFICATION
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
                 EVIDENCE          ADVERSARIAL
                                      REVIEW
                    │                   │
                    └─────────┬─────────┘
                              ▼
                           POLICY
                            GATE
                              │
                              ▼
                            MERGE
                              │
                              ▼
                          ARCHIVE
                              │
                              ▼
                           RUNTIME
                              │
                              ▼
                         OBSERVATION
                              │
                              ▼
                         NEW CHANGE
```

---

# 95. Главный принцип Dark Factory

Фабрика не должна пытаться быть самым умным компонентом системы.

Она должна делать другое:

> **делать правильный процесс проще неправильного.**

OpenSpec уже решает значительную часть SDD-задачи.

Dark Factory должна добавить только то, чего OpenSpec сознательно не пытается решать:

```text
CONTROL
VERIFICATION
EVIDENCE
DATA
AGENT SAFETY
RISK
RUNTIME
LEARNING
```

---

# 96. Конечная формула

```text
OpenSpec
    =
Specification Lifecycle

BDD
    =
Macro Behaviour

TDD
    =
Micro Design Feedback

ADR
    =
Durable Architecture Decisions

Glossary
    =
Shared Domain Language

Data Contract
    =
Data Semantics

Tests
    =
Executable Verification

Mutation
    =
Test Strength Verification

Evidence
    =
Proof of Result

Dark Factory
    =
Control + Orchestration + Governance
```

И поэтому итоговая система должна быть не:

```text
AI + 50 skills + 100 documents
```

а:

```text
              INTENT
                 ↓
             OpenSpec
                 ↓
        Specification
                 ↓
          BDD / TDD
                 ↓
          Implementation
                 ↓
        Deterministic Verify
                 ↓
             Evidence
                 ↓
             Release
                 ↓
             Runtime
                 ↓
            Feedback
```

**Это и есть минимальное ядро, вокруг которого имеет смысл строить Dark Software Factory.**

---

# 97. Практический следующий шаг

Реализацию следует начинать не с написания всех skills.

Сначала создать минимальный vertical slice:

```text
OpenSpec
   +
factory-sdd schema
   +
one FEATURE change
   +
BDD
   +
TDD
   +
factory-verify
   +
evidence manifest
   +
worktree discipline
```

Провести через него **реальное изменение проекта от intent до archive**.

После этого уже по фактическим failure modes добавлять:

```text
adversarial review
glossary
ADR
data contracts
mutation
runtime observation
self-improvement
```

Так мы получим не теоретическую "идеальную фабрику", а **маленькое рабочее ядро, которое можно расширять без архитектурного переписывания**.

Это, на мой взгляд, важный поворот относительно первоначальной идеи Dark Factory: **не строить ещё один OpenSpec внутри фабрики**. OpenSpec уже достаточно зрелый и сейчас активно развивается; например, актуальная ветка содержит custom schemas, profiles, validation и project configuration. ([GitHub][1])

Особенно удачным считаю разделение **OpenSpec = specification lifecycle**, **Factory = enforcement/evidence/runtime**. Оно позволит сохранить простоту и при этом постепенно встроить ваши уже запланированные механизмы L0/L1/L2, evidence, data governance и self-improvement, не превращая их в конкурирующие системы.

[1]: https://github.com/Fission-AI/openspec?utm_source=chatgpt.com "GitHub - Fission-AI/OpenSpec: Spec-driven development (SDD) for AI coding assistants. · GitHub"
[2]: https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md?utm_source=chatgpt.com "OpenSpec/docs/customization.md at main · Fission-AI/OpenSpec · GitHub"
[3]: https://github.com/Fission-AI/OpenSpec/blob/main/docs/opsx.md?utm_source=chatgpt.com "OpenSpec/docs/opsx.md at main · Fission-AI/OpenSpec · GitHub"
[4]: https://intent-driven.dev/blog/2026/07/17/behavior-driven-development-sdd-openspec/?utm_source=chatgpt.com "Behavior-Driven Development and Spec-Driven Development with OpenSpec | intent-driven.dev"
[5]: https://intent-driven.dev/blog/2026/08/23/tdd-bdd-spec-driven-development/?utm_source=chatgpt.com "How TDD and BDD Actually Fit Into Spec-Driven Development | intent-driven.dev"
[6]: https://intent-driven.dev/blog/2026/06/27/sdd-adversarial-authoring-glossary/?utm_source=chatgpt.com "SDD with Multi-Model Spec Review and Glossary | intent-driven.dev"
[7]: https://intent-driven.dev/blog/2026/04/29/spec-driven-development-with-adr/?utm_source=chatgpt.com "Architectural Decision Records with Spec-Driven Development using OpenSpec | intent-driven.dev"
[8]: https://intent-driven.dev/blog/2026/03/10/spec-driven-development-brownfield/?utm_source=chatgpt.com "Spec-Driven Development with Brownfield Projects | intent-driven.dev"
[9]: https://intent-driven.dev/blog/2026/04/01/openspec-git-worktrees-opencode/?utm_source=chatgpt.com "OpenSpec, Git WorkTrees and OpenCode | intent-driven.dev"

---
---
# Дополнение (рассмотреть!)

yaml - заменить на json по возможности!
## Что добавить

создать и проработать все нужные шаблоны
доработать необходимые скилл(рассмотреть: https://github.com/mattpocock/skills/tree/main) и добавить навыки и инструменты!
заложить интеграцию с sef/LATTICE
заложить интеграцию с JEV classifier (то что можно отдать безопасно)
заложить что данная система будет работать в связке с SEF(фабрика)


### 1. Contract compatibility engine

Для data contracts нужны не только YAML и review, а детерминированная проверка compatibility.

Минимальные правила:

```text
Добавление nullable-поля → обычно backward-compatible.
Добавление required-поля → breaking.
Удаление поля → breaking.
Переименование поля → breaking, если нет alias/migration.
Изменение типа → анализируется отдельно.
Изменение единиц измерения → semantic breaking.
Изменение timezone semantics → semantic breaking.
Изменение ключа идентичности → critical breaking.
```

Результат:

```yaml
compatibility:
  previous: DCT-ORDERS-2.1.0
  candidate: DCT-ORDERS-3.0.0
  level: breaking

findings:
  - id: CMP-001
    field: currency
    change: semantic interpretation changed
    required_actions:
      - migration_plan
      - consumer_impact_review
      - major_version_bump
```

***

### 2. Controlled vocabulary для статусов

В документе есть несколько статусных моделей: change lifecycle, runtime lifecycle, evidence lifecycle, `STOP/WAIT/CONTINUE/ESCALATE`.

Нужно закрепить, что это разные оси.

| Ось | Примеры |
|---|---|
| Change state | proposed, specified, implementing, merged, archived |
| Factory run state | queued, running, succeeded, failed, cancelled |
| Gate verdict | pass, fail, waived, not-applicable |
| Evidence status | proven, not-proven, inconclusive |
| Control action | continue, wait, stop, escalate |
| Runtime process state | discovered, validated, committed, published, quarantined |

Если смешивать их в одной колонке `status`, быстро появится хаос.

***

### 3. Policy-as-code и policy tests

Policy должна быть не только YAML-конфигурацией. Её нужно тестировать на эталонных кейсах.

```text
Given: destructive schema migration
When: rollback plan is absent
Then: merge gate must fail
```

Нужен набор policy fixtures:

```text
fixtures/
├── low-risk-bugfix/
├── feature-with-bdd/
├── breaking-data-change/
├── failed-security-check/
├── expired-waiver/
└── legacy-refactor/
```

Это особенно важно, если фабрика будет self-improving. Любое изменение policy должно проходить regression suite самой фабрики.

***

### 4. Waiver / exception lifecycle

Идея waivers была в предыдущем документе и её стоит вернуть в эту версию системы.

Исключение не должно быть комментарием в PR. Оно должно иметь:

```yaml
waiver_id: WAV-2026-004
change_id: CHG-2026-002
gate: G6-data-reconciliation
reason: Historical source snapshot unavailable.
risk: medium
compensating_controls:
  - consumer validation
  - post-release monitoring
owner: data-platform-owner
approved_by: human-approver
expires_at: 2026-10-15
status: active
```

Без expiration и owner исключения становятся постоянными обходами качества.

***

### 5. Rollback как самостоятельный тестируемый объект

Для high-risk data change нельзя ограничиться текстом `rollback.md`.

Нужно различать:

```text
rollback declared
rollback validated
rollback rehearsed
rollback executable
```

Для критических миграций требование должно быть таким:

```text
The rollback procedure has been executed successfully
against a production-like snapshot.
```

То есть rollback — это не документ, а проверенный сценарий.

***

## Рекомендуемая целевая модель

Я бы оставил систему небольшой и выразил её через шесть основных сущностей:

```text
Change
Run
Artifact
Policy
Evidence
RuntimeObservation
```

И связи между ними:

```text
Change
  ├── owns → OpenSpec artifacts
  ├── has → risk profile
  ├── has → policy profile
  ├── creates → FactoryRun
  ├── produces → Release
  └── is validated by → Evidence

FactoryRun
  ├── consumes → ContextPack
  ├── executes → Agent / Skill
  ├── produces → Artifacts
  ├── executes → Checks
  └── emits → FactoryEvents

Evidence
  ├── supports → Claim
  ├── refers to → Spec revision
  ├── refers to → Commit / Release / Dataset snapshot
  └── has → verdict

RuntimeObservation
  ├── measures → Runtime contract
  ├── confirms or contradicts → Claim
  └── may trigger → New Change
```

Это достаточно сильная модель для MVP и не требует сразу ни event sourcing, ни graph database.