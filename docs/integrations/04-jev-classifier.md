---
id: SEF-INT-04
title: JEV — classifier как ProposalSource
status: proposed
maturity: deferred
version: 0.1.0
---

# 04. JEV — classifier как ProposalSource

JEV (внешняя система классификации; ссылка на исходную идею — https://docs.typesafe.ai/introduction) — источник

**candidate classification**. Authority нет ([ADR-0008](../adr/WARRANT-ADR-0008-naming.md)).

## 1. Принцип

```text
JEV предлагает — LATTICE решает.
JEV читает snapshot — LATTICE пишет canonical.
JEV опционален — LATTICE и WARRANT самодостаточны.
```

## 2. Две роли

| Роль | Где | Контракт | Статус |
|---|---|---|---|
| Semantic advisor (offline) | ProposalSource для LATTICE ([02](02-proposal-contract.md)) | Этот документ, §3–5 | Идея, требует фиксации |
| Proposer classification Change | Proposer для WARRANT ([05 §4](../05-policy.md)) | §6 | Идея; входит в pack `jev` |
| Runtime sensor (System One, reflex layer SEF) | Вне LATTICE и WARRANT | Не определён | Концепция; открытый вопрос I6 |

Роли независимы. Ниже — только первые две; они используют один envelope.

## 3. Разделение с классификатором LATTICE

LATTICE имеет **собственный** детерминированный минимум classification ([01 §5](01-lattice-contract.md)): `root_kind`, `context`, `type`, `subtype`, `properties`, state axes. JEV поставляет знание: concepts, terminology, definitions, semantic relations, rules.

```text
                LATTICE
                   │
      ┌────────────┴────────────┐
      │                         │
 classification            JEV knowledge
 (deterministic contract)  (semantic knowledge / proposal engine)
      │                         │
      └────────────┬────────────┘
                   │
         candidate classification
```

Зависимость односторонняя: `JEV → proposal → LATTICE`. LATTICE MUST NOT требовать JEV для валидации инвариантов, иначе возникает скрытая петля `LATTICE → JEV → LATTICE` и фундамент перестаёт быть независимым.

| Уровень LATTICE | Зависимость от JEV |
|---|---|
| Core invariants | нет |
| Validation | нет |
| Classification workflow | опционально; без JEV классификация деградирует до human / rules, но работает |

## 4. Что JEV делает и не делает

| Делает | Не делает |
|---|---|
| Предлагает `root_kind`, `type`, `subtype` | Не пишет в canonical graph |
| Предлагает aliases, synonyms, mapping legacy → new vocabulary | Не мутирует LATTICE напрямую |
| Предлагает relation candidates | Не обходит validation и authorization |
| Объясняет предложение (`rationale`, explanation) | Не имеет authority |
| Читает snapshot (набор версий registry / meta, [06 §8.3](../../lattice/docs/03-substrate-decisions.md)) | Не читает «живые» данные |
| Особенно полезен на discovery и reclassification | Не входит в bootstrap primitives LATTICE |

## 5. Proposal для LATTICE

Envelope [02 §4](02-proposal-contract.md) с `source.system: "jev"`:

```json
{
  "$schema": "sef://proposal/1",
  "id": "PROP-000342",
  "source": { "system": "jev", "capability": "classifier", "version": "1.0.0" },
  "target": { "object_id": "platform/payment-gateway", "expected_version": 2 },
  "operation": { "type": "RECLASSIFY", "patch": { "root_kind": "thing", "type": "software_component", "subtype": "integration_component" } },
  "rationale": "Term matches concept 'integration component' (confidence 0.91); aliases: payment-provider, psp-adapter.",
  "based_on": { "graph_format": 1, "meta_version": 3, "registry_versions": { "platform": 12, "lexicon": 17 },
                "targets": { "platform/payment-gateway": 2 }, "context_hash": "sha256:…" },
  "marker": "PROPOSAL",
  "grounding_claimed": "inferred"
}
```

Регистрация:

```json
{ "$schema": "sef://proposal-source/1", "id": "jev-v1", "kind": "classifier", "system": "jev", "authority": "none",
  "reads": ["lexicon@snapshot", "meta/root_kind"], "operations": ["RECLASSIFY", "RELATE"], "rationale": "required" }
```

Pipeline и результаты — [02 §3, §5](02-proposal-contract.md). Proposal без `based_on` или `rationale` не принимается; несовпадение версий → `STALE`. History записывает `proposed_by: jev-v1`.

## 6. Proposer classification для WARRANT

Та же роль, другой целевой объект: не object LATTICE, а Change ([05 §4](../05-policy.md)).

| | Вход | Выход | Кто решает |
|---|---|---|---|
| WARRANT | Пути diff, proposal Change | `profiles[]`, значения измерений risk, confidence, rationale | CLI: `max(floor, proposer, human)`; понижение ниже floor — только human |

```json
{
  "$schema": "warrant://classification-proposal/1",
  "change": "add-customer-search",
  "source": { "system": "jev", "version": "1.0.0" },
  "profiles": [{ "id": "feature", "confidence": 0.94 }, { "id": "data-change", "confidence": 0.31 }],
  "risk": { "security_impact": { "value": "LOW", "confidence": 0.8 } },
  "rationale": "Paths under src/search/**; no migrations; touches auth middleware import only."
}
```

- Значения вне enum [05 §4](../05-policy.md) игнорируются; измерение остаётся `UNKNOWN` → `MEDIUM` и blocking UNKNOWN.
- `confidence` ниже порога `params.min_confidence` pack `jev` → proposal не учитывается, но записывается в Change record как `proposer:jev` для метрик.
- JEV MUST NOT видеть итог classification как «своё решение»: итог в Change record ([04 §9](../04-lifecycle.md)) с источником каждого значения.

## 7. Failure modes и security boundary

| Ситуация | Поведение |
|---|---|
| JEV недоступен | LATTICE: classification вручную / rules. WARRANT: LLM-proposer и human; controller не ждёт JEV |
| Невалидный ответ | Отбрасывается целиком; `REJECTED` / измерение `UNKNOWN` (fail closed) |
| JEV «уверен», но противоречит floor | Floor побеждает; расхождение записывается для метрик proposer |
| Устаревший snapshot | `STALE`; JEV перечитывает |

**Предлагаемое ограничение (не доказано, пока открыт I5):** наружу JEV получает только snapshot read model (подмножество), пути diff, текст proposal Change; никогда — код целиком, данные, секреты, evidence. Security boundary считается завершённым только после фиксации точного input envelope и границ локальности запуска JEV.

## 8. Versioning

- `source.version` JEV фиксируется в каждом proposal и в Change record; смена MAJOR — `factory-change` для pack `jev`.
- Метрики источника ([12 §4](../12-evolution.md)): доля принятых proposals, доля `REJECTED` по инварианту, расхождение с human. Деградация — основание отключить источник в policy, не трогая LATTICE.

## 9. Открытые вопросы

- I5 — формат входа, локальность, что можно отдать.
- I6 — runtime-роль sensor: отдельный контракт SEF↔JEV; не смешивать с двумя ролями выше.
- Порог `min_confidence` по умолчанию и нужен ли он вообще, если policy всё равно требует human для risk ≥ MEDIUM.
