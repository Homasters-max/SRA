# Proposal: guard-worktree

## Why

[#138](https://github.com/Homasters-max/SRA/issues/138), P1 для LATTICE. LATTICE ведёт каждую сессию в git worktree Claude Code (`<repo>/.claude/worktrees/<имя>`). Там guard не защищает `write_scope`:

- запись вне `write_scope` активного Run проходит `PreToolUse`;
- каждая правка, даже внутри `write_scope`, получает в `PostToolUse` hint `start a Run first`;
- тот же hint получает правка файла worktree из сессии основного checkout'а.

Вручную из worktree (`cwd` события = worktree, процесс тоже в worktree) guard решает верно.

Причина — в коде, а не в норме. REQ-ENF-004 требует определять проект и активный Run по `cwd` события. `warrant guard` берёт корень из `process.cwd()` (`commands/context.ts` `projectRoot`, `bin/warrant.ts` `productionCtx`), а Claude Code исполняет хуки worktree-сессии из основного checkout'а. Это видно по хуку `SessionStart` этого репозитория: в worktree-сессии он называет основной checkout. guard читает `<основной checkout>/.warrant/runs/current`, а там Run нет. Без Run правка решается как «без Run»: hint `run start`, а `write_scope` чужого Run не проверяется.

Класс A ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2): ошибающийся агент пишет вне `write_scope`, guard этого не видит.

## What Changes

- **Проект события — по его `cwd`** (REQ-ENF-004). Это ближайший к `cwd` предок (включая сам `cwd`) с `.warrant/warrant.json`. Нет такого — каталог процесса guard, как сейчас. Активный Run, policy, `<state>` и адаптеры (`openspec`, `git`) берутся от этого корня. Для `--frontend claude` то же самое: `cwd` родного входа.
- **Проект не под WARRANT.** `allow`, как раньше, если `.warrant/warrant.json` нет ни у `cwd` события и его предков, ни в каталоге процесса. Вход, который не разбирается как событие, судится в каталоге процесса, как сейчас.
- **Версия CLI — 0.10.1** (R-14; [ADR-0055](../../../docs/adr/WARRANT-ADR-0055-release-for-lattice.md) п. 1: исправление для LATTICE — patch). guard — не судья: вердикт `warrant ci`, схемы, JSON и коды выхода не меняются ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3). CHANGELOG — раздел `## 0.10.1`.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `enforcement`: REQ-ENF-004 — проект события по `cwd` (ближайший предок с `.warrant/warrant.json`, иначе каталог процесса); SCN-ENF-016 уточнён; новые SCN-ENF-056, SCN-ENF-057.

## Non-Goals

- **Правка файла worktree из сессии основного checkout'а** судится, как сейчас, проектом основного checkout'а: путь `.claude/worktrees/<имя>/…` — его путь (предел «другой checkout» REQ-ENF-004). Его hint `run start` без Run основного checkout'а — шум WS-26. Почему не «вне проекта» и не суд Run worktree'а — design D2.
- **Шум `start a Run first` без Run** (WS-26) — не этот Change. Здесь hint уходит только там, где Run есть, но guard его не видел.
- **`CLAUDE_PROJECT_DIR`** в команде хука не меняется: она находит файл CLI, а не проект события.

## Impact

- `packages/cli/src/core/guard/guard.ts` — корень по событию.
- `packages/cli/src/commands/guard.ts`, `packages/cli/src/bin/warrant.ts` — `ctx` для корня события.
- `packages/cli/test/app/commands/guard.test.ts`, `guard-frontend.test.ts` — SCN-ENF-016, SCN-ENF-056, SCN-ENF-057.
- `package.json` (версия 0.10.1), `CHANGELOG.md`.
