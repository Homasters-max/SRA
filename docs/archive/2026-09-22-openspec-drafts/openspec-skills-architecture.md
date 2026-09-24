# DARK SOFTWARE FACTORY — Skills Architecture

## 1. Назначение

Skills — это **не второй workflow** и не набор самостоятельных процессов.

Они являются небольшими composable единицами инженерного reasoning, которые вызываются внутри OpenSpec lifecycle и Factory operations.

Целевая композиция:

```text
OpenSpec
    │
    │ lifecycle / artifacts
    ▼
Factory Controller
    │
    │ policy / routing
    ▼
Skills
    │
    │ reasoning / authoring / review
    ▼
Deterministic Checks
    │
    │ facts / validation / enforcement
    ▼
LATTICE
    │
    │ semantic substrate / provenance / relations
    ▼
Evidence
```

Принцип:

```text
OpenSpec = WHAT is being specified and where it lives
Skills    = HOW an agent reasons about it
Checks    = WHAT can be determined mechanically
LATTICE   = semantic substrate
Evidence  = what was actually demonstrated
```

Skills **не владеют lifecycle**, не создают альтернативный source of truth и не должны самостоятельно изменять policy.

---

# 2. Главный архитектурный принцип

Не создавать skill для каждой операции.

Перед добавлением нового skill задать четыре вопроса:

```text
1. Это новый тип durable knowledge?
   → Artifact

2. Это deterministic rule?
   → Policy / Check

3. Это repeatable deterministic operation?
   → Factory operation / tool

4. Это задача, требующая semantic reasoning?
   → Skill
```

Если ответ на последний вопрос — нет, отдельный skill не нужен.

---

# 3. Skill hierarchy

Вместо большого плоского списка используется небольшое количество верхнеуровневых skills.

## Core Skills

```text
skills/
│
├── specification/
│   ├── authoring
│   ├── clarification
│   └── scenario-engineering
│
├── domain/
│   ├── modeling
│   ├── boundary-review
│   └── relation-semantics
│
├── semantic/
│   ├── substrate-modeling
│   ├── provenance
│   ├── epistemic-review
│   ├── canonicalization
│   └── semantic-diff
│
├── engineering/
│   ├── tdd
│   ├── implementation
│   ├── code-review
│   └── architecture-design
│
├── investigation/
│   ├── research
│   └── bug-diagnosis
│
└── evolution/
    ├── architecture-audit
    └── semantic-migration
```

Но это **не означает 20 независимых skills**.

Внешняя система видит только верхний уровень:

```text
specification
domain
semantic
engineering
investigation
evolution
```

Вложенные элементы являются modes/subskills.

---

# 4. Skill contract

Каждый skill должен иметь одинаковый минимальный контракт.

```yaml
skill:
  id: semantic
  purpose: semantic reasoning over LATTICE-backed project knowledge

  inputs:
    - context
    - task
    - relevant_artifacts
    - constraints

  outputs:
    - findings
    - proposals
    - decisions_required

  may:
    - inspect
    - reason
    - propose
    - produce review findings

  may_not:
    - mutate_canonical_state
    - change_policy
    - bypass_checks
    - invent_evidence
    - silently_resolve_unknowns
```

Skill должен быть максимально stateless:

```text
Context
   +
Command
   ↓
Skill
   ↓
Structured result
```

Это хорошо согласуется с общей моделью Factory:

```text
LLM = f(Context, Command)
```

---

# 5. Skill result

Не заставлять каждый skill придумывать собственный формат результата.

Используется общий envelope:

```yaml
result:
  status: PASS | FAIL | INCONCLUSIVE

  findings:
    - id:
      severity:
      category:
      statement:
      evidence:
      recommendation:

  proposals:
    - type:
      target:
      change:

  decisions_required:
    - question:
      blocking: true|false

  provenance:
    context_hash:
    skill:
    run_id:
```

Таким образом skills различаются **reasoning domain**, но не протоколом взаимодействия.

---

# 6. Specification Skill

## Назначение

Все reasoning, относящееся к формированию и проверке требований.

```text
specification
│
├── authoring
├── clarification
└── scenario-engineering
```

## 6.1 `specification.authoring`

Главный skill для качества specification.

