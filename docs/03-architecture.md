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
| `.warrant/` | Конфигурация процесса, waivers, evidence |
| LATTICE | Семантическая идентичность, связи, происхождение |

Всё остальное — отчёты, dashboards, индексы, графы, traceability matrix, effective policy — **projections**.
Projection MUST быть вычислимой из источников и MUST NOT редактироваться как источник.

## 4. Change ≠ Run

```text
Change: add-customer-search
  RUN-000101  agent=A  run_state=FAILED
  RUN-000102  agent=B  run_state=FAILED
  RUN-000103  agent=A  run_state=SUCCEEDED
```

Change — единица работы и спецификации. Run — одна попытка агента выполнить операцию.
Run содержит: `change_id`, operation, agent, model, `context_hash`, `effective_policy_hash`,
версии skills, worktree, время, `run_state`, ссылки на evidence. Это позволяет оценивать качество самой фабрики.

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
│   ├── local/                      project-local pack (overrides, свои gates/checks)
│   ├── waivers/                    WAV-*.json
│   ├── evidence/<change>/          manifest.json + ссылки на raw evidence
│   └── runs/                       RUN-*.json (MAY быть вне git — см. 06a)
│
├── <adr path>                      по умолчанию docs/adr/, задаётся в warrant.json
├── tests/
└── src/
```

Пути, отличные от OpenSpec, MUST задаваться в `warrant.json` → `paths`, а не зашиваться в packs.

## 7. Владение каталогами

| Путь | Владелец | Изменение |
|---|---|---|
| `openspec/specs/`, `openspec/changes/` | OpenSpec | Обычный Change |
| `openspec/schemas/`, `openspec/config.yaml` | WARRANT (через pack) | `factory-change` |
| `.warrant/warrant.json`, `.warrant/local/` | WARRANT | `factory-change` |
| `.warrant/waivers/` | WARRANT | Waiver lifecycle ([05](05-policy.md)) |
| `.warrant/evidence/`, `.warrant/runs/` | WARRANT (запись только CLI/CI) | Агент MUST NOT писать напрямую |
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
