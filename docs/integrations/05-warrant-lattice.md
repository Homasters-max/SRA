---
id: SEF-INT-05
title: WARRANT ↔ LATTICE — объекты, проекция маркеров, authorization
status: proposed
maturity: deferred
version: 0.1.0
---

# 05. WARRANT ↔ LATTICE

Что WARRANT берёт из LATTICE, что отдаёт и какую роль играет в канале proposals. Реализуется pack `lattice` ([08 §6](../08-packs.md)); kernel не меняется.

## 1. Какие объекты WARRANT становятся объектами LATTICE

Критерий — тест на object [01 §3](01-lattice-contract.md): stable ID, переживает Change, нужна история и relations.

| Объект WARRANT / OpenSpec | В LATTICE | Как |
|---|---|---|
| REQ, SCN | object | `CREATE` при archive Change; `REVISE` при изменении текста; `RETIRE` при удалении |
| DCT (data contract) | object | `CREATE` / `REVISE` с версией контракта |
| ADR | object | `CREATE` при `adr_state: ACCEPTED`; composite supersede при `SUPERSEDED` |
| TERM (glossary) | object | `CREATE` / `REVISE`; glossary — projection LATTICE ([10-pack-arch §3](../10-pack-arch.md)) |
| DECISION | object или grounding-событие | Как object, если durable (ADR); иначе как основание `declared` для другого объекта |
| EVID | **не object** | provenance edge `evidences` от объекта к claim; ссылка на запись в `.warrant/evidence/` |
| Change | object (ограниченно) | Identity Change нужна для relations `introduced_by`; содержание остаётся в OpenSpec |
| Run, TASK, WAV, Change record | нет | Операционное состояние WARRANT; в LATTICE не уходит |

Правило: LATTICE хранит **идентичность и связи**, текст остаётся в OpenSpec, evidence — в `.warrant/`. Второго хранилища спецификаций не появляется ([03 §8](../03-architecture.md)).

## 2. Read channel

Адаптер собирает semantic read model ([01 §9](01-lattice-contract.md)) для Context Pack:

- Subgraph по объектам, на которые ссылается Change (REQ, DCT, ADR, TERM) плюс их relations на глубину 1 и history window.
- Версии snapshot (`based_on`) входят в Context Pack и в `context_hash` ([06a §6](../06a-evidence.md)): решено, [06 §8.3](../../lattice/docs/03-substrate-decisions.md).
- `analyze` ([06 §5](../06-verification.md)) остаётся детерминированным по артефактам в git и **не зависит** от LATTICE; read model используется skills, не checks.

## 3. Проекция маркеров на оси объекта

Маркеры — ось высказывания, оси LATTICE — оси объекта ([02 §1](../02-vocabulary.md)). Соответствие — не таблица эквивалентов, а правило проекции, срабатывающее при формировании proposal. Данные pack `lattice`, файл `markers.json`:

| Маркер WARRANT | `grounding` | `epistemic_state` |
|---|---|---|
| `FACT` с основанием spec / ADR / DECISION | `declared` | `settled` |
| `FACT` с основанием check (L0 / L1) | `derived` | `settled` |
| `FACT` с основанием runtime / data evidence | `observed` | `settled` |
| `INFERENCE` | `inferred` | `unresolved` |
| `ASSUMPTION` | `inferred` (актор явно записан) | `unresolved`; `contested`, если оспорена |
| `UNKNOWN` | объекта нет | целевой объект остаётся `unresolved`; blocking UNKNOWN не меняет ось |
| `PROPOSAL` | не пишется как состояние | без изменений; это сам канал [02](02-proposal-contract.md) |
| `DECISION` | `declared`, источник ADR или approver | `settled`; два несовместимых DECISION → `contested` |

Инварианты проекции:

- Только `FACT` и `DECISION` могут дать `settled`. `INFERENCE → FACT` в WARRANT и `inferred → declared | derived | observed` в LATTICE требуют одного и того же grounding-события (INV-05).
- Понижать `grounding_claimed` LATTICE вправе, повышать — нет ([02 §4](02-proposal-contract.md)).
- Check — `derived`, runtime — `observed`; `contested` — производное от dispute record ([07 LD-S-07](../../lattice/docs/00-decision-register.md)).

## 4. WARRANT как authorizer

В pipeline proposals ([02 §3](02-proposal-contract.md)) WARRANT стоит между источником и LATTICE:

| Проверка | Правило |
|---|---|
| Разрешена ли операция источнику | Registry источника + effective policy Change |
| Нужен ли human approval | INV-11: architecture-breaking (supersede ADR), изменение identity (composite merge / split, `RETIRE`, `RENAME`) — только с approval; иначе `DEFERRED` |
| Не ослабляет ли proposal policy | Proposal MUST NOT менять правила WARRANT; это `factory-change` (INV-08) |
| Evidence | Принятый proposal порождает evidence `kind: lattice-mutation`, `attestation: ci`, ссылка на history LATTICE |

WARRANT не валидирует инварианты графа: это LATTICE. WARRANT не мутирует: это тоже LATTICE.

## 5. Degraded mode

LATTICE недоступен или не подключён (весь MVP):

- Context Pack без semantic read model; skills работают по артефактам в git.
- Proposals накапливаются в `.warrant/proposals/` и применяются при появлении LATTICE; при смене версий — `STALE`.
- Ни один gate MVP не требует LATTICE. Gates, которые потребуют его позже, при недоступности дают `BLOCKED`, не `PASS`.

## 6. Что должно быть решено до MVP

| Вопрос | Решение | Почему нельзя было отложить |
|---|---|---|
| I1 — внешние ID как identity (spike S6) | `name` = stable ID WARRANT, identity `spec/REQ-ING-001` ([06 D1](../../lattice/docs/03-substrate-decisions.md)) | Формат ID фиксируется в фазе 1; смена потом = миграция всех specs |
| I4 — snapshot в `context_hash` | Да, как `based_on` ([06 §8.3](../../lattice/docs/03-substrate-decisions.md)) | Иначе старое evidence станет несравнимым при подключении LATTICE |

Оба закрыты на уровне proposed; остальное — фаза 9 ([13 §2](../13-roadmap.md)).

## 7. Открытые вопросы

- I1–I4 закрыты ([07 §12](../../lattice/docs/00-decision-register.md)).
- Факты фабрики (PATTERN, FAILURE, TRAP из [12 §6](../12-evolution.md)) — объекты LATTICE или остаются в `.warrant/`.
- Glossary и ADR-индекс как projection LATTICE: кто пересобирает Markdown и когда.
