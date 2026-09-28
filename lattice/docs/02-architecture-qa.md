---
id: LATTICE-DOC-02
title: LATTICE — архитектурные вопросы, ответы и обязательные решения
status: normative
maturity: MVP
version: 0.1.0
---

# 02. LATTICE — архитектурные вопросы, ответы и обязательные решения

## Назначение

Этот документ фиксирует вопросы, ответы на которые могут изменить архитектуру, storage model, API, graph model или mutation protocol LATTICE.

Правило:

> Если ответ влияет на identity, consistency, history, context boundaries, classification, graph semantics или persistence — вопрос должен быть решён до реализации соответствующего механизма.

Ответы ниже являются нормативными решениями для LATTICE.

> Сверка с substrate и решениями D1–D7 — [06-lattice-substrate-decisions §10](03-substrate-decisions.md). Примеры identity приведены к `context/name`.

---

# 00. Где проходит граница LATTICE?

**Вариант A (через природу):**

> Сущность — кандидат в LATTICE, если о ней осмысленно утверждать: **«это факт, на который ссылаются, у которого есть provenance, и который входит в историю системы»**.
>
> Иначе — это операционный артефакт, он не попадает в LATTICE.

**Вариант Б (через контрпример):**

> Сущность **не** в LATTICE, если её можно **потерять, сбросить или пересоздать** без потери семантики системы.
>
> `retry counter` можно сбросить. `attempt` — нельзя: он часть истории.

---

Правило можно закрепить как **invariant**:

```text
I16 (candidate filter):
Объект создаётся в LATTICE только если выполняется хотя бы одно:
  (a) на него ссылается другой semantic object
  (b) его изменение входит в audit trail
  (c) он участвует в decisions как evidence/dependency/result
  (d) у него есть собственная provenance и history
Иначе — property, edge property или операционный артефакт вне LATTICE.
```

Это **уточнение** Q62 I1–I15, а не новое правило. Можно добавить как I16.

---

# 1. Подсистема или компонент?
**Ответ:** Подсистема — инфраструктурный субстрат (как KERNEL), на котором живут все остальные компоненты SEF; не отдельный сервис.

---

# 2. Мутации модели (группировка/абстракция)?
**Ответ:** Да — через вертикальные операции (`ReclassifyObject`, `GroupObjects`, `AbstractInto`) плюс связь `evolves_from` с ролью, но каждая мутация оставляет версию в history и не меняет identity, если смысл сохраняется.

---

# 3. Ограничения — что нельзя?
**Ответ:** Нельзя: смешивать оси в одном поле, класть classification в identity, создавать объект без собственной identity, вводить новый тип/связь/контекст без доказательства, использовать silent fallback и оставлять `unknown` без владельца.

---

# 4. Любой цифровой проект?
**Ответ:** Да, любая система, где есть именованные сущности, связи и история, описывается LATTICE; для проектов без истории и provenance (чистый key-value кэш) — избыточен.

---

# 5. Встраивать в другие системы?
**Ответ:** Да — LATTICE отдаёт стабильный `context/name`, aliases, edges и provenance, поэтому встраивается как «слой описания» над любой моделью данных; границу задаёт context map.

---

# 6. Оформлять сам LATTICE по методологии?
**Ответ:** Да, но минимально: сама LATTICE — это пять-семь объектов (`meta/root_kind`, `meta/relation-family`, `meta/axis`), их собственные типы не должны разрастаться.

---

# 7. Изоляция доменов?
**Ответ:** Да — через bounded contexts (8, включая `spec`; см. substrate D8.1) с ACL: контексты не читают поля друг друга напрямую, только через identity + явный контракт + translation.

---

# 8. Работа с файлами, кодом, классами, сигнатурами?
**Ответ:** Да — всё это `thing`-объекты (`file`, `class`, `function`, `signature`, `argument`, `type`), связи между ними (`calls`, `implements`, `has-argument`), provenance — git.

---

# 9. Разбить граф?
**Ответ:** Да — по contexts (`graph/platform.json`, `graph/runtime.json`), по блокам (`kernel`, `semantic`, `carrier`) или по шардам (каждый — свой `graph-ids.json`); cross-рёбра в отдельном файле.

