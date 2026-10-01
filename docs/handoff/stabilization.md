# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)): честный судья, поставка, идентичность агента. **Цель 0.10.0 — версия, работающая в LATTICE** ([ADR-0055](../adr/WARRANT-ADR-0055-release-for-lattice.md) п. 1): закрыта, когда в LATTICE слит pin-Change на `v0.10.0`, а не когда поставлен тег. 0.10.0 — `exit-contract` (закрыт) и `guard-recovery`, тег — archive-PR `guard-recovery`; затем 0.11.0 — `judge-law` → `code-floor` ([ADR-0052](../adr/WARRANT-ADR-0052-cycle-1-close.md), [ADR-0053](../adr/WARRANT-ADR-0053-guard-recovery.md)). Waiver WAV-2026-002 LATTICE — до 2026-10-13. Долг — строки `WS-N`, `A-N`, `R-N`, `BL-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization, 0.10.0, Change 2 — guard-recovery, последний Change 0.10.0 (ADR-0055). Цель — версия, работающая в LATTICE. Решения — ADR-0053 (вопросы maintainer'у сняты 2026-10-01), не гриллить. Работай автономно до результата; режим и список шагов — навык progress. Maintainer — только Approve в браузере spec-PR и impl-PR (пути CLI — класс приёмки): полная ссылка, «в браузере на GitHub, не в панели Claude Desktop», в жёлтой полосе «Add your review» → Approve → Submit review, затем auto-merge.
Объём (ADR-0053 п. 2–5): guard при policy, которая не грузится, запирает только правку путей проекта (событие вне проекта — до загрузки policy; правка .warrant/warrant.json, warrant sync/validate/status/--version и shell без правки проекта — разрешены), причина называет версии CLI, pack и диапазона и шаги pin-Change; хук .claude/settings.json и агенты sync исполняют закреплённый проектом CLI, а не PATH (форму выбрать в design); docs/process/rules.md «Настройка машины» — CLI потребителя из тега; навык warrant-upgrade — подъём minor pack, порядок «закрепление, затем CLI»; заодно R-46 (исключение runner'а guard — deny с кодом 0). Отчёт — D:\tmp\warrant-inbox\guard-lockout-version-skew-2026-10-01.md. Delta specs — REQ-ENF-004, REQ-ENF-005, REQ-KRN-025 (+ REQ-KRN-004 при новом поле warrant.json).
Шаги: openspec-propose → change-spec-pr → maintainer Approve → change-impl-pr → review-impl → maintainer Approve → change-archive-pr. Archive-PR guard-recovery ставит тег v0.10.0 (CHANGELOG `## 0.10.0` — дата). Затем maintainer'у — сессия LATTICE по docs/handoff/lattice.md; сбой её перехода — первым, patch v0.10.1, до judge-law. Затем 0.11.0 — impl judge-law: spec-PR #130 (SPECIFIED, review 6 PROVEN) — change-impl-pr judge-law. Первым делом в impl-PR — подъём версий по ADR-0055 п. 4 (CLI 0.11.0, kernel 0.11, диапазон kernel core-sdd <0.12 — patch pack; CHANGELOG `## 0.11.0`) и строки I-N: D11 и «Версии не поднимаются» proposal заменены ADR-0055; R-46 и design D9 сняты (сделал guard-recovery); MINOR F-1…F-6 review 6 (RUN-01M3VCZQM1KK6QA6J1NQVG2FN5, .warrant/runs/*.result.json) — правка delta по ADR-0024 п. 4 (waiver spec-approved, активирует maintainer) или строки backlog; F-5 — риск в design, F-6 — навык review (версия skill, REQ-SDD-008). Затем code-floor; тег v0.11.0 — archive-PR code-floor, закрывает цикл 1.
Факты для design — сбором Explore на текущем main (core/guard/guard.ts decidePre/loadPolicy/failedClosed, генератор sync для .claude/**, bin/crash.ts). Архитектурный аудит не обязателен (не фаза roadmap).
```

## Открытые вопросы

нет

## Не забыть

- Auto-merge без Approve не сливает: ruleset `main` требует ревью владельца CODEOWNERS (`reviewDecision` пуст — Approve нет).
- `gh pr edit` у бота падает на scope `read:org` — тело PR менять `gh api -X PATCH repos/Homasters-max/SRA/pulls/<N> -F body=@<файл>`.
- `transition MERGED` Change с `human-acceptance` — `--ref <impl-PR> --by <maintainer>` (gate `human-approval`).
- Глобальный `warrant` — `npm link` на `D:\project\SRA`: агент `warrant-reviewer` зовёт его из PATH. Переход машины на CLI из тега — только после п. 3 ADR-0053, иначе review spec в SRA пойдёт чужой версией.
- Contract-тесты с настоящим `gh`: под `GITHUB_ACTIONS` тексты другие — проверять с `GITHUB_ACTIONS=true`.