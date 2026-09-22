---
id: WARRANT-DOC-04
title: Жизненный цикл, controller и enforcement
status: normative
maturity: MVP
version: 0.1.0
---

# 04. Жизненный цикл, controller и enforcement

## 1. Цикл WARRANT

Весь процесс — один повторяющийся цикл. Profiles не добавляют этапы, они параметризуют цикл.

```text
       ┌──────────────────────────────────────────────────────┐
       ▼                                                      │
   classify ──▶ resolve ──▶ next ──▶ operation ──▶ check ──▶ gate
                                                              │
                                   controller_action ◀────────┘
                            CONTINUE / WAIT / STOP / ESCALATE
```

| Шаг | Кто выполняет | Детерминирован |
|---|---|---|
| classify | CLI (path rules) + proposer (LLM / JEV) + human | итог — да |
| resolve | CLI | да |
| next | CLI (controller) | да |
| operation | агент через skill (SRA) или CLI | зависит от операции |
| check | CLI / CI | да |
| gate | CLI / CI | да |

## 2. Состояния Change

```text
PROPOSED → SPECIFIED → APPROVED → IMPLEMENTING → VERIFYING → MERGED → ARCHIVED
    └────────────── ABANDONED (из любого состояния до MERGED) ──────────────┘
```

Это **не waterfall**. OpenSpec допускает свободное редактирование artifacts: если design оказался неверным,
design исправляется, и работа продолжается. Возврат назад (`VERIFYING → IMPLEMENTING`,
`IMPLEMENTING → SPECIFIED`) разрешён; переход вперёд — только через gates, указанные для перехода
в effective policy.

| Переход | Типичные gates (из core-sdd) |
|---|---|
| `SPECIFIED → APPROVED` | `spec-valid`, `required-artifacts-present`, `blocking-unknowns-resolved`, `human-approval` |
| `APPROVED → IMPLEMENTING` | `worktree-ready` |
| `VERIFYING → MERGED` | `tests-passed`, `scope-valid`, `analyze-clean`, `evidence-complete` |
| `MERGED → ARCHIVED` | `spec-valid` |

Конкретный набор определяет effective policy ([05](05-policy.md)), каталог — [06](06-verification.md).

## 3. Operations

| Operation | Назначение | Исполнитель | Результат |
|---|---|---|---|
| `classify` | Определить profiles и risk | CLI + proposer | classification в Change metadata |
| `clarify` | Найти decision-relevant неопределённости | skill | UNKNOWN / ASSUMPTION / DECISION, правки spec |
| `specify` | Создать / изменить artifacts OpenSpec | skill + OpenSpec | proposal, specs, design, tasks |
| `review` | Adversarial review спецификации или кода | skill (отдельный Run) | findings → L2 evidence |
| `implement` | Реализация одобренной задачи | CLI оркестрирует, skill рассуждает | код, тесты |
| `analyze` | Найти рассогласования spec ↔ design ↔ tasks ↔ tests ↔ code | CLI (+ skill для семантики) | findings |
| `verify` | Запустить checks и вычислить gates | CLI / CI | evidence, verdicts |
| `converge` | Закрыть найденные gaps | skill | правки кода / tasks |
| `archive` | Завершить Change | OpenSpec | обновлённые specs |

### Правила operations

- `analyze` MUST только обнаруживать, классифицировать и сообщать. Он MUST NOT исправлять.
- `converge` MUST NOT менять spec или design, чтобы подогнать их под код. Если код не соответствует spec —
  это `FAIL`; решение «исправить код» или «изменить spec» принимается явно, изменение spec — отдельная правка с review.
- `implement` — операция CLI: создаёт Run, собирает Context Pack, вызывает skill, запускает checks,
  собирает evidence. Skill MUST NOT сам решать, что implementation завершена.
- `clarify` задаёт вопрос только если ответ способен изменить spec, design, test, risk или data semantics.

## 4. Controller

Controller — **таблица решений**, а не workflow engine. Правила упорядочены; срабатывает первое подходящее.
Таблица поставляется pack'ом (базовая — `core-sdd`) и расширяется другими packs.

