---
id: LATTICE-DOC-03
title: LATTICE Object Substrate — решения по открытым вопросам
status: proposed
maturity: deferred
version: 0.1.0
---

# 03. LATTICE Object Substrate — решения

Ответы на семь пунктов «Рассмотреть / исправить» из [LATTICE — Object Substrate](01-object-substrate.md) плюс системные дополнения (§8). Решения D1–D7 применены к исходному документу там, где правка механическая (§9). Всё остальное — норма этого документа до переноса.

Принцип, которым проверялось каждое решение, — тот же, что в исходнике: **один вопрос — одна ось**, и правило абстракции WARRANT [01 §3](../../docs/01-principles.md): новая сущность только если существующие не выражают семантику.

## D1. Identity: `<context>/<name>`, два сегмента

**Решение.** Canonical identity — ровно два сегмента. Ни type, ни root_kind, ни namespace в id не входят.

```text
id      = <context> "/" <name>
context = [a-z][a-z0-9_-]*            один из зарегистрированных bounded contexts
name    = [A-Za-z0-9][A-Za-z0-9._-]*  machine-stable, уникален внутри context
```

Почему не `context/namespace/name`: namespace, который «не тип», на практике всегда становится типом (`components/`, `refs/`), и §14.1 нарушается снова. Уникальность имени внутри context — ответственность registry этого context, а не структуры id.

**Правило префикса.** `name` MAY содержать конвенциональный префикс (`INV-4`, `REQ-ING-001`, `HYP-012`). Префикс — naming convention уровня R2 (context contract), **не** classification:

- lint MUST NOT выводить `type` из префикса и MUST NOT требовать их совпадения;
- reclassification не меняет `name`, даже если префикс «устарел»; расхождение — это не ошибка, а история.

Так снимается напряжение между удобством чтения и §14.1: identity не *содержит* classification, но может *напоминать* о ней.

**Исправленные примеры.**

| Было | Стало | Classification (отдельно) |
|---|---|---|
| `platform/component/dispatcher` | `platform/dispatcher` | thing / component |
| `platform/invariant/INV-4` | `platform/INV-4` | concept / invariant |
| `platform/concept/policy/write-scope` | `platform/write-scope` | concept / policy |
| `lexicon/concept/observation` | `lexicon/observation` | concept / term |
| `evidence/thing/ref/plat-4-5` | `evidence/plat-4-5` | thing / ref |
| `method/thing/spike-classifier` | `method/spike-classifier` | thing / spike |
| `CHG-001/REQ-001` (slice) | `spec/REQ-001` + edge `part_of → spec/CHG-001` | concept / requirement |

**Следствие для WARRANT.** Открытый вопрос I1 / spike S6 ([13](../../docs/13-roadmap.md)) закрывается без mapping: stable ID WARRANT (`REQ-ING-001`, `ADR-004`, `TERM-customer`) становится `name`, identity — `spec/REQ-ING-001`, `spec/ADR-004`, `lexicon/TERM-customer`. LATTICE принимает внешние имена как есть, таблица соответствий не нужна. Это фиксируется в [05 §1](../../docs/integrations/05-warrant-lattice.md) после принятия.

## D2. Допустимые комбинации `acceptance × currency`

**Решение.** `currency` для `rejected` не хранится, а вычисляется. Одно правило вывода:

```text
acceptance = rejected  ⇒  currency := retired   (derived; запись вручную запрещена)
```

Так ни одна операция не обязана «помнить» о второй оси: `RejectModel` пишет одно значение и один history event. Это применение главного инварианта §77: если значение детерминировано другой осью, оно не хранится.

Оставшиеся комбинации действительно независимы:

| acceptance | `active` | `deprecated` | `retired` |
|---|---|---|---|
| `draft` | ✓ в работе | ✗ | ✓ брошенный черновик |
| `proposed` | ✓ на рассмотрении | ✗ | ✓ отозвано |
| `accepted` | ✓ действует | ✓ применять не рекомендуется | ✓ выведено |
| `rejected` | — | — | вычислено |

