# DARK SOFTWARE FACTORY

## OpenSpec Methodology Extensions

**Status:** Design Addendum
**Role:** дополнение к `OpenSpec Integration & Specification Engineering`

---

# 1. Главный принцип

Не нужно превращать OpenSpec в новую методологию Dark Factory.

Нужно построить поверх него **тонкий слой методологии**:

```text
OpenSpec
  = change/specification kernel

Factory Extensions
  = clarification
  + analysis
  + policies
  + profiles
  + verification
  + factory-specific skills
```

OpenSpec уже специально предоставляет три уровня кастомизации:

```text
project config
custom schemas
global/user schemas
```

При этом project-local schemas рекомендуются как version-controlled часть проекта.

Следовательно, Dark Factory должна максимально использовать **штатные механизмы OpenSpec**, а не создавать parallel framework.

---

# 2. Не делать schema для каждого change type

Это важная корректировка.

Плохая модель:

```text
feature      → feature schema
bugfix       → bugfix schema
data-change  → data schema
migration    → migration schema
security     → security schema
```

Она быстро приводит к:

```text
6 schemas
×
разные templates
×
разные правила
×
drift
```

## Правильнее

Иметь одну основную:

```text
factory-sdd
```

на базе `spec-driven`:

```text
proposal
   ├── specs
   └── design
          ↓
        tasks
```

И только если появляется **реально другой workflow**, создавать отдельную schema.

Например:

```text
factory-sdd
research-first
experiment
```

а не:

```text
feature
bugfix
refactor
data-change
migration
...
```

OpenSpec сам трактует schema как граф артефактов; `requires` определяет, что разблокировано, а не означает обязательность прохождения каждого узла.

---

# 3. Profiles — это Policy, а не Schema

Тип изменения должен разрешаться отдельно:

```text
Change
  ↓
Profile
  ↓
Policy
  ↓
Gates
```

Например:

```yaml
change:
  type: data-change
  risk: high
```

Factory определяет:

```yaml
profile: data-change

required:
  - proposal
  - specs
  - data_contract
  - migration_plan

gates:
  - spec_valid
  - contract_valid
  - migration_verified
  - reconciliation_passed
  - human_approval
```

Но OpenSpec продолжает использовать:

```text
factory-sdd
```

Это сильно уменьшает количество moving parts.

---

# 4. Profile должен быть декларативным

Profile — не инструкция агенту.

Он должен описывать только:

```text
что требуется
что запрещено
какие проверки нужны
какое approval требуется
```

Например:

```yaml
profile: migration

required_artifacts:
  - specs
  - migration_plan

required_gates:
  - compatibility
  - rollback
  - migration_test
  - reconciliation

approval:
  human: required
```

А **как выполнить** эти действия — решают skills.

---

# 5. Profile Resolution

Нужен один детерминированный механизм:

```text
Change
   ↓
classification
   ↓
profile
   ↓
risk
   ↓
effective policy
```

Не разрешать агенту самому решать:

> "Это, наверное, low-risk feature."

Classification должна быть отдельной операцией.

Например:

```text
factory classify
```

результат:

```yaml
type: data-change
risk:
  blast_radius: high
  reversibility: low
  data_loss: high
```

После этого policy engine вычисляет effective requirements.

---

# 6. Composable Profiles

Вот здесь стоит взять идею Spec Kit presets, но **не копировать её буквально**.

Spec Kit позволяет складывать presets с priority ordering и переопределять templates, commands и terminology.

Для Dark Factory полезнее:

```text
base
+
language
+
data
+
security
+
strict
```

Например:

```text
base
+ python
+ data-platform
+ duckdb
+ strict-tests
```

Получается:

```text
Effective Factory Policy
```

а не новый workflow.

---

# 7. Policy Composition

Например:

```yaml
base:
  require:
    - specification
    - tests
    - verification

data-platform:
  require:
    - data_contract
    - data_validation

strict-tests:
  require:
    - regression_test

security:
  require:
    - threat_review
```

