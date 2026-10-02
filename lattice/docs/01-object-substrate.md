---
id: LATTICE-DOC-01
title: LATTICE — Object Substrate
status: normative
maturity: MVP
version: 0.1.0
---

# 01. LATTICE — Object Substrate

---
## Открытые вопросы

Семь пунктов «Рассмотреть / исправить» решены в [06-lattice-substrate-decisions](03-substrate-decisions.md) (D1–D7); механические правки из решений применены здесь, остальное действует как норма того документа до переноса.

---
## 0. Назначение документа

Этот документ является целостной спецификацией рефакторинга единой объектной модели SEF × JEV.

Цель рефакторинга — не минимизировать количество типов, полей или relations любой ценой, а устранить смешение независимых семантических осей и получить модель, в которой каждый механизм отвечает на один определённый вопрос.

Целевая архитектура должна одновременно обеспечить:

* устойчивую идентичность объектов;
* независимую классификацию;
* независимые состояния принятия, актуальности и эпистемического статуса;
* явную provenance;
* контролируемую историю;
* компактный, но семантически достаточный graph vocabulary;
* bounded contexts с собственными языками;
* распределённый type registry;
* lossless migration со старой модели;
* отсутствие повторного превращения системы в `SYS`/`TERM`/`META`-монолит;
* возможность машинной проверки всех преобразований.

Главный принцип:

> **Не минимизировать количество сущностей любой ценой. Минимизировать количество разных механизмов, используемых для ответа на один и тот же семантический вопрос.**

---

# 1. Нормативные принципы

## 1.1. Один вопрос — одна ось

Каждое поле модели должно отвечать на один вопрос.

| Вопрос                                                 | Механизм          |
| ------------------------------------------------------ | ----------------- |
| Что это за сущность?                                   | `identity`        |
| В каком контексте живёт?                               | `context`         |
| К какому семантическому классу относится?              | `classification`  |
| Было ли решение принять объект?                        | `acceptance`      |
| Используется ли объект сейчас?                         | `currency`        |
| На каком основании утверждение существует?             | `grounding`       |
| Насколько утверждение разрешено/оспорено/не разрешено? | `epistemic_state` |
| Откуда получено утверждение?                           | `provenance`      |
| Как объект связан с другими?                           | `edge`            |
| Как объект изменялся?                                  | `history`         |
| Какой это graph schema?                                | `graph_format`    |

Нельзя использовать одно поле для ответа на несколько независимых вопросов только ради уменьшения количества полей.

---

## 1.2. Context ≠ type ≠ identity

`context` определяет bounded context и язык модели.

`type` определяет семантическую классификацию внутри этого context.

`identity` определяет конкретный объект.

Поэтому:

```text
context ≠ type
type ≠ identity
classification ≠ identity
```

Изменение классификации само по себе не должно автоматически уничтожать identity.

---

## 1.3. Edge ≠ object

Обычная связь между двумя объектами является edge.

Она не превращается в отдельный object только потому, что у неё есть семантическая роль.

Relation object создаётся только если сама связь имеет:

* собственную identity;
* независимый lifecycle;
* собственную provenance/history;
* необходимость адресации;
* либо самостоятельные свойства, которые нельзя корректно хранить как свойства edge.

Это исключает возврат к модели, где каждое отношение становится отдельным узлом.

---

## 1.4. State ≠ root kind

`state` не является универсальным видом объекта.

Например:

```text
accepted
deprecated
observed
contested
```

не должны превращаться в object types.

Состояния являются ортогональными свойствами объекта.

---

## 1.5. Provenance ≠ identity

Источник, commit, hash и физическое расположение описывают происхождение конкретного наблюдаемого представления объекта.

Они не являются identity объекта.

Следовательно:

```text
git_commit ≠ object_id
content_hash ≠ object_id
source_path ≠ object_id
line_number ≠ object_id
```

---

## 1.6. Graph ≠ knowledge SSOT

Документы и другие определённые источники остаются knowledge/source SSOT.

Graph является:

1. структурированной projection;
2. результатом классификации;
3. явным semantic overlay там, где решение не содержится непосредственно в source;
4. объектом машинной проверки.

Graph не должен незаметно становиться вторым независимым источником истины.

Каждое существенное поле graph должно иметь явно определённого owner.

---

# 2. Целевая архитектура

Модель разделяется на независимые слои:

```text
                    ┌──────────────────────┐
                    │       IDENTITY       │
                    │ id / context / name  │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │   CLASSIFICATION     │
                    │ root_kind / type     │
                    │ subtype / properties │
                    └──────────┬───────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
      ┌───────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
      │  ACCEPTANCE  │ │  CURRENCY   │ │ EPISTEMICS  │
      │ draft/...    │ │ active/...  │ │ settled/... │
      └──────────────┘ └─────────────┘ └──────┬───────┘
                                              │
                                      ┌───────▼───────┐
                                      │   GROUNDING   │
                                      │ declared/...  │
                                      └───────────────┘

        ┌──────────────────┐       ┌──────────────────┐
        │   PROVENANCE     │       │     HISTORY      │
        │ source/hash/git  │       │ semantic changes │
        └──────────────────┘       └──────────────────┘

                       ┌─────────────────────┐
                       │       EDGES         │
                       │ relation + role +   │
                       │ edge properties     │
                       └─────────────────────┘
```

---

# 3. Bounded contexts

Первоначальная модель использует семь bounded contexts:

```text
kernel
lexicon
method
meta
platform
runtime
evidence
spec        (добавлен решением D8.1 — объекты OpenSpec: change, requirement, scenario, task, decision, data_contract)
```

`experiment` **не является отдельным context на этом этапе**.

Это не означает запрет на его появление навсегда. Новый bounded context может быть добавлен только при доказательстве собственной:

* терминологии;
* invariants;
* lifecycle;
* ответственности;
* языка;
* context boundary.

---

## 3.1. `kernel`

`kernel` — инфраструктурный shared kernel, а не обычный предметный context.

Он владеет только механизмами, необходимыми для идентичности и технической истории объектов.

Допустимое содержание:

```text
ObjectIdentity
Alias
Version
ProvenanceRef
HistoryRef
Context membership
```

`kernel` НЕ владеет:

* терминами;
* методологией;
* platform semantics;
* runtime semantics;
* evidence semantics;
* concrete types;
* domain rules;
* business meaning.

### Важное ограничение

В kernel-node **нет** поля:

```yaml
classification:
```

Classification является семантической projection из соответствующего context/type registry.

---

# 4. `lexicon`