`deprecated` только для `accepted`: устареть может лишь то, что действовало. Само `deprecated` **не** выводится — это самостоятельное решение о действующем объекте, поэтому хранится.

Lint: `L-ST-03 invalid acceptance×currency` (для `draft` / `proposed` с `deprecated`), `L-ST-04 stored currency on rejected`. Reconstruction (D5) восстанавливает legacy `rejected` из одной оси.

## D3. §23: пять неоднозначных статусов

**Семантика GAP.** GAP создаётся только если ось **требуется контрактом type** и не выводима из источника. `null` без GAP допустим там, где type объявляет ось необязательной (placeholder, question). Иначе любое `reserved` порождало бы GAP по grounding, хотя утверждения там нет.

| old_status | `acceptance` | `currency` | `epistemic_state` | `grounding` | GAP |
|---|---|---|---|---|---|
| `open` | `draft` | `active` | `unresolved` | из источника, иначе `null` | по grounding, если type требует |
| `disputed` | из источника; иначе `proposed` | `active` | `contested` | из источника, иначе GAP | по grounding всегда, если нет источника |
| `unknown` | `draft` | `active` | `unresolved` | `null` | classification GAP, если type не выводим (§25) |
| `reserved` | `draft` | `active` | `unresolved` | `null` без GAP | нет: placeholder не утверждает |
| `deferred` | `proposed` | `active` | из источника, иначе `unresolved` | из источника, иначе `null` | нет; обязателен `review` (§25.1): owner, due, condition |

Логика: `open`/`unknown`/`reserved` — объект ещё не предлагался, значит `draft`; `disputed` — спор есть только о том, что уже выдвинуто; `deferred` — предложено, решение отложено, поэтому `proposed` плюс review record, а не отдельная ось.

**Ожидаемый GAP rate.** Задаётся не априори, а измеряется на M0:

```text
для каждого из 5 статусов: выборка ≤ 30 объектов (или все, если меньше)
→ ручная разметка осей двумя людьми → правило прогоняется dry-run → сравнение
метрика: rule_agreement (совпадение правила с разметкой), gap_rate (доля GAP по правилу)
```

| Порог | Действие |
|---|---|
| `rule_agreement ≥ 0.9` и `gap_rate ≤ 0.2` | правило принимается как есть |
| `rule_agreement < 0.9` | правило дорабатывается до M2; статус не мигрирует автоматически |
| `gap_rate > 0.5` | статус объявляется «неопределимым по статусу»; все объекты → GAP с owner; правило не выдумывается (§60) |

**Процедура принятия правила.** rule → dry-run на выборке → отчёт agreement/gap → sign-off owner context → правило получает `rule_id`, `version`, входит в migration function (§24). Изменение правила после M2 = повторный dry-run.

## D4. Направление `tests` и матрица context × context

**Направление.** `test --tests--> target`. Единое правило чтения для всех семи families: edge читается как предложение «source *verb* target»:

```text
section part_of document · term denotes concept · rule cites ref · component depends_on contract
new evolves_from old · test tests requirement · eventA causes eventB
```

Обратное направление (`is_tested_by`, `contains`) — projection, не canonical edge (§27).

**Матрица.** Вместо 7×7×7 — правило по умолчанию плюс явные исключения. Всё, что не перечислено, — `L-RL-05 illegal context relation`.

| Family | Внутри context | Cross-context (source → target) |
|---|---|---|
| `part_of` | ✓ | ✗ — структура не пересекает границу языка |
| `denotes` | ✓ (lexicon) | `lexicon → platform`, `lexicon → method`, `lexicon → spec`: термин обозначает понятие другого context |
| `cites` | ✓ | `* → evidence`: любой объект цитирует source / ref / record |
| `depends_on` | ✓ | `platform → spec` (компонент зависит от требования), `method → platform`; `spec` — никогда source наружу (8.1) |
| `evolves_from` | ✓ | ✗ — lineage не пересекает context; перенос между contexts делается alias'ом (§14.3), не lineage |
| `tests` | ✓ | `evidence → platform`, `evidence → spec`: oracle / baseline проверяет компонент или требование |
| `causes` | ✓ (runtime) | `runtime → evidence`: событие порождает observation; только между `root_kind = event` |

