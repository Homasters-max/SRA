---
id: SEF-INT-02
title: Proposal contract — единый канал изменений canonical state
status: proposed
maturity: deferred
version: 0.1.0
---

# 02. Proposal contract

Один канал, по которому **любой** источник предлагает изменение canonical state LATTICE. Раньше proposal описывался трижды (addendum SRA, ProposalSource JEV, `proposals[]` в envelope skill). Здесь — один envelope, один pipeline, один набор результатов.

## 1. Принцип

```text
Proposal — предложение, не мутация.
Источник читает snapshot и предлагает.  Authority у источника нет.
WARRANT разрешает.  LATTICE валидирует и мутирует.  History и evidence фиксируют.
```

Это INV-07 ([01](../01-principles.md)) и authority skill `canonical_mutation: NONE` ([07 §5](../07-skills.md)), распространённые на все компоненты.

## 2. Источники

| Источник | `source.system` | Что предлагает | Документ |
|---|---|---|---|
| SRA skill | `sra` | Объекты, relations, reclassification, revision по итогам reasoning | [03](03-sra-lattice.md) |
| JEV | `jev` | Candidate classification, aliases, relation candidates | [04](04-jev-classifier.md) |
| WARRANT | `warrant` | REQ, SCN, DCT, ADR, TERM, DECISION из принятых Changes; EVID как provenance | [05](05-warrant-lattice.md) |
| Human | `human` | Любая операция через UI / CLI | — |
| Importer, rules engine | `importer`, `rules` | Массовый ввод legacy, детерминированные переклассификации | — |

У всех источников `authority: none`. Различие между ними — только в доверии к rationale и в policy WARRANT, которая решает, нужен ли human approval для данного источника и операции.

## 3. Pipeline

```text
source reads snapshot
  → proposal (envelope §4)
  → queue
  → WARRANT authorization     policy: разрешена ли операция этому источнику; нужен ли approval (INV-11)
  → LATTICE validation        инварианты графа, identity, версии snapshot
  → mutation                  только LATTICE
  → history                   proposed_by, accepted_by, based_on
  → evidence                  запись в WARRANT: что было принято и на каком основании
```

- Порядок фиксирован: authorization раньше validation, чтобы LATTICE не тратил валидацию на неразрешённое. LATTICE MAY выполнять предварительную validation без side effects (dry run) до authorization.
- Ни один шаг не пропускается для «доверенного» источника; human отличается только тем, что approval совпадает с самим proposal.

## 4. Envelope

```json
{
  "$schema": "sef://proposal/1",
  "id": "PROP-000341",
  "source": { "system": "sra", "capability": "semantic/provenance", "version": "0.1.0", "run": "RUN-000417" },
  "target": { "object_id": "TERM-customer", "expected_version": 3 },
  "operation": { "type": "RECLASSIFY", "patch": { "subtype": "business_party" } },
  "rationale": "Term is used for both account and party; splitting is proposed in P-2.",
  "based_on": {
    "graph_format": 1,
    "meta_version": 3,
    "registry_versions": { "lexicon": 17 },
    "targets": { "TERM-customer": 3 },
    "context_hash": "sha256:…"
  },
  "marker": "PROPOSAL",
  "grounding_claimed": "inferred"
}
```

| Поле | Правило |
|---|---|
| `id` | Выдаёт инфраструктура (CLI / адаптер), не источник |
| `source` | Система, capability, версия, Run — для history и метрик источника |
| `target` | Для `CREATE` — `object_id: null`; `expected_version` защищает от lost update |
| `operation.type` | Один примитив на механизм ([06 §8.2](../../lattice/docs/03-substrate-decisions.md)): `CREATE`, `RENAME`, `RECLASSIFY`, `REVISE`, `ACCEPT`, `REJECT`, `DEPRECATE`, `RETIRE`, `REACTIVATE`, `GROUND`, `RELATE`, `UNRELATE`, `REVERT`. Composite (supersede, merge, split) — `batch[]` примитивов в одной транзакции |
| `rationale` | Обязателен; proposal без rationale не принимается |
| `based_on` | Обязателен: версии registry затронутых contexts, `meta_version`, `graph_format`, версии целевых объектов. Отдельного `snapshot_id` нет ([06 §8.3](../../lattice/docs/03-substrate-decisions.md)) |
| `marker` | Всегда `PROPOSAL` ([02 §1](../02-vocabulary.md)) |
| `grounding_claimed` | Какое основание источник заявляет для результата; LATTICE вправе понизить, повысить — нет |

Стабильные ID новых объектов при `CREATE` выдаёт LATTICE или WARRANT CLI, не источник ([02 §3](../02-vocabulary.md), открытый вопрос I1).

## 5. Результаты и staleness

| Результат | Кто ставит | Смысл |
|---|---|---|
| `ACCEPTED` | LATTICE после authorization | Мутация выполнена, history записана |
| `REJECTED` | WARRANT (policy) или LATTICE (инвариант) | С причиной; источник MAY переформулировать |
| `DEFERRED` | WARRANT | Ждёт approval человека (`controller_action: WAIT`) |
| `CONFLICT` | LATTICE | Конкурирующий proposal или несовместимое состояние; требует решения субъекта с authority |
| `STALE` | LATTICE | Версии registry / meta / graph_format в `based_on` устарели; proposal не применяется. Несовпадение версии целевого объекта — `CONFLICT` (OCC) |

- Результат вне enum → трактуется как `REJECTED` (fail closed, INV-10).
- `STALE` не означает «неверно»: источник перечитывает snapshot и повторяет reasoning. Это и есть явное закрытие обратной связи «источник читает → предлагает → LATTICE принимает → источник читает обновлённое». Это поток, не цикл.
- Источник MUST NOT сам выставлять результат. Это симметрично правилу «skill не выносит verdict» ([ADR-0003](../adr/WARRANT-ADR-0003-vocabulary-axes.md)).

## 6. Registry

Каждый источник зарегистрирован одной записью:

```json
{
  "$schema": "sef://proposal-source/1",
  "id": "jev-v1",
  "kind": "classifier",
  "system": "jev",
  "authority": "none",
  "reads": ["lexicon@snapshot", "meta/root_kind"],
  "operations": ["RECLASSIFY", "RELATE"],
  "rationale": "required"
}
```

`operations` ограничивает, что источник вправе предлагать вообще; policy WARRANT сужает это по Change и risk. Registry источников — данные pack `lattice` в `.warrant/`, как и очередь.

## 7. Идемпотентность и очередь

- Повтор proposal с тем же `source`, `target`, `operation`, `based_on` MUST быть дедуплицирован по content hash.
- Очередь упорядочена по `target`; два proposals на один target с одним `expected_version` → второй получает `CONFLICT`.
- Очередь — вне persistent core LATTICE: `.warrant/proposals/<id>.json`, запись только CLI ([06 §10.1](../../lattice/docs/03-substrate-decisions.md)).

## 8. Порядок контрактов

При конфликте применяется:

```text
LATTICE invariants → WARRANT policy → контракт источника (SRA / JEV) → конкретный proposal
```

Proposal не может ослабить ни инвариант LATTICE, ни policy WARRANT (INV-08).

## 9. Non-goals

Не определяет: mutation API LATTICE; формат approval человека (это gate `human-approval`, [04 §8](../04-lifecycle.md)); транспорт (файлы, HTTP, ACP); содержание reasoning источников.
