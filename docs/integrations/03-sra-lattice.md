---
id: SEF-INT-03
title: SRA над LATTICE — reasoning contract
status: proposed
maturity: deferred
version: 0.1.0
---

# 03. SRA над LATTICE

Как SRA читает LATTICE, о чём обязан рассуждать честно и как возвращает результат. Envelope и authority skills уже определены в [07](../07-skills.md); здесь — только то, что добавляет LATTICE.

## 1. Граница

```text
LATTICE stores semantic state.   SRA reasons about semantic state.
SRA may: READ · REASON · PROPOSE
SRA may not: MUTATE canonical LATTICE · change LATTICE rules · silently resolve conflicts · turn inference into fact
```

## 2. Что SRA получает

Часть Context Pack ([07 §3](../07-skills.md)) — semantic read model ([01 §9](01-lattice-contract.md)): objects, relations, identity, classification, grounding, provenance, `epistemic_state`, history window.

- Не весь LATTICE, а минимальный достаточный subgraph под задачу. Состав определяет адаптер по operation и effective policy, не skill.
- Snapshot read model входит в `context_hash` Run (открыто, I4).
- SRA MUST NOT знать об устройстве LATTICE больше, чем нужно для reasoning: только контракт 01.

## 3. Обязанности reasoning

| Обязанность | Правило |
|---|---|
| Различать grounding | `declared`, `derived`, `observed`, `inferred` — не смешивать; LLM inference ≠ declared fact |
| Не угадывать | Недостаточное основание → `unknowns[]` или finding `INSUFFICIENT_GROUNDING`, не значение |
| Различать модели | `domain/modeling` («что означает понятие») ≠ substrate modeling («как понятие существует в LATTICE») |
| Уважать relations | Relation — самостоятельное statement; новый relation type только через proposal → review → LATTICE decision |
| Не создавать второй canonical | Перед `CREATE` проверить existing identity, classification, relations, owner; предпочитать `REVISE` / `RECLASSIFY` |
| Не трогать инфраструктурные поля | Hashes, timestamps, run id — не результат reasoning |

## 4. Reasoning outcomes → result envelope

Черновики вводили статусы SRA (`UNKNOWN`, `INCONCLUSIVE`, `CONFLICT`, `DECISION_REQUIRED`, `STALE`). Это отклонено: единственный статус skill — `run_state` ([ADR-0003](../adr/WARRANT-ADR-0003-vocabulary-axes.md)). Outcomes проецируются на массивы envelope [07 §4](../07-skills.md):

| Outcome | Где в envelope | Маркер / поле |
|---|---|---|
| `UNKNOWN` — смысл или факт не установлен | `unknowns[]` | `blocking` по impact |
| `INCONCLUSIVE` — основания недостаточно | `findings[]`, `category: "insufficient-grounding"` | `marker: INFERENCE` |
| `CONFLICT` — несовместимые утверждения | `findings[]`, `category: "conflict"`, `severity: BLOCKER` или `MAJOR` | `marker: FACT` с `grounding: derived`, если конфликт структурный; иначе `INFERENCE` |
| `DECISION_REQUIRED` — нужно нормативное решение | `decisions_required[]` с `options` | — |
| `STALE` — контекст устарел | `run_state: FAILED`, причина `STALE_CONTEXT`; controller пересобирает Context Pack | поле причины — открытый вопрос к 07 §4 |

Следствие: SRA никогда не сообщает «WAIT» или «BLOCKED». Это решает controller по содержимому массивов.

## 5. Конфликты, которые SRA не разрешает молча

identity conflict · classification conflict · relation conflict · provenance conflict · semantic contradiction · stale context.

Допустимый результат — finding `conflict` плюс `decisions_required[]` с вариантами. Разрешает субъект с authority (`PROPOSAL → DECISION`, [02 §1](../02-vocabulary.md)).

## 6. Proposals

Все изменения semantic state SRA возвращает в `proposals[]` envelope. Адаптер WARRANT переупаковывает каждый элемент в envelope [02 §4](02-proposal-contract.md): добавляет `id`, `source.run`, `based_on` из Context Pack. Skill не заполняет `based_on` сам: snapshot известен инфраструктуре.

## 7. Semantic skills (кандидаты, informative)

Одна семантическая ответственность на skill ([07 §6](../07-skills.md)):

| Skill | Отвечает на |
|---|---|
| `semantic/substrate-modeling` | Object, edge, attribute, projection или operational state? Какие оси нужны? |
| `semantic/provenance` | Достаточно ли основание; какой `grounding` заявить |
| `semantic/epistemic-review` | Assumptions под видом facts, claims без grounding, stale unresolved, нужен ли ADR / experiment / observation |
| `semantic/canonicalization` | Не создаёт ли proposal дубликат; update vs create |
| `semantic/semantic-diff` | Что изменилось по смыслу между двумя snapshot / версиями объекта |

Владелец — SRA; здесь только границы.

## 8. Открытые вопросы

- I4 — входит ли snapshot LATTICE в `context_hash`.
- Поле причины `FAILED` в envelope 07 §4 (`STALE_CONTEXT` и другие).
- Кто решает состав subgraph для operation: recipe pack или адаптер LATTICE.
