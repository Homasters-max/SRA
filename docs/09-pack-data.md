---
id: WARRANT-DOC-09
title: Pack data — данные, контракты, миграции
status: proposed
maturity: later
version: 0.1.0
---

# 09. Pack `data`

Data governance — часть общей системы, а не вторая фабрика. Pack добавляет profiles `data-change` и `migration`,
gates, checks и templates; цикл WARRANT не меняется.

## 1. Что считается data-change

Не только SQL migration:

```text
schema change            column semantics change   data type change
key change               ETL logic change          aggregation change
business rule change     source mapping change     historical backfill
retention change         partition change          published dataset change
```

Детекция — floor rules по путям ([05 §4](05-policy.md)) + classification proposer. При срабатывании
автоматически требуются: data contract → migration strategy → rollback/recovery → data validation → evidence.

## 2. Data process specification

Описывает **процесс и его контракт**, а не SQL. Минимум:

```text
Trigger · Inputs · Outputs · Business semantics · Data constraints
Failure behavior · Recovery · Quality · Idempotency · Time semantics
```

Спецификация процесса MUST жить в OpenSpec spec (требования с ID); машиночитаемый контракт — отдельный
artifact, связанный с этими требованиями. Он MUST NOT становиться вторым OpenSpec.

## 3. Data contract

Отвечает: что входит, что выходит, что это значит, что всегда должно быть истинно.

```json
{
  "$schema": "warrant://data-contract/1",
  "id": "DCT-CUSTOMER",
  "version": "2.1.0",
  "dataset": "customer",
  "requirements": ["REQ-ING-001", "REQ-ING-002"],
  "fields": {
    "customer_id": { "type": "string", "required": true, "unique": true, "semantics": "Registered business customer identifier" },
    "amount":      { "type": "decimal(12,2)", "unit": "EUR", "semantics": "Net invoice amount" },
    "valid_from":  { "type": "timestamp", "time_semantics": "EFFECTIVE_TIME", "timezone": "UTC" }
  },
  "keys": { "identity": ["customer_id"] },
  "quality": { "null_rate": { "customer_id": 0 }, "duplicate_rate": { "customer_id": 0 } },
  "freshness": { "max_delay": "PT24H" },
  "failure": { "invalid_records": "QUARANTINE", "source_unavailable": "RETRY" },
  "recovery": { "idempotent": true }
}
```

Элементы: schema, semantics, keys, nullability, allowed values, units, time semantics, freshness,
quality constraints, compatibility.

## 4. Compatibility engine

Детерминированный check `contract-diff`, а не только review.

| Изменение | Уровень |
|---|---|
| Добавление nullable-поля | `COMPATIBLE` |
| Добавление required-поля | `BREAKING` |
| Удаление поля | `BREAKING` |
| Переименование без alias / migration | `BREAKING` |
| Изменение типа | анализ по таблице расширений типов; по умолчанию `BREAKING` |
| Изменение `unit` | `BREAKING` (semantic) |
| Изменение `time_semantics` / `timezone` | `BREAKING` (semantic) |
| Изменение `keys.identity` | `CRITICAL` |

Семантическая совместимость: `DECIMAL(12,2)` может остаться тем же типом, но `EUR → RUB` — breaking.
Поэтому contract MUST содержать semantics, а engine сравнивает и их.

```json
{
  "compatibility": { "previous": "DCT-ORDERS@2.1.0", "candidate": "DCT-ORDERS@3.0.0", "level": "BREAKING" },
  "findings": [
    { "id": "CMP-001", "field": "currency", "change": "semantic interpretation changed",
      "required_actions": ["migration-plan", "consumer-impact-review", "major-version-bump"] }
  ]
}
```

Gate `contract-compatible`: `PASS` если `COMPATIBLE`, либо `BREAKING` + major bump + required actions выполнены.

## 5. Time semantics, idempotency, late data

- Спецификация MUST явно определять: event time, effective time, load time, processing time, as-of time.
  Агент MUST NOT молча выбирать `created_at` как временную семантику.
- Спецификация MUST отвечать: что произойдёт при повторном запуске на том же input version.
  Ожидание — тот же логический результат либо явно определённое иное поведение.
- Для временных данных MUST быть определены: late event, out-of-order event, correction, reprocessing, backfill.
  Иначе spec для этого процесса считается неполной (`MISSING`).

## 6. Уровни data quality

| Уровень | Проверки |
|---|---|
| Structural | columns, types, nullability, schema |
| Integrity | unique keys, foreign keys, duplicates, referential integrity |
| Semantic | valid ranges, business rules, state transitions |
| Temporal | freshness, late arrival, event ordering, effective dates |
| Reconciliation | source count vs target count, aggregates, checksums |

Pipeline проверки: schema → structural → integrity → semantic → temporal → reconciliation → evidence.
Каждый слой выдаёт machine-readable результат — evidence, а не отдельный SSOT.

## 7. Migration

Migration plan (template) MUST отвечать:

```text
Current state · Target state · Transformation · Compatibility · Backfill
Validation · Rollback · Recovery · Cutover · Post-cutover checks
```

### Rollback — тестируемый объект, а не текст

| Уровень | Значение | Требуется при |
|---|---|---|
| `DECLARED` | Процедура описана | любой migration |
| `VALIDATED` | Процедура проверена review и статически | risk `MEDIUM` |
| `REHEARSED` | Выполнена на production-like snapshot | risk `HIGH` |
| `EXECUTABLE` | Автоматизирована и выполняется одной командой | `IRREVERSIBLE` без rehearsal невозможен |

Gate `rollback-rehearsed` требует evidence `rollback-report` уровня `REHEARSED`.

## 8. Development vs runtime state

OpenSpec Change описывает изменение; runtime исполняет процесс. Runtime-состояние — отдельная ось pack:

| Поле | Значения |
|---|---|
| `process_state` | `CREATED`, `DISCOVERED`, `VALIDATED`, `EXECUTED`, `COMMITTED`, `PUBLISHED`, `FAILED`, `QUARANTINED`, `CANCELLED`, `ROLLED_BACK`, `SUPERSEDED` |

Эти состояния MUST NOT дублироваться в OpenSpec или `change_state`.

## 9. Runtime evidence

Status: proposed · Maturity: later

После исполнения: input/output version, schema version, row counts, quality results, execution time, errors,
checksums → evidence соответствующего Change ([06a §7](06a-evidence.md)).