Итог:

```text
base
+ data-platform
+ strict-tests
+ security
```

→ единая effective policy.

---

# 8. Priority

Для overlays нужен простой порядок:

```text
default
   ↓
project
   ↓
profile
   ↓
risk
   ↓
explicit exception
```

Более специфичное правило переопределяет менее специфичное.

Но:

**запреты не должны переопределяться обычным profile.**

Например:

```text
security policy:
production_write = forbidden
```

не может быть отменено:

```text
feature profile:
production_write = allowed
```

---

# 9. Constitution: не создавать второй источник истины

Идея Constitution полезна, но её легко реализовать неправильно.

Не надо иметь одновременно:

```text
.factory/constitution.md
openspec/config.yaml
.factory/policies/
ADR/
```

и ожидать от агента, что он разберётся, какое правило важнее.

Использовать чёткое разделение:

```text
Constitution
  = неизменяемые инженерные принципы

Policy
  = machine-enforced rules

ADR
  = конкретные архитектурные решения

Spec
  = требуемое поведение

Skill
  = способ выполнения операции
```

---

# 10. Где хранить Constitution

Если принцип небольшой, предпочтительно:

```yaml
openspec/config.yaml
```

через project context/rules.

OpenSpec уже поддерживает project context и per-artifact rules через `config.yaml`.

Отдельный:

```text
.factory/constitution.md
```

нужен только если constitution действительно становится самостоятельным governance artifact.

**Не создавать файл ради самого паттерна.**

---

# 11. Constitution должна быть короткой

Например:

```text
1. Specification precedes implementation.
2. Deterministic gates cannot be overridden by an LLM.
3. Agents cannot approve their own changes.
4. Production-impacting changes require explicit recovery semantics.
5. Domain behavior must not depend on infrastructure details.
```

Не помещать сюда:

```text
use pytest
name variables in snake_case
run formatter
use DuckDB
```

Это project rules, а не constitution.

---

# 12. Clarify — отдельная операция

Очень полезная идея Spec Kit:

```text
spec
  ↓
clarify
  ↓
spec'
```

Spec Kit делает `clarify` именно для устранения underspecified areas перед planning.

В Dark Factory:

```text
factory clarify
```

должен искать только **decision-relevant uncertainty**.

Не задавать агенту 30 вопросов.

---

# 13. Clarify output

Каждая найденная неопределённость получает один статус:

```text
FACT
ASSUMPTION
UNKNOWN
DECISION
```

Например:

```text
UNKNOWN:
Can historical records be rewritten?

Impact:
migration design

Blocking:
yes
```

Если blocking:

```text
STOP / WAIT
```

Если нет:

```text
continue with explicit assumption
```

---

# 14. Clarify не должен становиться интервью

Ключевое правило:

> Задавать вопрос только если ответ способен изменить specification, design, test или risk.

Если ответ ничего не меняет:

```text
do not ask
```

Это позволит сохранить AI workflow быстрым.

---

# 15. Analyze

Вторая очень полезная идея Spec Kit — отдельный consistency analysis.

Spec Kit использует `analyze` для поиска несогласованностей между specification, plan, tasks и constitution.

У нас:

```text
factory analyze
```

не должен писать документы.

Он только анализирует:

```text
spec
↔ design
↔ tasks
↔ tests
↔ code
```

---

# 16. Analyze findings

Результаты:

```text
CONFLICT
MISSING
UNSATISFIED
ORPHAN
AMBIGUOUS
STALE
```

Например:

```text
REQ-14
  exists in spec

but:

no task
no test
no implementation evidence
```

→

```text
UNSATISFIED
```

---

# 17. Analyze не должен автоматически чинить всё

Это принципиально.

`analyze`:

```text
detect
classify
report
```

но не:

```text
detect
rewrite everything
```

Иначе consistency checker превращается в ещё одного autonomous author.

---

# 18. Converge

`Converge` — наиболее полезная идея для конца implementation.

Но его нужно сделать очень простым:

```text
implementation
    ↓
analyze
    ↓
remaining gaps
    ↓
tasks
    ↓
implementation
```

Spec Kit именно использует Converge как повторяемую проверку согласованности после реализации.

---

# 19. Converge не меняет намерение

Это важное правило, которое стоит взять практически напрямую как принцип.

Converge не должен самовольно переписывать:

```text
spec
design
```

чтобы подогнать их под существующий код.

Если реализация не соответствует specification:

```text
FAIL
```

Далее человек/agent должен решить:

```text
fix code
```

или:

```text
change specification
```

но это уже отдельное изменение.

---

# 20. Таким образом появляется простой quality loop

```text
SPEC
 ↓
IMPLEMENT
 ↓
VERIFY
 ↓
ANALYZE
 ↓
CONVERGED?
 ├── YES → finish
 └── NO  → remediation
```

Это лучше, чем создавать ещё один большой workflow.

---

# 21. Bug workflow

Bug имеет другую природу, поэтому не надо насильно прогонять его через полный feature process.

Минимум:

```text
ASSESS
 ↓
CHARACTERIZE
 ↓
FIX
 ↓
REGRESSION TEST
 ↓
VERIFY
```

Spec Kit также выделяет bug fixing в отдельный workflow и разделяет diagnosis, repair и verification.

---

# 22. Characterize — ключевой этап bugfix

До исправления нужно установить:

```text
what actually happens
```

Создать regression test, который:

```text
fails before fix
passes after fix
```

И только после этого менять implementation.

Это предотвращает ситуацию:

```text
agent guesses cause
agent changes code
tests pass
original bug still exists
```

---

# 23. Idea / Experiment workflow

Для исследований не нужен полный SDD.

Отдельный лёгкий profile:

```text
IDEA
 ↓
HYPOTHESIS
 ↓
EXPERIMENT
 ↓
RESULT
 ↓
DECISION
```

Decision:

```text
ADOPT
REJECT
ITERATE
INCONCLUSIVE
```

Важно:

**experiment не должен автоматически становиться production change.**

Если результат положительный:

```text
experiment
   ↓
new Change
   ↓
normal SDD
```

---

# 24. Research-first schema

Вот здесь отдельная OpenSpec schema действительно оправдана.

Например:

```text
research
   ↓
proposal
   ↓
tasks
```

или:

```text
hypothesis
   ↓
experiment
   ↓
result
```

Потому что это действительно другой dependency graph.

Именно для таких случаев OpenSpec предназначает custom schemas.

---

# 25. Не превращать `clarify`, `analyze`, `converge` в artifacts

Они лучше реализуются как:

```text
operations / skills / checks
```

а не как:

```text
clarify.md
analyze.md
converge.md
```

если в них нет самостоятельного долговечного результата.

Иначе появится:

```text
spec.md
clarify.md
analysis.md
convergence.md
```

ради процесса, а не знания.

---

# 26. Artifact vs Operation

Нужно установить простое правило:

```text
Artifact
= информация, которую нужно сохранить

Operation
= действие, которое можно повторить
```

### Artifact

```text
proposal
spec
design
ADR
data contract
test plan
```

### Operation

```text
clarify
analyze
verify
converge
validate
```

Это одно из самых важных упрощений.

---

# 27. Skills должны быть thin adapters

Factory skill:

```text
factory-clarify
factory-analyze
factory-converge
factory-verify
```

должен:

```text
load context
→ invoke/check
→ return structured result
```

а не содержать собственный mini-framework.

---

# 28. Один skill — одна ответственность

Плохо:

```text
factory-quality
```

который делает:

```text
clarify
specify
design
test
review
merge
```

Хорошо:

```text
clarify
analyze
verify
```

А orchestration решает, когда их вызвать.

---

# 29. Factory Controller

Чтобы не связывать skills между собой напрямую, нужен очень маленький controller:

```text
Change
  ↓
resolve profile
  ↓
resolve policy
  ↓
determine next operation
```

Например:

