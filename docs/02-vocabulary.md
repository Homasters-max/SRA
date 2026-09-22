---
id: WARRANT-DOC-02
title: Словарь, статусы и идентификаторы
status: normative
maturity: MVP
version: 0.1.0
---

# 02. Словарь, статусы и идентификаторы

Это единственный источник значений для маркеров, статусов и ID. Другие документы MUST ссылаться сюда,
а не вводить собственные варианты.

## 1. Эпистемические маркеры

Каждое утверждение, выдаваемое агентом или записываемое в artifact, MUST иметь один из шести маркеров:

| Маркер | Значение | Пример |
|---|---|---|
| `FACT` | Утверждение подтверждено grounding (источник, evidence, решение). | «Колонка `customer_id` NOT NULL» (по DDL). |
| `INFERENCE` | Вывод, сделанный рассуждением. Не проверен. | «Судя по коду, ID уникален глобально.» |
| `ASSUMPTION` | Принятое допущение, с которым работа продолжается. Видимо и отзываемо. | «Считаем, что источник отдаёт данные в UTC.» |
| `UNKNOWN` | Ответ неизвестен и важен. Имеет флаг `blocking`. | «Можно ли переписывать исторические записи?» |
| `PROPOSAL` | Предлагаемое изменение или решение. Не принято. | «Добавить partition по дате.» |
| `DECISION` | Решение, принятое субъектом с authority. | «Используем PostgreSQL» (ADR-004). |

### Основание FACT

`FACT` MUST указывать вид основания. Это ось источника, а не второй статус, и она совпадает
с осью `grounding` LATTICE, чтобы не плодить второй словарь (INV-06):

| `grounding` | Основание | Пример |
|---|---|---|
| `declared` | spec, ADR, DECISION субъекта с authority | «`customer_id` обязателен» (REQ-CUS-001) |
| `derived` | результат детерминированного check (L0 / L1) | «Все REQ имеют task» (`analyze`) |
| `observed` | runtime / data observation, evidence | «Row count после миграции совпал» (EVID-000921) |

`INFERENCE` и `ASSUMPTION` всегда имеют основание `inferred`. `UNKNOWN`, `PROPOSAL`, `DECISION` основания не несут:
`DECISION` само становится основанием `declared` для последующих `FACT`.

### Допустимые переходы

```text
INFERENCE  → FACT        только через grounding (evidence / источник)
ASSUMPTION → FACT        только через grounding
ASSUMPTION → INVALIDATED порождает новый Change
UNKNOWN    → FACT | ASSUMPTION | DECISION   через clarify
PROPOSAL   → DECISION    только субъектом с authority
```

Любой другой переход MUST NOT выполняться. См. INV-05.

### Правило UNKNOWN

- `blocking: true` — implementation запрещена до разрешения. Controller → `WAIT`.
- `blocking: false` — работа продолжается с явно записанным `ASSUMPTION`.
- Вопрос SHOULD задаваться только если ответ способен изменить spec, design, test, risk или data semantics.

### Запись в Markdown

```markdown
> **UNKNOWN** `UNK-012` · blocking — Можно ли переписывать исторические записи?
> **ASSUMPTION** `ASM-004` — Источник отдаёт время в UTC.
```

### Связь с LATTICE

Status: proposed · Maturity: deferred

Маркеры — это ось **высказывания**. LATTICE имеет собственные оси объекта: `grounding`
(declared / derived / observed / inferred) и `epistemic_state` (settled / contested / unresolved).
Эти оси MUST NOT смешиваться. Правило проекции маркеров на оси объекта — не часть kernel; оно задано
данными pack `lattice` и описано в [integrations/05-warrant-lattice](integrations/05-warrant-lattice.md).

## 2. Оси статусов

В объектах WARRANT (JSON, frontmatter artifacts) не существует общего поля `status`. Каждая ось имеет
собственное имя поля и собственный enum. Исключение — frontmatter документации WARRANT (`status` документа, [00](00-readme.md)).

