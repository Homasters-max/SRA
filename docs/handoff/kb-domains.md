# kb-domains

## Цель

Поиск по документации для агентов WARRANT через домены: документы нарезаны на units (одна норма — ссылки на документ,
код, тесты), агент ищет в своём домене. Пилот `lifecycle` и `kernel` принят на контроле 2026-09-26c. Дальше — grilling
черновиков [2026-09-26-kb-domains](../drafts/2026-09-26-kb-domains/README.md) и решения: где живут домены, модель
сущностей на контракте LATTICE, путь запроса (хэш, алиасы глоссария), работа агентов, 37 противоречий.

## Готовый запрос

```text
Grilling черновиков docs/drafts/2026-09-26-kb-domains/ (ветка process/kb-domains, worktree D:/project/SRA-kb-domains)
по порядку README: 01-storage → 02-entity-model (на контракте LATTICE, docs/integrations/01, 05 — только чтение) →
03-query-path → 04-agent-workflow → 05-conflicts → 06-bench → 07-doc-form. Факты проверить заново: данные пилота —
.kb-search/ основного checkout (domains/, bench/, usage.jsonl), навык — ~/.claude/skills/kb-search. Итог — ADR и
удаление папки черновиков тем же PR.
```

## Открытые вопросы

- Где живут домены (репозиторий или `.kb-search/` локально) — от этого зависят PR с `change-coordinate` и `--by-code`
  в `review-impl`.
- Совпадают ли домены с context'ами LATTICE (`lattice/docs`) — сверить до выбора имён.

## Не забыть

- В ветке уже есть коммит c3bbf7f: шаг «Пакет норм» в `change-coordinate` (работает, только если домен есть локально).
- Навык `kb-search` вне репозитория: правки 2026-09-26 — линейное слияние, домены (`--domain`, `--refs`, `--by-code`),
  поиск по ID, кэш по нормализованному вопросу, словарь в `state` Jev, порог «ответа нет» 0,6; копия до правок —
  scratchpad сессии 338009b9 (`kb-search-backup`).
- Контроль 2026-09-26c использован (`used_for: D-domains`): следующее решение о поиске — новый набор вопросов.