```text
if spec incomplete:
    clarify

elif required artifacts missing:
    create artifact

elif implementation incomplete:
    implement

elif verification incomplete:
    verify

elif consistency gaps:
    converge

else:
    complete
```

Это не workflow engine.

Это **decision table**.

---

# 30. Policy evaluation должна быть deterministic

LLM может предложить:

```text
profile = data-change
```

но итог должен вычисляться deterministic resolver'ом.

```text
classification
+
profile
+
risk
+
project policy
=
effective policy
```

Таким образом одинаковый вход даёт одинаковые требования.

---

# 31. Factory configuration

Предлагаемая компактная структура:

```text
.factory/
├── policy.yaml
├── profiles.yaml
├── skills/
├── checks/
├── evidence/
└── runs/
```

Не нужно сразу:

```text
policies/
  profiles/
  gates/
  risk/
  capabilities/
  exceptions/
  approvals/
  ...
```

если этого ещё нет.

Сначала один:

```text
policy.yaml
```

и разделить его позже только при реальной необходимости.

---

# 32. Policy structure

Например:

```yaml
profiles:

  feature:
    required:
      - specification
      - tests
      - verification

  bugfix:
    required:
      - characterization
      - regression_test
      - verification

  data-change:
    required:
      - specification
      - data_contract
      - data_verification

  architecture:
    required:
      - design
      - adr
      - verification
```

---

# 33. Не хранить derived policy

Если:

```text
profile
+
risk
+
project rules
```

порождают:

```text
effective policy
```

не нужно сохранять ещё:

```text
effective-policy.yaml
```

если это просто производное состояние.

Его можно вычислять.

---

# 34. Exceptions

Нужны исключения, но они должны быть явными:

```yaml
exception:
  reason: "Legacy migration cannot be rolled back automatically."
  approved_by: human
  expires: 2026-10-01
```

Особенно важно:

```text
exception ≠ policy modification
```

Временное waiver не должно менять общие правила фабрики.

---

# 35. Factory versioning

Любое изменение:

```text
schema
policy
skill
check
profile
```

должно быть обычным Change фабрики.

Например:

```text
CHG-FACTORY-012
```

И проходить:

```text
OpenSpec
→ tests
→ verification
→ merge
```

Таким образом сама фабрика развивается тем же способом, которым она управляет продуктом.

---

# 36. Methodology tests

Это важное дополнение.

Нужно тестировать не только продукт.

Создать небольшой набор **Factory Golden Changes**:

```text
golden/
├── feature/
├── bugfix/
├── refactor/
├── data-change/
├── architecture/
└── experiment/
```

Каждый golden case проверяет:

```text
classification
profile resolution
required artifacts
gates
agent capabilities
verification
```

---

# 37. Policy regression

При изменении Factory:

```text
new policy
    ↓
run golden changes
    ↓
compare expected behavior
```

Если новая policy неожиданно разрешила:

```text
data migration without reconciliation
```

→ factory change FAIL.

Это позволит безопасно развивать саму методологию.

---

# 38. Не копировать Spec Kit целиком

Из Spec Kit особенно полезны:

```text
constitution
clarify
analyze
converge
bug workflow
composable presets
```

Но не нужно импортировать:

```text
его CLI
его directory structure
его command vocabulary
его templates wholesale
```

OpenSpec остаётся основой.

Spec Kit — источник отдельных design patterns.

---

# 39. Не копировать Intent-Driven Template целиком

`intent-driven-template` полезен как reference implementation, потому что он уже сочетает:

```text
OpenSpec
ADR
C4
Gherkin
TDD
Glossary
adversarial authoring
Git discipline
skills
```

Но для Dark Factory это **каталог проверенных patterns**, а не новый framework. Сам template действительно использует локальную OpenSpec schema `proposal → specs → design → adr → tasks` и отдельные skills/agents для Gherkin, glossary, Git discipline и adversarial authoring.

---

# 40. Что реально взять из Intent-Driven

Приоритет:

### Высокий

