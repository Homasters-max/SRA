# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)): честный судья, поставка, идентичность агента. Цикл 0 закрыт (`release-path`, CLI 0.8.3). Merge агентом и приёмка человеком — [ADR-0050](../adr/WARRANT-ADR-0050-agent-merge.md) (spec одобряет человек; impl-PR агентом — с 0.9.0). Агент работает как машинный пользователь `homasters`. Долг — строки `WS-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization. Норма merge — ADR-0050, не гриллить. Работай автономно до результата; maintainer'а зови только для merge spec-PR и (до 0.9.0) impl-PR — ссылка и строка «Enable auto-merge», CI не ждать.
1) Change identities: если spec-PR #106 слит — worktree D:/project/SRA-identities (незакоммиченные правки warrant.json и навыков уже там): git switch -c worktree/identities origin/main, transition APPROVED --ref <#106> --by Homasters-max, IMPLEMENTING, группы, I-N по review 2 (тело #106), навыки — merge по ADR-0050 п. 8, VERIFYING, impl-PR; archive-PR — ботом. Не слит — ссылка maintainer'у.
2) Цикл 1, 0.9.0: architecture-audit, затем spec-PR — WS-03 (один gate engine, вопрос N44), A-34, WS-06, WS-13, WS-14, WS-15 (floor), ADR-0050 п. 2–4.
```

## Открытые вопросы

- Решения цикла 1: Р-5, Р-9, форма проверки форжа, противоречие формы WS-03 с N44 ADR-0037 — на spec-PR цикла 1; Р-2, Р-7, Р-8, Р-11 — цикл 2.
- Git-автор бота (`GIT_AUTHOR_*` / `GIT_COMMITTER_*` = `WARRANT agent <52467145+homasters@users.noreply.github.com>`) в `env` настроек Claude Code — шаг maintainer'а; до того агент задаёт их в команде.

## Не забыть

- WARRANT пассивен: судья, policy, evidence, контракт CLI. Исполнитель Change — внешний потребитель контракта (ADR-0050 п. 7); в этом репозитории его не строить.
- `gh` в Claude Code — бот `homasters`: spec- и impl-PR он не сливает (судья требует `merged_by` из `roles.maintainer`); archive-, docs-, process- и fix-PR сливает сам `--auto`.
- Команды merge и чистки — по одной, без `&&`; разрешения — `C:\Users\Xiaomi\.claude\settings.json`, читаются при старте.
- Навыки в `main` ещё велят агенту сливать spec- и impl-PR — до merge impl-PR `identities` следовать ADR-0050 п. 8.
- CI: флейк «does not provide an export named …» закрыт (`npm pack` запускал `prepare`); красный тест — разбор, Re-run — только при явной инфраструктуре; канарейка: красный «Install warrant» — поставка сломана.