---

# 10. PostgreSQL / Anchor Modeling / JSON-граф?
**Ответ:** Для 10⁴–10⁶ объектов достаточно JSON-графа + append-only реестров (как сейчас); PostgreSQL с Anchor Modeling — если нужны сложные запросы, много писателей и версионность «по-настоящему», но это преждевременно.

---

# 11. Как построить классификатор с нуля — совет?
**Ответ:** Три правила: (1) одна ось — одно поле, (2) словарь оси объявлен в одном месте и закрыт, (3) расширение только через реестр с обоснованием; классификатор — чистый `f(object) → classification`, без побочных эффектов.

---

# 12. Начать с LATTICE, потом строить SEF?
**Ответ:** Да — это правильно: LATTICE отвязана от домена SEF, поэтому её можно реализовать и протестировать изолированно (identity, оси, edges, миграция), а SEF потом наслаивается поверх как набор контекстов.

---

# 13. Задаёт ли LATTICE строгость разработки самого LATTICE и SEF?
**Ответ:** Да — LATTICE задаёт мета-строгость (одна ось — один вопрос, identity ≠ classification), а SEF наследует её как обязательный контракт; LATTICE при этом не диктует *какие* типы и контексты нужны, только *как* их правильно заводить.

---

# 14. Как сделать инварианты, тесты, хуки против дрейфа и протухания?

Принцип: три слоя защиты — инварианты → линт → метрики тренда. Инвариант объявляет правило, линт ловит нарушение, метрика показывает, что правило тихо размывается.

Ответ по частям:

- Инварианты — короткий закрытый список (≤ 15), каждый с `rule_id`, `owner`, `scope`, `source`; уровни R0–R6 (source > architecture > context > type > operation > projection > presentation).
- Линт — детерминированный, идемпотентный, с мутациями (`--self-test`); каждая проверка ловит один инвариант; новый инвариант без линта не принимается.
- Хуки — три точки: pre-commit (identity, aliases, duplicate), pre-merge (edge validity, provenance, lossless), post-build (double-build identical, hashes match).
- Анти-дрейф — health metrics с трендом: `new_type/month`, `reclassification_rate`, `unresolved_gap_age_p95`, `relation_proliferation`; рост без новых кейсов = деградация.
- Анти-протухание — у каждого объекта со `status ≠ accepted` есть `owner`, `due`, `condition`; `GAP` без владельца — ошибка линта; раз в квартал — ревью всех `unresolved`.
- Анти-развал — failure criteria (F1–F10): если classification меняет identity, если одно поле отвечает на два вопроса, если relation explosion — это сигнал остановки, а не «доработка по ходу».
- Запрет silent fallback — `unknown → GENERAL`, `missing → declared`, `legacy → accepted` без правила запрещены; вместо этого — явный GAP с владельцем и причиной.
- Правило расширения — новый тип/связь/контекст/root kind только через §61 (use cases → analysis → proof → migration rule → lint rule → owner).
- CI — обязательные проверки: lint PASS, double-build identical, self-test PASS, health metrics без регрессий; красный CI = заморозка vocabulary.

Итог: система не развалится, если каждое правило имеет проверку, у каждой проверки есть владелец, а у каждого владельца — метрика тренда.

---
# 15. Что является SSOT для объекта?

**Ответ:** Не graph и не projection.

SSOT разделяется по семантическим осям:

```text
identity       → identity registry
classification → context-owned classification
state          → canonical object state
edges          → canonical edge store
provenance     → provenance records
history        → append-only history
```

Graph является собранной projection.

**Рекомендация:** Не делать один giant `graph.json` SSOT.

LATTICE должна иметь логически разделённые canonical stores, даже если на первом этапе они физически находятся в одном JSON-файле.

---

# 16. Является ли LATTICE event-sourced системой?

**Ответ:** Нет — не в полном смысле.

LATTICE обязана иметь append-only history, но canonical current state не обязан восстанавливаться исключительно replay всех событий.

Разделение:

```text
current canonical state → operational truth
history                 → immutable audit/history
graph                   → projection
```

