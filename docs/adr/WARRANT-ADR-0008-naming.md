---
id: WARRANT-ADR-0008
title: Название WARRANT и границы компонентов SEF
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
---

## Context

Черновики назывались «Dark Software Factory» и смешивали роль всей фабрики с ролью слоя управления спецификациями. В SEF есть отдельные компоненты: OpenSpec, LATTICE, SRA, JEV.

## Decision

Слой управления спецификациями называется **WARRANT — Specification Governance**: *warrant* — основание, по которому evidence подтверждает claim, и разрешение на действие.

| Компонент | Роль |
|---|---|
| SEF | Software Factory, целое |
| OpenSpec | specification kernel — что требуется |
| LATTICE | object substrate — что это и как связано |
| SRA | reasoning — как рассуждать (skills) |
| WARRANT | governance — что разрешено и что доказано |
| JEV | classifier — предлагает, authority нет |

## Consequences

- Префиксы: `WARRANT-ADR-*`, CLI `warrant`, каталог `.warrant/`, схемы `warrant://`.
- Skills принадлежат SRA; WARRANT задаёт только контракт вызова.

## Alternatives

SPINE (метафора позиции, а не функции), ARBITER (звучит как «ИИ-судья»), CANON (конфликт с canonicalization LATTICE).