`lexicon` отвечает за язык и понятия.

Примеры:

```text
term
definition
alias
concept
hypothesis
question
```

Здесь могут существовать:

```text
lexicon/observation        (type: term)
lexicon/HYP-012            (type: hypothesis)
lexicon/QST-004            (type: question)
```

Но `lexicon` не владеет типами platform/runtime/evidence.

---

# 5. `method`

`method` отвечает за методологию работы.

Примеры:

```text
step
checklist
trap
level
procedure
spike
```

`spike` может находиться здесь, если его смысл — методологический эксперимент/исследовательская процедура, а не runtime event.

---

# 6. `meta`

`meta` не является центральным реестром всех типов системы.

Его задача — определить **метаязык классификации**, например:

```text
concept
thing
event
```

и общие правила:

* что считается root kind;
* какие classification axes существуют;
* какие поля являются стандартными;
* какие invariants обязательны для classification;
* как валидируется локальный type registry.

`meta` **не владеет concrete type vocabulary всех contexts**.

---

# 7. `platform`

`platform` содержит семантику SEF-платформы:

```text
component
invariant
slice
gate
contract
policy
control
```

Например:

```text
platform/dispatcher        (thing / component)
platform/INV-4             (concept / invariant)
platform/write-scope       (concept / policy)
```

Конкретный набор типов объявляется самим `platform`.

---

# 8. `runtime`

`runtime` отвечает за реально происходящие execution/runtime phenomena:

```text
attempt
session
execution
event
journal
signal
```

Например:

```text
runtime/ATT-000417         (event / attempt)
runtime/SES-2026-09-22-01  (event / session)
```

Runtime events не должны смешиваться с методологическими правилами или evidence records.

---

# 9. `evidence`

`evidence` отвечает за источники, ссылки и доказательную базу:

```text
source
ref
record
baseline
oracle
observation
measurement
```

Например:

```text
evidence/platform-md       (thing / source)
evidence/plat-4-5          (thing / ref)
evidence/baseline-dispatcher-v2  (thing / baseline)
```

---

# 10. Куда девается `experiment`

Отдельный `experiment` context не создаётся автоматически.

Его прежние сущности распределяются по смыслу:

| Legacy experiment concept    | Target context               |
| ---------------------------- | ---------------------------- |
| hypothesis                   | `lexicon`, type `hypothesis` |
| question                     | `lexicon`, type `question`   |
| spike как метод исследования | `method`, type `spike`       |
| baseline                     | `evidence`, type `baseline`  |
| oracle                       | `evidence`, type `oracle`    |
| observation                  | `evidence`, type `observation` |
| execution/attempt            | `runtime`, type `attempt`    |

Если в будущем обнаружится самостоятельный экспериментальный язык с собственными invariants и lifecycle, создаётся отдельный context через процедуру изменения архитектуры.

Запрещено создавать `experiment/*` только как удобную папку.

---

# 11. Context Map

Контексты не взаимодействуют через произвольное копирование полей.

Используются:

* identity;
* explicit contracts;
* translation;
* context mapping.

Целевая схема:

```text
                         ┌──────────────┐
                         │    KERNEL    │
                         │ Shared Kernel│
                         └──────┬───────┘
                                │
       ┌────────────┬───────────┼───────────┬────────────┐
       ▼            ▼           ▼           ▼            ▼
    lexicon       method       meta       platform     runtime
       │            │           │           │            │
       └────────────┴───────────┼───────────┴────────────┘
                                │
                                ▼
                             evidence
```

## 11.1. Kernel

`kernel` — Shared Kernel.

Он общий только на уровне:

* identity;
* alias;
* provenance references;
* version/history mechanics.

Он не является Shared Kernel для domain semantics.

---

## 11.2. Meta

`meta` — Supplier для остальных contexts на уровне общего classification contract.

Он поставляет:

```text
root kinds
classification rules
generic schema constraints
validation semantics
```

Но не поставляет concrete types.

---

## 11.3. Concrete contexts

Каждый context является владельцем собственного vocabulary.

Например:

```text
platform → component, invariant, gate...
runtime  → attempt, session, event...
evidence → source, ref, baseline...
```

Другие contexts используют их через explicit contracts, а не через прямое владение их полями.

---

## 11.4. Anti-Corruption Layer

Если модели двух contexts имеют одинаковое слово с разным смыслом, запрещено автоматически считать объекты эквивалентными.

Используется mapping:

```text
source context
    ↓
translation / ACL
    ↓
target context
```

Таким образом предотвращается постепенное протекание vocabulary одного context в другой.

---

# 12. Distributed Type Registry

Типы регистрируются локально.

Например:

```text
platform/types.yaml
runtime/types.yaml
evidence/types.yaml
method/types.yaml
lexicon/types.yaml
```

Каждый registry определяет:

```yaml
context: platform

types:
  - name: component
    root_kind: thing

  - name: invariant
    root_kind: concept
```

`meta` определяет допустимый формат этого registry, но не владеет его конкретным содержимым.

---

## 12.1. Classification

Classification объекта:

```yaml
classification:
  root_kind: thing
  type: component
  subtype: null
```

является семантической projection.

Она не принадлежит kernel identity.

---

## 12.2. Subtype

Subtype разрешается только если:

1. различие имеет самостоятельный semantic meaning;
2. оно используется машинно или нормативно;
3. оно имеет устойчивый vocabulary;
4. property не выражает ту же семантику без потери.

Если достаточно:

```yaml
properties:
  role: ...
```

новый subtype не создаётся.

---

# 13. Root kinds

Используются три root kind:

```text
concept
thing
event
```

---

## 13.1. `concept`

Абстрактная семантическая сущность:

```text
term
rule
policy
invariant
hypothesis
question
```

---

## 13.2. `thing`

Адресуемая сущность:

```text
component
source
baseline
reference
artifact
```

---

## 13.3. `event`

Факт произошедшего действия/изменения:

```text
attempt
execution
observation-event
runtime event
```

---

## 13.4. Что не является root kind

### State

Состояние — property/axis.

### Binding

Обычная связь — edge.

### Relation

Relation — edge vocabulary.

Это принципиальное ограничение против object explosion.

---

# 14. Identity

Каноническая identity:

```text
<context>/<name>
```

Например:

```text
platform/dispatcher
platform/INV-4
lexicon/observation
evidence/plat-4-5
method/spike-classifier
```

Ровно два сегмента. `name` MAY нести конвенциональный префикс (`INV-4`, `REQ-ING-001`); lint MUST NOT выводить из него classification (D1).

