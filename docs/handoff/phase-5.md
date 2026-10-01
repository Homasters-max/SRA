# phase-5

После: stabilization

## Цель

Фаза 5 roadmap ([13 §2](../13-roadmap.md), строка 5): нарезка и spec-PR после приёмки MVP (строка 4c). До неё — долг процесса, найденный slice и Changes фазы 4.

## Готовый запрос

```text
Поток phase-5. MVP принят (13 §2, строка 4c). Аудит перед фазой сделан — docs/process/audits/2026-10-01-phase-5.md (CLI 0.10.0, 7517c82): новые A-49 (грамматика stable ID), A-50 (правила waiver в validate и в оценке — до D-10), A-51 (ESCALATE литералом в 5 командах), наблюдения для нарезки — §3.5. Если в src после 7517c82 прошли Changes (judge-law закрывает A-34, A-40, A-45, A-47) — сначала architecture-audit --against docs/process/audits/2026-10-01-phase-5.json. Потом grilling нарезки фазы 5 (строка 5 13 §2) — вход: отчёт аудита, открытые A-N, BL-N и оставшиеся WS-N docs/backlog.md.
```

## Открытые вопросы

- A-51: действие при `POLICY_CONFLICT` — правило pack `policy-conflict`, одно для всех команд, или ядро без настройки (аудит 2026-10-01-phase-5 §3.4)

## Не забыть

- Slice (`D:/project/warrant-slice`) ведёт отдельная сессия под его hooks; навыки WARRANT туда не копируются.
- Следующий pin slice — по ADR-0040 п. 7 (руками maintainer'а), ADR-0041 был разовым.
