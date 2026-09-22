---
id: WARRANT-ADR-0006
title: JSON-конвенции, язык и комментарии
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
---

## Context

Машиночитаемые файлы будут редактировать LLM. Нужны предсказуемые, валидируемые файлы с чистым diff и единое
правило языка и комментариев.

## Decision

- Все файлы WARRANT — JSON + JSON Schema (`"$schema": "warrant://<name>/<major>"`).
- Исключения: OpenSpec-файлы (`config.yaml`, `schema.yaml`) — генерируются `warrant sync` из JSON;
  frontmatter Markdown — YAML по стандарту инструментов.
- Один объект — один файл. `warrant fmt` — канонический вид (сортировка ключей, отступ 2, LF).
- `warrant validate` в pre-commit и CI.
- Язык: документация / specs / tasks / ADR — русский с английскими терминами; JSON, схемы, код — английский.
- Комментарии: в JSON только `"$comment"` и только где неочевидно; в JSON Schema — `description` у каждого поля;
  в коде — «почему», а не «что»; HTML-комментарии в specs — только машинные метаданные.
- Именование: ID — kebab-case, enum — UPPER_SNAKE, ключи — snake_case.

## Consequences

- LLM получает подсказки из `description` схем, а не из комментариев.
- Правки `.warrant/**` автоматически получают profile `factory-change`.

## Alternatives

- JSONC — отвергнуто: не все инструменты и парсеры его поддерживают; `$comment` покрывает потребность.
- YAML — отвергнуто для файлов WARRANT: неоднозначности типов и отступов при правке LLM.