---

## 14.1. Identity не содержит classification

Запрещён id вида:

```text
platform/component/dispatcher
```

потому что средний сегмент — это classification (`type = component`), а она — отдельная информация. Правильно: `platform/dispatcher` + `classification.type = component`.

---

## 14.2. `name`

`name` — machine-stable identity component.

`display_name`, `label`, `title` — presentation metadata.

Изменение display label не должно автоматически менять identity.

---

## 14.3. Legacy addresses

Старые addresses сохраняются как aliases:

```yaml
aliases:
  - SEF-COMP-CAPABILITY-004
```

Старый address больше не является canonical identity, но остаётся разрешаемым.

---

## 14.4. Reclassification

Если объект остаётся той же semantic entity, его identity сохраняется:

```text
same identity
      +
new classification
```

Если semantic identity действительно изменилась, создаётся новый object:

```text
new_object
   └── evolves_from / supersedes → old_object
```

Таким образом различаются:

* reclassification;
* semantic replacement;
* rename;
* move;
* carrier change.

---

# 15. Node contract

Минимальный kernel identity record:

```yaml
id: platform/dispatcher
context: platform
name: dispatcher

version: 2

aliases:
  - SEF-COMP-CAPABILITY-004

provenance:
  source: docs/platform.md
  content_hash: sha256:...
  git_commit: abc123
  location:
    anchor: dispatcher
    lines: [120, 145]
```

В kernel record **нет**:

```yaml
classification:
phase:
status:
grounding:
relations:
```

Эти сведения находятся в соответствующих semantic projections.

---

# 16. State model

Старая единая ось `status` удаляется.

Она разделяется минимум на четыре независимые оси:

```text
acceptance
currency
grounding
epistemic_state
```

---

# 17. Acceptance

`acceptance` отвечает только на вопрос:

> Принято ли это как решение/модель?

Допустимые значения:

```text
draft
proposed
accepted
rejected
```

Семантика:

| Value      | Meaning                                |
| ---------- | -------------------------------------- |
| `draft`    | рабочая незавершённая формулировка     |
| `proposed` | предложено для рассмотрения            |
| `accepted` | принято как действующее решение/модель |
| `rejected` | принято решение не использовать        |

`rejected` не означает `retired`.

---

# 18. Currency

`currency` отвечает только на вопрос:

> Используется ли объект сейчас?

Допустимые значения:

```text
active
deprecated
retired
```

| Value        | Meaning                                                             |
| ------------ | ------------------------------------------------------------------- |
| `active`     | используется                                                        |
| `deprecated` | ещё существует/может использоваться, но применение не рекомендуется |
| `retired`    | выведено из использования                                           |

Это позволяет выразить:

```yaml
acceptance: accepted
currency: deprecated
```

то есть:

> решение было принято, но сейчас оно устаревает.

---

# 19. Grounding

`grounding` отвечает только на вопрос:

> На каком основании существует утверждение?

Допустимые значения:

```text
declared
derived
observed
inferred
```

| Value      | Meaning                                                   |
| ---------- | --------------------------------------------------------- |
| `declared` | явно заявлено источником/актором                          |
| `derived`  | формально выведено из других данных/утверждений           |
| `observed` | непосредственно наблюдалось                               |
| `inferred` | получено как inference, но не является прямым наблюдением |

`grounding` не содержит состояния уверенности или спора.

---

# 20. Epistemic state

`epistemic_state` отвечает только на вопрос:

> В каком состоянии находится знание об утверждении?

Допустимые значения:

```text
settled
contested
unresolved
```

| Value        | Meaning                                          |
| ------------ | ------------------------------------------------ |
| `settled`    | в текущей модели нет открытого epistemic dispute |
| `contested`  | существуют явные противоречия/оспаривание        |
| `unresolved` | недостаточно оснований для разрешения            |

Примеры:

```yaml
grounding: observed
epistemic_state: contested
```

означает:

> наблюдение существует, но его интерпретация/истинность оспаривается.

```yaml
grounding: null
epistemic_state: unresolved
```

означает:

> основание пока не установлено.

```yaml
grounding: derived
epistemic_state: settled
```

означает:

> утверждение выведено и в текущей модели считается разрешённым.

---

# 21. Mutable epistemic state

`grounding` и `epistemic_state` не являются immutable.

Например:

```text
declared / unresolved
        ↓
observed / unresolved
        ↓
observed / settled
```

или:

```text
declared / settled
        ↓
declared / contested
```

Такие изменения фиксируются history.

Нельзя кодировать переходы через замену identity.

---

# 22. Старый `status` не переносится как строка

Старая модель:

```text
planned
proposed
accepted
implemented
derived
open
disputed
unknown
reserved
deferred
historical
superseded
rejected
retired
```

не имеет одного универсального эквивалента.

Она раскладывается на независимые axes.

---

# 23. Нормативные migration rules для status

Миграция выполняется не вручную по объектам, а через детерминированные правила.

Базовые правила:

```text
old_status = planned
    → acceptance = draft
    → currency = active

old_status = proposed
    → acceptance = proposed
    → currency = active

old_status = accepted
    → acceptance = accepted
    → currency = active

old_status = implemented
    → acceptance = accepted
    → currency = active

old_status = derived
    → acceptance = accepted
    → currency = active
    → grounding = derived

old_status = rejected
    → acceptance = rejected

old_status = retired
    → acceptance = accepted
    → currency = retired

old_status = historical
    → acceptance = accepted
    → currency = retired

old_status = superseded
    → acceptance = accepted
    → currency = retired
    → create lineage: evolves_from

old_status = deprecated
    → acceptance = accepted
    → currency = deprecated
```

Для старых значений:

```text
open
disputed
unknown
reserved
deferred
```

нельзя автоматически выдумывать grounding.

Используется контекст + source evidence.

Например:

```text
old_status = disputed
    → epistemic_state = contested
```

а `grounding` определяется независимо из источника.

```text
old_status = unknown
    → epistemic_state = unresolved
```

```text
old_status = reserved
    → acceptance = draft
```

```text
old_status = deferred
    → acceptance = draft
```

Если источник не позволяет определить необходимую ось, значение остаётся `null` и создаётся migration GAP.

Это предпочтительнее ложной точности.

---

# 24. Migration function

Формально:

```text
M(
  legacy_object,
  legacy_status,
  source_evidence,
  legacy_relations
)
→
(
  identity,
  classification,
  acceptance,
  currency,
  grounding,
  epistemic_state,
  lineage,
  migration_diagnostics
)
```