```text
adversarial specification review
Gherkin authoring
glossary discipline
Git/worktree discipline
ADR when durable decision exists
```

### Средний

```text
C4
specialized agents
additional schemas
```

### Не брать автоматически

```text
полный набор skills
полный набор schemas
полную структуру template
```

Сначала нужен evidence, что они действительно уменьшают defects/rework.

---

# 41. Минимальная методология

В итоге вся дополнительная методология сводится к:

```text
                 CHANGE
                    │
                    ▼
                CLASSIFY
                    │
                    ▼
              RESOLVE POLICY
                    │
                    ▼
                  CLARIFY
                    │
                    ▼
                OpenSpec
                    │
             ┌──────┴──────┐
             ▼             ▼
           SPEC          DESIGN
             │             │
             └──────┬──────┘
                    ▼
                  TASKS
                    │
                    ▼
               IMPLEMENT
                    │
                    ▼
                 VERIFY
                    │
                    ▼
                ANALYZE
                    │
              ┌─────┴─────┐
              │           │
            GAPS        CLEAN
              │           │
              ▼           ▼
           CONVERGE      DONE
```

---

# 42. Где здесь profiles

Profiles не являются ещё одним этапом.

Они являются **параметрами этого процесса**:

```text
                    CHANGE
                       │
                       ▼
                  CLASSIFY
                       │
                       ▼
                ┌────────────┐
                │   PROFILE  │
                └─────┬──────┘
                      │
                      ▼
              Effective Policy
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       required     gates     capabilities
```

Это принципиально проще.

---

# 43. Где здесь schemas

Schemas определяют только **структуру workflow**:

```text
factory-sdd
```

и несколько действительно отличающихся workflows:

```text
research-first
experiment
```

Profiles не создают новые schemas без необходимости.

---

# 44. Где здесь Constitution

Constitution находится над profiles:

```text
Constitution
     ↓
Policies
     ↓
Profiles
     ↓
Change
```

Но constitution должна быть маленькой и редко изменяться.

---

# 45. Где здесь ADR

ADR не является обязательным этапом.

Он появляется только если:

```text
implementation creates durable architectural decision
```

То есть:

```text
Need ADR?
  ├── NO → continue
  └── YES → ADR
```

Это сохраняет OpenSpec workflow лёгким.

---

# 46. Где здесь data

Data process не получает отдельный giant workflow.

Он получает profile:

```text
data-change
```

который включает дополнительные требования:

```text
contract
compatibility
migration
reconciliation
recovery
```

Таким образом data governance остаётся частью общей фабрики, а не второй фабрикой.

---

# 47. Конечная модель

```text
                       OpenSpec
                          │
                  specification kernel
                          │
                          ▼
                   Factory Controller
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
           Profiles     Skills      Checks
              │           │           │
              └───────────┼───────────┘
                          ▼
                        Policy
                          │
                          ▼
                      Execution
                          │
                          ▼
                     Verification
                          │
                          ▼
                       Evidence
```

---

# 48. Главный architectural rule

Если новую идею можно реализовать как:

```text
policy
```

не создавай schema.

Если можно реализовать как:

```text
skill
```

не создавай artifact.

Если можно реализовать как:

```text
check
```

не создавай agent.

Если можно реализовать как:

```text
profile
```

не создавай новый workflow.

Если можно использовать штатный OpenSpec механизм:

```text
не пиши собственный механизм.
```

---

# 49. Итог

Dark Factory должна состоять из **очень маленького количества собственных primitives**:

```text
OpenSpec
Profiles
Policies
Skills
Checks
Evidence
```

И несколько операций:

```text
classify
clarify
analyze
verify
converge
```

Всё остальное должно быть композицией этих primitives.

Это позволит получить:

```text
OpenSpec
+
лучшие идеи Spec Kit
+
лучшие идеи Intent-Driven
+
ваша data/process governance
+
ваша verification/evidence система
```

**без создания третьего SDD-фреймворка.**

---

# 50. Критерий правильности архитектуры

