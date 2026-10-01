# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)): честный судья, поставка, идентичность агента. Остаток цикла 1 — 0.10.0 тремя Change по [ADR-0052](../adr/WARRANT-ADR-0052-cycle-1-close.md): `exit-contract` закрыт, дальше `judge-law` → `code-floor`. Долг — строки `WS-N`, `A-N`, `R-N`, `BL-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization, 0.10.0, Change 2 — judge-law. Решения — ADR-0052 п. 3–4 (развилки сняты 2026-10-01), не гриллить. Работай автономно до результата; режим и список шагов — навык progress. Maintainer — только Approve в браузере spec-PR и impl-PR (пути CLI — класс приёмки): полная ссылка, «в браузере на GitHub, не в панели Claude Desktop», в жёлтой полосе «Add your review» → Approve → Submit review, затем auto-merge.
Объём (ADR-0052 п. 1): остаток WS-03 (п. 4 — hash перехода по окну законов main, MERGED на то же правило), A-45 (п. 3 — общие предикаты gate engine, N44 держится), A-47, R-45 (ошибка загрузки M^1 — классом ошибок exit-contract), A-34, A-40; заодно BL-105 (REQ-ENF-007 «каждая ошибка — код 3» против BUSY 4) и R-46 (guard: исключение runner'а — deny с кодом 0). Delta specs — REQ-VER-011 («Record», «Ref») и REQ-ENF-007.
Шаги: openspec-propose → change-spec-pr (review warrant-reviewer, verify, SPECIFIED) → maintainer Approve → change-impl-pr → review-impl → maintainer Approve → change-archive-pr. Тег v0.10.0 — только после archive-PR code-floor; CHANGELOG `## 0.10.0 — не выпущена` дополнять, не заводить новый раздел.
Факты для design — пересобрать сбором Explore по ADR-0052 п. 3–4 на текущем main (src изменён exit-contract: классы кодов, exitCodeFor, starvedBy в gates/verdict.ts). Архитектурный аудит не обязателен (не фаза roadmap).
Потом — code-floor тем же путём.
```

## Открытые вопросы

нет

## Не забыть

- Auto-merge без Approve не сливает: ruleset `main` требует ревью владельца CODEOWNERS (`reviewDecision` пуст — Approve нет).
- `gh pr edit` у бота падает на scope `read:org` — тело PR менять `gh api -X PATCH repos/Homasters-max/SRA/pulls/<N> -F body=@<файл>`.
- `transition MERGED` Change с `human-acceptance` — `--ref <impl-PR> --by <maintainer>` (gate `human-approval`).
- Contract-тесты с настоящим `gh`: под `GITHUB_ACTIONS` его тексты другие — проверять с `GITHUB_ACTIONS=true`.
- Git-автор бота (`GIT_AUTHOR_*`, `docs/process/rules.md` «Настройка машины») не задан: коммиты агента — с автором maintainer'а.