```json
{
  "$schema": "warrant://controller-rules/1",
  "rules": [
    { "id": "policy-conflict",    "when": { "policy_conflict": true },            "action": "ESCALATE" },
    { "id": "gate-failed-hard",   "when": { "gate_verdict": "FAIL", "gate_waivable": false }, "action": "STOP" },
    { "id": "blocking-unknown",   "when": { "blocking_unknowns": ">0" },          "action": "WAIT", "next": "clarify" },
    { "id": "missing-artifact",   "when": { "missing_required_artifacts": ">0" }, "action": "CONTINUE", "next": "specify" },
    { "id": "approval-pending",   "when": { "pending_approvals": ">0" },          "action": "WAIT" },
    { "id": "impl-incomplete",    "when": { "open_tasks": ">0" },                 "action": "CONTINUE", "next": "implement" },
    { "id": "verify-incomplete",  "when": { "unevaluated_gates": ">0" },          "action": "CONTINUE", "next": "verify" },
    { "id": "gaps",               "when": { "analyze_findings": ">0" },           "action": "CONTINUE", "next": "converge" },
    { "id": "done",               "when": {},                                     "action": "CONTINUE", "next": "archive" }
  ]
}
```

Controller MUST быть чистой функцией: одинаковое состояние Change + effective policy → одинаковый результат.

### Quality loop

```text
SPEC → IMPLEMENT → VERIFY → ANALYZE → converged? ── yes → MERGE → ARCHIVE
                      ▲                    │
                      └──── CONVERGE ◀─ no ┘
```

## 5. Git discipline

Status: normative · Maturity: MVP

```text
propose / specify  → main        (агент видит все authoritative specs и другие changes)
implement          → worktree    (worktree/<change>)
merge              → main        (через PR, CI — последняя инстанция)
archive            → main
```

- Proposal SHOULD создаваться на `main`, а не в worktree: иначе агент видит только локальный delta
  и теряет контекст других изменений.
- Implementation MUST выполняться в отдельном worktree / ветке.
- Merge MUST проходить через CI, который заново вычисляет gates.

## 6. Enforcement

Prompt не является enforcement (INV-04). Принуждение распределено по слоям:

| Слой | Что принуждает | Maturity |
|---|---|---|
| **CLI** `warrant` | Разрешает переходы состояний, пишет evidence и runs | MVP |
| **CI** | Заново вычисляет L0/L1, блокирует merge | MVP |
| **Pre-tool hooks** frontend'а | Блокируют запрещённые действия (запись в `.warrant/evidence/`, production) | MVP (Claude Code) |
| **Permissions** | Ограничивают инструменты, пути, доступ к production | MVP |

WARRANT **agent-agnostic**: вся логика в CLI, который общается JSON. Frontends (Claude Code — первый;
далее агенты через ACP или API) — адаптеры, которые вызывают CLI и транслируют capabilities в свои
механизмы (permissions, hooks, sandbox).

### Capabilities

| Capability | Spec author | Implementer | Verifier |
|---|---|---|---|
| `READ_REPO`, `READ_SPEC` | ✓ | ✓ | ✓ |
| `WRITE_SPEC` | ✓ | — | — |
| `WRITE_CODE` | — | ✓ | — |
| `RUN_TEST` | — | ✓ | ✓ |
| `RUN_DATA_CHECK` | — | — | ✓ |
| `READ_EVIDENCE` | — | — | ✓ |
| `GIT_COMMIT` | ✓ | ✓ | — |
| `GIT_PUSH`, `MERGE`, `PRODUCTION_WRITE` | — | — | — |

Роли и capabilities — часть policy; profile MAY запрещать capabilities, но MUST NOT разрешать то,
что запрещено вышестоящим overlay ([05](05-policy.md)). `MERGE` и `PRODUCTION_WRITE` агентам по умолчанию
не выдаются.

## 7. CLI

Все команды MUST поддерживать JSON-вывод (по умолчанию для не-TTY). Контракт ответа:

```json
{
  "command": "next",
  "ok": true,
  "change": "add-customer-search",
  "data": { "controller_action": "CONTINUE", "next": "implement", "rule": "impl-incomplete" },
  "errors": []
}
```

