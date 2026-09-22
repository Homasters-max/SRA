---
id: WARRANT-ADR-0001
title: OpenSpec — canonical specification lifecycle kernel
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
---

## Context

Нужен SDD-процесс для работы с AI-агентами. Собственная реализация (proposal, spec, design, tasks, archive,
workflow engine) дублировала бы зрелый OpenSpec: change-oriented workflow, custom schemas, project config,
validation, version-controlled specs.

## Decision

OpenSpec — единственный владелец specification lifecycle. WARRANT управляет процессом вокруг него:
policy, gates, evidence, enforcement. OpenSpec используется без форка: project-local schema + config + packs.

## Consequences

- `openspec/specs/` — единственная спецификация; `.warrant/` не содержит specs (INV-06).
- Обновление OpenSpec — `factory-change` с compatibility suite.
- Ограничения формата OpenSpec (YAML config, заголовки требований) принимаются и обходятся генерацией и ID-комментариями.

## Alternatives

- Собственный SDD engine — отвергнуто: дублирование, drift, стоимость поддержки.
- Spec Kit как основа — отвергнуто: берутся отдельные паттерны (clarify, analyze, converge, bug workflow, presets).
