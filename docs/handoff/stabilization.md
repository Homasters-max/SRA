# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)): честный судья, поставка, идентичность агента. Цикл 0 закрыт (`release-path`, CLI 0.8.3). Решения 2026-09-29 о merge агентом и приёмке человеком — [drafts/2026-09-29-agent-merge](../drafts/2026-09-29-agent-merge/README.md) (О-1…О-5, вход ADR-0050). Агент работает как машинный пользователь `homasters`. Долг — строки `WS-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization. Прочитай docs/drafts/2026-09-29-agent-merge/ — решения О-1…О-5 приняты, не гриллить. Работай автономно до результата; maintainer'а зови только для merge spec-PR и (до 0.9.0) impl-PR — ссылка и строка «Enable auto-merge», CI не ждать.
1) Change identities: если spec-PR #106 слит — worktree D:/project/SRA-identities (незакоммиченные правки warrant.json и навыков уже там): git switch -c worktree/identities origin/main, transition APPROVED --ref <#106> --by Homasters-max, IMPLEMENTING, группы, I-N по review 2 (тело #106), VERIFYING, impl-PR; archive-PR — ботом. Не слит — ссылка maintainer'у.
2) ADR-0050 по 01-obligations (меняет ADR-0049 п. 2, 4, 5, 8), строки backlog (BL-98, О-1 для LOW после attestation); тот же PR удаляет папку черновиков. Классификатор откажет — дай maintainer'у файлы и строки.
3) Флейки WS-30 и BL-105. 4) Цикл 1, 0.9.0: WS-03, WS-13, WS-14, floor, О-2…О-4.
```

## Открытые вопросы

- Решения цикла 1: Р-5, Р-9, форма проверки форжа — на spec-PR цикла 1; Р-2, Р-7, Р-8, Р-11 — цикл 2.
- Git-автор бота (`GIT_AUTHOR_*` / `GIT_COMMITTER_*` = `WARRANT agent <52467145+homasters@users.noreply.github.com>`) в `env` настроек Claude Code — шаг maintainer'а; до того агент задаёт их в команде.

## Не забыть

- WARRANT пассивен: судья, policy, evidence, контракт CLI. Исполнение Change (запуск, бюджеты, отчёты, расписание) — не WARRANT; в этом репозитории его не строить.
- `gh` в Claude Code — бот `homasters`: spec- и impl-PR он не сливает (судья требует `merged_by` из `roles.maintainer`); archive-, docs- и fix-PR сливает сам `--auto`.
- Команды merge и чистки — по одной, без `&&`; разрешения — `C:\Users\Xiaomi\.claude\settings.json`, читаются при старте.
- Навыки в `main` ещё велят агенту сливать spec- и impl-PR — до merge impl-PR `identities` следовать черновику О-1…О-2.
- CI: флейки WS-30 и `npm pack` на windows (BL-105) — один Re-run всего run, второе падение — разбор; канарейка: красный «Install warrant» — поставка сломана.