Он отвечает за:

* observable behavior;
* actors;
* invariants;
* preconditions;
* postconditions;
* state transitions;
* negative cases;
* boundaries;
* acceptance criteria;
* non-goals;
* assumptions;
* unresolved questions.

Главное разделение:

```text
specification = what must be true
design        = how it will be achieved
```

Skill **не должен проектировать implementation вместо specification**.

### Вход

```text
Change
Proposal
existing specs
domain context
LATTICE context
```

### Выход

```text
proposed specification
missing information
ambiguities
acceptance scenarios
```

---

## 6.2 `specification.clarification`

Это не отдельный workflow и не отдельный artifact.

Это режим `specification`.

Он используется только тогда, когда вопрос может изменить:

```text
spec
design
test
risk
architecture
data semantics
```

Формат reasoning:

```text
FACT
ASSUMPTION
UNKNOWN
DECISION
```

Правило:

```text
blocking UNKNOWN
    → stop / ask

non-blocking UNKNOWN
    → explicitly record
```

После clarification результат либо:

```text
spec update
ADR
decision
experiment
```

но не произвольный `clarification.md`.

---

## 6.3 `specification.scenario-engineering`

Фокусируется на качестве behavioral scenarios.

Проверяет:

```text
happy path
negative path
boundary
retry
idempotency
concurrency
partial failure
temporal behavior
authorization
invalid input
recovery
```

BDD остаётся внутри specification layer.

Не нужно создавать отдельный `bdd` framework.

---

# 7. Domain Skill

```text
domain
│
├── modeling
├── boundary-review
└── relation-semantics
```

## 7.1 `domain.modeling`

Отвечает за:

* ubiquitous language;
* terminology;
* entities;
* value objects;
* domain concepts;
* synonyms;
* edge cases;
* bounded contexts.

Он покрывает domain modeling, аналогично полезной части `domain-modeling` из Matt Pocock skills.

Но:

```text
domain.modeling
    ≠
LATTICE substrate modeling
```

Первый отвечает:

> Что означает понятие?

Второй:

> Как это понятие существует в semantic substrate?

---

## 7.2 `domain.boundary-review`

Проверяет semantic boundaries.

Основные вопросы:

```text
Это действительно один concept?

Кто владеет смыслом?

Это entity или attribute?

Entity или value object?

Domain object или operational state?

Не смешаны ли разные bounded contexts?

Не читается ли чужой context напрямую?

Не превратился ли relation в искусственный object?
```

Особенно важный anti-pattern:

```text
status = active
```

если `active` потенциально означает:

```text
acceptance
currency
implementation state
runtime state
approval
```

Skill должен выявлять semantic overloading.

---

## 7.3 `domain.relation-semantics`

Это **subskill**, а не самостоятельный top-level skill.

Проверяет:

```text
source
target
direction
cardinality
role
meaning
lifecycle
```

Например:

```text
depends_on
tests
causes
cites
denotes
part_of
evolves_from
```

Главное правило:

> одна relation должна иметь один стабильный смысл.

Если relation используется для нескольких смыслов — нужна декомпозиция.

---

# 8. Semantic Skill

Это наиболее специфичная часть Dark Factory + LATTICE.

```text
semantic
│
├── substrate-modeling
├── provenance
├── epistemic-review
├── canonicalization
└── semantic-diff
```

## 8.1 `semantic.substrate-modeling`

Определяет, как новое понятие должно существовать в LATTICE.

Главный decision:

```text
LATTICE object?
artifact?
projection?
edge?
attribute?
operational state?
```

Если object:

```text
identity
context
classification
acceptance
currency
grounding
epistemic_state
provenance
history
edges
```

Но не все поля обязательны для каждого объекта.

### Главный тест

```text
Можно ли на это понятие:
- ссылаться;
- различать его экземпляры;
- аудировать изменение;
- восстанавливать происхождение;
- использовать в последующих решениях?
```

Если нет — возможно, это не LATTICE object.

---

## 8.2 `semantic.provenance`

Отвечает за grounding утверждений.

Базовые типы:

```text
declared
derived
observed
inferred
```

Skill должен проверять:

```text
что утверждается?
откуда это известно?
кто это установил?
можно ли воспроизвести?
какой context использовался?
не выдан inference за fact?
```

