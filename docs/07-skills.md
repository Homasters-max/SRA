---
id: WARRANT-DOC-07
title: Контракт вызова reasoning (skills)
status: normative
maturity: MVP
version: 0.1.0
---

# 07. Контракт вызова reasoning (skills)

## 1. Граница

Skills принадлежат **SRA**. WARRANT определяет только:

- как skill вызывается (input);
- что skill возвращает (result envelope);
- что skill имеет право делать (authority);
- как skill объявляется, версионируется и оценивается (manifest, audit).

Skill — не workflow, не policy, не check и не SSOT:

```text
Skills reason.  OpenSpec specifies.  WARRANT governs.
Checks enforce. LATTICE remembers meaning. Evidence proves what happened.
```

## 2. Когда нужен новый skill

Только если задача требует semantic reasoning, которое нельзя сделать кодом ([01 §3](01-principles.md)). Если задачу решает существующий skill + mode, композиция skills или check — новый skill MUST NOT создаваться.

Не превращать в skill детерминированную логику: валидацию схем, хэши, ID, enum-проверки, resolve profile, evaluate policy, построение индексов и графов, поиск orphan, coverage, запуск тестов, сбор commit SHA.

## 3. Вызов

```text
Result = Skill(ContextPack, Command)
```

```json
{
  "$schema": "warrant://skill-invocation/1",
  "skill": "specification/authoring@1.2.0",
  "operation": "specify",
  "change": "add-customer-search",
  "run": "RUN-000417",
  "command": "Draft spec delta for the proposal.",
  "context_pack": { "hash": "sha256:…", "items": ["openspec/changes/add-customer-search/proposal.md", "…"] },
  "constraints": { "write_scope": ["openspec/changes/add-customer-search/**"], "authority": "artifact_edit:controlled" }
}
```

Skill SHOULD быть stateless: всё, что ему нужно, приходит в Context Pack.

### Context Pack

Агент не получает весь репозиторий. CLI собирает:

```text
Change + relevant specs + relevant ADR + glossary + affected files + relevant tests
+ relevant data contracts + project rules + effective policy
```

Состав определяется operation и effective policy. Context Pack имеет `context_hash` ([06a §6](06a-evidence.md)).

## 4. Result envelope

Все skills возвращают один формат. Skills различаются reasoning domain, а не протоколом.

```json
{
  "$schema": "warrant://skill-result/1",
  "skill": "specification/authoring@1.2.0",
  "run": "RUN-000417",
  "run_state": "SUCCEEDED",
  "findings": [
    { "id": "F-1", "marker": "INFERENCE", "severity": "MAJOR", "category": "missing-boundary",
      "statement": "No behavior defined for duplicate IDs.", "targets": ["REQ-CUS-002"],
      "recommendation": "Add scenario for duplicate input." }
  ],
  "proposals":         [{ "id": "P-1", "target": "openspec/changes/…/specs/customer/spec.md", "change": "…" }],
  "unknowns":          [{ "id": "U-1", "question": "Can historical records be rewritten?", "blocking": true, "impact": ["design"] }],
  "assumptions":       [{ "id": "A-1", "statement": "Source timestamps are UTC." }],
  "decisions_required":[{ "id": "D-1", "question": "Soft or hard delete?", "options": ["soft", "hard"] }],
  "artifacts_to_update": ["design.md"],
  "recommended_operations": ["clarify"],
  "provenance": { "context_hash": "sha256:…", "model": "…", "started_at": "…", "finished_at": "…" }
}
```

Схема `warrant://skill-result/1` (`packages/cli/schemas/skill-result.1.schema.json`, фаза 4b): обязательные `$schema`, `skill` (`namespace/name@version`), `run` (`RUN-<ULID>`), `run_state` (`SUCCEEDED` | `FAILED` | `CANCELLED`), `findings[]`, `provenance` (`started_at`, `finished_at` — date-time; необязательные `context_hash`, `model`); необязательные `proposals[]`, `unknowns[]`, `assumptions[]`, `decisions_required[]`, `artifacts_to_update[]`, `recommended_operations[]`. Finding: `id`, `marker` (`FACT` | `INFERENCE`), `severity` ([02 §2](02-vocabulary.md)), `category`, `statement`; необязательные `targets[]`, `recommendation`. Неизвестный ключ верхнего уровня или finding отклоняется — в том числе `gate_verdict` и `evidence_status`. Envelope принимает `warrant run submit` только от Run `review` ([04 §7](04-lifecycle.md)); приём `specify` и `implement`, выдача stable ID для `unknowns[]` и `decisions_required[]` — позже.

Envelope сдаётся файлом, а не в тексте команды — предел длины команды не ограничивает размер результата ([ADR-0042](adr/WARRANT-ADR-0042-lattice-fixes.md) п. 4, [ADR-0043](adr/WARRANT-ADR-0043-long-command.md)): исполнитель записывает его во временный каталог ОС вне проекта (у Claude Code — scratchpad сессии) и сдаёт `warrant run submit --file <путь>`, сначала с `--dry-run`. Ошибка `SKILL_RESULT_INVALID` несёт `data.received{ bytes, root, keys }` — что получено, без значений ([06 §7](06-verification.md)).

Правила:

