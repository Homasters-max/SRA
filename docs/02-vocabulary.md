---
id: WARRANT-DOC-02
title: Словарь, статусы и идентификаторы
status: normative
maturity: MVP
version: 0.1.0
---

# 02. Словарь, статусы и идентификаторы

Это единственный источник значений для маркеров, статусов и ID. Другие документы MUST ссылаться сюда, а не вводить собственные варианты.

## 1. Эпистемические маркеры

Каждый finding в result envelope skill ([07 §4](07-skills.md)) и каждый блок `UNKNOWN` / `ASSUMPTION` / `DECISION` в artifact MUST иметь один из шести маркеров. Остальная проза artifacts маркеров не несёт: до approval она — `PROPOSAL` по умолчанию, а качество маркировки внутри неё — критерий L2-review, не машинной проверки ([01 §2](01-principles.md)).

| Маркер | Значение | Пример |
|---|---|---|
| `FACT` | Утверждение подтверждено grounding (источник, evidence, решение). | «Колонка `customer_id` NOT NULL» (по DDL). |
| `INFERENCE` | Вывод, сделанный рассуждением. Не проверен. | «Судя по коду, ID уникален глобально.» |
| `ASSUMPTION` | Принятое допущение, с которым работа продолжается. Видимо и отзываемо. | «Считаем, что источник отдаёт данные в UTC.» |
| `UNKNOWN` | Ответ неизвестен и важен. Имеет флаг `blocking`. | «Можно ли переписывать исторические записи?» |
| `PROPOSAL` | Предлагаемое изменение или решение. Не принято. | «Добавить partition по дате.» |
| `DECISION` | Решение, принятое субъектом с authority. | «Используем PostgreSQL» (ADR-004). |

### Основание FACT

`FACT` MUST указывать вид основания. Это ось источника, а не второй статус, и она совпадает с осью `grounding` LATTICE, чтобы не плодить второй словарь (INV-06):

| `grounding` | Основание | Пример |
|---|---|---|
| `declared` | spec, ADR, DECISION субъекта с authority | «`customer_id` обязателен» (REQ-CUS-001) |
| `derived` | результат детерминированного check (L0 / L1) | «Все REQ имеют task» (`analyze`) |
| `observed` | runtime / data observation, evidence | «Row count после миграции совпал» (EVID-000921) |

`INFERENCE` и `ASSUMPTION` всегда имеют основание `inferred`. `UNKNOWN`, `PROPOSAL`, `DECISION` основания не несут: `DECISION` само становится основанием `declared` для последующих `FACT`.

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

### Где хранятся UNKNOWN и ASSUMPTION

Source of truth — Change record ([04 §9](04-lifecycle.md)): массивы `unknowns[]` и `assumptions[]`. Запись — `warrant unknown add | resolve` ([04 §7](04-lifecycle.md)): закрытие пишет в элемент `resolution` (текст ответа), `resolved_as` (`decision`, `fact`, `assumption`) и `ref`; `warrant assumption add` — позже (BL-66), ASSUMPTION пока пишется только закрытием UNKNOWN. `warrant unknown` допустим только до `APPROVED` (`PROPOSED`, `SPECIFIED`): вопрос, возникший в реализации, — строка `I-N` в `design.md` с решением maintainer. Gate `blocking-unknowns-resolved` читает только record ([06 §4](06-verification.md)).

- Blocking UNKNOWN закрывает только `DECISION` с `ref` — URL комментария maintainer в PR (`…/pull/<N>#issuecomment-<id>` или `#pullrequestreview-<id>`), текст которого содержит id UNKNOWN; автора, текст и PR комментария проверяет `warrant ci` ([ADR-0040](adr/WARRANT-ADR-0040-slice-fixes.md) п. 2, 3).
- `FACT` / `ASSUMPTION` от агента закрывают только не-blocking UNKNOWN и ref не требуют.

Запись в Markdown — projection для читателя, не источник:

```markdown
> **UNKNOWN** `UNK-CUS-012` · blocking — Можно ли переписывать исторические записи?
> **ASSUMPTION** `ASM-CUS-004` — Источник отдаёт время в UTC.
```

### Связь с LATTICE

Status: proposed · Maturity: deferred

Маркеры — это ось **высказывания**. LATTICE имеет собственные оси объекта: `grounding` (declared / derived / observed / inferred) и `epistemic_state` (settled / contested / unresolved). Эти оси MUST NOT смешиваться. Правило проекции маркеров на оси объекта — не часть kernel; оно задано данными pack `lattice` и описано в [integrations/05-warrant-lattice](integrations/05-warrant-lattice.md).