Особые contexts:

- `kernel`: никаких semantic edges. Kernel record — только identity, alias, provenance, history refs.
- `meta`: ни source, ни target instance edges. Meta владеет правилами, не объектами.

Матрица хранится как данные `meta/context-map.json` и проверяется lint, а не описывается прозой.

## D5. Abort criteria и lossless reconstruction

**Abort criteria по фазам (§56).** Каждая фаза имеет gate; провал gate — остановка, не «продолжим и починим».

| Фаза | Gate | Abort, если |
|---|---|---|
| M0 Freeze | Snapshot воспроизводим: double-build идентичен | Два build M0 дают разные hashes |
| M1 Identity | `legacy_alias_resolution_rate = 100%`, `duplicate_identity_rate = 0` | Хотя бы один legacy address без target или с двумя |
| M2 State | Все статусы имеют принятое правило (D3) | Любой статус с `rule_agreement < 0.9` после двух итераций |
| M3 Root kinds | Каждый объект имеет root_kind или classification GAP с owner | GAP без owner |
| M4 Registries | Все types объявлены в registry своего context | Type, используемый объектом, но отсутствующий в registry |
| M5 Relations | `relation_gap_rate ≤ 0.1` | Выше порога после двух итераций правил |
| M6 REF/SECTION | `dangling_refs = 0` | Любой REF или anchor нерезолвим |
| M7 Contexts | Матрица D4 без нарушений | Cross-context edge вне матрицы, который нельзя отнести к GAP |
| M8 Operations | Каждая legacy mutation имеет vertical operation | Mutation без operation |
| M9 Projection | `projection_drift_rate = 0` | Projection содержит факт, отсутствующий в source |
| M10 Lint / reconstruction | `lossless_reconstruction_rate = 100%` (ниже) | < 100% после трёх итераций, или без прогресса между итерациями |

**Общий abort:** переход в compatibility period (§59) запрещён, пока не пройдены M1, M2, M6. Откат — к snapshot M0; ничего в legacy не записывалось (§59: read legacy, write canonical), поэтому откат = отбросить canonical.

**Операционное определение lossless reconstruction.** Не побайтовое равенство, а равенство **legacy view**:

```text
R(target_object, lineage, provenance, migration_mapping) → legacy_view
legacy_view == legacy_object  на множестве полей F, за вычетом объявленного списка D
```

```json
{
  "$schema": "sef://reconstruction-spec/1",
  "compared_fields": ["address", "name", "type", "subtype", "status", "ontoclass", "relations"],
  "intentionally_dropped": [
    { "field": "seq", "reason": "SEQ removed from identity; kept only as alias suffix" },
    { "field": "updated_at", "reason": "runtime timestamp, not semantics" }
  ],
  "relations_comparison": "as_set_of(source, legacy_relation, target)",
  "status_comparison": "reverse_rule(acceptance, currency, grounding, epistemic_state) ∈ legacy_status_candidates"
}
```

- `status`: обратное правило даёт **множество** кандидатов (`accepted+retired` → {retired, historical, superseded}); reconstruction проходит, если legacy status в множестве. Различить их внутри множества позволяет lineage (`superseded` ⇔ есть `evolves_from`) и provenance.
- `relations`: сравнение множеств троек; role и direction восстанавливаются по mapping M5.
- Поле не в F и не в D → ошибка спецификации reconstruction, а не «неважное поле». Список D — часть DoD.
- `lossless_reconstruction_rate` = доля объектов, у которых все F совпали.

## D6. `properties` — на верхнем уровне

**Решение.** `classification = { root_kind, type, subtype }`, и только это. `properties` — отдельный top-level блок объекта, его схема объявляется type registry:

```json
{
  "id": "platform/dispatcher",
  "classification": { "root_kind": "thing", "type": "component", "subtype": null },
  "properties": { "role": "capability" },
  "state": { "acceptance": "accepted", "currency": "active", "grounding": "declared", "epistemic_state": "settled" }
}
```

