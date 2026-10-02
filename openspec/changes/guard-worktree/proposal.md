# Proposal: guard-worktree

## Why

[#138](https://github.com/Homasters-max/SRA/issues/138), P1 для LATTICE. LATTICE ведёт каждую сессию в git worktree Claude Code (`<repo>/.claude/worktrees/<имя>`). Там guard не защищает `write_scope`:

- запись вне `write_scope` активного Run проходит `PreToolUse`;
- каждая правка, даже внутри `write_scope`, получает в `PostToolUse` hint `start a Run first`;
- тот же hint получает правка файла worktree из сессии основного checkout'а.

Вручную из worktree (`cwd` события = worktree, процесс тоже в worktree) guard решает верно.

Причина — в коде, а не в норме. REQ-ENF-004 требует определять проект и активный Run по `cwd` события. `warrant guard` берёт корень из `process.cwd()` (`commands/context.ts` `projectRoot`, `bin/warrant.ts` `productionCtx`), а Claude Code исполняет хуки worktree-сессии не из worktree'а: каталог процесса хука — не worktree, а `cwd` входа хука — worktree (факты — design, Context). guard читает `<основной checkout>/.warrant/runs/current`, а там Run нет. Без Run правка решается как «без Run»: hint `run start`, а `write_scope` чужого Run не проверяется.

Класс A ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2): ошибающийся агент пишет вне `write_scope`, guard этого не видит.

## What Changes

- **Проект события — по его `cwd`** (REQ-ENF-004). Это ближайший к `cwd` checkout под WARRANT (каталог с `.warrant/warrant.json` и `.git`), включая сам `cwd`. Нет такого — каталог процесса guard, как сейчас. Каталог только с `warrant.json` (проект golden pack) — часть объемлющего проекта. Активный Run, policy, `<state>` и адаптеры (`openspec`, `git`) берутся от этого корня. Для `--frontend claude` то же самое: `cwd` родного входа.
- **Путь другого checkout'а под WARRANT — вне проекта; под активным Run его правка — `deny`.** Другой checkout бывает вложенным (worktree в `.claude/worktrees/<имя>` основного checkout'а), объемлющим (основной checkout для пути из worktree'а) или соседним. Без Run такая правка — `allow` без hints, под Run `review` — прежнее правило пути вне проекта. Так ни `cd`, ни абсолютный путь не уводят правку из-под `write_scope`.
- **Проект не под WARRANT.** `allow`, как раньше, если checkout'а под WARRANT нет ни у `cwd` события и его предков, ни в каталоге процесса. Вход, который не разбирается как событие, судится в каталоге процесса, как сейчас; адаптер `claude` в каталоге не под WARRANT отвечает на него пустым stdout с кодом 0, как раньше (REQ-ENF-005).
- **Версия CLI — 0.10.1** (R-14; [ADR-0055](../../../docs/adr/WARRANT-ADR-0055-release-for-lattice.md) п. 1: исправление для LATTICE — patch). guard — не судья: вердикт `warrant ci`, схемы, JSON и коды выхода не меняются ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3). CHANGELOG — раздел `## 0.10.1`.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `enforcement`:
  - REQ-ENF-004 — проект события по `cwd` (ближайший checkout под WARRANT, иначе каталог процесса), путь другого checkout'а — вне проекта, под Run — `deny`; SCN-ENF-016 уточнён; новые SCN-ENF-056…059;
  - REQ-ENF-005 — проект по `cwd` родного входа; вход, который не разбирается, в каталоге не под WARRANT; SCN-ENF-021 уточнён.

## Non-Goals

- **Суд правки пути другого checkout'а его собственным Run.** Под Run она запрещена, без Run — разрешена; почему не суд тем Run — design D2.
- **Шум `start a Run first` без Run** (WS-26) — не этот Change. Здесь hint уходит только там, где Run есть, но guard его не видел.
- **`CLAUDE_PROJECT_DIR`** в команде хука не меняется: она находит файл CLI, а не проект события.

## Impact

- `packages/cli/src/core/guard/guard.ts`, `core/guard/decide.ts` — корень по событию, путь другого checkout'а.
- `packages/cli/src/commands/guard.ts`, `packages/cli/src/bin/warrant.ts` — `ctx` для корня события.
- `packages/cli/test/app/commands/guard.test.ts`, `guard-frontend.test.ts` — SCN-ENF-016, SCN-ENF-021, SCN-ENF-056…059.
- `package.json` (версия 0.10.1), `CHANGELOG.md`.