- `run_state` — единственный статус skill. Skill MUST NOT выносить `gate_verdict` или `evidence_status`.
- UNKNOWN, ASSUMPTION, PROPOSAL, DECISION MUST быть в своих массивах, а не смешаны.
- Каждый finding MUST иметь `marker` (обычно `FACT` или `INFERENCE`); INFERENCE MUST NOT выдаваться за FACT.
- Локальные `id` (`F-1`, `U-1`) действуют внутри результата; stable ID (`UNK-…`) выдаёт CLI при записи.
- `severity`: `BLOCKER`, `MAJOR`, `MINOR`, `INFO`.
- **Ничего не теряется молча** (Maturity: later — с первым skill, чей manifest объявляет входной список, например вывод гейта или findings другого ревьюера). Каждый входной элемент попадает либо в `findings[]`, либо в `dismissed[]` (`{ "input_ref", "reason" }`); CLI при приёме envelope проверяет покрытие по ссылкам и числу. Источник — приём «сначала дословно перечисли все находки» из `oinsio/clear-progress`.

## 5. Authority

По умолчанию: **Skill = READ + REASON + PROPOSE**.

```json
{
  "authority": {
    "canonical_mutation": "NONE",
    "policy_change": "NONE",
    "evidence_creation": "PROPOSE_ONLY",
    "artifact_edit": "CONTROLLED"
  }
}
```

| Поле | Значения | Смысл |
|---|---|---|
| `canonical_mutation` | `NONE` | LATTICE и другие canonical stores — только через proposal |
| `policy_change` | `NONE` | Всегда `NONE` |
| `evidence_creation` | `NONE`, `PROPOSE_ONLY` | Evidence записывает только CLI |
| `artifact_edit` | `NONE`, `CONTROLLED` | `CONTROLLED` — правки только внутри `write_scope` из invocation |

Путь мутации:

```text
Skill → proposal → policy / approval → deterministic mutation (CLI) → evidence
```

Authority MUST быть объявлена в manifest; frontend MUST ограничивать запись по `write_scope`.

## 6. Manifest

```json
{
  "$schema": "warrant://skill-manifest/1",
  "id": "specification/authoring",
  "version": "1.2.0",
  "kernel": ">=0.1 <0.2",
  "purpose": "Author observable-behavior specifications for an OpenSpec change.",
  "operations": ["specify"],
  "inputs": ["proposal", "specs", "glossary"],
  "outputs": ["findings", "proposals", "unknowns", "assumptions"],
  "authority": { "canonical_mutation": "NONE", "policy_change": "NONE", "evidence_creation": "NONE", "artifact_edit": "CONTROLLED" },
  "tools": [{ "id": "warrant", "commands": ["id", "status"] }],
  "entry": "SKILL.md"
}
```

### Структура и гранулярность

- Один skill = одна семантическая ответственность, один input-контракт, один output-контракт.
- Namespace: `capability/name` (`specification/authoring`, `code-review/security`). Максимум 2 уровня.
- Каждый skill — отдельная единица загрузки (`SKILL.md`). Крупный skill с многими режимами SHOULD быть разделён: агент не должен загружать ненужные режимы в контекст.
- Независимые review-перспективы (`code-review/spec-compliance`, `code-review/security`, `code-review/architecture`, `code-review/data-impact`) MUST выполняться отдельными Run с отдельным контекстом.

### Версионирование (semver)

| Изменение | Версия |
|---|---|
| Изменение output-контракта, authority или inputs | MAJOR |
| Новая возможность, новая категория findings | MINOR |
| Формулировки prompt без изменения контракта | PATCH |

Версия и content hash фиксируются в `warrant.lock.json`. Run MUST записывать `skill@version`.

### Tools

Skill MAY объявить инструменты (`tools`): команды CLI, MCP-серверы, внешние утилиты. Инструмент — детерминированный; frontend выдаёт его только если capability разрешена effective policy.

## 7. Композиция

Новый skill ради комбинации существующих MUST NOT создаваться. Комбинация задаётся **recipe** в pack:

```json
{
  "$schema": "warrant://recipe/1",
  "id": "specify-feature",
  "operation": "specify",
  "steps": [
    { "skill": "specification/authoring" },
    { "skill": "domain/boundary-review", "when": { "profiles": ["feature", "architecture"] } },
    { "skill": "specification/consistency", "run": "separate" }
  ]
}
```

Recipe — данные, а не код. Controller выбирает operation, recipe — последовательность skills для неё.

## 8. Audit и оценка

Status: normative · Maturity: later

- Каждый вызов фиксируется в Run: skill@version, context_hash, модель, длительность, результат.
- Метрики skill: доля findings, принятых человеком; findings, опровергнутых L1; escaped defects в зоне ответственности skill; retry count.
- Изменение MAJOR/MINOR версии skill SHOULD проходить eval на golden-наборе ([12-evolution](12-evolution.md)).
- Деградация метрик после обновления — основание для отката версии в lock.

## 9. Внешние skills

Хорошие generic skills не копируются вслепую: адаптируются interface, context и authority. Кандидаты (для SRA, informative):

| Источник | Роль |
|---|---|
| mattpocock/skills `grilling` / `grill-with-docs` | `specification/clarification` |
| mattpocock/skills `domain-modeling` | `domain/modeling` |
| mattpocock/skills `tdd` | `engineering/tdd` |
| mattpocock/skills `diagnosing-bugs` | `investigation/bug-diagnosis` |
| mattpocock/skills `research` | `investigation/research` |
| mattpocock/skills `codebase-design`, `improve-codebase-architecture` | `engineering/architecture-design`, `evolution/architecture-audit` |
| claudskills `c4-diagram` | `architecture/c4` (pack arch) |
| mattpocock/skills `to-spec`, `to-tickets` | Adapters: conversation → OpenSpec Change; OpenSpec tasks → tickets (projection) |

Issue tracker MUST оставаться projection OpenSpec tasks, а не canonical specification.