Registry декларирует допустимые ключи и их тип:

```json
{ "context": "platform", "types": [ { "name": "component", "root_kind": "thing",
  "properties": { "role": { "enum": ["capability", "adapter", "gate"] } },
  "required_axes": ["acceptance", "currency", "grounding", "epistemic_state"] } ] }
```

`required_axes` — то, что делает возможной семантику GAP из D3. §73 исходника уже так и устроен; §74 исправлен.

## D7. Старый lint `G-C11…G-C16`

**Решение.** Старые правила не переносятся. Новый lint **выводится из модели**, старые findings становятся regression-fixtures.

Почему: старый lint проверял старую модель. Перенос «правило за правилом» протаскивает в новую модель старые оси (`status`, `ontoclass`) — это failure mode F2. Источник lint-правил один: каждая ось и каждый инвариант порождает своё правило, поэтому lint полон по построению, а не по памяти.

1. Правило и инвариант живут в одном файле `meta/lint-rules.json`; `rule_id` по категориям §50: `L-ID-*`, `L-CL-*`, `L-ST-*`, `L-RL-*`, `L-PV-*`, `L-HI-*`, `L-MG-*`, каждое с `owner, scope, precedence, source` (§46.1).
2. На M0 сохраняются **fixtures**: объекты snapshot, на которых старый lint давал finding, с id старого правила.
3. В M10 новый lint запускается на fixtures. Disposition каждого старого правила вычисляется, а не назначается:

| Результат на fixtures | Disposition |
|---|---|
| Все findings пойманы одним или несколькими новыми правилами | `REPLACED_BY` |
| Часть не поймана, ось существует в новой модели | `KEPT` временно: недостающее новое правило — GAP с owner |
| Не поймано, ось в новой модели отсутствует | `RETIRED` с причиной «проверяло несуществующую ось» |

Текст `G-C11…G-C16` нужен только для fixtures в M10 и с критического пути снят.

## 8. Системные дополнения

### 8.1. Bounded context `spec`

Первый vertical slice (конец исходника) кладёт в LATTICE объекты OpenSpec: Change, Requirement, Task, Test, Evidence, Decision. Ни один из семи contexts их не владеет: `platform` — семантика самой SEF, не продукта. По критериям §62 у спецификации продукта есть всё: собственный язык (OpenSpec), lifecycle (Change), invariants (`spec-valid`, stable ID), owner (OpenSpec). Значит это восьмой context, а не папка:

| Context | Owner | Types (начально) |
|---|---|---|
| `spec` | OpenSpec (через WARRANT как адаптер) | `change` (thing), `requirement`, `scenario`, `decision` (concept), `task` (thing), `data_contract` (thing) |

Test и Evidence остаются в `evidence` (`oracle`, `record`). Runtime-факты продукта — в `runtime`. Это согласуется с [05 §1](../../docs/integrations/05-warrant-lattice.md) и снимает конфликт slice-примера с моделью.

Разница уровней (contexts фабрики vs объекты продукта) удерживается **одним правилом границы**:

```text
spec — target для depends_on, tests, denotes, cites из других contexts;
spec — source только для part_of внутри себя и cites → evidence;
spec никогда не source для depends_on наружу: продукт не зависит от внутренностей фабрики.
```

LATTICE не хранит текст требований — только identity, classification, оси, edges (§1.6, INV-06). Семейство `spec:<project>` — только когда появится второй продукт и докажет свой язык по §62.

### 8.2. Одна vocabulary операций

Операции описаны трижды: vertical operations в substrate (`AddObject`, `RejectModel`, `GroupObjects`, …), минимальный список в [Q&A §67](02-architecture-qa.md) (`CreateObject`, `UpdateProperties`, `RevertToRevision`, …) и `operation.type` в [02 §4](../../docs/integrations/02-proposal-contract.md). Три словаря для одного вопроса — нарушение §1.1. Решение: **одна примитивная операция на механизм**, всё остальное — composite.

