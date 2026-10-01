# phase-5

После: stabilization

## Цель

Фаза 5 roadmap ([13 §2](../13-roadmap.md), строка 5): нарезка и spec-PR после приёмки MVP (строка 4c). До неё — долг процесса, найденный slice и Changes фазы 4.

## Готовый запрос

```text
Поток phase-5. MVP принят (13 §2, строка 4c), CLI v0.8.0. Сначала навык architecture-audit --against docs/process/audits/2026-09-26-phase-4c.json — снимок устарел (старше v0.8.0, новый модуль core/unknowns), аудит обязателен. Затем process-PR по долгу процесса: BL-72 (ci.md: Re-run всего run, не --failed); BL-74 и BL-75 влиты в WS-04 потока stabilization. Потом grilling нарезки фазы 5 (строка 5 13 §2) — вход: открытые A-N, BL-N и оставшиеся WS-N docs/backlog.md.
```

## Открытые вопросы

- нет

## Не забыть

- Slice (`D:/project/warrant-slice`) ведёт отдельная сессия под его hooks; навыки WARRANT туда не копируются.
- Следующий pin slice — по ADR-0040 п. 7 (руками maintainer'а), ADR-0041 был разовым.
