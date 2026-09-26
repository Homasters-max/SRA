# lattice

После: phase-4

## Цель

LATTICE — отдельный проект `D:\project\LATTICE` (`Homasters-max/LATTICE`), первым — его vertical slice на объектах
OpenSpec; компоненты WARRANT, которым нужны объекты и связи, строятся на его read model. Решения — черновик
[2026-09-26-lattice-first](../drafts/2026-09-26-lattice-first/README.md) (Q9–Q18). Начинается после фазы 4 WARRANT.

## Готовый запрос

```text
Поток lattice (после phase-4). Решения — docs/drafts/2026-09-26-lattice-first/01-accepted-round-2.md, не гриллить.
1) ADR WARRANT: порядок фаза 4 → slice LATTICE → WARRANT на LATTICE, строка roadmap после фазы 4 с критерием выхода
   slice (Q14, Q16). 2) Перенос: git subtree split --prefix=lattice → D:\project\LATTICE, remote
   Homasters-max/LATTICE (public — подтвердить maintainer'ом перед созданием), минимальный CI; в SRA — PR удаления
   lattice/ со ссылкой, structure.test.ts, CLAUDE.md, удаление этого файла (Q9, Q18). 3) LATTICE-ADR-0001 в новом
   репозитории; дальше — его NEXT-SESSION.md: grilling реестра LD-* (первый вопрос — стек TypeScript/Node, Q11).
```

## Открытые вопросы

- Нет: раунды 2–3 grilling закрыли Q9–Q18. Новые — grilling реестра LD-* в репозитории LATTICE.

## Не забыть

- LD-B-06 в силе: slice, не полная модель заранее.
- Контракты стыка `docs/integrations/01, 02, 05` остаются в SRA.
- Поток kb-domains: 02–07 ждут slice LATTICE (Q13).
