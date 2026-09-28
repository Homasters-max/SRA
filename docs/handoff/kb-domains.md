# kb-domains

## Цель

Поиск по документации для агентов WARRANT через домены: документы нарезаны на units (одна норма — ссылки на документ, код, тесты), агент ищет в своём домене. Пилот `lifecycle` и `kernel` принят на контроле 2026-09-26c. Grilling черновиков [2026-09-26-kb-domains](../drafts/2026-09-26-kb-domains/README.md), раунды 1–8 (Q1–Q56): архитектура поиска, модель «вопрос → группа-ответ» с выбором LLM, вердикты и калибровка, ядро (объект, posit, ledger, группа, snapshot) — как часть LATTICE ([lattice-first](../drafts/2026-09-26-lattice-first/README.md)). Итог — ADR и реализация; ядро и шаги модели — после slice LATTICE.

## Готовый запрос

```text
Grilling открытых вопросов kb-domains (ветка от main, навык git-start, поток kb-domains): разделы «Вопросы для
grilling» файлов docs/drafts/2026-09-26-kb-domains/12-search-model.md, ../2026-09-26-lattice-first/02-core-model.md,
03-classification-ids.md, 04-terms.md, затем 01-storage п. 2 и п. 5. Нумерация — с Q57. Решения Q1–Q56 (файлы 10,
11, lattice-first/01) не гриллить; термины — только из lattice-first/04-terms. Факты проверить заново: LATTICE —
lattice/docs (D1, §12–15, §40–45, D4, D8.3); пилот — .kb-search/ основного checkout; навык — ~/.claude/skills/kb-search.
```

## Открытые вопросы

- Ядро — часть LATTICE (lattice-first/02 вопрос 1); конфликт SSOT (ledger против §41 «история — projection») и proposals для калибровки — в grilling реестра LD-* потока `lattice`.

## Не забыть

- Шаг «Пакет норм» в `change-coordinate` работает, только если домен есть локально (`--root D:/project/SRA`) — до переноса доменов в репозиторий (Q26, каталог — 01 п. 2).
- Рефакторинг навыка на модули — после 01 (Q8), без ledger (lattice-first/02 п. 7); регрессия — топ-N из кэша.
- Навык `kb-search` вне репозитория (`C:\Users\Xiaomi\.claude\skills` = `D:\kb\.claude\skills`): правки 2026-09-26 — линейное слияние, домены (`--domain`, `--refs`, `--by-code`), поиск по ID, кэш по нормализованному вопросу, словарь в `state` Jev, порог «ответа нет» 0,6, журналы с доменом и уверенностью. Версионирования у навыка нет; прежнее слияние — `"fusion": "rrf"` в `.kb-search.json`.
- Контроль 2026-09-26c использован (`used_for: D-domains`): следующее решение о поиске — новый набор вопросов.