Например:

```yaml
grounding:
  kind: inferred
  source:
    actor: llm
    run_id: RUN-007
  epistemic_state: unresolved
```

После подтверждения:

```yaml
grounding:
  kind: declared
  source:
    decision: ADR-004
  epistemic_state: settled
```

Skill **не создаёт hashes, timestamps и commit IDs** — это делает deterministic infrastructure.

---

## 8.3 `semantic.epistemic-review`

Отвечает только за epistemic status.

```text
settled
contested
unresolved
```

Не смешивать его с:

```text
accepted
rejected
deprecated
```

Потому что:

```text
acceptance = принято ли решение
epistemic state = насколько утверждение обосновано
```

Примеры:

```text
accepted + unresolved
accepted + contested
rejected + settled
```

Skill ищет:

* assumptions presented as facts;
* claims without grounding;
* stale unresolved items;
* unresolved conflicts;
* missing decisions;
* необходимость ADR/experiment/observation.

---

## 8.4 `semantic.canonicalization`

Один из ключевых skills всей системы.

Его задача:

> не допустить появления второго канона.

Проверяет:

```text
Где уже существует эта информация?

Это новый объект или новая редакция?

Кто canonical owner?

Это source или projection?

Это cache?

Это derived view?

Не создаётся ли второй spec?

Не создаётся ли второй glossary?

Не превращается ли report в SSOT?
```

Базовое разделение:

```text
OpenSpec
    = normative functional specification

ADR
    = durable architectural decision

LATTICE
    = semantic identity / relations / provenance / history

Factory
    = process / policy / evidence

Git
    = actual implementation

Docs/reports
    = projections
```

---

## 8.5 `semantic.semantic-diff`

Не заменяет обычный Git diff.

Он отвечает на вопрос:

> Что изменилось **семантически**?

Например:

```text
file moved
+
semantic identity unchanged
=
move
```

или:

```text
classification changed
identity unchanged
=
reclassification
```

или:

```text
identity changed
=
new object / replacement
```

или:

```text
meaning changed
=
revision
```

Skill определяет:

```text
edit
move
revision
reclassification
split
merge
deprecation
replacement
```

Дальнейшее impact analysis выполняется deterministic graph machinery.

---

# 9. Engineering Skill

```text
engineering
│
├── tdd
├── implementation
├── code-review
└── architecture-design
```

## 9.1 `engineering.tdd`

Классический micro-loop:

```text
RED
 ↓
GREEN
 ↓
REFACTOR
 ↓
next slice
```

TDD не управляет OpenSpec.

Он получает:

```text
OpenSpec behavior
    ↓
scenario
    ↓
implementation slice
```

и создаёт:

```text
test evidence
```

---

## 9.2 `engineering.implementation`

Это adapter skill, а не второй lifecycle.

Его задача:

```text
load Change
→ load Context
→ resolve write scope
→ execute implementation
→ use TDD
→ prepare review
```

Он **не имеет права**:

```text
change profile
change policy
change canonical spec silently
modify LATTICE canonical state directly
bypass guards
```

---

## 9.3 `engineering.code-review`

Единый review skill с несколькими независимыми perspectives:

```text
code quality
spec compliance
architecture
data impact
security impact
```

Но это **modes**, а не пять skills.

Например:

```text
code-review
  mode = spec-compliance
```

или:

```text
code-review
  mode = security-impact
```

Это позволяет сохранить независимость reasoning, не создавая пять систем.

Результат:

```yaml
review:
  code_quality: PASS
  spec_compliance: PASS
  architecture: INCONCLUSIVE
  data_impact: N/A
  security: PASS
```

---

## 9.4 `engineering.architecture-design`

Используется для deep-module design:

```text
new bounded context
new domain service
application boundary
ports/adapters
orchestration
coupling reduction
large refactor
```

Результат должен жить в:

```text
design.md
```

или:

```text
ADR
```

а не в собственном permanent skill artifact.

---

# 10. Investigation Skill

```text
investigation
│
├── research
└── bug-diagnosis
```

## 10.1 `investigation.research`

Цикл:

```text
question
→ sources
→ findings
→ uncertainty
→ decision
```

