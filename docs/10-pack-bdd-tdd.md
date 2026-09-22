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

Исполняемые `.feature` файлы MAY использоваться, если стек этого требует; каждый Scenario в них MUST нести тег
с SCN-ID из OpenSpec. Источник истины — OpenSpec.

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

Coverage не доказывает защищённость поведения (`coverage 98% ≠ behavior protected 98%`).
Mutation testing проверяет силу тестов, но MUST NOT быть обязательным для каждого изменения:

| Risk | Требование |
|---|---|
| `LOW` | обычные tests |
| `MEDIUM` | tests + mutation на изменённых модулях (SHOULD) |
| `HIGH` | tests + mutation (gate `mutation-score`) + adversarial review |

Порог — параметр pack: `params.mutation_threshold`.

## 5. Bugfix

Profile `bugfix` использует:

```text
ASSESS → REPRODUCE → MINIMIZE → HYPOTHESIZE → INSTRUMENT → FIX → REGRESSION TEST → VERIFY
```

- Diagnosis ≠ implementation. Сначала воспроизводимый отказ.
- Regression test MUST падать до исправления и проходить после (`red-first`).
- Если исправление меняет intended behavior — это не bugfix, а Change с изменением spec.
