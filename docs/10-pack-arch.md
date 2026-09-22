---
id: WARRANT-DOC-10-ARCH
title: Pack arch — ADR, C4, glossary
status: proposed
maturity: later
version: 0.1.0
---

# 10. Pack `arch`

## 1. ADR

### Когда нужен

ADR MUST создаваться только при **durable architectural decision**:

- «Use PostgreSQL as primary persistence layer»;
- «Use event-driven integration instead of synchronous RPC».

Не требуют ADR: переименование, новый endpoint, новая валидация.

ADR не является обязательным этапом workflow: `Need ADR? → no → continue / yes → ADR`.
Gate `adr-present` применяется, когда profile `architecture` активен или skill отметил durable decision (DECISION в result).

### Почему ADR живёт отдельно от Change

`design.md` описывает reasoning конкретного изменения и уходит в archive вместе с ним.
ADR живёт постоянно, чтобы будущие Changes учитывали принятые решения, а не изобретали архитектуру заново:

```text
openspec/specs/ = текущее функциональное поведение
ADR             = текущие архитектурные решения
```

### Формат

Путь — `paths.adr` в `warrant.json`. Frontmatter:

```markdown
---
id: ADR-004
title: Use PostgreSQL as primary persistence layer
adr_state: ACCEPTED       # PROPOSED | ACCEPTED | SUPERSEDED | DEPRECATED
date: 2026-09-22
supersedes: []
change: add-persistence-layer
---

## Context
## Decision
## Alternatives
## Consequences
```

Машиночитаемый индекс ADR (для поиска агентом) — projection, вычисляемая из frontmatter, не отдельная база.

## 2. C4

Status: proposed · Maturity: later

Основа — skill `c4-diagram` (claudskills), адаптированный:

| Оставить | Добавить | Убрать |
|---|---|---|
| C4-дисциплина уровней | Связь элементов с ADR и REQ ID | Генерацию деталей, которых нет в коде / specs |
| Structurizr DSL | Data-platform элементы (datasets, pipelines) | Всё, что дублирует OpenSpec |
| Brownfield-подход | Маркеры FACT / INFERENCE на элементах | |

- Диаграммы — projection. Источник — DSL-файл в репозитории.
- Skill MUST NOT выдумывать компоненты: всё, что не подтверждено кодом или ADR, помечается `INFERENCE` / `UNKNOWN`.
- Интеграция с LATTICE — deferred ([11](11-integrations.md)).

## 3. Glossary

Glossary нужен против semantic drift между человеком, агентом A, агентом B и будущими Changes.

- Glossary MUST быть **маленьким**: термин включается, только если влияет на поведение или решение.
- Не превращать в энциклопедию.
- Путь — `paths.glossary`.

```markdown
### customer
<!-- id: TERM-customer -->
A registered business customer.
Not to be confused with: account.
```

Skill `domain/modeling` (SRA) выявляет перегруженные термины (например, `status = active`, если «active»
может означать acceptance, currency, runtime state или approval).

Status: proposed · Maturity: deferred — при подключении LATTICE glossary может стать projection LATTICE-объектов.
