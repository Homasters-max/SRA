# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)): честный судья, поставка, идентичность агента. Закрыты: цикл 0 (`release-path`, 0.8.3), `identities`, `agent-merge` (0.9.0, [ADR-0051](../adr/WARRANT-ADR-0051-agent-merge-first.md)): impl-PR вне класса путей с приёмкой человеком сливает агент. Дальше — остаток цикла 1, 0.10.0. Долг — строки `WS-N`, `A-N`, `R-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization. Нормы merge — ADR-0050, ADR-0051, не гриллить. Работай автономно до результата; режим и список шагов — навык progress. Maintainer — только merge spec-PR и PR с путями класса приёмки (.warrant/local/profiles/human-acceptance.json, .github/CODEOWNERS): полная ссылка, «в браузере на GitHub, не в панели Claude Desktop».
1) process-PR (защита агента — сливает maintainer): навыки change-impl-pr, git-land, fast-mode — impl-PR вне класса приёмки сливает сессия `--auto` (ADR-0051 Consequences); R-44 (остатки «merge #N»); R-46 (тест CODEOWNERS ↔ профиль).
2) Проверить защиту main (группа 6 agent-merge): «Require review from Code Owners», обязательная warrant / warrant — спросить maintainer'а, если не подтверждено.
3) Цикл 1, 0.10.0: architecture-audit (от 2026-10-01-cycle-1), затем spec-PR — WS-06 (код 4, retryable, A-42), WS-15, A-34, A-40 (requiresHuman в трёх местах), A-41 (paths.* и paths.tests SRA, I-231), остаток WS-03, R-45.
```

## Открытые вопросы

- Решения цикла 1: Р-5, Р-9, противоречие одного gate engine с N44 ADR-0037 — на spec-PR 0.10.0; Р-2, Р-7, Р-8, Р-11 — цикл 2.
- LATTICE на 0.9.0 — сессия LATTICE: профиль приёмки и `CODEOWNERS` (CHANGELOG 0.9.0, «Миграция»); без них — находка `NO_HUMAN_ACCEPTANCE`.

## Не забыть

- WARRANT пассивен: судья, policy, evidence, контракт CLI. Исполнитель Change — внешний потребитель контракта (ADR-0050 п. 7); в этом репозитории его не строить.
- `gh` в Claude Code — бот `homasters`. Spec-PR и PR с путями класса приёмки сливает maintainer; остальные impl-, archive-, docs-, process-, fix-PR — бот `--auto`. PR-панель Claude Desktop работает от бота — не для merge, который должен сделать человек (#113, I-225).
- Поднять minor встроенного pack или ввести локальный профиль в impl-PR — судья это умеет с 0.9.0 (I-233, I-234); M^1 archive-PR со старым pack — fail-closed, impl-PR сливает maintainer.
- Правила разрешения `C:\Users\Xiaomi\.claude\settings.json` (`transition`, `verify`, `git commit`) снимают отказы классификатора; команды merge и чистки — по одной, без `&&`.
- CI: красный тест — разбор; Re-run — только при явной инфраструктуре; одиночный таймаут `ci.test.ts` под нагрузкой — повтор; канарейка: красный «Install warrant» — поставка сломана.
