---
id: WARRANT-ADR-0007
title: MVP — kernel + core-sdd + один vertical slice
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
---

## Context

Черновики подробно описывали event log, память, метрики, mutation testing, runtime, LATTICE — без уровней зрелости. Всё выглядело одинаково обязательным.

## Decision

- MVP: kernel + pack `core-sdd` + одно реальное FEATURE-изменение от intent до archive.
- Каждый раздел документов имеет `Maturity` (`MVP` / `later` / `deferred`).
- Новые packs и возможности — по фактическим failure modes.

## Consequences

- bdd-tdd, arch, data, brownfield, integrations — после MVP.
- Спайки S1–S5 ([13-roadmap](../13-roadmap.md)) — до начала реализации.
