---
id: WARRANT-ADR-0051
title: Merge impl-PR агентом первым — 0.9.0 только Change `agent-merge` (ADR-0050 п. 2–3, WS-03, WS-13, WS-14); класс путей с приёмкой — весь CLI, policy, защита агента, workflow, запрет merge ботом — CODEOWNERS и защита ветки; исключение для агента — по policy базы impl-PR; WS-03 — проверка записанных `WAIVED` / `NOT_APPLICABLE` без пересчёта evidence; fallback `maintainer` остаётся; код 4, WS-15, A-34 — 0.10.0
adr_state: ACCEPTED
date: 2026-10-01
supersedes: []
amends: [WARRANT-ADR-0048, WARRANT-ADR-0050]
---

## Context

После Change `identities` (CLI 0.8.3) на каждый Change приходятся два нажатия maintainer'а: merge spec-PR и merge impl-PR. [ADR-0050](WARRANT-ADR-0050-agent-merge.md) п. 2 разрешает агенту сливать impl-PR, но не раньше, чем судья закроет WS-03, WS-13 и WS-14 (п. 6, Alternatives). Цикл 1 целиком (0.9.0, [ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 4) — ещё WS-06 с кодом 4, WS-15 и A-34; ждать его ради merge агентом долго.

Два раунда grilling maintainer'а 2026-10-01; второй — по review spec `agent-merge` (RUN-01M3T3553QDJFW06RSZQWEVX25, `NOT_PROVEN`: BLOCKER 4) и аудиту 2026-10-01 (A-39…A-44). Главная находка review: судья, который только обнаруживает, не мешает агенту слить impl-PR, ослабляющий policy или код судьи, а archive-PR затем судит по ослабленной базе и ослабленным кодом (`warrant: checkout`). Приняты рекомендации.

## Decision

1. **0.9.0 — только Change `agent-merge`** (меняет ADR-0048 п. 4 и ADR-0050 п. 4, п. 6).
   - В 0.9.0: ADR-0050 п. 2–3, WS-03 (записанные `WAIVED` / `NOT_APPLICABLE`), WS-13, WS-14.
   - Код выхода 4 и `retryable` (ADR-0050 п. 4, WS-06), WS-15, A-34, сверка hash policy у `APPROVED`, `SPECIFIED`, `ARCHIVED` — 0.10.0.
   - Merge impl-PR агентом — с merge impl-PR `agent-merge`: сам этот impl-PR сливает maintainer.
2. **Класс путей с приёмкой человеком в SRA — весь CLI** (уточняет ADR-0050 п. 3): `packages/cli/src/**`, `packages/cli/schemas/**`, `packages/cli/package.json`, `package.json`, `package-lock.json`, `packages/cli/vitest.config.ts`, `**/tsconfig*.json`, `scripts/build.js`; policy — `packs/**`, `.warrant/warrant.json`, `.warrant/warrant.lock.json`, `.warrant/local/**`, `.warrant/waivers/**`; защита агента — `.claude/**`, `**/AGENTS.md`, `CLAUDE.md`, `scripts/dev/*-hook.js`; форж — `.github/workflows/**`, `.github/CODEOWNERS`. CLI и есть судья: правка любой его части меняет проверку. В SRA агент сам сливает impl-PR с тестами, скриптами разработки, доками и навыками SRA; у потребителя класс свой.
3. **Предотвращение — форж** (класс C, ADR-0048 п. 2, настраивает maintainer). `.github/CODEOWNERS` называет maintainer'а владельцем путей п. 2; защита `main` — «Require review from Code Owners» и обязательная проверка `warrant / warrant`. Бот не сольёт PR с путями класса — ни impl-, ни docs-PR (WS-13 для PR без Change). WARRANT настройки форжа не проверяет.
4. **Обнаружение — судья.**
   - Класс путей — локальный профиль `.warrant/local/profiles/human-acceptance.json` с `human-approval` и approval `maintainer` на `VERIFYING->MERGED`.
   - Ref `MERGED` без gate `human-approval`: `merged_by` — член `roles` или агент, в том числе автор PR. Policy, `roles`, `approvals[]` и `identities.agents` — базы impl-PR (M^1), а не базы archive-PR; классификация — record на M плюс профили, которые `classify` по packs M^1 выводит из diff impl-PR: impl-PR не снимет с себя приёмку и не впишет себе роль. Policy M^1 не вычисляется текущим CLI — исключения нет (fail-closed).
   - PR с путями класса сливает maintainer сам, не только одобряет ревью: auto-merge, включённый ботом, пишет `merged_by` бота. Слит не тем — повтор impl-PR без правок кода (`VERIFYING->IMPLEMENTING->VERIFYING`), который сливает maintainer (I-225 Change `identities`).
   - Fallback `maintainer` при пустых `approvals[]` остаётся (меняет ADR-0050 п. 2, третий пункт): одобрение spec держит он (п. 1), а «нет роли» при gate `human-approval` без approvals запер бы merge для всех. Исключение для агента срабатывает по отсутствию gate, не по пустым approvals.
   - Проект без объекта policy, дающего `human-approval` на `VERIFYING->MERGED`, получает в `warrant ci` информационную находку `NO_HUMAN_ACCEPTANCE`.