| Механизм (§69) | Примитив | `operation.type` в proposal |
|---|---|---|
| identity | `CreateObject`, `RenameObject` (identity-preserving или new identity + lineage, Q&A §21) | `CREATE`, `RENAME` |
| classification | `ReclassifyObject` | `RECLASSIFY` |
| properties | `UpdateProperties` | `REVISE` |
| acceptance | `RecordDecision(accepted \| rejected)` | `ACCEPT`, `REJECT` |
| currency | `SetCurrency(active \| deprecated \| retired)` | `DEPRECATE`, `RETIRE`, `REACTIVATE` |
| epistemics | `SetEpistemics(grounding, epistemic_state)` | `GROUND` |
| edge | `AddEdge`, `RemoveEdge` (`AddReference` = `AddEdge(cites)`, не отдельный примитив) | `RELATE`, `UNRELATE` |
| history | `RevertToRevision` | `REVERT` |

Composite — batch примитивов в одной транзакции (Q&A §18), не новые примитивы:

| Composite | Состав |
|---|---|
| `SupersedeObject` | `CreateObject` + `AddEdge(evolves_from, role=supersedes)` + `SetCurrency(old, deprecated \| retired)` |
| `MergeObjects`, `SplitObject`, `GroupObjects`, `AbstractInto` | `CreateObject` + `AddEdge(evolves_from, role=…)` + `SetCurrency(retired)` для поглощённых |
| `RejectModel` | `RecordDecision(rejected)`; `currency` выводится (D2) |

`AlignTerms`, `IntroduceType`, `AddContext` — не proposals на объект, а изменения registry: architecture change procedure (§61, Q&A §57), через `factory-change` WARRANT. [02 §4](../../docs/integrations/02-proposal-contract.md) приведён к этому enum.

### 8.3. Snapshot = набор версий, без отдельного `snapshot_id`

Q&A §48 задаёт раздельные версии: `object_version`, `graph_format`, `registry_version`, `migration_version`; §19 — optimistic concurrency по `expected_version` объекта. Отдельный `snapshot_id` тогда избыточен: snapshot **есть** набор версий, и proposal ссылается на него напрямую:

```json
{ "based_on": { "graph_format": 1, "meta_version": 3,
  "registry_versions": { "platform": 12, "lexicon": 17, "spec": 1 },
  "targets": { "platform/dispatcher": 17 } } }
```

`STALE`, если изменились `graph_format`, `meta_version` или версия registry любого затронутого context; `CONFLICT`, если `targets[*]` не совпадает с текущей `object_version` (Q&A §19). Это закрывает I4: в `context_hash` WARRANT входит именно `based_on` целиком, потому что он и есть семантическая картина, на которой рассуждал агент.

### 8.4. Формат файлов

Registries и правила описаны в YAML; конвенция проекта — JSON с `$schema` ([ADR-0006](../../docs/adr/WARRANT-ADR-0006-json-conventions.md)): `platform/types.json`, `meta/context-map.json`, `meta/migration-rules.json`. LLM будет править эти файлы, и аргументы ADR-0006 применимы целиком.

### 8.5. Порядок реализации

Раздел «Что реализовывать первым» откладывает четыре оси состояния на второй шаг, но slice-пример уже использует `acceptance` и `grounding`. Минимум для slice: identity, classification, provenance, edge, history **плюс** `acceptance` и `grounding`. `currency` и `epistemic_state` — после slice; до этого они `null` без GAP (D3).

## 9. Что применено к исходному документу

Механические правки по D1, D4, D6, 8.1, 8.5:

- Блок «Рассмотреть / исправить» заменён ссылкой сюда.
- §3: добавлен context `spec` (с пометкой). §66: восемь contexts.
- §4, §7, §8, §9, §10, §14, §15, §29, §36–37, §52, §53, §68: identity приведены к двум сегментам.
- §14.1: пример невалидного id переписан под новое правило.
- §32: направление `test --tests--> target` зафиксировано.
- §74: `properties` вынесены из CLASSIFICATION.
- Slice-пример: `spec/REQ-001`, `part_of → spec/CHG-001`, `evidence/TEST-001 --tests--> spec/REQ-001`.

