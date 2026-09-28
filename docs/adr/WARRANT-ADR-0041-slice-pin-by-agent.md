---
id: WARRANT-ADR-0041
title: Pin-Change `v0.8.0` в `warrant-slice` проводит агент сессии SRA по решению maintainer'а, а не maintainer руками
adr_state: ACCEPTED
date: 2026-09-27
supersedes: []
amends: [WARRANT-ADR-0040]
---

## Context

[ADR-0040](WARRANT-ADR-0040-slice-fixes.md) п. 7 велит провести Change `factory-change` в `warrant-slice` (тег `v0.8.0` в `warrant.yml`, `issues: read`, `kernel: "0.8"`, `warrant sync`, текст `process.json`) maintainer'у руками, без сессии Claude: агент slice под guard не пишет `.warrant/local/**` и `.github/workflows/**`, а операция записи для них отвергнута — агент правил бы свои правила и workflow CI.

После archive-PR `slice-fixes` (тег `v0.8.0`, 2026-09-27) maintainer решил не проводить pin руками: это около 20 ручных шагов (record через `warrant`, артефакты Change, review spec, три PR). Сессия потока `phase-4` в SRA работает вне hooks slice — guard slice её не касается.

## Decision

1. **Pin-Change `v0.8.0` в slice проводит агент сессии SRA** (поток `phase-4`), не агент slice: тремя PR, переходы и record — через `warrant`, артефакты — внутри Run `specify`, review spec — субагентом `warrant-reviewer`. Правку policy-путей slice делает эта сессия; человеческие акты — одобрение и merge каждого PR maintainer'ом («merge #N», `merged_by`). Решение — только для этого pin-Change; следующий pin — по ADR-0040 п. 7, пока не решено иначе.
2. **Guard агента slice не меняется**: операции записи `.warrant/local/**` и `.github/workflows/**` нет (BL-56), альтернатива ADR-0040 «`write_scope` агента на эти пути» по-прежнему отвергнута — агент slice свои правила не правит.
3. **Отчёт приёмки** (строка 4c [13 §2](../13-roadmap.md)) помечает шаг «агентом сессии SRA по решению maintainer'а», как bootstrap помечен человеческим.

## Consequences

- ADR-0040 — заметка `amended_by`.
- Файл передачи `phase-4`: pin-Change — шаг сессии SRA, затем сессия slice на `rate-limiter-precision`.

## Alternatives

- **Pin руками maintainer'а (ADR-0040 п. 7)** — отвергнуто maintainer'ом: объём ручных шагов без новой гарантии — человеческий контроль остаётся в одобрении и merge PR.
- **Агент slice с операцией записи policy-путей** — отвергнуто ADR-0040 и здесь: агент правил бы собственные правила.
