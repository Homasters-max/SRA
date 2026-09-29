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

Change, proposal, specs, design, tasks, spec deltas, archive, schema workflow, project-level SDD context (`openspec/config.yaml`), `openspec validate`.

### WARRANT owns

Classification, risk, profiles, effective policy, controller (выбор следующей операции), gates, waivers, evidence manifest, контракт вызова reasoning, контракт pack, CLI и CI-enforcement.

### SRA owns

Skills и их режимы: authoring, clarification, review, diagnosis, domain modeling и т.д. WARRANT определяет только **контракт** вызова и authority ([07-skills](07-skills.md)).

### LATTICE owns

Identity, relations, provenance, history и epistemic state durable-объектов. WARRANT передаёт в LATTICE decisions и evidence **как proposals** ([11-integrations](11-integrations.md)).

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

Всё остальное — отчёты, dashboards, индексы, графы, traceability matrix, effective policy — **projections**. Projection MUST быть вычислимой из источников и MUST NOT редактироваться как источник.

## 4. Change ≠ Run

```text
Change: add-customer-search
  RUN-01J8Z3KQ…  agent=A  run_state=FAILED
  RUN-01J8Z3M5…  agent=B  run_state=FAILED
  RUN-01J8Z3N7…  agent=A  run_state=SUCCEEDED
```

Change — единица работы и спецификации. Run — одна попытка агента выполнить операцию.

Schema `warrant://run/1` (фаза 4a, `review` — 4b): обязательные `id` (`RUN-<ULID>`), `change`, `operation` (`specify` | `implement` | `review`), `write_scope[]` (пуст только у `review`), `scope[]` (сужение `--scope`, может быть пустым), `branch`, `started_at`, `run_state`, `context_hash`, `effective_policy_hash`, `guard_events[]`; `spec_tree` — обязателен у `review` и отсутствует у остальных ([02 §2](02-vocabulary.md)); необязательные `task`, `skill` (`namespace/name@version`), `model`, `finished_at`, `evidence[]`. Событие `guard_events[]` — каждый вызов `warrant guard` при активном Run: `at`, `phase` (`pre` | `post`), `action` (`edit` | `shell` | `other`), `paths[]`, `decision`, `findings[]` (коды), `rules_shown[]` (id правил), `reason?`, `argv?` (только `deny` по префиксу check); имени frontend в Run нет ([ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 2). Run создаёт `warrant run start <change> --operation <op>` (его JSON — Context Pack), закрывает `warrant run finish [--state …]` ([04 §7](04-lifecycle.md)).

Run `review` — отдельный Run ревьюера spec ([06 §7](06-verification.md), [ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md)): `warrant run start <change> --operation review` в `PROPOSED` при закоммиченных `proposal.md` и `specs/**` (иначе `SPEC_UNCOMMITTED`), `write_scope` пуст, Run запоминает `spec_tree`. Guard при таком Run отклоняет любую правку проекта и любую shell-команду, кроме `warrant run submit`, команд без записи и отмены `warrant run finish --state CANCELLED` ([04 §6](04-lifecycle.md), [ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 5). Закрывает его `warrant run submit`: envelope skill (`skill-result/1`, [07 §4](07-skills.md)) — в `<state>/runs/<id>.result.json` рядом с файлом Run, evidence `review` — в каталог evidence Change, `run_state` — из envelope.

Файл Run `<state>/runs/<id>.json` (и `<id>.result.json` Run `review`) коммитится вместе с работой: `FRONTEND_HOOKS_INACTIVE` сверяет с его событиями diff Change ([06](06-verification.md)). Активный Run указан в `<state>/runs/current` (одна строка — id) — единственный источник `write_scope` для guard; `current` не коммитится (строку `.warrant/runs/current` в `.gitignore` держит `warrant sync`). Активный Run — один на worktree; Run не в `RUNNING` активным не считается. Это позволяет оценивать качество самой фабрики.

## 5. Development ≠ Runtime

```text
"Change is complete"            — факт разработки (change_state = MERGED/ARCHIVED)
"Pipeline execution succeeded"  — факт исполнения (runtime state)
```

Эти факты MUST NOT смешиваться. OpenSpec Change определяет процесс; runtime его исполняет. Runtime-наблюдения связываются с Change только через evidence.

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
│   └── runs/                       RUN-*.json + current (в git в MVP; в sef-hub — вне репозитория, WARRANT_STATE_DIR, ADR-0020 п. 13)
│
├── .codex/hooks.json               генерируется warrant sync: hook warrant guard --frontend codex (адаптер codex, до S1 SEF — ADR-0034)
├── AGENTS.md                       генерируется warrant sync из правил с paths ["**"] (ADR-0022)
├── .claude/                        адаптер claude, MVP (ADR-0014, ADR-0034)
│   ├── settings.json               свои permissions.deny + hook warrant guard; чужие ключи сохраняются
│   └── agents/warrant-reviewer.md  subagent для review-Run
│
├── <adr path>                      по умолчанию docs/adr/, задаётся в warrant.json
├── tests/                          warrant.json → paths.tests
└── src/                            warrant.json → paths.src
```

Пути, отличные от OpenSpec, MUST задаваться в `warrant.json` → `paths`, а не зашиваться в packs. Ветки: `spec/<change>`, `worktree/<change>`, `archive/<change>` — имя ветки задаёт mapping PR → Change ([ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md)).

## 7. Владение каталогами

| Путь | Владелец | Изменение |
|---|---|---|
| `openspec/specs/`, `openspec/changes/` | OpenSpec | Обычный Change |
| `openspec/schemas/`, `openspec/config.yaml` | WARRANT (через pack) | `factory-change` |
| `.warrant/warrant.json`, `.warrant/warrant.lock.json`, `.warrant/local/` | WARRANT | `factory-change` |
| `.claude/settings.json`, `.claude/agents/` | WARRANT (генерируется `warrant sync` — управляемое подмножество; адаптер `claude` — MVP, [ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md)) | `factory-change` |
| `.codex/hooks.json`, `AGENTS.md` | WARRANT (генерируется `warrant sync`, [ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md), [ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)) | `factory-change` |
| `.warrant/local/rules/`, `rules/` pack | WARRANT (path rules, [ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)) | `factory-change` |
| `.claude/skills/openspec-*/` | OpenSpec (`openspec init \| update`; состав — профиль OpenSpec, [ADR-0032](adr/WARRANT-ADR-0032-dev-context.md) п. 8) | `chore` ([ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md)) |
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

MVP MUST NOT требовать: distributed event bus, graph database, workflow engine, multi-agent swarm, отдельную базу памяти. Достаточно файлов в Git, CLI и CI. Трассировка строится по ID и ссылкам в artifacts.
