# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)): честный судья, поставка, идентичность агента. Цикл 0 закрыт (`release-path`, CLI 0.8.3). Merge агентом и приёмка человеком — [ADR-0050](../adr/WARRANT-ADR-0050-agent-merge.md) (spec одобряет человек; impl-PR агентом — с 0.9.0). Агент работает как машинный пользователь `homasters`, объявленный судье в `identities.agents` (Change `identities` закрыт). Долг — строки `WS-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization. Норма merge — ADR-0050, не гриллить. Работай автономно до результата; maintainer'а зови только для merge spec-PR и (до 0.9.0) impl-PR — полная ссылка на PR и «Merge pull request / Enable auto-merge в браузере на GitHub, не в панели Claude Desktop», CI не ждать.
1) process-PR R-44: остатки «merge #N» вне навыков Change identities (repo-hygiene, docs/process/rules.md, AGENTS.md, orchestration.md, description git-land, fast-mode) — защита агента, сливает maintainer.
2) Цикл 1, 0.9.0: architecture-audit, затем spec-PR — WS-03 (один gate engine, вопрос N44), A-34, WS-06, WS-13, WS-14, WS-15 (floor), ADR-0050 п. 2–4.
```

## Открытые вопросы

- Решения цикла 1: Р-5, Р-9, форма проверки форжа, противоречие формы WS-03 с N44 ADR-0037 — на spec-PR цикла 1; Р-2, Р-7, Р-8, Р-11 — цикл 2.
- Git-автор бота (`GIT_AUTHOR_*` / `GIT_COMMITTER_*` = `WARRANT agent <52467145+homasters@users.noreply.github.com>`) в `env` настроек Claude Code — шаг maintainer'а; до того агент задаёт их в команде.

## Не забыть

- WARRANT пассивен: судья, policy, evidence, контракт CLI. Исполнитель Change — внешний потребитель контракта (ADR-0050 п. 7); в этом репозитории его не строить.
- `gh` в Claude Code — бот `homasters`: spec- и impl-PR он не сливает (судья требует `merged_by` из `roles.maintainer`); archive-, docs-, process- и fix-PR сливает сам `--auto`.
- PR-панель Claude Desktop (кнопки merge и auto-merge) работает токеном сессии — от бота: #113 так слит ботом, судья отказал ref `MERGED`, восстановление — повтор impl-PR #114 (I-225, WS-32). Auto-merge, включённый ботом (`enabledBy: homasters`), на spec- и impl-PR — снять `gh pr merge N --disable-auto` и попросить maintainer'а в браузере.
- Классификатор auto-режима не пускает агента писать `transition APPROVED --by <maintainer>`, удалять evidence и коммитить `.claude/**` — одна команда maintainer'у (PowerShell: без `sed`), остальное продолжать. Команды merge и чистки — по одной, без `&&`; разрешения — `C:UsersXiaomi.claudesettings.json`, читаются при старте.
- CI: флейк «does not provide an export named …» закрыт (`npm pack` запускал `prepare`); красный тест — разбор, Re-run — только при явной инфраструктуре; канарейка: красный «Install warrant» — поставка сломана.