Migration function должна быть:

* детерминированной;
* versioned;
* idempotent;
* проверяемой;
* loss-aware.

Для каждого legacy object результат должен содержать:

```text
MIGRATED
MIGRATED_WITH_GAP
REJECTED_FOR_AMBIGUITY
```

Не допускается молчаливое ручное преобразование.

---

# 25. Неопределённость и процедура `unknown`

Неклассифицируемый объект не должен получать фиктивный тип:

```text
GENERAL
UNCLASSIFIED
MISC
OTHER
```

только для того, чтобы закрыть GAP.

Процедура:

```text
discovered
   ↓
identity assigned
   ↓
classification candidate
   ↓
evidence check
   ├── sufficient → classify
   └── insufficient
           ↓
      unresolved classification
           ↓
      explicit GAP
```

Допустимо временное состояние:

```yaml
classification:
  root_kind: null
  type: null

epistemic_state: unresolved
```

но такой объект должен иметь:

```text
classification_gap
owner
created_at
reason
review_condition
```

---

## 25.1. Срок жизни `unknown`

`unknown` не может быть бессрочным мусорным состоянием.

Каждый unresolved classification должен иметь:

```yaml
review:
  owner: ...
  due: ...
  condition: ...
```

Если evidence всё ещё недостаточно, GAP продлевается явно.

Нельзя закрывать GAP выдуманной классификацией.

---

# 26. Relation model

Целевая relation vocabulary:

```text
part_of
denotes
cites
depends_on
evolves_from
tests
causes
```

Это **семь relation families**.

---

# 27. `part_of`

Используется для структурной принадлежности:

```text
A --part_of--> B
```

Например:

```text
section --part_of--> document
component --part_of--> subsystem
```

`contains` является обратной projection:

```text
B contains A
```

но не отдельным canonical relation.

---

# 28. `denotes`

`denotes` используется для семантического обозначения:

```text
term --denotes--> concept
symbol --denotes--> concept
label --denotes--> concept
```

Это устраняет двусмысленность старого `defines`.

`denotes` отвечает:

> Что именно обозначает этот объект?

Если требуется дополнительная семантика:

```yaml
relation: denotes
props:
  role: terminological
```

---

# 29. `cites`

`cites` используется для ссылки на source/evidence point.

Например:

```text
rule --cites--> evidence/plat-4-5
```

Это не означает семантическое определение.

Различие:

```text
term --denotes--> concept
rule --cites--> ref
```

`denotes` — semantic relation.

`cites` — source/evidence relation.

---

# 30. `depends_on`

Используется для directed dependency.

Например:

```text
component --depends_on--> contract
policy --depends_on--> invariant
task --depends_on--> component
```

Роль уточняет dependency semantics:

```yaml
relation: depends_on
props:
  role: requires
```

или:

```yaml
relation: depends_on
props:
  role: governed_by
```

или:

```yaml
relation: depends_on
props:
  role: invokes
```

Новая relation создаётся только если `depends_on + role` не сохраняет необходимую семантику.

---

# 31. `evolves_from`

Используется для semantic lineage:

```text
new --evolves_from--> old
```

Покрывает:

```text
supersedes
replaces
narrows
extends
reclassifies
```

через role:

```yaml
relation: evolves_from
props:
  role: supersedes
```

или:

```yaml
relation: evolves_from
props:
  role: reclassifies
```

Это предпочтительнее отдельного relation vocabulary для каждого варианта lineage.

---

# 32. `tests`

Используется для проверки объекта. Canonical direction:

```text
test --tests--> target
```

Правило чтения едино для всех families: edge читается как «source *verb* target»; обратное направление (`is_tested_by`) — projection (D4).

Роли:

```text
unit
integration
acceptance
invariant
regression
```

могут храниться в edge properties.

---

# 33. `causes`

`causes` используется только для причинно-следственных утверждений.

```text
event A --causes--> event B
```

или:

```text
condition A --causes--> outcome B
```

`causes` не заменяет temporal ordering.

---

# 34. Temporal order

Временной порядок не является отдельным relation.

Он является свойством edge/event.

Например:

```yaml
relation: causes

props:
  temporal_order: before
```

Допустимые значения:

```text
before
after
concurrent
unknown
```

При необходимости допускаются более точные temporal properties:

```yaml
props:
  occurred_at: ...
  interval_start: ...
  interval_end: ...
  temporal_order: before
```

Правило:

> Если вопрос относится к времени конкретного события/связи, он хранится в event/edge temporal properties, а не создаётся новый relation `precedes`.

---

# 35. Relation creation rule

Новый relation family разрешён только если одновременно выполнены условия:

1. существующие relation + role не выражают семантику;
2. направление имеет самостоятельный смысл;
3. это нужно для машинной валидации или query semantics;
4. существует несколько реальных примеров;
5. distinction невозможно корректно выразить property;
6. есть явный owner vocabulary.

Иначе используется существующая family.

---

# 36. REF

`REF` — адресуемая точка в источнике.

Это не physical occurrence.

Для:

```text
SPEC.md §4.5
```

содержащего:

```text
[П §10.3]
```

создаётся один:

```text
evidence/<ref-name>
```

для уникальной addressable point:

```text
source = П
section = 10.3
anchor = ...
```

Если десять объектов ссылаются на этот пункт:

```text
A --cites--> REF
B --cites--> REF
C --cites--> REF
```

существует один REF.

---

# 37. REF occurrence

Физические occurrences не становятся отдельными objects.

Информация о конкретном месте обнаружения хранится в provenance edge:

```yaml
relation: cites
target: evidence/plat-4-5

provenance:
  source: SPEC.md
  anchor: section-4-5
  lines: [220, 224]
```

Это позволяет различать:

```text
REF = куда указывает ссылка
occurrence provenance = где именно ссылка была обнаружена
```

Отдельный `REF-OCCURRENCE` вводится только если в будущем потребуется собственная identity/lifecycle occurrence.

---

# 38. SECTION

SECTION также является addressable structural point.

Используются:

```text
number
anchor
path
section_lines
```

---

## 38.1. `number`

`number` — только авторская нумерация.

Например:

```text
6.2.1
```

Не генерировать искусственные номера.

---

## 38.2. `anchor`

`anchor` — стабильный ключ heading.

Он не должен быть:

```text
section-017
```

только потому, что это семнадцатый section.

---

## 38.3. `path`

`path` хранит structural heading context.

Например:

```text
Architecture / Graph / Relations
```

---

## 38.4. SECTION identity