| Команда | Назначение |
|---|---|
| `warrant status [change]` | Состояние Change, effective policy, verdicts, следующая операция |
| `warrant classify <change>` | Классификация (path rules + proposal) |
| `warrant resolve <change>` | Вычислить effective policy (с объяснением источников) |
| `warrant next <change>` | Ответ controller |
| `warrant check [id]` | Запустить check(s), записать evidence |
| `warrant gate [id]` | Вычислить verdict(s) |
| `warrant verify <change>` | `check` + `gate` для всех требований effective policy текущего перехода |
| `warrant analyze <change>` | Детерминированный анализ согласованности |
| `warrant waive` | Создать / отозвать waiver |
| `warrant id <prefix> <area>` | Выдать новый stable ID |
| `warrant validate` | Проверить конфигурацию, packs, JSON Schema, IDs |
| `warrant fmt` | Привести JSON к каноническому виду |
| `warrant sync` | Сгенерировать `openspec/config.yaml` и schema из packs, обновить lock |
| `warrant init` | Инициализировать `.warrant/` и mapping схем для редакторов |

Коды выхода: `0` — ok; `1` — verdict FAIL / STOP; `2` — WAIT / ESCALATE; `3` — ошибка конфигурации.

## 8. Human approval

Approval — gate `human-approval` с evidence вида `human`. Минимальные точки:

- переход `SPECIFIED → APPROVED` для risk ≥ medium;
- merge для классов из INV-11;
- любой waiver;
- понижение risk ниже вычисленного floor.

В MVP approval фиксируется через PR review; CLI читает его как evidence с attestation `human-review` ([06a §3](06a-evidence.md)).

## 9. Change record

Status: normative · Maturity: MVP · Решение — [WARRANT-ADR-0009](adr/WARRANT-ADR-0009-change-record-attestation.md)

Governance-состояние Change (classification, risk, `change_state`) принадлежит WARRANT, а не OpenSpec (INV-06, [03 §2](03-architecture.md)).
Оно хранится в `.warrant/changes/<change>.json`. Имя файла — ID Change без даты ([02 §3](02-vocabulary.md)), поэтому archive OpenSpec его не меняет.

```json
{
  "$schema": "warrant://change-record/1",
  "change": "add-customer-search",
  "change_state": "APPROVED",
  "classification": {
    "profiles": ["feature"],
    "risk": {
      "data_loss":       { "value": "NONE",   "from": "proposer:llm" },
      "reversibility":   { "value": "EASY",   "from": "proposer:llm" },
      "blast_radius":    { "value": "LOCAL",  "from": "floor" },
      "security_impact": { "value": "MEDIUM", "from": "floor" },
      "compatibility":   { "value": "COMPATIBLE", "from": "human:<login>" }
    },
    "risk_level": "MEDIUM"
  },
  "transitions": [
    { "to": "SPECIFIED", "at": "2026-09-22T09:00:00Z", "by": "cli:local", "effective_policy_hash": "sha256:…" },
    { "to": "APPROVED",  "at": "2026-09-22T11:00:00Z", "by": "ci:run/8812", "effective_policy_hash": "sha256:…",
      "gates": { "spec-valid": "PASS", "human-approval": "PASS" }, "evidence": ["EVID-000919"] }
  ]
}
```

Правила:

- Запись MUST выполняться только CLI. Агент и skills MUST NOT редактировать файл напрямую (как для evidence, [06a §3](06a-evidence.md)).
- Файл MUST коммититься: один Change — один файл, diff читаем, конфликтов нет.
- Каждое значение classification MUST хранить источник (`floor`, `proposer:*`, `human:*`), чтобы `resolve --explain` был воспроизводим ([05 §4](05-policy.md)).
- Переход вперёд MUST записываться вместе с verdicts gates перехода и ссылками на evidence. Переход в `APPROVED` и `MERGED`
  MUST опираться на evidence с attestation `human-review` или `ci`; запись, сделанная `cli:local`, для этих состояний невалидна.
- `ABANDONED` и `APPROVED` ниоткуда не выводятся и MUST быть записаны явно. Остальные состояния также записываются, но
  `warrant status` MUST сверять запись с производными сигналами (наличие artifacts, worktree, merge в git, каталог archive)
  и сообщать `STALE`, если они расходятся. Запись — акт перехода; вычисление — проверка, что акт всё ещё соответствует реальности.
- Файл — не второй source спецификации: он не содержит ни требований, ни tasks ([03 §8](03-architecture.md)).
