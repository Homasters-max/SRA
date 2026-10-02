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

Profile описывает **что** требуется, запрещено, проверяется и одобряется. **Как** это выполнить — решают skills. Profile MUST NOT содержать произвольную логику.

Profiles — это policy, а не OpenSpec schema. Все profiles используют одну schema `warrant-sdd`; отдельная schema создаётся только для другого dependency graph ([01 §3](01-principles.md)).

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

Change MAY иметь несколько profiles (например, `feature` + `data-change`). Classification возвращает набор; resolver композирует их по правилам §5.

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

**Floor по размеру diff** (Maturity: later, по failure mode). Правило вида `{ "diff_size": { "files": N, "lines": M }, "set": { "blast_radius": "COMPONENT" } }` с порогами из параметров pack: большой Change получает более строгую policy, но не блокируется; «разбить Change» решает человек. Отдельного finding `OVERSIZED` нет. В транспорте `sef-hub` то же делает `risk_floor` SEF по фактическому diff ([ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)). Источник идеи — правило «1 change = 1–4 недели» в `oinsio/clear-progress`.

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

**Unknown risk:** если хотя бы одно измерение `UNKNOWN`, уровень MUST быть не ниже `MEDIUM`, и создаётся blocking `UNKNOWN` для этого измерения (controller → `WAIT`, операция `clarify`). Это консервативно (INV-10), но не эскалирует всё подряд в `HIGH`.

### Risk overlays

| Level | Дополнительно к profile | Pack |
|---|---|---|
| `LOW` | обычная verification | core-sdd |
| `MEDIUM` | + `adversarial-review` | core-sdd |
| `HIGH` | + `adversarial-review` (с `core-sdd` 0.4.0 `human-approval` на merge даёт профиль путей проекта, [ADR-0051](adr/WARRANT-ADR-0051-agent-merge-first.md) п. 6) | core-sdd |
| `MEDIUM` | mutation не выполняется (было: «check `mutation` выполняется, gate не required» — снято D-6, [ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md) п. 10) | bdd-tdd |
| `HIGH` | + `mutation-score` | bdd-tdd |
| `HIGH` | + `rollback-rehearsed` (если применимо) | data |

`mutation-score` и `rollback-rehearsed` приносят packs `bdd-tdd` и `data` — своими overlays с `match: {"risk_level": ["HIGH"]}`, а не core-sdd.

Точные наборы задаются overlay-файлами `risk-low.json`, `risk-medium.json`, `risk-high.json` в pack core-sdd; core-sdd поставляет в них только свои gates.

Overlay MAY срабатывать не только по `risk_level`, но и по значению отдельного измерения:

```json
{ "$schema": "warrant://overlay/1", "id": "security-high", "match": { "security_impact": ["HIGH"] } }
```

Resolver сопоставляет `match` с любым полем classification одинаково. Так pack `security` усиливает policy по `security_impact`, не вводя ни profile, ни нового уровня risk ([10-pack-security](10-pack-security.md)).

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

Effective Policy — **вычисляемый runtime-объект**, не SSOT. Он MUST NOT коммититься как редактируемый файл, но MUST включаться в Run, Context Pack и evidence manifest:

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
  "id": "WAV-01M3YC8FP9SYPK438EKXFQS4TX",
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

- `owner` и `expires_at` MUST присутствовать всегда; `approved_by` (human из `roles.maintainer`) MUST присутствовать в любом `waiver_state`, кроме `PROPOSED`. Без них waiver невалиден. (Было: `approved_by` обязателен всегда — тогда агент не мог записать предложенный waiver.)
- Waiver действует на один gate одного Change. Waiver ≠ изменение policy.
- Gates с `waivable: false` MUST NOT отменяться waiver (`human-approval`, `scope-valid` и др.).
- Истёкший waiver → `EXPIRED`; gate перевычисляется.
- Агент MAY предложить waiver (`PROPOSED`, `warrant waive <change> <gate> …`), но не активировать его. Активирует и отзывает человек: `warrant waive --activate <WAV> --by <login>` (пишет `approved_by`), `warrant waive --revoke <WAV> --by <login>`; `--by` — заявление, как у `transition`. Актом человека активацию делает merge maintainer'ом PR, который вносит файл waiver в `ACTIVE`: `.warrant/waivers/**` — путь класса с приёмкой человеком проекта, spec-PR сливает maintainer, у impl-PR судья проверяет `merged_by` ([ADR-0052](adr/WARRANT-ADR-0052-cycle-1-close.md) п. 8). Gate засчитывает только `ACTIVE` неистёкший waiver с `approved_by` ∈ roles (R-2).

### Частичный waiver

Необязательное поле `targets[]` сужает waiver до отдельных объектов, которые gate учитывает поштучно (первое применение — эквивалентные мутанты, [ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md)):

```json
"targets": [
  { "file": "src/orders/total.py", "symbol": "apply_discount", "mutator": "EqualityOperator",
    "replacement": ">=", "source_sha256": "…" }
]
```

- Waiver с `targets` не переводит gate в `WAIVED`: targets читает **check**, поставляющий evidence (исключает их из знаменателя и пишет `excluded_equivalent`, `waivers[]` в `metrics`); gate в пред-фильтре допустимости ([06 §3](06-verification.md)) сверяет, что waiver `ACTIVE` и отпечатки совпадают с текущим кодом (D-10).
- Target, не совпавший с текущим состоянием, — finding `STALE`; исключение не действует.
- Форму target объявляет pack, поставляющий gate; kernel-схема держит `targets[]` как object[], `validate` применяет схему pack вторым шагом (D-13).
