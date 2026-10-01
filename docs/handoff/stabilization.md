# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)): честный судья, поставка, идентичность агента. 0.10.0 выпущена (`exit-contract`, `guard-recovery`); её цель — работа в LATTICE ([ADR-0055](../adr/WARRANT-ADR-0055-release-for-lattice.md) п. 1): закрыта, когда в LATTICE слит pin-Change на `v0.10.0`. Затем 0.11.0 — `judge-law` → `code-floor` ([ADR-0052](../adr/WARRANT-ADR-0052-cycle-1-close.md)). Долг — строки `WS-N`, `A-N`, `R-N`, `BL-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization, 0.11.0 — impl judge-law. Сначала проверить LATTICE: если сессия LATTICE по docs/handoff/lattice.md сообщила сбой перехода на v0.10.0 — он первым, patch v0.10.1, до judge-law. Работай автономно; режим и список шагов — навык progress. Maintainer — только Approve в браузере impl-PR (пути CLI — класс приёмки): полная ссылка, «в браузере на GitHub, не в панели Claude Desktop», «Add your review» → Approve → Submit review, затем auto-merge.
judge-law: spec-PR #130 слит (SPECIFIED, review 6 PROVEN) — навык change-impl-pr judge-law, worktree от origin/main. Первым делом в impl-PR — подъём версий по ADR-0055 п. 4 (CLI 0.11.0, kernel 0.11, диапазон kernel core-sdd <0.12 — patch pack; CHANGELOG `## 0.11.0`) и строки I-N: D11 и «Версии не поднимаются» proposal заменены ADR-0055; R-46 и design D9 сняты (сделал guard-recovery: runGuardRead, SCN-ENF-052); MINOR F-1…F-6 review 6 (RUN-01M3VCZQM1KK6QA6J1NQVG2FN5, .warrant/runs/*.result.json) — правка delta по ADR-0024 п. 4 (waiver spec-approved, активирует maintainer) или строки backlog; F-5 — риск в design, F-6 — навык review (версия skill, REQ-SDD-008). Затем code-floor; тег v0.11.0 — archive-PR code-floor, закрывает цикл 1.
Факты для design — сбором Explore на текущем main. Архитектурный аудит не обязателен (не фаза roadmap).
```

## Открытые вопросы

нет

## Не забыть

- Машину перевести на CLI из тега `v0.10.0` (maintainer, `docs/process/rules.md` «Настройка машины»): SRA от PATH больше не зависит — `cli` в `warrant.json`, хук `warrant-reviewer` исполняет `packages/cli/dist/bin/warrant.js` основного checkout (после `git pull` — `npm run build`), `run submit` — worktree.
- Хук frontmatter `warrant-reviewer` с новой командой интерактивно не проверен (R-56): при первом review spec после перезапуска сессии убедиться, что guard его судит.
- Auto-merge без Approve не сливает: ruleset `main` требует ревью владельца CODEOWNERS. `gh pr edit` у бота падает на `read:org` — тело PR: `gh api -X PATCH repos/Homasters-max/SRA/pulls/<N> -F body=@<файл>`.
- `transition MERGED` Change с `human-acceptance` — `--ref <impl-PR> --by <maintainer>`.
- Contract-тесты с настоящим `gh`: под `GITHUB_ACTIONS` тексты другие — проверять с `GITHUB_ACTIONS=true`.
