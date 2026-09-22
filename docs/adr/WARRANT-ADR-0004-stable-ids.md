---
id: WARRANT-ADR-0004
title: Stable ID в OpenSpec artifacts через HTML-комментарии
adr_state: PROPOSED
date: 2026-09-22
supersedes: []
---

## Context

OpenSpec идентифицирует требования заголовком `### Requirement: <name>`. Traceability и LATTICE требуют
идентичности, не зависящей от формулировки. Frontmatter один на файл, а требований в `spec.md` много.

## Decision

- Требования и сценарии: `<!-- id: REQ-AREA-NNN -->` сразу под заголовком.
- Файловые artifacts (ADR, data contract, документы): frontmatter `id:`.
- heading = label, stable ID = identity, path/line = provenance.
- ID выдаёт CLI (`warrant id`), не LLM; ID не переиспользуются.

## Consequences

- Нужен spike S1: совместимость с `openspec validate` и archive. До его закрытия ADR в состоянии PROPOSED.
- Gate `ids-valid` проверяет формат, уникальность, отсутствие переиспользования.

## Alternatives

- ID в тексте заголовка — отвергнуто: заголовок участвует в merge delta и меняется при переименовании.
- Frontmatter для требований — невозможно без изменения формата OpenSpec.