Research должен сохранять provenance источников.

Он не изменяет продукт автоматически.

Результат:

```text
Decision
или
OpenSpec Change
или
ADR
или
Experiment
```

---

## 10.2 `investigation.bug-diagnosis`

Bug workflow:

```text
ASSESS
 ↓
REPRODUCE
 ↓
MINIMIZE
 ↓
HYPOTHESIZE
 ↓
INSTRUMENT
 ↓
FIX
 ↓
REGRESSION TEST
 ↓
VERIFY
```

Ключевой принцип:

```text
diagnosis ≠ implementation
```

Сначала reproducible failure.

Для behavioral bug:

```text
characterization test
    FAIL before fix
    PASS after fix
```

Если исправление меняет intended behavior — создаётся нормальный OpenSpec Change.

---

# 11. Evolution Skill

```text
evolution
│
├── architecture-audit
└── semantic-migration
```

## 11.1 `evolution.architecture-audit`

Не запускается после каждого change.

Запускается:

```text
after a group of changes
before major architecture work
when coupling grows
after repeated failed runs
before migration
```

Результат:

```text
candidate
→ evidence
→ impact
→ selected improvement
→ OpenSpec Change
```

Сам audit **не является изменением архитектуры**.

---

## 11.2 `evolution.semantic-migration`

Используется при изменении semantic model:

```text
classification change
merge
split
identity policy change
legacy vocabulary migration
relation migration
field meaning change
```

Минимальная модель:

```yaml
migration:
  source_model:
  target_model:
  mapping_rules:
  identity_policy:
  relation_transform:
  lossy_cases:
  gaps:
  rollback:
  verification:
```

Никогда не угадывать потерянную семантику.

Например:

```text
legacy:
  status = active
```

может преобразоваться в:

```text
currency = active
```

но нельзя автоматически сделать:

```text
acceptance = accepted
```

если legacy data этого не доказывает.

В таком случае:

```text
GAP
→ human decision
```

---

# 12. Matt Pocock Skills: mapping

Не нужно создавать собственные копии уже хороших generic engineering skills.

Используем существующие идеи как implementation-level skills/adapters:

| Existing skill                  | Factory role                      |
| ------------------------------- | --------------------------------- |
| `grill-with-docs`               | `specification.clarification`     |
| `domain-modeling`               | `domain.modeling`                 |
| `tdd`                           | `engineering.tdd`                 |
| `code-review`                   | `engineering.code-review`         |
| `research`                      | `investigation.research`          |
| `diagnosing-bugs`               | `investigation.bug-diagnosis`     |
| `codebase-design`               | `engineering.architecture-design` |
| `improve-codebase-architecture` | `evolution.architecture-audit`    |

То есть:

```text
do not fork blindly
do not install a second workflow
do not duplicate generic skills
```

Адаптировать только interface/context/policy.

## Исходный анализ правильно выделяет эти skills как наиболее полезные строительные блоки, особенно `grill-with-docs`, `domain-modeling`, `tdd`, `code-review`, `research` и `diagnosing-bugs`.

# 13. Что делать с `to-spec`, `to-tickets`, `wayfinder`

Это не Core Skills.

## `to-spec`

Adapter:

```text
conversation
→ OpenSpec Change
```

Не:

```text
conversation
→ second specification system
```

## `to-tickets`

Projection:

```text
OpenSpec tasks
→ tickets
```

Не наоборот.

## `wayfinder`

Только для больших инициатив:

```text
initiative
→ multiple OpenSpec Changes
→ dependency graph
→ execution schedule
```

Он не должен становиться третьим requirements hierarchy.

Эта граница особенно важна: исходный материал правильно отмечает, что issue tracker должен оставаться projection/backlog, а не canonical specification.

---

# 14. Skills vs deterministic infrastructure

Это критическая граница.

## Skill

Использует reasoning:

```text
"Это действительно новая сущность?"
"Что означает этот термин?"
"Достаточно ли provenance?"
"Не смешаны ли два semantic contexts?"
"Какой смысл имеет relation?"
```

## Deterministic code

Делает:

```text
validate schema
calculate hash
create ID
check enum
check allowed state combination
resolve profile
evaluate policy
build index
build graph
detect orphan
rebuild projection
calculate coverage
check OCC
compare files
execute tests
collect commit SHA
```