**Рекомендация:** Не превращать LATTICE в event-sourcing framework.

Нужна возможность восстановить историю изменения, но не обязательная модель:

```text
state = reduce(all_events)
```

для каждого read.

Это сохранит простоту JSON implementation.

---

# 17. Как выполняется мутация?

**Ответ:**

```text
Command
  ↓
Validate
  ↓
Check invariants
  ↓
Apply mutation
  ↓
Append history
  ↓
Rebuild/update projection
  ↓
Lint
```

Мутация считается одной логической транзакцией.

Например:

```text
ReclassifyObject
```

не может изменить classification, но не записать history.

**Рекомендация:** Сделать единый mutation engine:

```text
Mutation → Validation → State change → History → Projection
```

а не отдельный механизм для каждой операции.

---

# 18. Нужна ли атомарность нескольких изменений?

**Ответ:** Да.

Операция должна либо примениться полностью, либо не примениться.

Например:

```text
ReclassifyObject
```

может одновременно менять:

* classification;
* lineage edge;
* version;
* history;
* projection.

Частичное применение недопустимо.

**Рекомендация:** Ввести transaction boundary на уровне mutation batch.

На JSON storage достаточно:

```text
write temp
→ fsync
→ atomic rename
```

На PostgreSQL — обычная DB transaction.

---

# 19. Нужен ли optimistic concurrency control?

**Ответ:** Да, даже если сейчас один writer.

Каждая mutation работает относительно версии:

```text
expected_version
```

Если текущая версия отличается:

```text
CONFLICT
```

а не silent overwrite.

**Рекомендация:**

```yaml
mutation:
  expected_version: 17
```

Это дешёвая защита от будущего появления второго writer.

---

# 20. Может ли объект быть удалён?

**Ответ:** Физическое удаление canonical object запрещено.

Используются:

```text
currency: retired
```

и history.

Физическое удаление допустимо только для ошибочно созданного технического объекта, если он никогда не был semantic fact.

**Рекомендация:** Разделить:

```text
retire semantic object
delete technical artifact
```

Не использовать `delete` как обычную domain operation.

---

# 21. Может ли identity быть переименована?

**Ответ:** Только если name является presentation label.

Если name входит в canonical identity:

```text
context/name
```

его изменение создаёт новую identity либо explicit identity migration.

Поэтому:

```text
display_name → свободно изменяем
name          → стабилен
id            → стабилен
```

**Рекомендация:** Не делать rename обычным `update(name)`.

Нужна отдельная операция:

```text
RenameObject
```

с явным решением:

```text
identity-preserving rename
```

или:

```text
new identity + lineage
```

---

# 22. Должна ли identity зависеть от context?

**Ответ:** Да.

```text
platform/dispatcher
runtime/dispatcher
```

могут быть двумя разными объектами.

Одинаковое имя не означает одинаковую семантическую сущность.

**Рекомендация:** Уникальность:

```text
(context, name)
```

а не `name`.

Если один объект действительно принадлежит нескольким contexts, это выражается membership/mapping, а не копированием identity.

---

# 23. Может ли объект одновременно принадлежать нескольким contexts?

**Ответ:** Canonical ownership — один context.

Другой context может иметь:

* reference;
* projection;
* mapping;
* ACL representation.

Но не второй canonical owner.

**Рекомендация:**

```text
one object
    ↓
one semantic owner
    ↓
N projections/mappings
```

Это критично для предотвращения distributed SSOT.

---

# 24. Кто владеет classification?

**Ответ:** Context, которому принадлежит объект.

`meta` определяет **правила classification**, но не классифицирует все объекты централизованно.

Например:

```text
platform/component
```

определяется `platform`.

`runtime/attempt` определяется `runtime`.

**Рекомендация:** Classification API должен быть context-aware:

```text
classify(context, object)
```

а не:

```text
meta.classify(anything)
```

---

# 25. Может ли объект иметь несколько типов?

**Ответ:** Нет в canonical classification.

У объекта:

```text
root_kind
type
subtype?
```

одна canonical classification на конкретной revision.

Если объект одновременно удовлетворяет нескольким независимым классификациям, это должно быть выражено:

