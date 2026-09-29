# stabilization

## Цель

Фаза стабилизации ([ADR-0048](../adr/WARRANT-ADR-0048-stabilization.md)) и тёмная фабрика: **человек запускает Change (merge spec-PR), машина ведёт его до PASS или FAIL с отчётом**. Решения Q1–Q7 grilling 2026-09-29 — [drafts/2026-09-29-dark-factory](../drafts/2026-09-29-dark-factory/README.md); они меняют [ADR-0049](../adr/WARRANT-ADR-0049-flow.md) (человек между стадиями). Цикл 0 закрыт (`release-path`, CLI 0.8.3). Агент работает как машинный пользователь `homasters`. Долг — строки `WS-N` [backlog](../backlog.md).

## Готовый запрос

```text
Поток stabilization. Прочитай docs/drafts/2026-09-29-dark-factory/ (README, 01-accepted, 03-open) — решения Q1–Q7 приняты, не гриллить заново; Q8 (граница WARRANT и фабрики) — подтвердить раскладку первой. Работай автономно, до конечного результата; maintainer'а зови только для merge spec-PR и (до 0.9.0) impl-PR — дай ссылку и строку «Enable auto-merge», не жди CI.
1) Change identities (03-open §2): если spec-PR #106 слит — impl-PR из D:/project/SRA-identities (незакоммиченные правки уже там), I-N по review 2, затем archive-PR ботом; не слит — ссылка maintainer'у.
2) ADR-0050 «WARRANT в тёмной фабрике: граница и обязательства» по Q8 (меняет ADR-0049 п. 1, 2, 5, 8 и ADR-0047 п. 1–2); решения фабрики Q1–Q6 — docs/process/dark-factory.md из 02-scheme-v2 по 03-open §1 с пометкой «документ фабрики», правка docs/process/flow.md, строки backlog; тот же PR удаляет папку черновиков. Классификатор откажет — дай maintainer'у файлы и строки.
3) Флейки WS-30 и BL-105, затем scripts/dev/flow.js v0 — весь путь после запуска (01-accepted, порядок работ п. 4), задача по расписанию (Q5).
```

## Открытые вопросы

- Три малых вопроса [03-open](../drafts/2026-09-29-dark-factory/03-open.md): где живёт метка `ready`, хранение advisory-ревью, формат отчёта — принять рекомендациями при записи ADR-0050 или спросить.
- Решения цикла 1: Р-5, Р-9, Р-10 (код 4 — нужен в 0.9.0 по Q4), форма проверки форжа — на spec-PR цикла 1; Р-2, Р-7, Р-8, Р-11 — цикл 2.
- Git-автор бота (`GIT_AUTHOR_*` / `GIT_COMMITTER_*`) в `env` настроек Claude Code — шаг maintainer'а; до того агент задаёт их в команде.

## Не забыть

- WARRANT — отдельный проект, компонент фабрики: в WARRANT — только судья, policy, evidence, контракт CLI; исполнение, бюджеты, отчёт, merge — фабрика (Q8).
- `gh` в Claude Code — бот `homasters`: spec- и impl-PR он сливать не должен (судья требует `merged_by` из `roles.maintainer`); archive-, docs- и fix-PR сливает сам `--auto`.
- Команды merge и чистки — по одной, без `&&`; правила разрешений — в `C:\Users\Xiaomi\.claude\settings.json`, читаются при старте.
- FAIL — только при изменении утверждённой spec или по бюджету Q4; ревью реализации — advisory, не доказательство (поправки maintainer'а к Q4, Q6).
- CI: флейки WS-30 и `npm pack` на windows (BL-105) — один Re-run всего run, второе падение — разбор; канарейка `canary.yml`: красный «Install warrant» — поставка сломана, красный `warrant ci` — строка backlog.