Не превращать deterministic logic в LLM skill.

---

# 15. Skill invocation model

Factory Controller не должен знать все детали skills.

Он работает примерно так:

```text
Change
  ↓
Profile
  ↓
Policy
  ↓
Required operation
  ↓
Skill selection
  ↓
Skill mode
  ↓
Deterministic checks
  ↓
Evidence
```

Например:

```text
feature
  ↓
specification.authoring
  ↓
domain.boundary-review
  ↓
semantic.substrate-modeling
  ↓
engineering.implementation
  ↓
engineering.code-review
  ↓
verify
```

Для bug:

```text
bugfix
  ↓
investigation.bug-diagnosis
  ↓
specification.scenario-engineering
  ↓
engineering.tdd
  ↓
engineering.implementation
  ↓
engineering.code-review
```

Для semantic migration:

```text
migration
  ↓
semantic.semantic-diff
  ↓
evolution.semantic-migration
  ↓
semantic.provenance
  ↓
deterministic migration verification
```

---

# 16. Skill composition

Skills должны быть composable.

Например:

```text
specification.authoring
    +
domain.modeling
    +
semantic.boundary-review
```

не создают:

```text
feature-authoring-v2
```

Вместо этого Factory просто вызывает три существующих capability.

То же самое:

```text
research
+
provenance
+
canonicalization
```

может использоваться для architecture decision.

---

# 17. Skill nesting

Допустима следующая глубина:

```text
domain
  └── boundary-review
      └── relation-semantics
```

Но не следует строить глубокое дерево:

```text
a
 └── b
     └── c
         └── d
             └── e
```

Практическое правило:

```text
max 2 levels
```

Первый уровень — capability.

Второй — reasoning mode.

Если появляется третий уровень, скорее всего abstraction неверный.

---

# 18. Skill independence

Каждый skill должен иметь:

```text
one semantic responsibility
one stable input contract
one stable output contract
no hidden lifecycle
no hidden mutation
```

Плохой skill:

```text
feature-development
```

потому что он пытается владеть всем.

Хорошие:

```text
specification.authoring
domain.modeling
semantic.provenance
engineering.tdd
```

---

# 19. Mutation boundary

По умолчанию:

```text
Skill = READ + REASON + PROPOSE
```

Не:

```text
Skill = arbitrary WRITE
```

Mutation проходит через Factory:

```text
proposal
→ policy
→ approval/guard
→ deterministic mutation
→ evidence
```

Особенно это важно для LATTICE.

Skill может предложить:

```yaml
object:
  type: TestResult
```

но не должен напрямую менять canonical LATTICE.

Правильный путь:

```text
Skill
  ↓
proposal
  ↓
review / policy
  ↓
mutation engine
  ↓
LATTICE
```

---

# 20. Anti-hallucination boundary

Skills должны явно различать:

```text
FACT
INFERENCE
ASSUMPTION
PROPOSAL
DECISION
UNKNOWN
```

Нельзя преобразовывать:

```text
LLM inference
```

в:

```text
fact
```

без соответствующего grounding.

Это особенно важно для:

```text
provenance
domain modeling
migration
architecture
research
```

---

# 21. Skills и Evidence

Skill сам по себе не является доказательством.

Например:

```text
code-review = PASS
```

не означает:

```text
software = correct
```

Это означает:

```text
reviewer found no issue under specified review scope
```

Evidence должен связываться с:

```text
Change
commit
test run
context hash
skill
policy
timestamp
```

Например:

```yaml
evidence:
  type: review
  change_id: CHG-001
  skill: engineering.code-review
  mode: spec-compliance
  commit: abc123
  context_hash: ...
  result: PASS
```

---

# 22. LATTICE integration

LATTICE не должен превращаться в storage для всех промежуточных мыслей.

В LATTICE попадает durable semantic knowledge:

```text
concept
entity
decision
requirement
evidence
test result
relation
provenance
history
```

Не нужно индексировать туда автоматически:

```text
every prompt
every thought
every retry
every temporary variable
every agent scratchpad
```

Иначе LATTICE станет event/log/debug store.

---

