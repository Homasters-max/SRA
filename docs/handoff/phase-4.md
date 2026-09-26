# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, уточнённой
[ADR-0036](../adr/WARRANT-ADR-0036-phase-4b-producers.md) и [ADR-0037](../adr/WARRANT-ADR-0037-phase-4c-ci.md): `phase-4a`,
`phase-4b`, `phase-4c` закрыты → vertical slice в отдельном репозитории ([13 §1](../13-roadmap.md)) — критерий MVP.

## Готовый запрос

```text
Фаза 4c закрыта (archive-PR phase-4c, тег v0.7.0). Дальше — vertical slice MVP (13 §1) в репозитории
Homasters-max/warrant-slice (Python + pytest): сначала grilling объёма slice и его Change, затем spec-PR первого Change
slice. Перед spec-PR — architecture-audit и repo-hygiene.
```

## Открытые вопросы

- Sample-проект `Homasters-max/warrant-slice` создаёт maintainer до slice — создан ли.
- Как slice ставит CLI: pin версии в workflow slice (policy-путь, ADR-0038 п. 3) или `npm link` локально.

## Не забыть

- Глобальный `warrant` (`npm link`) указывает на удалённый worktree `SRA-phase-4c`: `npm link` из основного checkout.
- BL-46: envelope субагента длиннее ~8 тыс. символов не сдаётся одним heredoc — просить короткие формулировки.
- BL-45: `classify` по diff spec-PR не видит путей реализации — `--paths` планом.
- `npm test` целиком на Windows под нагрузкой падает по таймаутам (BL-31, BL-37) — прогонять уровни по очереди.
- Review spec: `PROVEN` с MAJOR — решение в impl-PR по ADR-0024 п. 4 (I-176, навык `change-spec-pr`), не новый раунд.
