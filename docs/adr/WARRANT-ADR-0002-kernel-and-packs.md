---
id: WARRANT-ADR-0002
title: Модель Kernel + Packs
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
---

## Context

Исходные черновики задавали поведение прозой, настройки были разбросаны (config.yaml, policy.yaml, profiles.yaml,
реестр skills, constitution). Любое изменение требовало правки текста в нескольких местах.

## Decision

- **Kernel**: инварианты, словарь, JSON-контракты, resolver, controller engine, CLI. Меняется редко.
- **Packs**: подключаемые модули с profiles, gates, checks, risk overlays, controller rules, recipes, templates,
  OpenSpec schema/rules, ссылками на skills. Подключаются в `.warrant/warrant.json`.
- Реестр skills не описывается отдельно — это объединение манифестов packs.

## Consequences

- Добавить возможность = подключить pack; документы и kernel не меняются.
- Коллизии ID между packs — ошибка конфигурации; override — только в `.warrant/local/` и только усиливающий.
- Версии фиксируются в `warrant.lock.json`.

## Alternatives

- Отдельная OpenSpec schema на каждый тип изменения — отвергнуто: drift шаблонов и правил.
- Единый `policy.yaml` — отвергнуто: плохо масштабируется и плохо редактируется LLM.
