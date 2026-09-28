---
id: WARRANT-ADR-0005
title: Enforcement в CLI и CI; frontends — адаптеры
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
---

## Context

Prompt не является механизмом принуждения. На следующих этапах SEF будет вызывать агентов через ACP или API, поэтому логика не может жить внутри одного агента.

## Decision

- Вся логика — в CLI `warrant` с JSON-выводом ([04 §7](../04-lifecycle.md)).
- CI — последняя инстанция: заново вычисляет L0/L1 и блокирует merge.
- Frontends (первый — Claude Code; далее ACP / API) транслируют capabilities в свои механизмы: hooks, permissions, sandbox.

## Consequences

- WARRANT agent-agnostic.
- Агент не пишет evidence и runs напрямую; это делает только CLI / CI.
- Позже поверх CLI MAY появиться MCP-адаптер без изменения логики.

## Alternatives

- Логика в skills / prompts — отвергнуто (INV-04).
- Workflow engine — отвергнуто: controller достаточно таблицы решений.