# 23. Minimal initial implementation

Не нужно реализовывать всё дерево сразу.

## Phase 1 — Core

```text
specification.authoring
specification.clarification

domain.modeling
domain.boundary-review

semantic.substrate-modeling
semantic.provenance
semantic.canonicalization

engineering.tdd
engineering.code-review
```

Это уже покрывает основной loop.

## Phase 2

```text
specification.scenario-engineering
investigation.bug-diagnosis
investigation.research
engineering.architecture-design
```

## Phase 3

```text
semantic.epistemic-review
semantic.semantic-diff
domain.relation-semantics
evolution.semantic-migration
evolution.architecture-audit
```

Не добавлять Phase 3 до появления реальных случаев, которые Phase 1/2 не покрывают.

---

# 24. Final Skill Registry

Внешний registry можно сделать очень маленьким:

```yaml
skills:

  specification:
    modes:
      - authoring
      - clarification
      - scenario-engineering

  domain:
    modes:
      - modeling
      - boundary-review
      - relation-semantics

  semantic:
    modes:
      - substrate-modeling
      - provenance
      - epistemic-review
      - canonicalization
      - semantic-diff

  engineering:
    modes:
      - tdd
      - implementation
      - code-review
      - architecture-design

  investigation:
    modes:
      - research
      - bug-diagnosis

  evolution:
    modes:
      - architecture-audit
      - semantic-migration
```

Но Factory не обязан вызывать `skills/semantic/provenance` как отдельную систему.

Интерфейс:

```text
invoke_skill(
    skill="semantic",
    mode="provenance",
    context=...
)
```

---

# 25. Что в итоге получилось

Вместо плоского набора из ~20 skills:

```text
20 independent skills
```

получаем:

```text
6 core capabilities
    │
    ├── ~20 lightweight modes
    │
    └── one common contract
```

Это существенно проще архитектурно.

Главное — **количество reasoning capabilities не уменьшилось**.

Мы просто убрали ложную независимость между ними.

---

# 26. Финальная модель Dark Factory

```text
                    ┌───────────────┐
                    │    OpenSpec   │
                    │   lifecycle   │
                    └───────┬───────┘
                            │
                            ▼
                    ┌───────────────┐
                    │    Factory    │
                    │   Controller  │
                    └───────┬───────┘
                            │
              ┌─────────────┼─────────────┐
              │             │             │
              ▼             ▼             ▼
        specification     domain       semantic
              │             │             │
              └─────────────┼─────────────┘
                            │
                            ▼
                       engineering
                            │
                            ▼
                     investigation
                            │
                            ▼
                        evolution
                            │
                            ▼
                 deterministic checks
                            │
                            ▼
                         LATTICE
                            │
                            ▼
                         Evidence
```

Но логически это не pipeline из шести stages.

Это **capability graph**.

Любой Change использует только необходимый набор capabilities.

---

# 27. Основные архитектурные правила

### Rule 1 — Skill не является workflow

Workflow принадлежит OpenSpec + Factory.

### Rule 2 — Skill не является policy

Policy определяет, когда skill требуется.

### Rule 3 — Skill не является check

Если ответ можно получить детерминированно — это code/check.

### Rule 4 — Skill не является SSOT

Skill производит reasoning result, а не canonical knowledge.

### Rule 5 — Skill не мутирует canonical state напрямую

Mutation идёт через Factory/guards.

### Rule 6 — Skills должны быть composable

Не создавать новый skill только ради комбинации существующих.

### Rule 7 — один контракт результатов

Все skills возвращают единый result envelope.

### Rule 8 — LATTICE хранит semantic knowledge, а не agent scratchpad

### Rule 9 — неизвестное нельзя молча превращать в факт

### Rule 10 — новый skill требует реального gap

Если существующие skill + mode + deterministic check решают задачу, новый skill не нужен.

---

# 28. Главный принцип

Итоговая система должна быть максимально близка к:

```text
few capabilities
+
many lightweight modes
+
strong deterministic infrastructure
```

а не:

```text
many specialized agents
+
many specialized skills
+
many overlapping workflows
```

Поэтому целевая философия Skills:

```text
Skills reason.
OpenSpec specifies.
Factory governs.
Checks enforce.
LATTICE remembers meaning.
Evidence proves what happened.
```