* properties;
* roles;
* relations;
* mappings.

**Рекомендация:** Не вводить `types: []`.

Это быстро превратит classification в неуправляемый набор tags.

---

# 26. Нужна ли confidence у classification?

**Ответ:** Не как универсальное числовое поле.

`0.83 confidence` не является заменой доказательства.

Используются:

```text
classification
+
grounding
+
epistemic_state
+
provenance
```

Если классификация не разрешена:

```text
epistemic_state: unresolved
```

и explicit GAP.

**Рекомендация:** Не вводить ML-style confidence в canonical model.

Если classifier использует confidence — хранить его как classifier output/provenance, а не как semantic truth.

---

# 27. Кто имеет право менять classification?

**Ответ:** Только explicit mutation operation.

Например:

```text
ReclassifyObject
```

Она должна:

1. проверить существование target type;
2. проверить context ownership;
3. проверить invariants;
4. записать history;
5. сохранить lineage при необходимости;
6. увеличить semantic version, если изменилась семантика.

**Рекомендация:** Запретить прямой:

```python
object.type = ...
```

даже внутри обычного application code.

---

# 28. Что считается semantic change?

**Ответ:**

Semantic version увеличивается, если меняется хотя бы одно:

* identity meaning;
* classification meaning;
* canonical property meaning;
* semantic relation;
* normative state;
* interpretation.

Не увеличивается при:

* move;
* formatting;
* graph rebuild;
* projection rebuild;
* Git commit без semantic change;
* изменении runtime timestamp.

**Рекомендация:** Ввести deterministic `semantic_hash`.

```text
semantic_hash(object)
```

должен зависеть только от semantic content.

---

# 29. Что входит в semantic hash?

**Ответ:**

Входит:

```text
identity semantic fields
classification
semantic properties
canonical state
canonical relations
```

Не входит:

```text
git commit
runtime timestamp
file line
graph block
projection ordering
```

**Рекомендация:** Сделать `semantic_hash` центральным механизмом определения semantic revision.

---

# 30. Имеют ли edges собственную identity?

**Ответ:** Да, но только техническую, если она необходима для адресации/истории.

Semantic identity edge определяется:

```text
source
relation
target
```

с учётом role, если role является частью различия.

Например:

```text
A --depends_on(role=requires)--> B
A --depends_on(role=invokes)--> B
```

это два различных semantic edges.

**Рекомендация:** Не делать relation object.

Использовать:

```text
edge_id
source
relation
target
props
provenance
version
```

---

# 31. Можно ли иметь два одинаковых edge?

**Ответ:** Нет в canonical graph.

Дубликаты:

```text
A --depends_on--> B
A --depends_on--> B
```

должны схлопываться в один edge, если у них нет semantic distinction.

Разные provenance сохраняются отдельно.

**Рекомендация:** Canonical edge key:

```text
(source, relation, target, canonical_role)
```

---

# 32. Может ли provenance создавать различие между edges?

**Ответ:** Нет.

Две ссылки на один semantic relation:

```text
A → B
```

не становятся двумя semantic edges только потому, что найдены в разных документах.

Provenance — evidence for edge, а не identity edge.

**Рекомендация:** Разделять:

```text
semantic edge
+
N provenance records
```

---

# 33. Должен ли `role` быть закрытым словарём?

**Ответ:** Да.

Иначе:

```text
role: requires
role: required
role: requirement
role: needs
```

создадут скрытый uncontrolled relation vocabulary.

**Рекомендация:** Каждая relation family имеет собственный закрытый role registry.

Расширение role требует той же процедуры, что и новый type.

---

# 34. Что делать с legacy relations `calls`, `implements`, `has-argument`?

**Ответ:** Не оставлять их автоматически как новые relation families.

Они должны пройти semantic mapping.

Например:

```text
function --depends_on(role=calls)--> function
class --depends_on(role=implements)--> interface
function --part_of(role=has_argument)--> signature
```

Но mapping должен быть проверен на реальных use cases.

**Рекомендация:** Зафиксировать legacy relation mapping registry до реализации graph migration.

Это особенно важно, потому что текущий ответ №8 перечисляет `calls`, `implements`, `has-argument`, тогда как core model содержит только семь families.

