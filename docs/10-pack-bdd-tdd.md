---
id: WARRANT-DOC-10-BDD
title: Pack bdd-tdd — поведение и тесты
status: proposed
maturity: later
version: 0.1.0
---

# 10. Pack `bdd-tdd`

## 1. Роли уровней

```text
SDD  — что система должна делать           (OpenSpec spec)
BDD  — как это выглядит снаружи            (macro verification, acceptance)
TDD  — как внутренние компоненты выполняют контракт (micro verification)
```

TDD не заменяет BDD. BDD задаёт внешние ограничения, TDD — micro-контракты и границы взаимодействия.

## 2. BDD

Spec описывает observable behavior, а не implementation:

- неправильно: «Add a CustomerService class»;
- правильно: «When a customer searches by an exact identifier, the system returns the matching customer».

OpenSpec уже содержит сценарии (`#### Scenario:` с WHEN/THEN). Pack MUST NOT вводить второй формат сценариев:

```text
OpenSpec Scenario (SCN-ID) → executable acceptance test (тег @SCN-ID) → evidence
```

Исполняемые `.feature` файлы MAY использоваться, если стек этого требует; каждый Scenario в них MUST нести тег с SCN-ID из OpenSpec. Источник истины — OpenSpec.

Gate `bdd-passed`: все SCN, помеченные как acceptance, имеют `PROVEN` evidence.

### Scenario engineering

Skill `specification/scenario-engineering` проверяет покрытие:

```text
happy path · negative path · boundary · retry · idempotency · concurrency
partial failure · temporal behavior · authorization · invalid input · recovery
```

## 3. TDD

Инструкции «use TDD» недостаточно. Цикл:

```text
RED (failing test) → minimal implementation → GREEN → REFACTOR → next behavior
```

WARRANT проверяет не только наличие тестов:

| Проверка | Как | Уровень |
|---|---|---|
| Тест падал до реализации | Check `red-first`: тест запускается на commit до implementation; evidence с `NOT_PROVEN` → затем `PROVEN` | L1 |
| Тест связан со specification | Тег / аннотация SCN или REQ; `analyze` → `ORPHAN` | L0 |
| Assertion meaningful | Mutation testing (§4) | L1 |
| Тест не проверяет только implementation detail | Review `code-review/spec-compliance` | L2 |
| Нет лишнего поведения | Review + `analyze` (код без REQ) | L2 / L0 |

## 4. Mutation testing

Coverage не доказывает защищённость поведения (`coverage 98% ≠ behavior protected 98%`). Mutation testing проверяет силу тестов, но MUST NOT быть обязательным для каждого изменения. Решение — [ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md).

| Risk | Требование |
|---|---|
| `LOW` | обычные tests; mutation не выполняется |
| `MEDIUM` | обычные tests; mutation не выполняется (было: check выполняется без gate — снято D-6) |
| `HIGH` | gate `mutation-score` required + adversarial review |

### Scope — diff

Score считается только по мутантам внутри diff Change, а не по модулю: иначе унаследованный долг файла роняет gate, к Change не относящийся.

- Мутант учитывается, если его location пересекает изменённые строки. Если инструмент не даёт строк — изменённые функции. Гранулярность (`line` / `function`) объявляет parser и пишет в evidence.
- Base — по транспорту: `github` — `merge-base(HEAD, base-ветка PR)`, как у `scope-valid`; `sef-hub` — `manifest.base_commit` (`--base <commit>`). Сдвиг base → `STALE`.
- Перенесённый код — изменённый. Rename файла распознаётся (`git diff -M`).

### Формула и порог

```text
score = killed / (killed + survived + no_coverage)
Timeout → killed · CompileError, RuntimeError → вне знаменателя (errors)
Ignored в diff → survived, если нет исключения
0 мутантов в diff → evidence NOT_APPLICABLE (check) → gate NOT_APPLICABLE (шаг 1, 06 §3)
```

Порог — `params.mutation_threshold`, default `0.9`. Check сравнивает сам, выставляет `PROVEN` / `NOT_PROVEN` и пишет применённый порог в `metrics.threshold`; gate сверяет его с effective param в пред-фильтре допустимости ([06 §3](06-verification.md)), расхождение → finding `STALE`, evidence исключается.

### Нормализация отчёта

Parser каждого инструмента приводит отчёт к mutation-testing-report-schema (экосистема Stryker); фильтр по diff применяет check WARRANT. Инструмент MAY сужать прогон ради стоимости, но verdict считается по фильтру WARRANT. Сужение и стоимость — через `execution` ([06 §2](06-verification.md), [ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)): check `mutation` поставляется с `exclusive: true`, `local: "scoped-only"`, `max_paths: 5` — полный прогон только в CI. Инструмент для Python sample — spike S7 ([13 §3](13-roadmap.md)).

### Evidence `mutation-report`

```json
{
  "kind": "mutation-report",
  "metrics": {
    "scope": "diff",
    "granularity": "line",
    "base_commit": "abc1234",
    "killed": 41, "survived": 2, "no_coverage": 1, "timeout": 3, "errors": 0,
    "excluded_equivalent": 1,
    "waivers": ["WAV-2026-004"],
    "score": 0.955,
    "threshold": 0.9,
    "module_score": 0.61
  }
}
```

`module_score` — справочно (долг для brownfield), gate его не читает.

### Эквивалентные мутанты

Исключаются частичным waiver ([05 §7](05-policy.md)) с `targets[]`. Target — отпечаток `{file, symbol, mutator, replacement, source_sha256}`; для гранулярности `function` — hash тела функции. Targets читает check (исключает мутанты, пишет `excluded_equivalent` и `waivers[]`); gate сверяет свежесть отпечатков. Отпечаток, не совпавший с текущим кодом, — finding `STALE`, исключение не действует. Общего реестра исключений нет.

### Защита от обхода

| Обход | Механизм |
|---|---|
| Инструмент помечает мутант `Ignored` | `Ignored` в diff → survived |
| Pragma (`# pragma: no mutate` и др.) — мутант не попадает в отчёт | Lint diff → finding; легитимная pragma — через `targets` |
| Сужение в конфиге инструмента | Конфиг — policy-путь: проект SHOULD объявить его в override `.warrant/local/profiles/factory-change.json` (`match.paths`); было `params.mutation_config_paths` — снято D-16 |

## 5. Bugfix

Profile `bugfix` использует:

```text
ASSESS → REPRODUCE → MINIMIZE → HYPOTHESIZE → INSTRUMENT → FIX → REGRESSION TEST → VERIFY
```

- Diagnosis ≠ implementation. Сначала воспроизводимый отказ.
- Regression test MUST падать до исправления и проходить после (`red-first`).
- Если исправление меняет intended behavior — это не bugfix, а Change с изменением spec.
