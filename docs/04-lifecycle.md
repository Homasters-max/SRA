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

После `ARCHIVED` неизменны каталог архива, record и evidence Change; исправление — новый Change с `amends`.
`ABANDONED` замораживает record и удаляет каталог Change тем же коммитом ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)).

| Переход | Gates профиля `feature` (core-sdd@0.1) | Где вычисляется |
|---|---|---|
| `PROPOSED → SPECIFIED` | `required-artifacts-present`, `spec-valid`, `ids-valid` | локально |
| `SPECIFIED → APPROVED` | `spec-valid`, `required-artifacts-present`, `ids-valid`, `blocking-unknowns-resolved`, `adversarial-review`, `human-approval` | CI на spec-PR (кроме `human-approval` — branch protection) |
| `APPROVED → IMPLEMENTING` | `branch-isolated` | локально |
| `VERIFYING → MERGED` | `tests-passed`, `scope-valid`, `analyze-clean`, `ids-valid`, `evidence-complete` | CI на impl-PR |
| `MERGED → ARCHIVED` | `spec-valid`, `required-artifacts-present`, `analyze-clean` | `warrant archive` + CI на archive-PR |

Конкретный набор определяет effective policy ([05](05-policy.md)), каталог — [06](06-verification.md).
Каждый переход привязан к виду PR ([ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md)).

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
    { "id": "policy-conflict",      "when": { "policy_conflict": true },            "action": "ESCALATE" },
    { "id": "gate-failed-hard",     "when": { "gate_verdict": "FAIL", "gate_waivable": false }, "action": "STOP" },
    { "id": "gate-failed-waivable", "when": { "gate_verdict": "FAIL", "gate_waivable": true },  "action": "WAIT" },
    { "id": "blocking-unknown",     "when": { "blocking_unknowns": ">0" },          "action": "WAIT", "next": "clarify" },
    { "id": "missing-artifact",     "when": { "missing_required_artifacts": ">0" }, "action": "CONTINUE", "next": "specify" },
    { "id": "approval-pending",     "when": { "pending_approvals": ">0" },          "action": "WAIT" },
    { "id": "impl-incomplete",      "when": { "open_tasks": ">0" },                 "action": "CONTINUE", "next": "implement" },
    { "id": "awaiting-attestation", "when": { "gates_awaiting_attestation": ">0" }, "action": "WAIT" },
    { "id": "verify-incomplete",    "when": { "unevaluated_gates": ">0" },          "action": "CONTINUE", "next": "verify" },
    { "id": "gaps",                 "when": { "analyze_findings": ">0" },           "action": "CONTINUE", "next": "converge" },
    { "id": "done",                 "when": {},                                     "action": "CONTINUE", "next": "archive" }
  ]
}
```

Определения входов (вычисляет CLI, все — из record, effective policy и evidence):

| Вход | Значение |
|---|---|
| `pending_approvals` | Gates с evidence kind `human-approval` без валидного evidence |
| `gates_awaiting_attestation` | Gates, чей `accepts_attestation` не содержит `none`, при отсутствии evidence с допустимой attestation (ждём CI или review; локальный `verify` их не закроет) |
| `unevaluated_gates` | Gates перехода с verdict `BLOCKED` или ещё не вычисленные, кроме двух категорий выше |

`gate-failed-waivable` даёт `WAIT`, а не проваливается до `done`: человек либо чинит причину, либо оформляет waiver.

Controller MUST быть чистой функцией: одинаковое состояние Change + effective policy → одинаковый результат.

### Quality loop

```text
SPEC → IMPLEMENT → VERIFY → ANALYZE → converged? ── yes → MERGE → ARCHIVE
                      ▲                    │
                      └──── CONVERGE ◀─ no ┘