---

# 35. Нужно ли LATTICE понимать код?

**Ответ:** Нет.

LATTICE должна быть domain-neutral.

Она предоставляет object/edge/provenance model.

Code intelligence — отдельный adapter/context vocabulary.

Например:

```text
code adapter
    ↓
file/class/function/signature
    ↓
LATTICE objects
```

**Рекомендация:** Не помещать parser/compiler semantics внутрь LATTICE core.

---

# 36. Где заканчивается LATTICE?

**Ответ:** На semantic graph infrastructure.

LATTICE отвечает:

```text
what exists?
how is it classified?
how is it related?
where did it come from?
how did it evolve?
```

LATTICE не отвечает:

```text
how to compile code
how to execute SEF
how to choose architecture
how to run an experiment
how to infer business semantics
```

**Рекомендация:** Core должен быть маленьким.

Все domain intelligence — adapters / contexts / clients.

---

# 37. Нужен ли API поверх LATTICE?

**Ответ:** Да, но API должен отражать semantic operations, а не storage.

Минимальный API:

```text
get_object
resolve_id
resolve_alias
get_classification
get_edges
get_provenance
get_history

add_object
reclassify_object
update_properties
add_edge
remove_edge
record_decision
add_reference
retire_object
```

**Рекомендация:** Не давать пользователю public API вида:

```text
write_node_json()
write_edge_json()
```

Storage format должен быть implementation detail.

---

# 38. Нужен ли Query Language?

**Ответ:** На первом этапе — нет отдельного DSL.

Достаточно:

```text
exact id lookup
alias lookup
context/type filtering
edge traversal
provenance lookup
history lookup
```

**Рекомендация:** Сначала стабильный semantic API.

DSL появится только после доказанной потребности в сложных queries.

---

# 39. Должны ли projections быть rebuildable?

**Ответ:** Да — обязательно.

Любая projection должна быть полностью восстанавливаема из canonical state.

```text
canonical state
      ↓
projection
```

а не:

```text
projection
      ↓
canonical state
```

**Рекомендация:** Добавить:

```text
rebuild-projections
```

и проверку:

```text
build twice → byte-identical result
```

---

# 40. Можно ли вручную редактировать projection?

**Ответ:** Нет.

Manual semantic decisions выполняются через mutation API.

Projection только пересобирается.

Исключение:

```text
explicit overlay
```

если overlay является canonical semantic input и имеет собственного owner.

**Рекомендация:** Чётко разделить:

```text
projection
overlay
source
```

Overlay не должен маскироваться под projection.

---

# 41. Что является Overlay?

**Ответ:** Явное semantic решение, которого нет непосредственно в source.

Например:

```text
source says A
LATTICE decision:
A is classified as platform/component
```

Это:

```text
semantic overlay
+
owner
+
reason
+
provenance
+
history
```

**Рекомендация:** Overlay — first-class input, но не второй SSOT.

---

# 42. Может ли classifier автоматически менять graph?

**Ответ:** Нет.

Classifier:

```text
f(object, context) → candidate classification
```

не имеет side effects.

Принятие результата:

```text
candidate
→ validation
→ explicit mutation
```

**Рекомендация:** Разделить:

```text
classification inference
```

и:

```text
classification commit
```

Это позволит использовать LLM/ML без передачи ему write authority.

---

# 43. Может ли LLM создавать объекты напрямую?

**Ответ:** Нет.

LLM может предложить:

```text
candidate object
candidate classification
candidate relation
candidate migration
```

Но commit проходит через deterministic guards.

```text
LLM
 ↓
proposal
 ↓
validation
 ↓
human/system decision
 ↓
mutation
```

**Рекомендация:** LATTICE core не должен содержать LLM-specific semantics.

LLM — внешний producer proposal.

---

# 44. Нужна ли человеку возможность override?

**Ответ:** Да.

Но override не должен обходить invariant.

Человек может изменить:

```text
classification
state
relation
decision
```

но не может:

```text
break identity uniqueness
create invalid relation
bypass provenance requirement
violate context ownership
```

**Рекомендация:** Human override является обычной mutation с actor provenance.

