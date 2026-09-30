---
id: WARRANT-ADR-0051
title: Merge impl-PR агентом первым — 0.9.0 только Change `agent-merge` (ADR-0050 п. 2–3, WS-03, WS-13, WS-14); WS-03 — точечная проверка записанных вердиктов без пересчёта evidence, один gate engine позже; код 4 и `retryable`, WS-15, A-34 — 0.10.0
adr_state: ACCEPTED
date: 2026-10-01
supersedes: []
amends: [WARRANT-ADR-0048, WARRANT-ADR-0050]
---

## Context

После Change `identities` (CLI 0.8.3) на каждый Change приходятся два нажатия maintainer'а: merge spec-PR и merge impl-PR. [ADR-0050](WARRANT-ADR-0050-agent-merge.md) п. 2 разрешает агенту сливать impl-PR, но не раньше, чем судья закроет WS-03, WS-13 и WS-14 (п. 6, Alternatives). Цикл 1 целиком (0.9.0, [ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 4) — ещё WS-06 с кодом 4, WS-15 и A-34; ждать его ради merge агентом долго. Grilling maintainer'а 2026-10-01 — пять вопросов, приняты рекомендации.

## Decision

1. **0.9.0 — только Change `agent-merge`** (меняет ADR-0048 п. 4 и ADR-0050 п. 4, п. 6).
   - В 0.9.0: ADR-0050 п. 2 (ref `MERGED` агента без `human-approval` на переходе), п. 3 (класс путей с приёмкой человеком), WS-03, WS-13, WS-14.
   - Код выхода 4 и `retryable` (ADR-0050 п. 4, WS-06), WS-15, A-34 — в 0.10.0, остаток цикла 1.
   - Merge impl-PR агентом — с merge impl-PR `agent-merge`: сам этот impl-PR сливает maintainer.
2. **WS-03 — точечная проверка записанного вердикта.**
   - `WAIVED`: судья находит в файлах waiver базы или HEAD waiver этого Change на этот gate в состоянии `ACTIVE`, срок которого не истёк на момент перехода; gate в policy базы `waivable`.
   - `NOT_APPLICABLE`: условие `applies_when` gate по policy базы не выполнено на diff перехода — у `MERGED` diff merge-коммита impl-PR (M^1..M), у остальных — diff судимого PR.
   - `APPROVED`, `SPECIFIED`, `ARCHIVED`: `effective_policy_hash` и состав gates — как у `MERGED` (policy базы).
   - Evidence заново не вычисляется: [ADR-0037](WARRANT-ADR-0037-phase-4c-ci.md) N44 не нарушается.
   - Один gate engine для `transition` и судьи (кандидат 1 разбора 2026-09-29) — позже, строкой backlog.
3. **Класс путей п. 3 — локальный профиль SRA.** Профиль в `.warrant/local/**` матчит пути класса и добавляет `human-approval` на `VERIFYING->MERGED`; `human-approval` с overlay `risk-high` снимается (ADR-0050 п. 3 «заменяет»). Пути класса — ADR-0050 п. 3; у потребителя — свой профиль (WS-12).
4. **WS-13:** пути защиты агента — в классе п. 3; reusable workflow `warrant.yml` выполняет `warrant validate` и `warrant sync --check` до `warrant ci`.
5. **WS-14:** PR без Change с правкой `paths.src` или `paths.tests` — `SCOPE_VIOLATION` ([ADR-0049](WARRANT-ADR-0049-flow.md) п. 7).

## Consequences

- Навыки `change-impl-pr`, `git-land`, `fast-mode`: impl-PR вне класса п. 3 сливает сессия `--auto` — в archive-PR `agent-merge`.
- `docs/handoff/stabilization.md`: после `agent-merge` — остаток цикла 1, 0.10.0.
- Backlog: WS-03 — «Куда» один gate engine; WS-06, WS-15, A-34 — 0.10.0.
- Индекс ADR: ADR-0048, ADR-0050 — «уточнён 0051».

## Alternatives

- **Один gate engine сразу (WS-03, форма разбора):** отвергнуто для 0.9.0. Большой рефакторинг `transition` и `core/ci` и снятие N44 отдельным решением; точечная проверка закрывает дыру WS-03 без пересчёта evidence.
- **Оставить `human-approval` у `risk-high`:** отвергнуто. Почти любой Change SRA — HIGH (`identities` — HIGH по floor), merge агентом не случался бы.
- **Весь цикл 1 одним 0.9.0 (ADR-0048 п. 4):** отвергнуто. Merge агентом ждал бы кода 4, WS-15 и A-34, которые его не требуют.