SECTION существует как object, если имеется хотя бы:

* авторский `number`;
* либо уникальный heading/anchor.

Изменение порядка section — `move`, а не semantic version.

---

# 39. Formula для SECTION / REF

Главное различие:

> **SECTION/REF = where we point.**
>
> **Edge = who points.**
>
> **Provenance = where exactly discovered.**
>
> **Git/history = when/from which source state.**

---

# 40. Provenance

Минимальная provenance:

```yaml
provenance:
  source: ...
  content_hash: ...
  git_commit: ...
  location:
    anchor: ...
    lines: [...]
```

---

## 40.1. Git

Git отвечает:

> Что было в carrier/source state?

Git не определяет semantic version объекта.

---

## 40.2. Content hash

`content_hash` отвечает:

> Какой точный content был классифицирован?

---

## 40.3. Semantic version

`version` отвечает:

> Какая semantic revision объекта существует?

---

## 40.4. Move

Перемещение объекта:

```text
same semantics
different carrier location
```

является `move`.

Оно не увеличивает semantic version.

---

# 41. History

История является projection.

Она не становится вторым SSOT.

Пример:

```yaml
history:
  - version: 1
    event: created
    hash: ...
    git_commit: abc

  - version: 2
    event: semantic_change
    prev_hash: ...
    hash: ...
    git_commit: def

  - event: move
    git_commit: ghi
```

Runtime timestamps не должны входить в `def_hash`.

---

# 42. Aggregate boundaries

Каждый aggregate имеет один root.

```text
Aggregate Root
    ├── local value/state
    └── local children without independent identity
```

Если child имеет независимую identity:

```text
separate object
+
relation
```

а не duplicated embedded object.

---

# 43. Vertical slices

Миграция и дальнейшая работа выполняются вертикальными operations.

Примеры:

```text
AddObject
AlignTerms
IntroduceType
RejectModel
RecordDecision
AddReference
ReclassifyObject
DeprecateObject
RetireObject
```

Каждая operation проходит:

```text
input
  ↓
eligibility
  ↓
classification
  ↓
identity
  ↓
invariants
  ↓
state
  ↓
relations
  ↓
provenance
  ↓
history
  ↓
projection
  ↓
lint
```

---

# 44. Экономика объекта

Object не создаётся только потому, что некоторый текст можно назвать сущностью.

Перед созданием объекта задаётся вопрос:

> Требуется ли этой сущности самостоятельная identity?

Object justified, если выполняется хотя бы один критерий:

1. на него должны ссылаться несколько объектов;
2. у него есть самостоятельный lifecycle;
3. он имеет собственную provenance;
4. он должен участвовать в graph query;
5. он является target/source relation;
6. он имеет самостоятельные invariants;
7. его нужно адресовать независимо;
8. его semantic history имеет значение.

Если ничего из этого нет — предпочтительно:

```text
property
```

или:

```text
edge property
```

а не новый object.

---

# 45. Принцип против object explosion

Не создавать object для:

* каждого слова;
* каждого occurrence;
* каждого status transition;
* каждого relation role;
* каждой строки документа;
* каждого timestamp;
* каждого property;
* каждого UI label.

Например:

```text
REF
```

создаётся один раз для addressable source point.

А физические occurrences остаются provenance.

---

# 46. Rule precedence

В системе должны существовать уровни нормативности.

При конфликте действует следующий порядок:

```text
R0 — source-of-truth / external constraint
R1 — architecture invariants
R2 — context contract
R3 — object/type rules
R4 — operation rules
R5 — projection conventions
R6 — presentation conventions
```

Правило более низкого уровня не может противоречить более высокому.

Например:

```text
projection convention
```

не может отменить:

```text
architecture invariant
```

---

## 46.1. Conflict handling

Если два правила одного уровня конфликтуют:

```text
conflict
  ↓
do not guess
  ↓
create explicit decision/GAP
  ↓
owner resolves
```

Нельзя разрешать конфликт:

* по времени появления;
* по частоте использования;
* по удобству реализации;
* молчаливым приоритетом.

Каждое правило должно иметь:

```text
rule_id
owner
scope
precedence
source
```

---

# 47. Failure criteria модели

Модель считается неработающей, если возникает устойчивый контрпример, который требует нарушения одного из core principles.

Критические failure modes:

### F1. Classification changes identity

Если reclassification систематически требует создания нового identity без semantic identity change.

### F2. One field answers multiple questions

Например `status` снова начинает означать одновременно acceptance + currency + epistemic state.

### F3. Relation explosion

Если новые semantic distinctions постоянно требуют новых relation families, хотя они выражаются existing relation + role.

### F4. Context leakage

Если platform начинает владеть runtime vocabulary или runtime начинает использовать platform semantics без explicit contract.

### F5. Kernel semantic leakage

Если kernel начинает хранить domain-specific types/rules.

### F6. Lossy migration

Если legacy semantics невозможно восстановить из target representation + lineage + provenance.

### F7. Unknown laundering

Если unresolved objects систематически получают фиктивные types только ради закрытия GAP.

### F8. Object explosion

Если properties/occurrences/roles регулярно превращаются в objects без самостоятельной identity.

### F9. Projection becomes SSOT

Если source больше не позволяет объяснить происхождение graph semantic fact.

### F10. Query ambiguity

Если одна и та же relation/property имеет несколько несовместимых трактовок.

---

# 48. Контрпример как тест модели

Для любого спорного решения задаётся:

```text
What real object cannot be represented?
What information would be lost?
Which invariant would be violated?
Which query would become impossible?
```

Если новый design не может представить существующий реальный кейс без специального исключения, это архитектурный сигнал.

---

# 49. Health metrics

Простые counts недостаточны.

Health измеряется динамикой.

Минимальный dashboard:

### 49.1. Classification health

```text
unresolved_classification_rate
classification_gap_age_p50
classification_gap_age_p95
reclassification_rate
```

---

### 49.2. Vocabulary health

```text
new_type_rate
new_relation_rate
new_role_rate
unused_type_rate
unused_relation_rate
```

Особенно важен:

```text
new_relation / month
```

Рост relation vocabulary без новых semantic requirements является сигналом деградации.

---

### 49.3. Provenance health

```text
objects_without_source
objects_without_content_hash
objects_without_resolvable_alias
dangling_refs
```

---

### 49.4. Migration health

```text
migration_coverage
migration_gap_rate
lossless_reconstruction_rate
legacy_alias_resolution_rate
```

Цель:

```text
migration_coverage = 100%
lossless_reconstruction_rate = 100%
```

