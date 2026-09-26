# LATTICE первым — индекс черновиков (2026-09-26)

LATTICE выделяется в отдельный проект `D:\project\LATTICE` и реализуется первым после фазы 4 WARRANT; компоненты
WARRANT, которым нужны объекты и связи (домены поиска и др.), строятся на его read model. Решение принято в grilling
потока kb-domains (раунд 2). Черновики — вход ADR, не норма.

## Уже решено (не гриллить)

- [01-accepted-round-2](01-accepted-round-2.md) — Q9–Q14: репозиторий, объём (vertical slice, LD-B-06 в силе),
  порядок в LATTICE, фаза 4 до конца, поток kb-domains, два ADR.

## Порядок grilling

1. Открытые вопросы [01-accepted-round-2](01-accepted-round-2.md) — состав фазы 4, владелец потока, репозиторий.
2. Grilling реестра LD-* — в репозитории LATTICE после переноса (его `NEXT-SESSION.md`, шаг 1).

## Сквозные вопросы

- Контракты стыка (`docs/integrations/01, 02, 05`) остаются в SRA, один owner.
- Поток kb-domains: [2026-09-26-kb-domains](../2026-09-26-kb-domains/README.md), решения раунда 1 — его файл 10.

## Проверенные факты (2026-09-26)

- LATTICE: `lattice/README.md`, `NEXT-SESSION.md`, `docs/00–03`; кода и машинных файлов нет.
- Активный Change WARRANT — `phase-4c` (SPECIFIED, 30 открытых задач).
