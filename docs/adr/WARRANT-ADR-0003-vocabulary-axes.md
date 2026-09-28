---
id: WARRANT-ADR-0003
title: Шесть эпистемических маркеров и раздельные оси статусов
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
---

## Context

В черновиках было несколько несовместимых наборов маркеров (4 и 6 элементов) и смешанные статусные модели (PROVEN…, PASS…, 7 статусов skill result, CONTINUE…).

## Decision

- Маркеры: `FACT`, `INFERENCE`, `ASSUMPTION`, `UNKNOWN`, `PROPOSAL`, `DECISION`.
- Раздельные оси с собственными именами полей: `change_state`, `run_state`, `evidence_status`, `gate_verdict`, `controller_action`, `waiver_state`. Общего поля `status` нет.
- Цепочка: check → evidence → gate → controller. Skill не выносит verdict.
- У gate нет `INCONCLUSIVE` (fail closed); `BLOCKED` — невозможно вычислить.

## Consequences

- Значения определены только в [02-vocabulary](../02-vocabulary.md); другие документы ссылаются туда.
- Оси packs (`process_state`, `adr_state`) не переиспользуют имена полей kernel.

## Alternatives

- Четыре маркера — отвергнуто: INFERENCE и PROPOSAL смешивались с FACT и ASSUMPTION.
- Единый enum — отвергнуто: невозможно отличить «не нужно» от «нужно, но не выполнено».
