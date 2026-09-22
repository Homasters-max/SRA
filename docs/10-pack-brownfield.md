---
id: WARRANT-DOC-10-BROWNFIELD
title: Pack brownfield — существующий код
status: proposed
maturity: later
version: 0.1.0
---

# 10. Pack `brownfield`

## 1. Главное правило

```text
code ≠ specification
```

Код — evidence **текущего** поведения, но не обязательно **задуманного**. Reverse-engineered спецификация,
созданная ИИ, MUST NOT объявляться истиной автоматически: она может не отражать исходный intent и скрытые
особенности legacy.

## 2. Процесс

```text
Existing code → Discovery → Current behavior → Unknowns → Human confirmation → Baseline spec → New change
```

- Всё, что получено из кода рассуждением, записывается как `INFERENCE`.
- Спорные места — `UNKNOWN` (blocking, если от них зависит последующее изменение).
- `FACT` появляется только после characterization test или подтверждения человеком.

## 3. Characterization first

Первый Change для legacy-функциональности:

```text
"describe / characterize current behavior"   — а не "refactor legacy subsystem"
```

Порядок:

```text
Characterization tests → Baseline specification → Tests → Refactoring
```

Profile `refactor` в brownfield-зоне требует artifact `behavior-baseline` и gate `tests-passed` на characterization tests
**до** начала изменений.

## 4. Определение brownfield-зоны

Pack параметризуется путями legacy-кода (`params.legacy_paths`). Floor rule: изменения в этих путях без
baseline spec → blocking `UNKNOWN`.

Mutation score в brownfield-зоне считается по diff ([ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md)):
унаследованный долг не роняет gate Change. Долг виден как `metrics.module_score` в evidence `mutation-report`;
gate его не читает.
