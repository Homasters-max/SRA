# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)): честный судья, поставка, идентичность агента. Закрыты: цикл 0 (0.8.3), `identities`, `agent-merge` (0.9.0). Остаток цикла 1 — 0.10.0 тремя Change по [ADR-0052](../adr/WARRANT-ADR-0052-cycle-1-close.md): `exit-contract` → `judge-law` → `code-floor`. Долг — строки `WS-N`, `A-N`, `R-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization, 0.10.0. Решения — ADR-0052 (все развилки сняты двумя раундами 2026-10-01), не гриллить. Работай автономно до результата; режим и список шагов — навык progress. Maintainer — только merge spec-PR и impl-PR (пути CLI — класс приёмки): полная ссылка, «в браузере на GitHub, не в панели Claude Desktop», Approve + auto-merge.
Change 1 — exit-contract (ADR-0052 п. 2): WS-06, A-42, A-48. Аудит свежий — docs/process/audits/2026-10-01-cycle-1b.md (снимок d777762), повторять не нужно, если в packages/cli/src не было правок после 0993a74.
Шаги: openspec-propose → change-spec-pr (review warrant-reviewer, verify, SPECIFIED) → maintainer сливает → change-impl-pr → review-impl → maintainer сливает → change-archive-pr. Версия 0.10.0 — первым коммитом impl-PR (CHANGELOG «Вердикт», «Миграция»); тег v0.10.0 — только после archive-PR code-floor.
Факты для design (места кода, спеки, тесты) собраны 2026-10-01 — пересобрать сбором Explore по пунктам ADR-0052 п. 2: EXIT в core/errors.ts, 56 строк в 25 файлах, Math.max ×5, BUSY 2/3, ci → 2 при занятом замке, FORGE_UNAVAILABLE для неверного GITHUB_REPOSITORY, acceptChangedLaw по тексту (core/ci/base.ts:64-73).
Потом — judge-law, затем code-floor тем же путём.
```

## Открытые вопросы

нет

## Не забыть

- `retryable` — ключ только при `true`: около 264 строгих сравнений `errors` в тестах; `guard --frontend` код 2 — протокол Claude Code, не трогать.
- Git-автор бота (`GIT_AUTHOR_*` в `env` пользовательских настроек, `docs/process/rules.md` «Настройка машины») — пока не задан: коммиты агента идут с автором maintainer'а.
- Ветки на origin `process/merge-remnants`, `process/audit-cycle-1b`, `docs/wrap-list-fix` слиты — удаление отклонил классификатор, команда — maintainer'у.
- `gh` в Claude Code — бот `homasters`; PR-панель Claude Desktop — бот, не для merge человеком. Ruleset `main` требует Approve владельца пути: «Review changes → Approve», затем auto-merge сработает.
- CI: красный тест — разбор; Re-run — только инфраструктура; одиночный таймаут `ci.test.ts` под нагрузкой — повтор; канарейка: красный «Install warrant» — поставка сломана.
