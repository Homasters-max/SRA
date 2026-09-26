# phase-4

## Цель

Фаза 4 — MVP frontend по нарезке [ADR-0034](../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, уточнённой
[ADR-0036](../adr/WARRANT-ADR-0036-phase-4b-producers.md) и [ADR-0037](../adr/WARRANT-ADR-0037-phase-4c-ci.md): `phase-4a`,
`phase-4b`, `phase-4c` закрыты, аудит после 4c слит → vertical slice в отдельном репозитории ([13 §1](../13-roadmap.md))
по [ADR-0039](../adr/WARRANT-ADR-0039-vertical-slice.md) — критерий MVP.

## Готовый запрос

```text
Vertical slice MVP по ADR-0039. Репозиторий Homasters-max/warrant-slice (публичный, пустой) создаёт maintainer.
1. Bootstrap (ADR-0039 п. 4) корневым коммитом прямо в main клона D:/project/warrant-slice: pyproject.toml и
   пакет rate_limiter без кода, openspec init, warrant init --frontend claude + warrant sync, команда tests-passed
   (pytest --junitxml) в .warrant/local/checks/, правило процесса rule/1 paths ["**"] → AGENTS.md (п. 3),
   .github/workflows/warrant.yml — копия job warrant с установкой по тегу v0.7.0 (п. 5, 6); warrant validate зелёный.
2. Готовый запрос для сессии slice (открывается в D:/project/warrant-slice): Change rate-limiter (п. 2) от intent
   до archive только через warrant и PR.
3. Итог slice — failure modes строками backlog с источником slice, отчёт приёмки в строке 4c 13 §2 (п. 8).
```

## Открытые вопросы

- Создан ли `Homasters-max/warrant-slice` (команда — ADR-0039 п. 1, делает maintainer).

## Не забыть

- Глобальный `warrant` (`npm link`) указывает на удалённый worktree `SRA-phase-4c`: `npm link` из основного checkout на
  `v0.7.0` — та же версия, что pin slice (ADR-0039 п. 5).
- BL-46: envelope субагента длиннее ~8 тыс. символов не сдаётся одним heredoc — просить короткие формулировки.
- BL-45: `classify` по diff spec-PR не видит путей реализации — `--paths` планом.
- `npm test` целиком на Windows под нагрузкой падает по таймаутам (BL-31, BL-37) — прогонять уровни по очереди.
- Review spec `PROVEN` с MAJOR — решение в impl-PR по ADR-0024 п. 4 (I-176, навык `change-spec-pr`), не новый раунд.