к моменту завершения migration.

---

### 49.5. Graph health

```text
orphan_object_rate
dangling_edge_rate
invalid_relation_rate
duplicate_identity_rate
projection_drift_rate
```

---

### 49.6. Trend criterion

Здоровый graph — не graph с минимальным количеством объектов.

Здоровый graph — graph, в котором:

* GAPs контролируются;
* unresolved state не накапливается бесконечно;
* vocabulary растёт только при реальной необходимости;
* duplicate semantics уменьшается;
* provenance coverage растёт;
* migration loss уменьшается;
* relation proliferation контролируется;
* lint remains deterministic.

Тренд важнее абсолютного count.

---

# 50. Lint

Lint должен проверять независимо:

## Identity

* duplicate IDs;
* invalid context;
* broken aliases;
* reused legacy addresses.

## Classification

* unknown type;
* invalid root kind;
* invalid subtype;
* context/type mismatch.

## State

* invalid acceptance;
* invalid currency;
* invalid grounding;
* invalid epistemic state.

## Relations

* invalid relation;
* invalid role;
* wrong direction;
* dangling target;
* illegal context relation.

## Provenance

* missing source;
* invalid hash;
* unresolved location;
* missing provenance where required.

## History

* broken version chain;
* impossible lineage;
* inconsistent reclassification.

## Migration

* unmapped legacy object;
* unmapped legacy status;
* semantic loss;
* unresolved GAP;
* broken alias.

---

# 51. Determinism

Graph build должен быть deterministic.

Одинаковый input:

```text
same source state
same registry
same migration rules
```

должен давать:

```text
same graph
same classification
same hashes
same lint result
```

Runtime timestamps не должны менять semantic hashes.

---

# 52. Worked example — Dispatcher

## 52.1. Legacy

Старый объект:

```yaml
address: SEF-COMP-CAPABILITY-004

name: dispatcher

type: COMP
subtype: CAPABILITY

status: accepted

ontoclass: SYS
```

Предположим, source говорит, что dispatcher является действующим компонентом SEF, а его описание является явным architectural declaration.

---

## 52.2. Target identity

Новый identity:

```yaml
id: platform/dispatcher
context: platform
name: dispatcher

aliases:
  - SEF-COMP-CAPABILITY-004
```

SEQ исчезает из canonical identity.

---

## 52.3. Classification

```yaml
classification:
  root_kind: thing
  type: component
```

`classification` принадлежит platform semantic projection, а не kernel.

---

## 52.4. Acceptance / currency

Legacy:

```text
accepted
```

Target:

```yaml
acceptance: accepted
currency: active
```

---

## 52.5. Grounding / epistemics

Источник содержит явное declaration:

```yaml
grounding: declared
epistemic_state: settled
```

Это **не** выводится из `accepted`.

---

## 52.6. Provenance

```yaml
provenance:
  source: ...
  content_hash: ...
  git_commit: ...
  location:
    anchor: dispatcher
    lines: [...]
```

---

## 52.7. Relations

Например:

```text
dispatcher
  --depends_on(role=contract)--> dispatch-contract

dispatcher
  --depends_on(role=governed_by)--> runtime-policy

dispatcher-test
  --tests(role=acceptance)--> dispatcher
```

Если в source есть ссылочная опора:

```text
dispatcher
  --cites--> evidence/<ref-name>
```

---

## 52.8. Target result

```yaml
id: platform/dispatcher

classification:
  root_kind: thing
  type: component

acceptance: accepted
currency: active

grounding: declared
epistemic_state: settled

aliases:
  - SEF-COMP-CAPABILITY-004

provenance:
  source: ...
  content_hash: ...
  git_commit: ...
```

Семантика legacy object сохраняется, но независимые вопросы больше не смешаны.

---

# 53. Worked example — REF

Legacy source:

```text
SPEC.md §4.5:
[PLATFORM §10.3]
```

Другой document:

```text
DESIGN.md §7:
[PLATFORM §10.3]
```

Создаётся один:

```text
evidence/platform-10-3
```

Relations:

```text
SPEC-section-4-5
    --cites-->
evidence/platform-10-3

DESIGN-section-7
    --cites-->
evidence/platform-10-3
```

Каждое edge имеет собственную discovery provenance.

Таким образом:

```text
REF = addressable point
edge = reference relation
provenance = physical occurrence
```

---

# 54. Worked example — disputed observation

Допустим, источник содержит наблюдение, но два анализа спорят о его интерпретации.

Object:

```yaml
grounding: observed
epistemic_state: contested
```

Это корректно.

Нельзя записывать:

```yaml
grounding: disputed
```

потому что `disputed` не говорит ничего об основании наблюдения.

---

# 55. Worked example — accepted but deprecated

Решение было принято, затем появилась новая модель.

Старый object:

```yaml
acceptance: accepted
currency: deprecated
```

Новый object:

```yaml
acceptance: accepted
currency: active
```

Lineage:

```text
new
  --evolves_from(role=supersedes)-->
old
```

Это точнее, чем превращать старый object в:

```text
status: superseded
```

---

# 56. Migration architecture

Migration выполняется в следующих фазах.

## M0 — Freeze

Зафиксировать:

* graph snapshot;
* source snapshot;
* legacy registries;
* current lint;
* object count;
* relation count;
* address registry;
* version registry.

---

## M1 — Identity

Создать target identities.

Для каждого legacy object:

```text
legacy address
→ target id
```

Старый address сохранить alias.

---

## M2 — State

Разложить legacy status:

```text
→ acceptance
→ currency
→ grounding
→ epistemic_state
```

Grounding извлекается из evidence, а не угадывается по status.

---

## M3 — Root kinds

Каждый object классифицировать:

```text
concept
thing
event
```

State и Binding не создаются как root kinds.

---

## M4 — Type registries

Создать distributed registries.

```text
platform/types
runtime/types
method/types
lexicon/types
evidence/types
```

`meta` хранит общие classification rules.

---

## M5 — Relations

Каждую legacy relation преобразовать:

```text
legacy relation
→ family
→ role
→ direction
→ properties
```

Если mapping невозможен без semantic loss — GAP.

---

## M6 — REF / SECTION

Сохранить:

* SECTION identity;
* author numbering;
* anchors;
* REF addressable points;
* occurrence provenance.

---

## M7 — Context boundaries

Проверить:

* ownership;
* vocabulary;
* contracts;
* context leakage;
* ACL/mappings.

---

## M8 — Vertical operations

Перевести mutation workflows:

