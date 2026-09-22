---
id: WARRANT-DOC-11
title: Интеграции — форма и карта
status: proposed
maturity: deferred
version: 0.1.0
---

# 11. Интеграции

Документ фиксирует **форму** любой интеграции WARRANT с компонентом SEF. Содержание контрактов компонентов
(LATTICE, proposals, SRA, JEV) вынесено в [integrations/](integrations/00-readme.md) и имеет статус идей,
которые предстоит доработать. До их принятия действуют только INV-06 и INV-07 ([01](01-principles.md)).

## 1. Форма интеграции

Интеграция всегда имеет одну структуру. Она выводится из INV-06 (один canonical owner), INV-07 (внешние источники
только предлагают) и authority skill ([07 §5](07-skills.md)):

```text
Интеграция = pack + адаптер + два канала

  read channel      компонент ──▶ Context Pack          (WARRANT читает, не мутирует)
  proposal channel  WARRANT ──▶ компонент                (WARRANT предлагает, не мутирует)
```

| Элемент | Правило |
|---|---|
| Pack | Интеграция подключается как pack (`lattice`, `jev`, `sef`); kernel и документы не меняются ([08](08-packs.md)) |
| Адаптер | Детерминированный код в CLI; общается JSON; не содержит reasoning |
| Read channel | Данные компонента входят в Context Pack и в `context_hash` ([06a §6](06a-evidence.md)) |
| Proposal channel | Единый envelope proposal ([integrations/02](integrations/02-proposal-contract.md)); результат — enum компонента |
| Authority | Ни один компонент не мутирует canonical state другого напрямую |
| Degraded mode | Недоступность компонента не ломает WARRANT: файлы в git остаются SSOT (fail closed только там, где компонент — обязательный источник evidence) |

## 2. Карта компонентов

| Компонент | Read channel (что WARRANT берёт) | Proposal channel (что WARRANT отдаёт) | Authority компонента | Документ |
|---|---|---|---|---|
| **LATTICE** | Semantic read model: объекты, relations, grounding, `epistemic_state`, история по snapshot | REQ, SCN, DCT, ADR, TERM, DECISION как объекты; EVID как provenance | Identity, relations, provenance, валидация инвариантов графа | [integrations/01](integrations/01-lattice-contract.md), [05](integrations/05-warrant-lattice.md) |
| **SRA** | Result envelope skill ([07 §4](07-skills.md)) | Skill invocation, Context Pack | Reasoning; verdict не выносит | [07](07-skills.md), [integrations/03](integrations/03-sra-lattice.md) |
| **JEV** | Candidate classification: profiles, risk dimensions ([05 §4](05-policy.md)) | Пути diff, proposal Change | Нет; floor rules не переопределяет | [integrations/04](integrations/04-jev-classifier.md) |
| **SEF** | Расписание, выбор агента, retry policy | JSON CLI ([04 §7](04-lifecycle.md)): `status`, `next`, `verify` | Оркестрация; переходы состояний — только через `warrant` | граница — [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md); требования — ниже |

### Требования WARRANT к SEF

Status: proposed · Источники: [ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md), [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md);
опираются на черновик SEF rev 3 ([2026-09-17-sef-platform-design](integrations/2026-09-17-sef-platform-design.md), предварительный). Не закрывают вопрос «SEF: CLI или API».

Граница: WARRANT — инструмент стола и argv-гейты; SEF — исполнение, попытки, evidence исполнения, допуск, посадка.

- Sef item задачи ссылается на TASK OpenSpec: `source_ref: <change>#TASK-…`; один TASK — один item.
- `sef work approve` вызывает `warrant transition <change> APPROVED --ref sef://<project>/approval/<work>-r<N>@<commit>` в коммите снимка.
- Pack проекта объявляет тесты одним гейтом `warrant verify --transition VERIFYING->MERGED` (lane и integration); отдельного `pytest`-гейта нет.
- `landing` вызывает `warrant transition <change> MERGED --ref …` в коммите посадки; после последнего TASK Change — `warrant archive` отдельным коммитом (gates `MERGED → ARCHIVED` — integration-гейты, конфликт → `sef inbox`).
- `protected[]` `.sef/pack.yaml` покрывает пути policy WARRANT и неизменные пути архива — `openspec/changes/archive/**`, record и evidence архивных Changes ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)) (`warrant validate` → `SEF_PROTECTED_DRIFT`).
- `.codex/hooks.json` и `AGENTS.md` входят в эталон `.sef/engines/<profile>/`; trust hook Codex выдан в образе или слоте.
- Context Pack попытки включает `rules[]` из `warrant run start <change> --task <TASK>` ([ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)).
- Процесс ACP-адаптера агента запускается с cwd = worktree Change, один процесс на worktree (Codex читает hooks при старте процесса).
- `session/request_permission` не считается механизмом запрета: агент не обязан его вызывать.
- Если SEF — ACP client, он вызывает `warrant validate --files` по `locations` завершённых edit `tool_call`, доставляет hints в следующем prompt и делает `session/cancel` при записи вне `write_scope`.

Роль WARRANT в цепочке proposals всех компонентов одна: **authorization** (policy, approval, INV-11) между источником
proposal и валидацией LATTICE ([integrations/02 §3](integrations/02-proposal-contract.md)).

## 3. Failure modes и security boundary

| Компонент | Недоступен | Отдаёт невалидный ответ | Что уходит наружу |
|---|---|---|---|
| LATTICE | Context Pack без semantic read model; proposals в очередь; gates, требующие LATTICE-evidence, → `BLOCKED` | Proposal result вне enum → `REJECTED` (fail closed) | Только объекты со stable ID и evidence; не код |
| SRA | Run `FAILED`; controller повторяет по retry policy SEF | Envelope не по схеме → Run `FAILED` | Context Pack (минимальный subgraph) |
| JEV | Classification продолжается LLM-proposer и human | Значения вне enum → игнорируются, UNKNOWN по измерению | Пути diff и proposal; никогда secrets и данные |
| SEF | WARRANT работает как локальный CLI | — | JSON-ответы CLI |

## 4. Открытые вопросы

| Вопрос | Состояние |
|---|---|
| Принимает ли LATTICE внешние stable ID как identity (spike S6, [13](13-roadmap.md)) | Открыт, нужен до MVP |
| Семантика `contested` и `derived` в LATTICE для проекции маркеров | Proposed в [integrations/05](integrations/05-warrant-lattice.md) |
| SEF: CLI или API; кто создаёт Run | Открыт |
| Glossary и ADR-индекс как projection LATTICE | Deferred, [10-pack-arch](10-pack-arch.md) |
| Факты фабрики (FACT, DECISION, PATTERN, FAILURE) в LATTICE или в `.warrant/` | Deferred, [12 §6](12-evolution.md) |