Согласовано 2026-09-22: D1–D7, 8.1–8.5. Не перенесено в исходник (ждёт следующей правки): матрица D4 как `context-map.json`, правила D3 в §23, abort criteria в §56, YAML → JSON.

## 10. Сверка с «LATTICE — архитектурные вопросы, ответы и обязательные решения»

Q&A-документ закрывает часть вопросов [00](../../docs/integrations/00-readme.md) и вводит расхождения с substrate, которые устранены ниже.

### 10.1. Закрытые вопросы

| # | Решение | Основание в Q&A |
|---|---|---|
| I3 очередь proposals | **Вне LATTICE.** Persistent core LATTICE — objects, aliases, edges, provenance, history, registries (§51); proposal в него не входит, это вход mutation engine (§17, §43). Очередь — файлы под управлением WARRANT: `.warrant/proposals/<id>.json`, запись только CLI, как evidence. JSON-first (§52–53) и минимализм [03 §9](../../docs/03-architecture.md) совпадают | §15, §43, §51 |
| I4 snapshot в `context_hash` | **Да**, в виде `based_on` (8.3) | §19, §48 |
| I1 внешние ID | Подтверждено: identity `context/name`, уникальность `(context, name)` (§22, §68) | §22, §68 |

### 10.2. I2 `contested`: решение (принято 2026-09-22)

Q&A не задаёт условий входа и выхода. По образцу D2 `contested` **производно** от наличия открытого dispute record, а не выставляется свободно:

```text
epistemic_state = contested   ⇔   существует открытый dispute record на объект
dispute record = { object, claims[≥2 c разными actors], owner, due, condition }   (тот же контракт, что GAP, §25.1)
вход:  RecordDispute — только с двумя claims, каждый с provenance
выход: RecordDecision закрывает dispute → settled; либо condition истекла без решения → остаётся contested, эскалация owner
```

`unresolved` — основания недостаточно (нет claims); `contested` — оснований больше одного и они несовместимы; `settled` — ни того ни другого. Так три значения перестают пересекаться, а анти-протухание (§14: owner, due, condition у всего, что не accepted) распространяется на споры автоматически.

`derived` vs `observed` для результата check: Q&A §19 substrate определяет `derived` как «формально выведено из других данных», `observed` — «непосредственно наблюдалось». Check над артефактами в git — `derived`; runtime / data observation — `observed`. Это совпадает с [02 §1](../../docs/02-vocabulary.md) WARRANT.

### 10.3. Расхождения Q&A с substrate и D1–D7 (исправлены в Q&A)

| Место | Было | Стало |
|---|---|---|
| §22, §55 | примеры `platform/component/dispatcher` (3 сегмента) | `platform/dispatcher` (D1) |
| §7, §68 | «7 contexts» | 8, включая `spec` (8.1) |
| §8 | связи кода `calls`, `implements`, `has-argument` как relations | оставлено; §34 уже требует mapping в семь families через role |
| §67 operations | третий список | сведён в 8.2 |
| §45 actor | `human, agent, system, migration, importer` | принят как enum `actor.type`; `source.system` proposal ([02 §4](../../docs/integrations/02-proposal-contract.md)) = `actor.id` |
| §26 confidence | не в canonical | согласуется с [04 §6](../../docs/integrations/04-jev-classifier.md): confidence живёт только в proposal, не в объекте |

### 10.4. Что Q&A добавляет к WARRANT

- **Semantic gate vs quality gate (§61).** Прямо ложится на gates WARRANT: `lattice-semantic-integrity` (L1, не waivable, freeze vocabulary при FAIL) и `lattice-quality` (L1, waivable). Кандидаты для pack `lattice`.
- **I16 candidate filter (§00)** = тест на object [01 §3](../../docs/integrations/01-lattice-contract.md); формулировки объединить при переносе.
- **Правило без executable test не введено (§64)** — то же, что golden changes [12 §2](../../docs/12-evolution.md); lint-правила LATTICE проверяются golden-набором так же, как policy WARRANT.