```text
AddObject
AddReference
RecordDecision
ReclassifyObject
DeprecateObject
RetireObject
...
```

---

## M9 — Projection

Перестроить graph projections.

---

## M10 — Lint / reconstruction

Проверить:

```text
legacy → target → reconstructed legacy semantics
```

---

# 57. Lossless migration criterion

Для каждого legacy object:

```text
Legacy Semantics
=
Target Representation
+
Lineage
+
Provenance
+
Migration Mapping
```

Если target representation не позволяет восстановить legacy semantics:

```text
MIGRATION GAP
```

а не молчаливое упрощение.

---

# 58. Migration invariants

После migration должны выполняться:

```text
legacy address resolves to exactly one target identity
```

```text
no target identity has two unrelated legacy owners
```

```text
every legacy relation has mapping or explicit GAP
```

```text
every legacy status has deterministic rule
```

```text
every semantic loss is explicit
```

```text
all REF points remain resolvable
```

```text
all SECTION anchors remain resolvable
```

---

# 59. Compatibility period

В переходный период разрешается:

```text
read legacy
write canonical
```

Новые объекты не создаются в старой identity model.

Legacy write допускается только через compatibility adapter.

Это предотвращает параллельное развитие двух моделей.

---

# 60. Запрет на silent fallback

Нельзя:

```text
unknown type → GENERAL
unknown relation → references
unknown status → accepted
missing grounding → declared
missing evidence → observed
```

Любое такое преобразование является semantic invention.

Вместо него:

```text
GAP
```

или:

```text
explicit unresolved state
```

---

# 61. Architecture change procedure

Изменение core vocabulary требует:

1. concrete use cases;
2. examples;
3. semantic analysis;
4. proof that existing vocabulary is insufficient;
5. migration rule;
6. lint rule;
7. owner;
8. documentation update.

Нельзя добавлять:

```text
new type
new relation
new context
new root kind
```

только потому, что это удобнее локальному коду.

---

# 62. Когда допустим новый bounded context

Новый context создаётся только если существует независимый:

```text
language
model
invariants
lifecycle
ownership
```

и существующие contexts не могут выразить его semantics без систематического leakage.

Таким образом `experiment` пока не является context.

---

# 63. Когда допустим новый root kind

Новый root kind разрешён только если нельзя корректно представить новую категорию как:

```text
concept
thing
event
```

и это доказано несколькими реальными cases.

`state` и `binding` не являются такими cases.

---

# 64. Когда допустима новая relation family

Требуется доказать:

```text
family + role
```

не сохраняет необходимую семантику.

Только после этого вводится новая family.

---

# 65. Когда допустим новый object

Требуется самостоятельная:

```text
identity
```

и хотя бы одна из:

```text
lifecycle
provenance
relations
invariants
query target
history
independent ownership
```

---

# 66. Target vocabulary

Целевая модель не утверждает искусственную цифру:

```text
5 types
6 relations
35 concepts
```

Количество является результатом migration и domain analysis.

Фиксируются не counts, а invariants:

```text
3 root kinds
7 relation families
4 acceptance states
3 currency states
4 grounding states
3 epistemic states
8 bounded contexts/areas including kernel and spec
```

При этом concrete type count распределён по contexts.

---

# 67. Legacy vocabulary mapping

Основная идея рефакторинга:

```text
44 legacy types
        ↓
context ownership
        ↓
root_kind
        ↓
local type
        ↓
optional subtype
        ↓
properties
```

Не требуется, чтобы все 44 legacy types буквально исчезли.

Некоторые будут:

* объединены;
* переименованы;
* превращены в property;
* разделены;
* перенесены в другой context;
* признаны не semantic type;
* удалены как технические артефакты.

---

# 68. TERM migration

Legacy `TERM` с множеством subtype не сохраняется как god object.

Принцип:

### Glossary classification

Если distinction только описывает glossary domain:

```text
property
```

### QST

Отдельный:

```text
lexicon/<name>   (type: question)
```

### HYP

Отдельный:

```text
lexicon/<name>   (type: hypothesis)
```

### GENERAL / UNCLASSIFIED

Не являются semantic types.

Используется:

```text
classification gap
```

или соответствующая реальная classification.

### INT / VIS / ROUTE

Переносятся в context, где они имеют собственную semantic responsibility.

---

# 69. Старые ontoclasses

`ontoclass` не должен оставаться второй независимой taxonomy, если его семантика уже выражена target classification.

Migration должна определить для каждого legacy ontoclass:

```text
identity
root_kind
type
subtype
property
or retired metadata
```

Если ontoclass содержит действительно независимую ось, она сохраняется как отдельное property.

---

# 70. Graph projections

Graph blocks являются projections:

```text
context
type
root_kind
relation
```

Они не являются semantic owners.

Один object может участвовать в нескольких projections.

---

# 71. Canonical edge ownership

Каждое semantic edge имеет одного owner.

Projection может показывать:

```text
A → B
```

в нескольких блоках, но это одна semantic relation.

Нельзя создавать:

```text
platform relation
+
runtime relation
+
evidence relation
```

для одного и того же факта только потому, что он виден в нескольких projections.

---

# 72. Auditability

Для любого graph fact должна быть возможность ответить:

```text
What is it?
Who owns its meaning?
Where did it come from?
Why is it classified this way?
When did it change?
Which rule produced it?
```

Если хотя бы один ответ систематически невозможен, модель требует исправления.

---

# 73. Minimal target object contract

Семантически объект может быть представлен как:

```yaml
id:
context:

classification:
  root_kind:
  type:
  subtype:

state:
  acceptance:
  currency:
  grounding:
  epistemic_state:

properties:

provenance:

version:
aliases:
```

Но это **логическая модель**, а не обязательный единый physical table/document.

Kernel storage, semantic projection и context-owned records могут физически находиться отдельно.

---

# 74. Canonical semantic formula

Итоговая модель:

```text
IDENTITY
  context
  name
  aliases
  version

CLASSIFICATION
  root_kind
  type
  subtype?

PROPERTIES
  (схема задаётся type registry)

DECISION STATE
  acceptance

USAGE STATE
  currency

EPISTEMIC AXES
  grounding
  epistemic_state

EDGE
  relation
  role?
  temporal properties?
  provenance

PROVENANCE
  source
  content_hash
  git_commit
  location

HISTORY
  semantic revisions
  moves
  lineage
```

---

# 75. Главные запреты

Следующие решения являются architectural invariants.

### Запрещено

```text
SYS as god-context
```

