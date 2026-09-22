---
id: WARRANT-DOC-05
title: Profiles, risk и policy
status: normative
maturity: MVP
version: 0.1.0
---

# 05. Profiles, risk и policy

## 1. Модель

```text
Change ──classify──▶ { profiles[], risk } ──resolve──▶ Effective Policy
                                                         ├── required artifacts
                                                         ├── gates per transition
                                                         ├── capabilities
                                                         ├── approvals
                                                         └── required evidence
```

- **Profile** — декларативный набор требований для класса изменений. Не инструкция агенту.
- **Overlay** — слой политики, участвующий в композиции.
- **Effective Policy** — результат композиции для конкретного Change.

Profile описывает **что** требуется, запрещено, проверяется и одобряется. **Как** это выполнить — решают skills.
Profile MUST NOT содержать произвольную логику.

Profiles — это policy, а не OpenSpec schema. Все profiles используют одну schema `warrant-sdd`;
отдельная schema создаётся только для другого dependency graph ([01 §3](01-principles.md)).

## 2. Каталог profiles

| Profile | Назначение | Pack |
|---|---|---|
| `feature` | Новое поведение | core-sdd |
| `bugfix` | Исправление: assess → characterize → fix → regression test → verify | core-sdd |
| `refactor` | Изменение структуры без изменения поведения; требует behavior baseline | core-sdd |
| `chore` | Docs, конфигурация, обновление зависимостей | core-sdd |
| `architecture` | Durable архитектурное решение; требует design + ADR | arch |
| `data-change` | Изменение данных, схем, семантики, ETL | data |
| `migration` | Перенос данных / схемы между состояниями; rollback обязателен | data |
| `experiment` | hypothesis → experiment → result → decision; не становится production change | core-sdd |
| `factory-change` | Изменение самого WARRANT (policy, packs, schema, skills) | core-sdd |

- `security` — **не profile**, а измерение risk (`security_impact`) и overlay pack `security`.
- `research` — не profile, а паттерн внутри `experiment` или operation `clarify`: не создаёт production change.
- Решение `experiment`: `ADOPT` / `REJECT` / `ITERATE` / `INCONCLUSIVE`. `ADOPT` порождает **новый** Change.

### Несколько profiles

Change MAY иметь несколько profiles (например, `feature` + `data-change`). Classification возвращает набор;
resolver композирует их по правилам §5.

## 3. Схема profile

```json
{
  "$schema": "warrant://profile/1",
  "id": "data-change",
  "version": "1.2.0",
  "extends": ["base"],
  "match": {
    "paths": ["**/migrations/**", "**/*.sql", "pipelines/**"]
  },
  "artifacts": {
    "required": ["proposal", "specs", "data-contract", "migration-plan"],
    "recommended": ["adr"],
    "forbidden": ["direct-production-sql"]
  },
  "gates": {
    "SPECIFIED->APPROVED": ["spec-valid", "contract-compatible", "human-approval"],
    "VERIFYING->MERGED": ["migration-verified", "reconciliation-passed"]
  },
  "capabilities": {
    "forbidden": ["PRODUCTION_WRITE"]
  },
  "approvals": [
    { "role": "data-owner", "at": "SPECIFIED->APPROVED" }
  ],
  "evidence": {
    "required": ["schema-diff", "data-quality-report", "rollback-report"]
  }
}
```

- `required` / `recommended` / `forbidden` разделены, чтобы не использовать waiver там, где достаточно `recommended`.
- `recommended` не блокирует переход, но отображается в `warrant status` и `analyze`.
- Profile MUST быть versioned (semver).

## 4. Classification и risk

### Источники classification

| Источник | Роль | Authority |
|---|---|---|
| Path rules (`match.paths` profiles, floor rules) | Детерминированный минимум | Задаёт floor |
| Proposer (LLM, JEV) | Предлагает profiles и значения risk | Нет — только proposal |
| Human | Подтверждает, повышает, понижает | Понижение ниже floor — только с approval |

Агент MUST NOT сам решать итоговый класс («наверное, low-risk»). Итог вычисляет CLI.

### Измерения risk

| Измерение | Значения (по возрастанию) |
|---|---|
| `data_loss` | `NONE`, `LOW`, `MEDIUM`, `HIGH` |
| `reversibility` | `EASY`, `MODERATE`, `DIFFICULT`, `IRREVERSIBLE` |
| `blast_radius` | `LOCAL`, `COMPONENT`, `SYSTEM`, `CROSS_SYSTEM` |
| `security_impact` | `NONE`, `LOW`, `MEDIUM`, `HIGH` |
| `compatibility` | `COMPATIBLE`, `DEPRECATING`, `BREAKING` |

Каждое измерение MAY иметь значение `UNKNOWN`.

### Floor rules

Детерминированные правила по diff задают **минимальное** значение измерения:

```json
{
  "$schema": "warrant://risk-floor/1",
  "floors": [
    { "paths": ["**/migrations/**"], "set": { "data_loss": "MEDIUM", "reversibility": "MODERATE" } },
    { "paths": ["**/auth/**", "**/security/**"], "set": { "security_impact": "MEDIUM" } },
    { "paths": [".warrant/**", "openspec/schemas/**", "openspec/config.yaml"], "set": { "blast_radius": "SYSTEM" } }
  ]
}
```

Итоговое значение измерения = максимум из floor, proposer и human (понижение ниже floor — только с approval).