## 2. Оси статусов

В объектах WARRANT (JSON, frontmatter artifacts) не существует общего поля `status`. Каждая ось имеет собственное имя поля и собственный enum. Исключение — frontmatter документации WARRANT (`status` документа, [00](00-readme.md)).

| Ось | Поле | Значения |
|---|---|---|
| Change | `change_state` | `PROPOSED`, `SPECIFIED`, `APPROVED`, `IMPLEMENTING`, `VERIFYING`, `MERGED`, `ARCHIVED`, `ABANDONED` |
| Run | `run_state` | `QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED` |
| Evidence | `evidence_status` | `PROVEN`, `NOT_PROVEN`, `INCONCLUSIVE`, `NOT_APPLICABLE` |
| Gate | `gate_verdict` | `PASS`, `FAIL`, `WAIVED`, `NOT_APPLICABLE`, `BLOCKED` |
| Controller | `controller_action` | `CONTINUE`, `WAIT`, `STOP`, `ESCALATE` |
| Waiver | `waiver_state` | `PROPOSED`, `ACTIVE`, `EXPIRED`, `REVOKED` |

Оси, принадлежащие packs (например, runtime-состояние data process), определяются в документе pack и MUST NOT повторно использовать имена полей из этой таблицы.

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
- `NOT_APPLICABLE` ставится только правилом `applies_when` или детерминированным check (evidence со статусом `NOT_APPLICABLE`, [06 §3](06-verification.md)), не мнением агента.
- `WAIVED` требует `ACTIVE` waiver, срок которого не истёк.
- `attestation.type` записи evidence — не ось статуса, а кто ручается за её происхождение: `ci`, `human-review`, `signature`, `none` ([06a §3](06a-evidence.md)).
- Evidence `review` (результат adversarial review, [06 §7](06-verification.md)) записывает `warrant run submit` из envelope skill ([07 §4](07-skills.md)): `run_state: SUCCEEDED` и ни одной находки `BLOCKER` → `PROVEN`; есть `BLOCKER` → `NOT_PROVEN`; `FAILED` или `CANCELLED` → `INCONCLUSIVE`; число находок по `severity` — в `metrics` ([ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 4). Статус выводит CLI, не skill.
- **`spec_tree`** — hash набора пар «путь → blob» файлов `proposal.md` и `specs/**` каталога Change на commit (тот же набор, что сравнивает gate `spec-approved`). Запись evidence с `subject.spec_tree` (evidence `review`) пред-фильтр gate сравнивает по дереву spec, а не по `commit` и `base_commit`: она переживает коммиты, не меняющие spec, и получает `STALE` с правкой spec ([ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 3).

### Severity находки skill

`severity` — поле finding envelope skill ([07 §4](07-skills.md)), не ось статуса: из него CLI выводит `evidence_status`.

| Значение | Смысл |
|---|---|
| `BLOCKER` | Без исправления реализация по spec неверна или непроверяема; делает evidence `review` `NOT_PROVEN` и MUST быть закрыт до `APPROVED` |
| `MAJOR` | Существенный пробел, spec остаётся проверяемой; информирует maintainer'а, не блокирует |
| `MINOR` | Локальная неточность формулировки, имени, ссылки |
| `INFO` | Наблюдение без дефекта |

### Значения controller_action

| Значение | Смысл |
|---|---|
| `CONTINUE` | Можно выполнять следующую операцию. |
| `WAIT` | Нужна информация или решение человека (blocking UNKNOWN, approval). |
| `STOP` | Нарушено обязательное правило. Продолжение запрещено. |
| `ESCALATE` | Высокий риск или конфликт политики требует human decision. |

### Run и событие guard

- **Run** — одна попытка агента выполнить операцию Change (`specify` | `implement` | `review`) в пределах `write_scope` (`warrant://run/1`, [03 §4](03-architecture.md)); ось — `run_state`. **Активный Run** — Run в `RUNNING`, чей id записан в `<state>/runs/current`; на worktree он один.
- **Событие guard** — запись `guard_events[]` активного Run о вызове `warrant guard`: `phase` (`pre` — до действия, `post` — после), `action` (`edit` | `shell` | `other`), `decision` (`allow` | `deny`), `findings[]` (коды), `rules_shown[]` (id показанных правил). `decision` — ответ hook, не ось статуса: `deny` отменяет действие агента, а не переход Change.

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
| `UNK` | Unknown | `UNK-CUS-012` |
| `ASM` | Assumption | `ASM-CUS-004` |
| `EVID` | Evidence | `EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3` |
| `RUN` | Run | `RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y` |
| `WAV` | Waiver | `WAV-01M3YC8FP9SYPK438EKXFQS4TX` (прежняя форма — `WAV-2026-004`) |

Два формата ([WARRANT-ADR-0012](adr/WARRANT-ADR-0012-id-allocation.md)):

| Класс | Формат | Объекты | Почему |
|---|---|---|---|
| Spec-уровень | `PREFIX-AREA-NNN`, `AREA` — код capability из реестра `.warrant/local/areas.json` (2–5 латинских букв) | `REQ`, `SCN`, `TASK`, `UNK`, `ASM` | Читаемость для людей и LLM |
| Сквозные | `PREFIX-<ULID>` (26 символов Crockford base32) | `EVID`, `RUN`, `WAV` | `EVID`, `RUN` создаются на каждом прогоне, `WAV` — агентом в ветке каждого Change; счётчик без координации ломается ([ADR-0056](adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 2) |
| Waiver прежней формы | `WAV-<year>-NNN` | `WAV` | Остаётся валидным; новых в этой форме CLI не выдаёт |

Идентификатор Change — имя каталога OpenSpec change **без даты**. При archive OpenSpec добавляет префикс даты к каталогу; идентичность Change от этого не меняется. Имя Change MUST NOT переиспользоваться: создание отказывает, если имя есть в `.warrant/changes/` или `openspec/changes/archive/*-<name>`.

### Правила

- ID MUST выдаваться CLI (`warrant id`), а не придумываться LLM.
- ID MUST NOT переиспользоваться, даже после удаления объекта. Реестра нет: следующий NNN = max по `main` (`openspec/specs/**` + `openspec/changes/**`, включая archive) + 1.
- ID spec-уровня становится **immutable с момента `MERGED`** spec-PR. До этого при коллизии с base-веткой `warrant id renumber <old> <new>` переписывает ссылки внутри Change; после — переименование запрещено.
- `AREA` MUST быть объявлена в `.warrant/local/areas.json` (`{ "CUS": { "capability": "customer-search" } }`), 1:1 с каталогом `openspec/specs/<capability>/`. Неизвестная AREA — ошибка `ids-valid`.
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

Совместимость подтверждена spike S1 на OpenSpec 1.13.1 ([WARRANT-ADR-0004](adr/WARRANT-ADR-0004-stable-ids.md)). Правила размещения, которые проверяет `ids-valid`:

- комментарий стоит **непосредственно под** своим заголовком уровня 3 / 4 (над заголовком он приклеится к предыдущему требованию);
- после комментария есть непустое тело (комментарий не считается телом; иначе `--strict` даёт exit 1);
- комментарий не стоит между `## ADDED Requirements` и первым `### Requirement:` (при archive он теряется);
- комментарий закрыт (`<!--` без `-->` вырезает всё после себя).

## 4. Именование

| Что | Стиль | Пример |
|---|---|---|
| ID объектов конфигурации (profile, gate, check, pack, skill) | kebab-case | `contract-compatible` |
| Значения enum | UPPER_SNAKE | `NOT_APPLICABLE` |
| Ключи JSON | snake_case | `required_artifacts` |
| Ссылка с версией | `id@version` | `data-change@1.2.0` |
| Skill | `namespace/name` | `specification/authoring` |

Одинаково в документах и в JSON.

## 5. Уровни тестов самого WARRANT

[ADR-0025](adr/WARRANT-ADR-0025-test-levels.md). Каталог `packages/cli/test/<level>/` = уровень. Для проектов под WARRANT классификация не вводится (долг фазы 5, pack `bdd-tdd`).

| Уровень | Значение |
|---|---|
| `unit` | Функции `core/*` без порождения процессов; файловая система во временном каталоге разрешена |
| `app` | Команда `runX()` в процессе теста с фейковыми портами (`FakeOpenSpec`, `FakeGit`, фейк запуска checks); процессы запрещены |
| `contract` | Настоящий адаптер порта против настоящего `openspec` / `git` / child process и соответствие фейка настоящему |
| `e2e` | Запуск бинаря `warrant` процессом; только по причине из закрытого списка (`argv`, `exit-codes`, `output`, `platform-spawn`, `golden`, `package`, `lifecycle`) |

«Vertical slice» — не уровень тестов, а поставка одного изменения от intent до archive ([13 §1](13-roadmap.md)).
