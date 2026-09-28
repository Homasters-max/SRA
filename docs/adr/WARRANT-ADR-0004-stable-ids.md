---
id: WARRANT-ADR-0004
title: Stable ID в OpenSpec artifacts через HTML-комментарии
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
---

## Context

OpenSpec идентифицирует требования заголовком `### Requirement: <name>`. Traceability и LATTICE требуют идентичности, не зависящей от формулировки. Frontmatter один на файл, а требований в `spec.md` много.

## Decision

- Требования и сценарии: `<!-- id: REQ-AREA-NNN -->` сразу под заголовком.
- Файловые artifacts (ADR, data contract, документы): frontmatter `id:`.
- heading = label, stable ID = identity, path/line = provenance.
- ID выдаёт CLI (`warrant id`), не LLM; ID не переиспользуются. Правила выдачи — [ADR-0012](WARRANT-ADR-0012-id-allocation.md).

## Consequences

- Spike S1 закрыт (OpenSpec 1.13.1): комментарии под `### Requirement:` и `#### Scenario:` проходят `openspec validate --strict` и переживают `openspec archive` для `ADDED` и `MODIFIED` без дублирования и искажения. Парсер маскирует комментарии только для определения структуры и пишет тело из исходных строк.
- Правила размещения (нарушение — ошибка `ids-valid`): строго под своим заголовком; после комментария непустое тело; не между `## ADDED Requirements` и первым `### Requirement:`; комментарий всегда закрыт.
- Gate `ids-valid` проверяет формат, уникальность против base-ветки, позицию и наличие тела.

## Alternatives

- ID в тексте заголовка — отвергнуто: заголовок участвует в merge delta и меняется при переименовании.
- Frontmatter для требований — невозможно без изменения формата OpenSpec.