```

## 5. Git discipline

Status: normative · Maturity: MVP

Топология Change имеет два транспорта ([ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)): `github` (MVP, ниже) и
`sef-hub` (со срезом S1 SEF, proposed: `sef work approve` → попытка → `landing`; archive — `landing` после последнего TASK).

Транспорт `github` — [WARRANT-ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md). Два PR на Change плюс archive:

```text
propose / specify  → ветка spec/<change> от актуального main → PR → human review → merge   (SPECIFIED → APPROVED)
implement          → ветка worktree/<change> (worktree SHOULD) → PR → CI gates → merge      (VERIFYING → MERGED)
archive            → warrant archive → ветка archive/<change> → PR или push в main          (MERGED → ARCHIVED)
```

- Ветка spec MUST создаваться от актуального `main`: агент должен видеть все authoritative specs и другие changes.
  «На main» означает контекст, а не commit target.
- Implementation MUST выполняться в отдельной ветке `worktree/<change>`; отдельный git worktree — SHOULD.
  Gate `branch-isolated` проверяет ветку, потому что CI не видит worktree.
- Impl-PR валиден, только если в base есть merged spec-PR с approving review — так INV-01 проверяется машиной.
- Merge MUST проходить через CI, который заново вычисляет gates; ни одного коммита в `main` вне PR.
- Транзиции record едут в *следующем* PR ([§9](#9-change-record)); между PR `warrant status` показывает `STALE` штатно.
- `openspec archive` MUST вызываться только через `warrant archive`: OpenSpec сам не проверяет граф artifacts
  и архивирует пустой Change (spike S2).

## 6. Enforcement

Prompt не является enforcement (INV-04). Принуждение распределено по слоям:

| Слой | Что принуждает | Maturity |
|---|---|---|
| **CLI** `warrant` | Разрешает переходы состояний, пишет record, evidence и runs | MVP |
| **CI** `warrant ci` | Заново вычисляет L0/L1, верифицирует refs, блокирует merge. Не пишет в репозиторий ([ADR-0010](adr/WARRANT-ADR-0010-trust-by-reference.md)) | MVP |
| **Форж** (GitHub) | Bot-идентичность агента без права merge; branch protection на `main`; required review | MVP |
| **ACP client** (диспетчер SEF, [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)) | Наблюдает `tool_call`, `validate --files` после правки, `session/cancel` при записи вне `write_scope`, проверка живости hooks ([ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md)) | S1 SEF; в MVP нет |
| **Hook** `warrant guard --frontend <name>` | `pre`: отказ вне `write_scope` активного Run и на прямой запуск тяжёлых checks (ADR-0017); `post`: hints по изменённому файлу ([ADR-0019](adr/WARRANT-ADR-0019-post-edit-hints.md)) и текст правил по путям; без активного Run — `deny` ([ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)) | MVP (`codex`); `claude`, `opencode` — later |
| **Static deny** frontend'а | `permissions.deny` в `.claude/settings.json`, генерируется `warrant sync` | later (адаптер `claude`) |

WARRANT **agent-agnostic**: вся логика в CLI, который общается JSON. Frontends — адаптеры, которые переводят
родной формат агента в нормализованное событие `warrant guard` и обратно ([ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md)).
В MVP реализацию ведёт Codex через codex-acp; адаптер Claude Code ([ADR-0014](adr/WARRANT-ADR-0014-claude-code-enforcement.md)) — later.
Hooks внутри агента — ускорение, а не гарантия: запрет до действия, если они загружены; дальше ACP и CI.

Известный предел: deny на `Edit` / `Write` не мешает записи через shell. Гарантия — не hook, а CI: запись
без верифицируемого ref не проходит `warrant ci`.

### Capabilities

| Capability | Spec author | Implementer | Verifier | Принуждение в MVP |
|---|---|---|---|---|
| `READ_REPO`, `READ_SPEC`, `READ_EVIDENCE` | ✓ | ✓ | ✓ | informative: чтение не ограничивается |
| `WRITE_SPEC` | ✓ | — | — | `write_scope` Run + static deny |
| `WRITE_CODE` | — | ✓ | — | `write_scope` Run |
| `RUN_TEST` | — | ✓ | ✓ | — |
| `RUN_DATA_CHECK` | — | — | ✓ | pack `data`, later |
| `GIT_COMMIT` | ✓ | ✓ | — | — |
| `GIT_PUSH` (только `spec/<change>`, `worktree/<change>`) | ✓ | ✓ | — | права GitHub App + hook |
| `OPEN_PR` | ✓ | ✓ | — | права GitHub App |
| `MERGE`, push в `main`, `PRODUCTION_WRITE` | — | — | — | branch protection; у бота нет права merge |

Роли и capabilities — часть policy; profile MAY запрещать capabilities, но MUST NOT разрешать то,
что запрещено вышестоящим overlay ([05](05-policy.md)). `MERGE` и `PRODUCTION_WRITE` агентам не выдаются.

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

| Команда | Назначение | Maturity |
|---|---|---|
| `warrant init` | Инициализировать `.warrant/`, `.claude/`, mapping схем для редакторов. Bootstrap-Change без policy gates | MVP |
| `warrant init change <name>` | `openspec new change --schema warrant-sdd --json` + record в `PROPOSED`; отказ при повторном имени | MVP |
| `warrant status [change]` | Состояние Change, effective policy, verdicts, `STALE`, следующая операция | MVP |
| `warrant classify <change> [--propose <json>]` | Классификация: path rules + proposal агента + human overrides | MVP |
| `warrant resolve <change> [--explain]` | Вычислить effective policy с происхождением каждого требования | MVP |
| `warrant next <change>` | Ответ controller | MVP |
| `warrant run start\|submit\|finish` | Создать Run и Context Pack (с `rules[]`, пересекающими `write_scope`, [ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)), принять result envelope skill, закрыть Run | MVP |
| `warrant guard --frontend <name>` | Адаптер frontend: `pre` — разрешить / отклонить по `write_scope` и тяжёлым checks ([ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)); `post` — hints ([ADR-0019](adr/WARRANT-ADR-0019-post-edit-hints.md)); нормализованный контракт — [ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md) | MVP |
| `warrant unknown add\|resolve`, `warrant assumption add` | Записать UNKNOWN / ASSUMPTION / DECISION в record | MVP |
| `warrant check [id] [--paths …] [--wait]` | Запустить check(s), записать evidence; `--paths` — суженный прогон, `--wait` — ждать замок `exclusive` ([ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)) | MVP |
| `warrant gate [id]` | Вычислить verdict(s) | MVP |
| `warrant verify <change>` | `check` + `gate` для всех требований effective policy текущего перехода | MVP |
| `warrant analyze <change>` | Детерминированный анализ согласованности | MVP |
| `warrant transition <change> <state> --ref <url>` | Записать переход; `APPROVED` / `MERGED` только с верифицируемым ref; `ABANDONED` удаляет каталог Change ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)) | MVP |
| `warrant link <change> --amends\|--supersedes <target>` | Связь с исправляемым (`MERGED` / `ARCHIVED`) или заменяемым (`ABANDONED`) Change; до `APPROVED` ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)) | MVP |
| `warrant sync-state <change>` | Прочитать форж (review, merge, CI run) и записать соответствующие переходы с refs | MVP |
| `warrant archive <change>` | `openspec validate --strict` → gates `MERGED → ARCHIVED` → `openspec archive --yes --json` | MVP |
| `warrant ci` | Всё для CI: Change и переход из ветки, пересчёт L0/L1, верификация refs, JSON, exit 1 при `FAIL` | MVP |
| `warrant id <prefix> <area>`, `warrant id renumber <old> <new>` | Выдать stable ID; перенумеровать до `MERGED` при коллизии | MVP |
| `warrant validate [--files <paths>]` | Конфигурация, packs, JSON Schema, IDs, сгенерированные YAML, отсутствие токенов; `--files` — только проверки одного файла ([ADR-0019](adr/WARRANT-ADR-0019-post-edit-hints.md)) | MVP |
| `warrant fmt` | Привести JSON к каноническому виду | MVP |
| `warrant sync` | Сгенерировать `openspec/config.yaml`, schema, `.codex/hooks.json`, `AGENTS.md` ([ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)) из packs; обновить lock | MVP |
| `warrant waive` | Создать / отозвать waiver | later ([ADR-0013](adr/WARRANT-ADR-0013-mvp-refinement.md)) |

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
- Необязательные `amends[]` (цель в `MERGED` / `ARCHIVED`) и `supersedes[]` (цель в `ABANDONED`) пишет `warrant link`;
  обратные `amended_by[]` / `superseded_by[]` не хранятся — их вычисляют `status` и `analyze`. После `ARCHIVED` или
  `ABANDONED` файл неизменен ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)).