При добавлении новой идеи задаём четыре вопроса:

```text
1. Это новый тип знания?
   → Artifact

2. Это новое правило?
   → Policy

3. Это повторяемая операция?
   → Skill / Check

4. Это другой dependency graph?
   → Schema
```

Если ни один ответ не подходит — **скорее всего, новая абстракция не нужна**.

Это должно стать главным anti-overengineering правилом Dark Factory.

---
---
# Что следует добавить (рассмотреть!)

## 1. Нужна чёткая модель «что такое profile»

Сейчас profile описан хорошо концептуально, но нужно определить схему.

```
profile:
  id: data-change
  version: 1.2.0
  extends:
    - base
    - data-platform

  match:
    change_types:
      - data-change
      - migration

  required_artifacts:
    - proposal
    - specs
    - data_contract
    - migration_plan

  required_gates:
    - spec_valid
    - contract_compatible
    - migration_verified
    - reconciliation_passed

  forbidden_capabilities:
    - production_write

  approvals:
    human:
      required: true
      roles:
        - data-owner

  evidence:
    required:
      - schema_diff
      - data_quality_report
      - rollback_report
```

Profile должен быть versioned, но не должен содержать произвольную логику.

## 2. Нужны отдельные правила для `required`, `recommended`, `forbidden`

Не всё должно быть бинарно.

```
artifacts:
  required:
    - proposal
    - specs
  recommended:
    - adr
  forbidden:
    - direct_production_sql
```

Иначе вы будете использовать exceptions там, где достаточно `recommended`.

## 3. Нужен режим `not-applicable`

Для gates и evidence нужны как минимум:

```
PASS
FAIL
NOT_APPLICABLE
WAIVED
INCONCLUSIVE
```

Например, `data_reconciliation` для UI-only изменения:

```
gate:
  id: reconciliation
  status: not_applicable
  reason: no_data_artifacts_detected
```

`NOT_APPLICABLE` нельзя приравнивать к `PASS`, но он должен позволять пройти профиль без ложного waiver.

## 4. Нужна обработка конфликтующих overlays

Правило priority:

```
default
→ project
→ profile
→ risk
→ explicit exception
```

хорошее, но нужна детерминированная политика конфликтов.

Предлагаю:

```
allow:
  более специфичное правило может усилить требование

relax:
  ослабление требует explicit exception

deny:
  deny не может быть отменён обычным overlay

unknown conflict:
  resolution fails closed
```

Пример:

```
base requires tests
profile requires unit tests
risk requires integration tests

effective:
unit + integration tests
```

Если один overlay говорит:

```
security: production_write = forbidden
feature: production_write = allowed
```

результат:

```
forbidden
```

Если два overlays дают разные значения `required_artifacts`, controller должен не выбирать «последний», а сообщать:

```
POLICY_CONFLICT
```

## 5. Нужен Policy Compiler, даже если не нужен Policy Database

Вы правильно пишете, что не надо хранить `effective-policy.yaml` как SSOT. Но вычисляемый результат всё равно должен существовать как **runtime object**:

```
policy resolver
→ EffectivePolicy
```

Его можно не коммитить, но нужно включать в:

```
FactoryRun
Evidence Manifest
Context Pack
```

```
effective_policy:
  hash: sha256:...
  source:
    - policy.yaml@abc
    - profile:data-change@1.2.0
    - risk:high
    - project:ducklake@def
```

Так можно доказать, какие именно правила действовали во время run.

## 6. Нужен conflict policy для factory changes

Сама фабрика меняет:

```
policy
profiles
skills
checks
schema
```

Нужно запрещать изменение этих компонентов обычным product change без профиля:

```
factory-change
```

Например:

```
factory_change:
  affected_paths:
    - .factory/**
    - openspec/schemas/**
    - openspec/config.yaml
  required:
    - factory_golden_tests
    - policy_regression
    - human_approval
```

Это следует из вашей сильной идеи, что методология должна развиваться через тот же SDD lifecycle.