5. **WS-03 — проверка записанного вердикта без пересчёта evidence** ([ADR-0037](WARRANT-ADR-0037-phase-4c-ci.md) N44).
   - `WAIVED`: засчитываемый waiver этого Change на gate; файл из базы, а если его в базе нет — с HEAD (новый waiver — путь класса п. 2, его сливает maintainer); срок — на дату прогона CI. Доверие к новому waiver с HEAD держит класс путей проекта — у потребителя `.warrant/waivers/**` в его профиле приёмки и `CODEOWNERS` (миграция в CHANGELOG).
   - `NOT_APPLICABLE`: `applies_when` gate не выполнен на diff перехода, или каждый элемент `requires_evidence` удовлетворён записью `NOT_APPLICABLE` от check из `evidence[]` перехода (у `MERGED` — CI-запись на M^2).
   - Один gate engine для `transition` и судьи — позже; предикаты `applies_when` и засчитываемого waiver выносятся из engine в этом Change (A-39).
6. **Pack `core-sdd` 0.4.0:** `risk-high` без `human-approval` и approvals (ADR-0050 п. 3 «заменяет»); миграция потребителя — свой профиль приёмки, CHANGELOG.
7. **WS-13:** `warrant.yml` — `warrant validate` и `warrant sync --check` до `warrant ci`: ловят дрейф сгенерированных файлов и lock, не согласованную правку с перегенерацией — её держит п. 3.
8. **WS-14:** PR без Change с правкой `paths.src` или `paths.tests` — `SCOPE_VIOLATION` ([ADR-0049](WARRANT-ADR-0049-flow.md) п. 7); SRA задаёт `paths.src: packages/cli/src`, `paths.tests: packages/cli/test` — fix-PR с правкой тестов становится Change.

## Consequences

- Maintainer до archive-PR `agent-merge`: `CODEOWNERS` в impl-PR, защита `main` — его настройка (п. 3).
- Навыки `change-impl-pr`, `git-land`, `fast-mode`: impl-PR вне класса п. 2 сливает сессия `--auto` — в archive-PR `agent-merge`.
- LATTICE: при переходе на 0.9.0 — свой профиль приёмки и `CODEOWNERS` (навык `warrant-upgrade`).
- `docs/handoff/stabilization.md`: после `agent-merge` — остаток цикла 1, 0.10.0.
- Backlog: WS-03 — «Куда» один gate engine и hash policy не-`MERGED`; WS-06, WS-15, A-34 — 0.10.0; A-39 — закрыт этим Change.
- Индекс ADR: ADR-0048, ADR-0050 — «уточнён 0051».

## Alternatives

- **Только обнаружение судьёй:** отвергнуто. Агент сливает ослабляющий impl-PR, archive-PR судит ослабленной базой и кодом.
- **Узкий класс (`core/ci`, `core/gates`):** отвергнуто. Судья — весь CLI: роли, waivers, классификация, загрузчик packs, адаптеры.
- **Один gate engine сразу:** отвергнуто для 0.9.0 — большой рефакторинг и снятие N44 отдельным решением.
- **Сверка hash policy у всех переходов:** отложено. По базе на момент CI она ломает честные records, когда `main` сдвинулся.
- **«Нет роли» вместо fallback (буква ADR-0050 п. 2):** отвергнуто — запирает merge при gate без approvals.
- **Оставить `human-approval` у `risk-high`:** отвергнуто — почти любой Change SRA HIGH, merge агентом не случался бы.