### Уровень risk

Вычисляется детерминированно, **в этом порядке**:

```json
{
  "$schema": "warrant://risk-levels/1",
  "high": {
    "when_any": {
      "data_loss": ["MEDIUM", "HIGH"],
      "reversibility": ["DIFFICULT", "IRREVERSIBLE"],
      "security_impact": ["HIGH"],
      "blast_radius": ["SYSTEM", "CROSS_SYSTEM"],
      "compatibility": ["BREAKING"]
    }
  },
  "low": {
    "when_all": {
      "data_loss": ["NONE"],
      "reversibility": ["EASY"],
      "blast_radius": ["LOCAL"],
      "security_impact": ["NONE"],
      "compatibility": ["COMPATIBLE"]
    }
  },
  "default": "MEDIUM"
}
```

1. Совпало `high` → `HIGH`.
2. Совпало `low` → `LOW`.
3. Иначе → `MEDIUM`.

**Unknown risk:** если хотя бы одно измерение `UNKNOWN`, уровень MUST быть не ниже `MEDIUM`,
и создаётся blocking `UNKNOWN` для этого измерения (controller → `WAIT`, операция `clarify`).
Это консервативно (INV-10), но не эскалирует всё подряд в `HIGH`.

### Risk overlays

| Level | Дополнительно к profile |
|---|---|
| `LOW` | обычная verification |
| `MEDIUM` | + `adversarial-review` |
| `HIGH` | + `adversarial-review`, `mutation-score`, `rollback-rehearsed` (если применимо), `human-approval` на merge |

Точные наборы задаются overlay-файлами `risk-low.json`, `risk-medium.json`, `risk-high.json` в pack core-sdd.

Overlay MAY срабатывать не только по `risk_level`, но и по значению отдельного измерения:

```json
{ "$schema": "warrant://overlay/1", "id": "security-high", "match": { "security_impact": ["HIGH"] } }
```

Resolver сопоставляет `match` с любым полем classification одинаково. Так pack `security` усиливает policy по
`security_impact`, не вводя ни profile, ни нового уровня risk ([10-pack-security](10-pack-security.md)).

## 5. Композиция

### Порядок overlays

```text
default → project → profile(s) → risk → waiver
```

### Правила конфликтов

| Ситуация | Результат |
|---|---|
| Более специфичный overlay **усиливает** требование | Применяется |
| Overlay **ослабляет** требование (убирает gate / artifact) | Запрещено; ослабление — только waiver |
| `forbidden` в любом overlay | Абсолютно; никакой overlay кроме `factory-change` не отменяет |
| Одно и то же поле одновременно `required` и `forbidden` | `POLICY_CONFLICT` → `ESCALATE` |
| Неизвестный тип конфликта | `POLICY_CONFLICT` → fail closed |

### Семантика слияния по типу поля

| Поле | Слияние |
|---|---|
| `artifacts.required`, `gates.*`, `evidence.required`, `approvals` | объединение множеств |
| `artifacts.recommended` | объединение; элемент, ставший `required`, удаляется из `recommended` |
| `artifacts.forbidden`, `capabilities.forbidden` | объединение; побеждает всё |
| скалярные параметры (порог, число) | берётся более строгое значение по объявленному направлению |

Пример:

```text
base:    tests
profile: unit-tests
risk:    integration-tests
───────────────────────────
effective: unit-tests + integration-tests
```

Resolver MUST NOT выбирать «последний победивший» — только правила выше.

## 6. Effective Policy

Effective Policy — **вычисляемый runtime-объект**, не SSOT. Он MUST NOT коммититься как редактируемый файл,
но MUST включаться в Run, Context Pack и evidence manifest:

```json
{
  "effective_policy": {
    "hash": "sha256:…",
    "sources": [
      "kernel@0.1.0",
      "core-sdd@0.1.0:profile/feature@1.0.0",
      "data@0.3.0:profile/data-change@1.2.0",
      "core-sdd@0.1.0:risk-high@1.0.0",
      "project:.warrant/local@<git-sha>"
    ],
    "risk_level": "HIGH",
    "explain": [
      { "item": "gate:reconciliation-passed", "from": "profile/data-change" }
    ]
  }
}
```

`warrant resolve --explain` MUST показывать происхождение каждого требования.

## 7. Waivers

Waiver — явное временное исключение из конкретного gate для конкретного Change.

```json
{
  "$schema": "warrant://waiver/1",
  "id": "WAV-2026-004",
  "change": "orders-currency-migration",
  "gate": "reconciliation-passed",
  "reason": "Historical source snapshot unavailable.",
  "risk": "MEDIUM",
  "compensating_controls": ["consumer-validation", "post-release-monitoring"],
  "owner": "data-platform-owner",
  "approved_by": "human:<login>",
  "expires_at": "2026-10-15",
  "waiver_state": "ACTIVE"
}
```

Правила:

- `owner`, `approved_by` (human) и `expires_at` MUST присутствовать. Без них waiver невалиден.
- Waiver действует на один gate одного Change. Waiver ≠ изменение policy.
- Gates с `waivable: false` MUST NOT отменяться waiver (`human-approval`, `scope-valid` и др.).
- Истёкший waiver → `EXPIRED`; gate перевычисляется.
- Агент MAY предложить waiver (`PROPOSED`), но не активировать его.