```text
TERM as universal semantic container
```

```text
status as universal state
```

```text
grounding = disputed
```

```text
phase = acceptance + currency
```

```text
classification inside kernel ownership
```

```text
Binding as universal root kind
```

```text
State as root kind
```

```text
SEQ as semantic identity
```

```text
physical REF occurrence as REF object
```

```text
experiment context without independent model
```

```text
central META ownership of all concrete types
```

```text
new relation for every semantic nuance
```

```text
unknown → fake type
```

```text
graph → hidden second SSOT
```

---

# 76. Definition of Done

Refactoring считается завершённым только если:

## Architecture

* [ ] `SYS` eliminated as god-context.
* [ ] `kernel` is infrastructure/shared kernel only.
* [ ] bounded contexts have explicit ownership.
* [ ] context map is documented.
* [ ] `experiment` is distributed by semantics unless independent context is proven.

## Identity

* [ ] canonical identity is independent of classification.
* [ ] legacy addresses resolve as aliases.
* [ ] SEQ is removed from canonical identity.
* [ ] semantic identity change creates lineage/new identity.
* [ ] reclassification does not automatically change identity.

## Classification

* [ ] exactly three initial root kinds: `concept`, `thing`, `event`.
* [ ] `state` is not a root kind.
* [ ] `binding` is not a root kind.
* [ ] concrete types are context-owned.
* [ ] `meta` owns classification rules, not all concrete types.

## State

* [ ] `acceptance` replaces decision/lifecycle semantics.
* [ ] `currency` replaces usage/retirement semantics.
* [ ] `grounding` contains only basis.
* [ ] `epistemic_state` contains only epistemic condition.
* [ ] all four axes are independently mutable and historized.

## Relations

* [ ] seven initial relation families.
* [ ] `denotes` replaces ambiguous `defines`.
* [ ] `cites` represents source/evidence citation.
* [ ] `evolves_from` represents semantic lineage.
* [ ] `causes` is distinct from temporal order.
* [ ] temporal order is edge/event property.
* [ ] every relation has explicit direction.
* [ ] roles are controlled vocabulary.

## Evidence

* [ ] REF means addressable source point.
* [ ] duplicate references to same point share one REF.
* [ ] physical occurrences remain provenance.
* [ ] SECTION numbering remains author-owned.
* [ ] no artificial ordinal section IDs.

## Provenance

* [ ] source, content_hash, git_commit are distinct.
* [ ] semantic version is distinct from Git.
* [ ] move does not create semantic version.
* [ ] history is projection.

## Migration

* [ ] deterministic migration rules exist.
* [ ] every legacy status has mapping or explicit GAP.
* [ ] every legacy type has mapping or explicit GAP.
* [ ] every legacy relation has mapping or explicit GAP.
* [ ] aliases are resolvable.
* [ ] migration is lossless.
* [ ] reverse reconstruction passes.

## Quality

* [ ] lint is deterministic.
* [ ] double-build is identical.
* [ ] health metrics are collected.
* [ ] trends are monitored.
* [ ] unresolved classifications have owners/review conditions.
* [ ] no silent fallback exists.

---

# 77. Final acceptance criterion

Архитектура считается успешной не тогда, когда она имеет меньше типов или полей.

Она успешна, если выполняется следующее:

```text
same semantic object
        ↓
stable identity

independent semantic questions
        ↓
independent axes

different bounded contexts
        ↓
different languages

relations
        ↓
edges, not accidental objects

source evidence
        ↓
provenance / REF

semantic evolution
        ↓
history / lineage

classification
        ↓
context-owned type registry

uncertainty
        ↓
explicit unresolved state

migration
        ↓
deterministic + lossless + auditable
```

Главный invariant всей системы:

> **Ни одна семантическая ось не должна быть вынуждена изображать другую ось.**

И второй, не менее важный:

> **Уменьшение vocabulary допустимо только до тех пор, пока оно не уменьшает различимость реальных семантических фактов.**

Итоговая архитектурная формула:

```text
                ┌───────────────┐
                │    IDENTITY   │
                └───────┬───────┘
                        │
                ┌───────▼───────┐
                │ CLASSIFICATION│
                └───────┬───────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
  ACCEPTANCE         CURRENCY        EPISTEMICS
                                      │
                               ┌──────▼──────┐
                               │  GROUNDING  │
                               └─────────────┘

       ┌─────────────────────────────────────┐
       │ EDGE = relation + role + properties │
       └─────────────────────────────────────┘

       ┌─────────────────────────────────────┐
       │ PROVENANCE + HISTORY = traceability │
       └─────────────────────────────────────┘
```

**Target principle:**

> **One identity, one context language, one question per axis, one owner per semantic fact, one canonical edge, one deterministic migration path.**

---
---

## Что реализовывать в LATTICE первым

Не все десять осей. Для MVP:

```
identity
classification
provenance
history
edge
```

Уточнение (D8.5): slice ниже уже использует `acceptance` и `grounding`, поэтому они входят в первый шаг. Затем:

```
currency
epistemic_state
```

И только после первого работающего сценария:

```
ProposalSource
JEV integration
MutationEngine
migration engine
semantic hash
```

## Первый vertical slice

Лучший тестовый сценарий:

```
OpenSpec Change
  → создать specification artifact
  → классифицировать его в LATTICE
  → связать с requirement/test/evidence
  → провести mutation
  → записать provenance/history
  → построить projection
  → проверить Converge
```

Например:

```
Object:
  type: requirement

LATTICE:
  identity: spec/REQ-001
  classification: concept / requirement
  acceptance: accepted
  currency: active
  grounding: declared
  provenance: proposal.md
  edges:
    - spec/REQ-001      part_of  → spec/CHG-001
    - evidence/TEST-001 tests    → spec/REQ-001
  history:
    - created
    - accepted
```

Так вы сразу проверите, нужен ли LATTICE именно как substrate для Dark Factory, а не просто как абстрактная универсальная модель.

## Итог

```
OpenSpec — реализовать первым.
LATTICE — проектировать параллельно, но внедрять через один vertical slice.
```

Роли:

```
OpenSpec:
  управляет change/specification lifecycle

LATTICE:
  управляет идентичностью, связями, provenance,
  history, classification и evidence objects

Dark Factory:
  связывает их через policies, checks и operations
```

Главное: **не строить LATTICE полностью заранее**. Сначала доказать его на объектах OpenSpec — `Change`, `Requirement`, `Task`, `Test`, `Evidence`, `Decision` — и только потом расширять до полной объектной решётки.