---

# 45. Кто actor mutation?

**Ответ:** Каждая mutation должна иметь actor:

```text
human
agent
system
migration
importer
```

Это provenance mutation, а не object classification.

Минимально:

```yaml
actor:
  type: agent
  id: classifier-v2
```

**Рекомендация:** Actor не является автоматически semantic object.

Object создаётся только если actor имеет самостоятельную domain identity.

---

# 46. Нужна ли история всех property changes?

**Ответ:** Да, если property semantic.

Но не обязательно хранить каждое техническое переписывание файла.

История должна фиксировать semantic transitions.

```text
old value
→ new value
→ operation
→ actor
→ provenance
```

**Рекомендация:** History event должен описывать **что изменилось семантически**, а не diff JSON.

---

# 47. Нужен ли `undo`?

**Ответ:** Нет как destructive rollback.

Вместо:

```text
undo
```

создаётся новая semantic mutation:

```text
RevertToRevision
```

которая сама попадает в history.

**Рекомендация:** History остаётся append-only.

Никогда не удалять историю ради rollback.

---

# 48. Нужен ли schema version?

**Ответ:** Да, но отдельно от object version.

Минимум:

```text
object_version
graph_format
registry_version
migration_version
```

Они отвечают на разные вопросы.

**Рекомендация:** Никакого универсального `version`.

---

# 49. Как эволюционирует сама LATTICE?

**Ответ:** Через versioned schema/migration.

Например:

```text
LATTICE schema v1
        ↓
migration
        ↓
LATTICE schema v2
```

Object semantic version при этом не изменяется автоматически.

**Рекомендация:** LATTICE schema migration должна быть отдельным механизмом от domain object migration.

---

# 50. Нужен ли backward compatibility?

**Ответ:** Да.

Минимально:

```text
old id → alias
old schema → migration adapter
old relation → mapping
old status → deterministic state mapping
```

Но canonical writes всегда идут в новую модель.

**Рекомендация:**

```text
read old + read new
write new only
```

на переходном этапе.

---

# 51. Что является минимальным persistent ядром?

**Ответ:**

```text
objects
aliases
edges
provenance
history
registries
```

Всё остальное — projection.

**Рекомендация:** Не хранить отдельно то, что можно deterministic rebuild.

---

# 52. Как LATTICE выбирает storage?

**Ответ:** Storage не должен менять semantic contract.

Core API должен работать поверх:

```text
JSONStore
PostgresStore
...
```

Но второй implementation не создавать заранее.

**Рекомендация:** Сначала реализовать один production-grade JSON backend с чётким repository contract.

Абстракция storage появляется вокруг реального boundary, а не ради DI.

---

# 53. Нужен ли PostgreSQL сейчас?

**Ответ:** Нет.

Для текущего масштаба:

```text
10⁴–10⁶ objects
```

JSON + append-only registries достаточно при условии:

* atomic writes;
* deterministic rebuild;
* concurrency guard;
* indexed lookup;
* sharding при необходимости.

**Рекомендация:** Не проектировать PostgreSQL/Anchor Modeling как часть LATTICE core.

Но repository boundary оставить чистым.

---

# 54. Нужен ли graph sharding?

**Ответ:** Да как storage/projection mechanism, но не как semantic boundary.

Допустимо:

```text
graph/platform.json
graph/runtime.json
graph/evidence.json
```

но semantic graph остаётся единым.

Cross-context edges:

```text
graph/cross-context.json
```

могут быть отдельной physical projection.

**Рекомендация:** Shard by context — физическая оптимизация, не новый ontology layer.

---

# 55. Может ли cross-context edge существовать?

**Ответ:** Да.

Но он должен проходить через explicit context contract.

Например:

```text
runtime/ATT-000417
   --depends_on(role=uses)-->
platform/dispatcher
```

Это не означает, что runtime получил право читать внутренние поля platform object.

**Рекомендация:** Cross-context edge хранит:

```text
source context
target context
contract/version
```

если это необходимо для validation.

---

# 56. Что делать при удалении context?

**Ответ:** Context нельзя удалить, если существуют semantic objects.

Сначала:

