---
id: WARRANT-DOC-03
title: Архитектура и границы
status: normative
maturity: MVP
version: 0.1.0
---

# 03. Архитектура и границы

## 1. Место WARRANT в SEF

```text
                        HUMAN INTENT
                             │
                             ▼
     ┌──────────────────── WARRANT ─────────────────────┐
     │  classify → resolve policy → next op → gates     │
     └───────┬──────────────┬───────────────┬───────────┘
             │ lifecycle    │ reasoning     │ evidence / decisions
             ▼              ▼               ▼
         OpenSpec          SRA           LATTICE
      (что требуется)  (как рассуждать) (что это, как связано)
             │
             ▼
        Git (код)  ──▶  CI  ──▶  Runtime / Data
```

WARRANT **не заменяет** ни один из этих компонентов. Он управляет процессом вокруг них.

## 2. Распределение ответственности

### OpenSpec owns

Change, proposal, specs, design, tasks, spec deltas, archive, schema workflow, project-level SDD context
(`openspec/config.yaml`), `openspec validate`.

### WARRANT owns

Classification, risk, profiles, effective policy, controller (выбор следующей операции), gates,
waivers, evidence manifest, контракт вызова reasoning, контракт pack, CLI и CI-enforcement.

### SRA owns

Skills и их режимы: authoring, clarification, review, diagnosis, domain modeling и т.д.
WARRANT определяет только **контракт** вызова и authority ([07-skills](07-skills.md)).

### LATTICE owns

Identity, relations, provenance, history и epistemic state durable-объектов.
WARRANT передаёт в LATTICE decisions и evidence **как proposals** ([11-integrations](11-integrations.md)).

### Не владеет WARRANT

- Содержанием спецификаций — MUST NOT создавать `.warrant/specs/` или аналоги.
- Смыслом доменных понятий — это SRA (domain modeling) и LATTICE.
- Кодом и его историей — это Git.

## 3. Источники истины

| Источник | Что является истиной |
|---|---|
| `openspec/specs/` | Требуемое / текущее функциональное поведение |
| ADR проекта | Durable архитектурные решения |
| Git | Фактическое состояние исходников |
| Runtime / Data | Фактическое операционное состояние |
| `.warrant/` | Конфигурация процесса, Change records, waivers, evidence |
| LATTICE | Семантическая идентичность, связи, происхождение |

Всё остальное — отчёты, dashboards, индексы, графы, traceability matrix, effective policy — **projections**.
Projection MUST быть вычислимой из источников и MUST NOT редактироваться как источник.

## 4. Change ≠ Run

```text
Change: add-customer-search
  RUN-01J8Z3KQ…  agent=A  run_state=FAILED
  RUN-01J8Z3M5…  agent=B  run_state=FAILED
  RUN-01J8Z3N7…  agent=A  run_state=SUCCEEDED
```

Change — единица работы и спецификации. Run — одна попытка агента выполнить операцию.

Schema `warrant://run/1` (MVP): `change`, `operation`, `skill` (`namespace/name@version`), `model`, `context_hash`,
`effective_policy_hash`, `write_scope[]`, `branch`, `started_at`, `finished_at`, `run_state`, `evidence[]`,
`guard_events[]` (отказы `warrant guard`, [ADR-0014](adr/WARRANT-ADR-0014-claude-code-enforcement.md)).
Активный Run указан в `.warrant/runs/current` — единственный источник `write_scope` для hook.
Это позволяет оценивать качество самой фабрики.

## 5. Development ≠ Runtime

```text
"Change is complete"            — факт разработки (change_state = MERGED/ARCHIVED)
"Pipeline execution succeeded"  — факт исполнения (runtime state)
```

Эти факты MUST NOT смешиваться. OpenSpec Change определяет процесс; runtime его исполняет.
Runtime-наблюдения связываются с Change только через evidence.

## 6. Структура репозитория проекта

```text
project/
├── openspec/                       OpenSpec (без изменений в формате)
│   ├── config.yaml                 генерируется warrant sync (context + rules)
│   ├── schemas/warrant-sdd/        project-local schema (из pack core-sdd)
│   ├── specs/
│   └── changes/  (+ archive/)
│
├── .warrant/
│   ├── warrant.json                единственная точка конфигурации
│   ├── warrant.lock.json           зафиксированные версии и хэши packs
│   ├── local/                      project-local pack (overrides, свои gates/checks, areas.json, openspec/rules.json)
│   ├── changes/<change>.json       Change record: classification, change_state, unknowns, журнал переходов
│   ├── waivers/                    WAV-*.json
│   ├── evidence/<change>/          manifest.json + записи EVID-*.json
│   └── runs/                       RUN-*.json + current (в git в MVP; внешнее хранение — later)
│
├── .claude/                        генерируется warrant sync для frontend Claude Code (ADR-0014)
│   ├── settings.json               permissions.deny + hook warrant guard
│   └── agents/warrant-reviewer.md  subagent для review-Run
│
├── <adr path>                      по умолчанию docs/adr/, задаётся в warrant.json
├── tests/                          warrant.json → paths.tests
└── src/                            warrant.json → paths.src
```

Пути, отличные от OpenSpec, MUST задаваться в `warrant.json` → `paths`, а не зашиваться в packs.
Ветки: `spec/<change>`, `worktree/<change>`, `archive/<change>` — имя ветки задаёт mapping PR → Change
([ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md)).

## 7. Владение каталогами

| Путь | Владелец | Изменение |
|---|---|---|
| `openspec/specs/`, `openspec/changes/` | OpenSpec | Обычный Change |
| `openspec/schemas/`, `openspec/config.yaml` | WARRANT (через pack) | `factory-change` |
| `.warrant/warrant.json`, `.warrant/warrant.lock.json`, `.warrant/local/` | WARRANT | `factory-change` |
| `.claude/settings.json`, `.claude/agents/` | WARRANT (генерируется `warrant sync`) | `factory-change` |
| `.claude/commands/opsx/`, `.claude/skills/openspec-*/` | OpenSpec (`openspec init \| update`) | `chore` ([ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md)) |
| `.warrant/changes/` | WARRANT (запись только CLI) | Переходы через `warrant` ([04 §9](04-lifecycle.md)); агент MUST NOT писать напрямую |
| `.warrant/waivers/` | WARRANT | Waiver lifecycle ([05](05-policy.md)) |
| `.warrant/evidence/`, `.warrant/runs/` | WARRANT (запись только CLI) | Агент MUST NOT писать напрямую; CI не пишет ([ADR-0010](adr/WARRANT-ADR-0010-trust-by-reference.md)) |
| ADR | Architecture | Change с ADR |
| `tests/`, `src/` | Engineering | Обычный Change |

## 8. Самая важная граница

`.warrant/` MUST NOT становиться второй системой спецификаций. Неправильно:

```text
.warrant/specs/   openspec/specs/   docs/specs/
```

Правильно: спецификация — только `openspec/specs/`. `.warrant/` контролирует процесс вокруг неё.

## 9. Минимализм инфраструктуры

Status: normative · Maturity: MVP

MVP MUST NOT требовать: distributed event bus, graph database, workflow engine, multi-agent swarm,
отдельную базу памяти. Достаточно файлов в Git, CLI и CI. Трассировка строится по ID и ссылкам в artifacts.
