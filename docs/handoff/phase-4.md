# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, уточнённой
[ADR-0036](../adr/WARRANT-ADR-0036-phase-4b-producers.md) и [ADR-0037](../adr/WARRANT-ADR-0037-phase-4c-ci.md): `phase-4a`,
`phase-4b`, `phase-4c` закрыты → vertical slice в отдельном репозитории ([13 §1](../13-roadmap.md)) — критерий MVP.

## Готовый запрос

```text
Фаза 4c закрыта. Дальше — vertical slice MVP (13 §1) в репозитории Homasters-max/warrant-slice (Python + pytest).
1. Навык architecture-audit --against docs/process/audits/2026-09-26-phase-4b.json — снимок устарел (до v0.7.0,
   новый модуль core/ci), аудит обязателен; затем repo-hygiene.
2. Grilling объёма slice: какой Change проходит slice от intent до archive, как slice ставит CLI (pin версии
   в workflow — policy-путь, ADR-0038 п. 3), job warrant в slice; вход — открытая A-5 и строки backlog с «Куда» slice.
3. Spec-PR первого Change slice (навык change-spec-pr).
Спросить maintainer'а: создан ли warrant-slice.
```

## Открытые вопросы

- Создан ли sample-проект `Homasters-max/warrant-slice`.

## Не забыть

- Глобальный `warrant` (`npm link`) указывает на удалённый worktree `SRA-phase-4c`: `npm link` из основного checkout.
- BL-46: envelope субагента длиннее ~8 тыс. символов не сдаётся одним heredoc — просить короткие формулировки.
- BL-45: `classify` по diff spec-PR не видит путей реализации — `--paths` планом.
- `npm test` целиком на Windows под нагрузкой падает по таймаутам (BL-31, BL-37) — прогонять уровни по очереди.
- Review spec `PROVEN` с MAJOR — решение в impl-PR по ADR-0024 п. 4 (I-176, навык `change-spec-pr`), не новый раунд.