```text
freeze
→ migrate
→ aliases
→ compatibility
→ verify
→ retire context
```

**Рекомендация:** Context lifecycle должен быть:

```text
proposed
active
deprecated
retired
```

Но это lifecycle **context**, не object.

---

# 57. Кто может создать новый context?

**Ответ:** Только архитектурное решение.

Минимальный RFC должен доказать:

```text
language
ownership
invariants
lifecycle
cross-context mismatch
```

**Рекомендация:** `AddContext` не является обычной user mutation.

Это architecture-level change.

---

# 58. Нужно ли LATTICE хранить правила самой LATTICE?

**Ответ:** Да, но минимально.

Сам LATTICE может описывать:

```text
meta/root-kind
meta/relation-family
meta/axis
meta/invariant
```

Но эти objects не должны образовывать отдельную «мета-вселенную».

**Рекомендация:** LATTICE описывает собственные правила через тот же механизм, но bootstrap schema остаётся hard-coded минимальным kernel.

Иначе возникает bootstrap paradox:

```text
LATTICE needs LATTICE to define LATTICE
```

---

# 59. Где заканчивается self-description?

**Ответ:** Self-description не должна быть бесконечно рекурсивной.

Допустимо:

```text
LATTICE core
   ↓
describes LATTICE rules
```

Но bootstrap primitives:

```text
identity
context
edge
history
```

фиксируются implementation-level contract.

**Рекомендация:** Разделить:

```text
bootstrap invariants
```

и:

```text
self-describing vocabulary
```

---

# 60. Может ли LATTICE изменить собственные invariants?

**Ответ:** Да, но только как versioned architecture migration.

Нельзя:

```text
edit invariant
```

и сразу считать старый graph валидным.

Процесс:

```text
new invariant
→ compatibility analysis
→ migration
→ new schema version
→ new lint
→ validation
→ activation
```

**Рекомендация:** Invariant registry должен быть versioned.

---

# 61. Что означает «красный CI = freeze vocabulary»?

**Ответ:** Не весь CI failure должен замораживать vocabulary.

Только failure semantic integrity.

Например:

```text
duplicate identity → freeze
invalid relation → freeze
lossy migration → freeze
broken provenance → freeze
```

Но:

```text
documentation typo
slow test
formatting
```

не должны блокировать semantic evolution.

**Рекомендация:** Разделить CI:

```text
semantic gate
quality gate
informational metrics
```

---

# 62. Какие invariants действительно обязательны?

**Ответ:** Core invariant set должен быть маленьким.

Рекомендуемый immutable минимум:

```text
I1  identity uniqueness
I2  identity ≠ classification
I3  one semantic owner
I4  valid context/type ownership
I5  valid relation direction
I6  no dangling canonical edge
I7  semantic mutation is historized
I8  provenance where required
I9  no silent fallback
I10 no duplicate semantic edge
I11 projections are rebuildable
I12 migration is lossless
I13 unresolved requires owner/condition
I14 semantic hash is deterministic
I15 canonical writes pass invariants
```

**Рекомендация:** Не увеличивать список ради каждой частной проверки.

Частные checks должны ссылаться на один из этих invariants.

---

# 63. Может ли lint исправлять ошибки?

**Ответ:** Нет.

Lint:

```text
detect
report
classify
```

но не меняет semantic state.

`--fix` допустим только для технических projection artifacts.

Например:

```text
rebuild projection
sort deterministic output
```

но не:

```text
invent classification
change relation
accept object
```

**Рекомендация:** Убрать идею «lint с мутациями» из core.

Self-test может создавать временный sandbox state, но production graph lint остаётся read-only.

---

# 64. Как проверять новые правила?

**Ответ:**

Каждый invariant должен иметь:

```yaml
rule_id:
owner:
scope:
source:
validator:
test_cases:
failure_mode:
```

Для каждого правила минимум:

```text
positive case
negative case
boundary case
```

**Рекомендация:** Правило без executable test не считается полностью введённым.

---

# 65. Как LATTICE предотвращает «тихий рост сложности»?

**Ответ:** Через change budget.

Каждое расширение vocabulary сопровождается:

```text
new type
new relation
new role
new context
new root kind
```

и фиксируется:

```text
why
real cases
alternative rejected
migration cost
owner
```

**Рекомендация:** Ввести `Architecture Change Record`.

Особенно для:

```text
new relation family
new context
new root kind
```

---

# 66. Главный тест LATTICE

Перед добавлением любого нового механизма задаётся четыре вопроса:

```text
1. Какой новый semantic question он решает?
2. Почему существующая ось/тип/relation этого не решает?
3. Какие реальные cases требуют нового механизма?
4. Как будет мигрирована существующая модель?
```

Если нет убедительного ответа хотя бы на один вопрос — механизм не добавляется.

---

# 67. Итоговые решения, влияющие на разработку

После этого набора вопросов LATTICE должна строиться вокруг следующего минимального runtime contract:

```text
                 ┌──────────────────┐
                 │     IDENTITY     │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │ CLASSIFICATION   │
                 └────────┬─────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
          ACCEPTANCE   CURRENCY   EPISTEMICS
                                    │
                               GROUNDING

                 ┌──────────────────┐
                 │      EDGES       │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │    PROVENANCE    │
                 └────────┬─────────┘
                          │
                 ┌────────▼─────────┐
                 │     HISTORY      │
                 └──────────────────┘
```

Минимальные operations:

```text
CreateObject
ReclassifyObject
UpdateProperties
AddEdge
RemoveEdge
RecordDecision
AddReference
RenameObject
RetireObject
RevertToRevision
```

Минимальные infrastructure services:

```text
IdentityRegistry
TypeRegistry
RelationRegistry
MutationEngine
HistoryStore
ProvenanceStore
ProjectionBuilder
Validator
Lint
```

---

# 68. Решения, которые считаются закрытыми

| Область        | Решение                                       |
| -------------- | --------------------------------------------- |
| Contexts       | 8 logical areas (7 + `spec`, решение D8.1)    |
| Kernel         | Shared Kernel, infrastructure only            |
| Root kinds     | `concept / thing / event`                     |
| State          | не root kind                                  |
| Binding        | edge, не root kind                            |
| Concrete types | context-owned                                 |
| Meta           | classification protocol, не global type owner |
| Identity       | `context/name`                                |
| Legacy IDs     | aliases                                       |
| Acceptance     | `draft / proposed / accepted / rejected`      |
| Currency       | `active / deprecated / retired`               |
| Grounding      | `declared / derived / observed / inferred`    |
| Epistemics     | `settled / contested / unresolved`            |
| Relations      | 7 families                                    |
| Relation roles | закрытые registry                             |
| Temporal order | edge/event property                           |
| REF            | unique addressable source point               |
| REF occurrence | provenance                                    |
| SECTION        | author number + anchor + path                 |
| History        | append-only projection                        |
| Event sourcing | не обязательная архитектура                   |
| Mutation       | atomic operation                              |
| Concurrency    | optimistic version check                      |
| Delete         | semantic retirement                           |
| Classifier     | pure proposal                                 |
| LLM            | proposal-only                                 |
| Projection     | rebuildable                                   |
| Lint           | read-only                                     |
| Storage        | JSON first                                    |
| PostgreSQL     | future backend, не core                       |
| Sharding       | physical, не semantic                         |
| New context    | architecture decision                         |
| New relation   | proof required                                |
| New root kind  | proof required                                |
| New object     | independent identity required                 |

---

# 69. Главный architectural invariant

В конечном итоге LATTICE должна обеспечивать не «много объектов и связей», а **разделение ответственности между механизмами**:

```text
identity      → кто это?
classification→ что это?
acceptance    → принято ли?
currency      → используется ли?
grounding     → на каком основании?
epistemics    → разрешено ли знание?
edge          → как связано?
provenance    → откуда известно?
history       → как изменилось?
context       → на каком языке описывается?
```

Если для нового требования приходится заставлять существующее поле отвечать на два вопроса — это архитектурный smell.

Если приходится создавать новый механизм — сначала доказать, что существующие оси не справляются.

> **LATTICE должна расширяться добавлением семантики, а не добавлением способов хранить одну и ту же семантику.**