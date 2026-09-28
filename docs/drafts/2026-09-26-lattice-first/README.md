# LATTICE первым — индекс черновиков (2026-09-26)

LATTICE выделяется в отдельный проект `D:\project\LATTICE` и реализуется первым после фазы 4 WARRANT; компоненты WARRANT, которым нужны объекты и связи (домены поиска и др.), строятся на его read model. Решение принято в grilling потока kb-domains (раунд 2). Черновики — вход ADR, не норма.

## Уже решено (не гриллить)

- [01-accepted-round-2](01-accepted-round-2.md) — Q9–Q18: репозиторий, объём (vertical slice, LD-B-06 в силе), порядок в LATTICE, фаза 4 до конца, поток kb-domains, два ADR, место в roadmap, владелец потока, remote и CI.
- Решения Q19–Q56 потока kb-domains, на которых стоят файлы 02–04, — [kb-domains/11](../2026-09-26-kb-domains/11-accepted-round-3.md).

## Файлы

- [02-core-model](02-core-model.md) — ядро: объект и posit, ledger, группа и snapshot, доверие по осям LATTICE, операции, раскладка в Anchor Modeling, место в LATTICE.
- [03-classification-ids](03-classification-ids.md) — классификация объектов по LATTICE (context, root kind, type), схема ID, проверка связей по матрице D4.
- [04-terms](04-terms.md) — единый список терминов обоих потоков.

## Порядок grilling

1. Вопросы для grilling файлов 02–04 (сейчас, в потоке kb-domains).
2. Grilling реестра LD-* — в репозитории LATTICE после переноса (его `NEXT-SESSION.md`, шаг 1); туда же — вопросы 02 о SSOT и proposals; поток — [docs/handoff/lattice.md](../../handoff/lattice.md).

## Сквозные вопросы

- Контракты стыка (`docs/integrations/01, 02, 05`) остаются в SRA, один owner.
- Поток kb-domains: [2026-09-26-kb-domains](../2026-09-26-kb-domains/README.md), решения раунда 1 — его файл 10.

## Проверенные факты (2026-09-26)

- LATTICE: `lattice/README.md`, `NEXT-SESSION.md`, `docs/00–03`; кода и машинных файлов нет.
- Активный Change WARRANT — `phase-4c` (SPECIFIED, 30 открытых задач).
