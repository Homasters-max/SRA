---
id: WARRANT-DOC-08
title: Packs и конфигурация
status: normative
maturity: MVP
version: 0.1.0
---

# 08. Packs и конфигурация

## 1. Kernel и packs

```text
KERNEL (меняется редко)                PACKS (подключаются)
├── инварианты          (01)           ├── profiles
├── словарь             (02)           ├── gates, checks
├── контракты JSON Schema              ├── risk overlays, floor rules
├── resolver + controller engine       ├── controller rules, recipes
└── CLI                                ├── OpenSpec schema, templates, config rules
                                       └── ссылки на skills (SRA)
```

Добавить или убрать возможность = подключить или отключить pack. Документы и kernel при этом не меняются.

## 2. Манифест pack

```json
{
  "$schema": "warrant://pack/1",
  "id": "data",
  "version": "0.3.0",
  "kernel": ">=0.1 <0.2",
  "depends_on": { "core-sdd": ">=0.1" },
  "provides": {
    "profiles": ["profiles/data-change.json", "profiles/migration.json"],
    "gates": ["gates/contract-compatible.json", "gates/reconciliation-passed.json"],
    "checks": ["checks/contract-diff.json"],
    "risk_floors": ["risk/floors.json"],
    "controller_rules": [],
    "recipes": ["recipes/specify-data.json"],
    "templates": ["templates/data-contract.md", "templates/migration-plan.md"],
    "openspec_rules": "openspec/rules.json",
    "skills": ["data/contract-authoring@^1", "semantic/evidence-reasoning@^1"],
    "evidence_kinds": ["schema-diff", "data-quality-report", "rollback-report"]
  },
  "params_schema": "params.schema.json"
}
```

Структура каталога pack:

```text
<pack>/
├── pack.json
├── params.schema.json
├── profiles/   gates/   checks/   risk/   recipes/
├── templates/
└── openspec/   (schema, rules)
```

## 3. Конфигурация проекта

`.warrant/warrant.json` — **единственная** точка конфигурации:

```json
{
  "$schema": "warrant://config/1",
  "kernel": "0.1",
  "openspec": "1.13.x",
  "packs": {
    "core-sdd": { "version": "^0.1" },
    "bdd-tdd":  { "version": "^0.1", "params": { "mutation_threshold": 0.9 } },
    "data":     { "version": "^0.3", "params": { "reconciliation": "row-count+checksum" } }
  },
  "paths": {
    "adr": "docs/adr",
    "glossary": "docs/glossary.md",
    "tests": "tests"
  },
  "roles": {
    "data-owner": ["<login>"]
  }
}
```

`.warrant/warrant.lock.json` — вычисленный файл: точные версии packs и skills + content hash каждого.
Lock MUST генерироваться CLI и MUST NOT редактироваться вручную.

## 4. Разрешение и коллизии

- Packs загружаются в порядке зависимостей (`depends_on`), затем project-local pack `.warrant/local/`.
- Два pack, объявляющие объект с одним ID, → ошибка конфигурации (`warrant validate`, код 3).
- Переопределить объект чужого pack можно только в `.warrant/local/` с явным `"overrides": "<pack>:<id>"`.
  Override MUST подчиняться правилам композиции [05 §5](05-policy.md): усиливать можно, ослаблять — нет.
- Изменение версии pack в lock — это `factory-change`.

## 5. Где размещать новую идею

| Вопрос ([01 §3](01-principles.md)) | Что добавить в pack |
|---|---|
| Новое правило | `profiles/` или overlay |
| Детерминированная проверка | `checks/` + `gates/` |
| Повторяемое действие | operation в kernel (редко) или recipe |
| Новый тип знания | `templates/` + `artifacts.required` в profile |
| Reasoning | skill в SRA + ссылка в `provides.skills` |
| Другой dependency graph | `openspec/` schema |

## 6. Каталог packs

| Pack | Содержимое | Maturity | Документ |
|---|---|---|---|
| `core-sdd` | schema `warrant-sdd`, profiles feature / chore / factory-change (0.1), bugfix / refactor / experiment — later, по failure mode; core gates, risk overlays, controller rules, templates proposal / spec / design / tasks | MVP | этот каталог, [05](05-policy.md), [06](06-verification.md) |
| `bdd-tdd` | Gherkin, TDD, red-first, mutation | later | [10-pack-bdd-tdd](10-pack-bdd-tdd.md) |
| `arch` | profile architecture, ADR, C4, glossary | later | [10-pack-arch](10-pack-arch.md) |
| `data` | profiles data-change / migration, contracts, compatibility, rollback | later | [09-pack-data](09-pack-data.md) |
| `brownfield` | characterization, baseline spec | later | [10-pack-brownfield](10-pack-brownfield.md) |
| `security` | overlays по `security_impact`, threat-model, security checks, threat review | later | [10-pack-security](10-pack-security.md) |
| `lattice`, `jev`, `sef` | интеграционные адаптеры: proposal channel, read model, проекция маркеров | deferred | [11-integrations](11-integrations.md), [integrations/](integrations/00-readme.md) |

## 7. Правка конфигурации агентом (LLM)

JSON-конфигурацию MAY править LLM. Чтобы это было надёжно:

- **Один объект — один файл** (`profiles/feature.json`, а не общий `policy.json`): меньше ошибок и конфликтов, читаемый diff.
- Каждый файл MUST содержать `"$schema"`. Схемы kernel содержат `description` у каждого поля — это подсказка для LLM.
- `warrant validate` MUST запускаться pre-commit hook и в CI; невалидная правка не попадает в репозиторий.
- `warrant fmt` приводит JSON к каноническому виду (сортировка ключей по схеме, отступ 2, LF), чтобы diff был стабильным.
- Любая правка `.warrant/**`, `openspec/schemas/**`, `openspec/config.yaml` автоматически получает profile `factory-change`.
- Подсказка в JSON — только ключ `"$comment"` (стандарт JSON Schema), на английском, только где неочевидно.

Схемы адресуются как `warrant://<name>/<major>`; CLI сопоставляет их с файлами, поставляемыми kernel.
Для редакторов `warrant init` генерирует mapping на локальные файлы схем.

## 8. OpenSpec-файлы

`openspec/config.yaml` и `openspec/schemas/**/schema.yaml` остаются **YAML**: этого требует OpenSpec.
Источник — JSON: pack поставляет workflow schema (`openspec/schema.json`, `warrant://openspec-schema/1`),
per-artifact rules (`openspec/rules.json`, `warrant://openspec-rules/1`) и templates (`openspec/templates/`);
проект добавляет свои `context`, `rules` и `operations` в `.warrant/local/openspec/rules.json`.
`warrant sync` сливает их и генерирует `config.yaml` (ключи `schema`, `context`, `rules`, `operations`),
`schema.yaml` и копии templates ([ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md)).
Сгенерированные YAML помечаются первой строкой `# generated by warrant — do not edit` и MUST NOT редактироваться вручную;
`warrant validate` проверяет побайтное совпадение с результатом генерации.

```json
{
  "$schema": "warrant://openspec-rules/1",
  "context": "Python 3.12, PostgreSQL 16, pytest, Docker.",
  "rules": {
    "proposal": ["Identify non-goals", "Identify affected boundaries"],
    "specs": ["Describe observable behavior only", "Every requirement has a stable ID comment"],
    "design": ["Do not introduce infrastructure without justification"],
    "tasks": ["Keep tasks independently verifiable", "Reference REQ IDs"]
  },
  "operations": {
    "apply": { "guidance": ["Run warrant status before marking a task done"] }
  }
}
```