Именно такая граница позволяет сохранить мощность `grill-with-docs`, `domain-modeling`, `TDD`, `research`, `bug diagnosis`, `code review` и LATTICE-specific reasoning, не превращая Dark Factory в ещё один тяжёлый process framework.

---
---

## Что нужно исправить

проверить не дублируют данные скилл уже заложенный функционал
yaml - по возможности заменить на json
в skills добавить правильно версионирование
продумать как разбить на более мелкие навыки чтобы было более модульно, но без потери качества, продумать как можно комбинировать навыки
продумать возможность добавление инструментов
проверить согласованность
продумать что можно сделать детерминировано
найти готовые скиллы проверить и доработать
предусмотреть аудит и оценку работы, для будущего улучшения навыков
по возможности заложить индексацию\классификацию LATTICE

### 1. В result envelope нельзя использовать только PASS/FAIL/INCONCLUSIVE

Нужно добавить:

```
WAIT
BLOCKED
NOT_APPLICABLE
WAIVED
```

Рекомендуемая модель:

```
status:
  - pass
  - fail
  - inconclusive
  - wait
  - blocked
  - not_applicable
  - waived
```

Иначе skill не сможет корректно отличить:

```
проверка не нужна
```

от:

```
проверка нужна, но не выполнена
```

### 2. `decisions_required` недостаточно

Нужны отдельные типы результата:

```
findings: []
proposals: []
decisions_required: []
assumptions: []
unknowns: []
artifacts_to_update: []
recommended_operations: []
```

Особенно важно не смешивать:

```
UNKNOWN
ASSUMPTION
PROPOSAL
DECISION
```

в одном массиве.

### 3. Нужен skill-level `authority`

У каждого skill/mode должна быть явно указана authority:

```
authority:
  canonical_mutation: none
  policy_change: none
  evidence_creation: propose_only
  artifact_edit: controlled
```

Иначе позднее появятся скрытые исключения.

### 4. `engineering.implementation` выглядит слишком близко к workflow

Это самый спорный элемент.

Если implementation skill:

```
load Change
→ resolve write scope
→ execute implementation
→ use TDD
→ prepare review
```

то он начинает владеть workflow, хотя документ это запрещает.

Лучше разделить:

```
Factory operation:
  implementation session orchestration

Skill:
  implementation reasoning within an already-approved task
```

То есть:

```
factory implement
  → создаёт session
  → выдаёт context
  → вызывает engineering/implementation
  → запускает checks
  → собирает evidence
```

А skill не должен сам решать, когда implementation завершена.

### 5. `engineering.code-review` слишком широкий

Решение объединить code, spec, architecture, data и security review в один skill экономит количество names, но может снизить качество.

Я бы оставил один capability:

```
engineering/code-review
```

но сделал независимые review modes с разными контекстами и, желательно, разными reviewer runs:

```
code-review/spec-compliance
code-review/architecture
code-review/security
code-review/data-impact
```

Не запускать их одним prompt’ом, иначе reviewer будет поверхностным.

### 6. Нужен `specification.consistency` mode

В документе есть `analyze` на уровне Factory, но отсутствует явное место для semantic review спецификации как документа.

Я бы добавил:

```
specification/consistency
```

Он проверяет reasoning-level вещи:

- требование противоречит другому требованию;
- scenario не соответствует terminology;
- acceptance criterion не наблюдаем;
- boundary не покрыта;
- requirement смешивает what и how;
- data semantics неполны;
- non-goal конфликтует с goal.

Детерминированная часть остаётся `factory-analyze`, а semantic часть — этот mode.

### 7. Нужен `evidence-interpretation`

Не для создания evidence и не для проверки файлов. Нужен reasoning skill, который отвечает:

```
Достаточно ли собранных evidence для конкретного claim?
```

Например:

```
test passed
```

не всегда доказывает:

```
migration safe
```

Skill должен анализировать:

- claim;
- scope;
- evidence type;
- limitations;
- reproducibility;
- observed vs inferred;
- coverage gaps.

Это полезно для LATTICE `grounding` и `epistemic_state`.

Добавить:

```
semantic/evidence-reasoning
```
