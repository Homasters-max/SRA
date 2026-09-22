---
id: WARRANT-ADR-0017
title: Execution в manifest check — эксклюзивный замок, режим локального запуска, суженный прогон, guard
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: [WARRANT-ADR-0014]
---

## Context

Наблюдение из стороннего проекта на OpenSpec + Claude Code (`oinsio/clear-progress`): параллельные прогоны тестов,
фоновые запуски и полный Stryker исчерпывают память и вешают машину. Защита держится только на тексте CLAUDE.md
(«строго по одному», «не в фоне», «Stryker не больше 5 файлов», «full run — только человек»). По INV-04 prompt —
не механизм принуждения.

Источники риска: агент, вызывающий тяжёлую команду напрямую через shell; параллельные subagents (разные процессы,
возможно разные worktree); фоновые запуски. Схема `warrant://check/1` (kernel spec, «Схема check») описывает только
*что* запускать (`run.command`), но не *как* это разрешено запускать.

## Decision

1. **Блок `execution`** рядом с `run` в check:
   `{ "exclusive": bool, "timeout_s": int, "local": "allowed" | "scoped-only" | "ci-only", "max_paths": int,
   "guard_prefixes": string[][] }`. Defaults: `exclusive: false`, `local: "allowed"`,
   `timeout_s` — из `warrant.json` `defaults.check_timeout_s`. Это стоимость выполнения, а не сила проверки:
   мягкие defaults не нарушают INV-10.
2. **Кто исполняет.** Runner `warrant check` (замок, timeout, `local`) и `warrant guard` (запрет обхода).
   Orchestration (фаза 7) читает тот же manifest. Внутреннее планирование CI — вне WARRANT.
3. **Замок `exclusive`** — один на машину: file lock `$(git rev-parse --git-common-dir)/warrant/check.lock`, общий
   для всех процессов и worktree. Занят → код `2` (WAIT), `errors[0].code: "BUSY"`, в ответе держатель
   (pid, check, начало). `--wait` ждёт до `timeout_s` (так вызывает CI). Замок мёртвого pid снимается автоматически
   с записью в журнал Run. Фоновый запуск отдельно не запрещается — замок сериализует его так же.
   Именованные группы замков — later.
4. **Суженный прогон.** `run.scoped_command` — argv с плейсхолдером `{paths}`; вызов
   `warrant check <id> --paths a,b`, по умолчанию пути — из diff (base по [ADR-0016](WARRANT-ADR-0016-mutation-diff-scope.md)).
   Больше `max_paths` → код `3`. Evidence суженного прогона несёт `limitations: ["scoped: <paths>"]` и gate не
   засчитывается. `local: "scoped-only"` — локально разрешён только суженный прогон; `ci-only` — локально никакой.
5. **Guard** (уточняет [ADR-0014](WARRANT-ADR-0014-claude-code-enforcement.md) п. 2). Для checks с `exclusive: true`
   или `local ≠ allowed` guard сравнивает Bash-команду после shell-разбора с `execution.guard_prefixes`
   (default — первые токены `run.command`) и отвечает `deny` с подсказкой `warrant check <id> [--paths …]`.
   Команда не переписывается. Событие — в `guard_events[]`.
6. **Где объявляется.** Default — в check pack; проект переопределяет через `overrides` в `.warrant/local/checks/`
   (policy-путь → `factory-change`).
7. **Сроки.** Поля схемы check, `defaults.check_timeout_s` в config и runner — OpenSpec change фазы 3 (вместе с
   `metrics` ADR-0016). Правило guard — фаза 4.

## Consequences

- Правила clear-progress «по одному», «не больше 5 файлов», «full run — только CI» выражаются полями manifest,
  а не текстом prompt.
- Параллельные subagents упираются в замок и получают `BUSY` сразу — агент переключается или спрашивает человека.
- Kernel spec получает изменение схемы check и схемы config в фазе 3; до этого поля существуют только в документах.
- Предел INV-07 сохраняется: shell-обёртка (скрипт, alias) обходит `guard_prefixes`. Guard закрывает прямой и
  типичный случай; замок в runner при обходе не участвует.

## Alternatives

- **Замок внутри одного процесса `warrant check`** — отвергнуто: не ловит параллельных subagents.
- **Замок в `.warrant/runs/`** — отвергнуто: у каждого worktree свой каталог.
- **Строгие defaults (`exclusive: true`)** — отвергнуто: сериализует всё без выигрыша в защите.
- **Отдельный профиль машины вне git** — отвергнуто: расходится между разработчиками и CI, невоспроизводим.
- **Guard переписывает команду (`updatedInput`)** — отвергнуто: неявное поведение, агент не знает, что выполнилось.
- **Guard только предупреждает** — отвергнуто: это снова текст, а не механизм.
- **Ожидание замка по умолчанию** — отвергнуто для агента: блокирует сессию; для CI — `--wait`.
- **Отдельный OpenSpec change к kernel сейчас** — отвергнуто: поля никто не читает до фазы 3.