| Ось | Поле | Значения |
|---|---|---|
| Change | `change_state` | `PROPOSED`, `SPECIFIED`, `APPROVED`, `IMPLEMENTING`, `VERIFYING`, `MERGED`, `ARCHIVED`, `ABANDONED` |
| Run | `run_state` | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` |
| Evidence | `evidence_status` | `PROVEN`, `NOT_PROVEN`, `INCONCLUSIVE`, `NOT_APPLICABLE` |
| Gate | `gate_verdict` | `PASS`, `FAIL`, `WAIVED`, `NOT_APPLICABLE`, `BLOCKED` |
| Controller | `controller_action` | `CONTINUE`, `WAIT`, `STOP`, `ESCALATE` |
| Waiver | `waiver_state` | `PROPOSED`, `ACTIVE`, `EXPIRED`, `REVOKED` |

Оси, принадлежащие packs (например, runtime-состояние data process), определяются в документе pack
и MUST NOT повторно использовать имена полей из этой таблицы.

### Цепочка агрегации

```text
Check       ──produces──▶ Evidence   (evidence_status)
Evidence    ──feeds────▶  Gate       (gate_verdict)
Gate        ──feeds────▶  Controller (controller_action)
Skill       ──produces──▶ Findings / Proposals — не verdict
```

- Skill MUST NOT выносить verdict. Результат AI-review — это evidence уровня L2 ([06a](06a-evidence.md)).
- У gate нет `INCONCLUSIVE`: неубедительное evidence даёт `FAIL` (INV-10).
- `BLOCKED` — gate невозможно вычислить (нет предпосылок).
- `NOT_APPLICABLE` ставится только правилом `applies_when`, не мнением агента.
- `WAIVED` требует `ACTIVE` waiver, срок которого не истёк.

### Значения controller_action

| Значение | Смысл |
|---|---|
| `CONTINUE` | Можно выполнять следующую операцию. |
| `WAIT` | Нужна информация или решение человека (blocking UNKNOWN, approval). |
| `STOP` | Нарушено обязательное правило. Продолжение запрещено. |
| `ESCALATE` | Высокий риск или конфликт политики требует human decision. |

## 3. Идентификаторы

### Правило идентичности

```text
heading    = display label   (может меняться)
stable ID  = identity        (не меняется никогда)
path/line  = provenance only (не является идентичностью)
```

### Префиксы

| Префикс | Объект | Пример |
|---|---|---|
| — | Change | имя каталога OpenSpec change: `add-customer-search` |
| `REQ` | Requirement | `REQ-ING-001` |
| `SCN` | Scenario | `SCN-ING-003` |
| `TASK` | Task | `TASK-ING-002` |
| `ADR` | Architecture Decision (проекта) | `ADR-004` |
| `DCT` | Data Contract | `DCT-ORDERS` |
| `UNK` | Unknown | `UNK-012` |
| `ASM` | Assumption | `ASM-004` |
| `EVID` | Evidence | `EVID-000921` |
| `RUN` | Run | `RUN-000417` |
| `WAV` | Waiver | `WAV-2026-004` |

Формат: `PREFIX-AREA-NNN`, где `AREA` — короткий код capability (2–5 латинских букв). Для сквозных
объектов (`EVID`, `RUN`, `WAV`) `AREA` не используется.

Идентификатор Change — имя каталога OpenSpec change **без даты**. При archive OpenSpec добавляет
префикс даты к каталогу; идентичность Change от этого не меняется.

### Правила

- ID MUST выдаваться CLI (`warrant id`), а не придумываться LLM.
- ID MUST NOT переиспользоваться, даже после удаления объекта.
- ID нужен только там, где существует traceability. Не засорять ID каждый абзац.

### Размещение ID в artifacts

Для требований и сценариев внутри OpenSpec spec — HTML-комментарий сразу под заголовком:

```markdown
### Requirement: Idempotent ingestion
<!-- id: REQ-ING-001 -->

The system SHALL produce the same logical result when ingestion is repeated for the same input version.

#### Scenario: Repeated run
<!-- id: SCN-ING-003 -->
- **WHEN** ingestion runs twice for input version V
- **THEN** the target dataset is identical after both runs
```

Для файловых artifacts (ADR, data contract, документы) — frontmatter `id:`.

Совместимость HTML-комментариев с `openspec validate` и archive MUST быть подтверждена spike до MVP
([13-roadmap](13-roadmap.md)).

## 4. Именование

| Что | Стиль | Пример |
|---|---|---|
| ID объектов конфигурации (profile, gate, check, pack, skill) | kebab-case | `contract-compatible` |
| Значения enum | UPPER_SNAKE | `NOT_APPLICABLE` |
| Ключи JSON | snake_case | `required_artifacts` |
| Ссылка с версией | `id@version` | `data-change@1.2.0` |
| Skill | `namespace/name` | `specification/authoring` |

Одинаково в документах и в JSON.
