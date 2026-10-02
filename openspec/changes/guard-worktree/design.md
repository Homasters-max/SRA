# Design: guard-worktree

## Context

База — `main` `20fa6d3`: CLI 0.10.0 выпущен (тег `v0.10.0`), `kernel` 0.10, pack `core-sdd` 0.4.1. Источник — [#138](https://github.com/Homasters-max/SRA/issues/138). Пути ниже — от `packages/cli/src`.

**Корень сейчас.** `commands/context.ts` `projectRoot()` возвращает `process.cwd()`: CLI вверх не ходит. `bin/warrant.ts` `productionCtx` строит `ctx` от этого корня, и от него же — адаптеры `OpenSpecCli`, `GitCli`, `ForgeGh`. `warrant guard` (обе формы) получает этот `ctx`:
- `core/guard/guard.ts` `guard` и `guardFrontend` проверяют `underWarrant(ctx.root)` до разбора входа;
- `pre` и `post` берут `projectFiles(ctx.root, event)`, `activeRun(ctx.root, env)` → `readCurrent`, `loadPacks(ctx.root)`, `cliWrittenState(ctx.root, env)`;
- `post` гоняет `runFileChecks(validateRun(ctx, loaded), files)`, а он может звать `ctx.openspec` (`validate/generated.ts`);
- `appendGuardEvent(ctx, run, …)` пишет событие в файл Run под `ctx.root`.

`cwd` события используется только для разрешения относительных путей (`path.resolve(event.cwd, given)`) и для `cd` под Run `review` (`reviewShellPlaces`).

**Claude Code в worktree.** Хуки `.claude/settings.json` worktree-сессии исполняются из основного checkout'а. Хук `SessionStart` этого репозитория (`scripts/dev/brief.js`, корень — `CLAUDE_PROJECT_DIR` или `cwd`) в сессии worktree `.claude/worktrees/trusting-taussig-ce1dc3` 2026-10-02 назвал `D:/project/SRA [main]`. При этом `cwd` входа хука — каталог сессии, то есть worktree. Так же и в отчёте #138: вручную с `cwd` = worktree guard решает верно.

**Норма.** REQ-ENF-004 уже требует определять проект и Run по `cwd` события. Код ей не следует. Норма не говорит, как найти проект от `cwd`-подкаталога: тест SCN-ENF-036 шлёт `cwd` = `<root>/src`. Не говорит она и о вложенном checkout'е.

## Goals / Non-Goals

**Goals:** guard в worktree-сессии судит Run и policy worktree'а. Сессия основного checkout'а не получает ложный hint на правку файла worktree.

**Non-Goals:** суд правки файла worktree его собственным Run из сессии основного checkout'а (D2). WS-26 — шум hint без Run.

## Decisions

### 1. Решения

- **D1. Корень события.** `guardRoot(cwd, fallback)` — ближайший к `path.resolve(fallback, cwd)` каталог-предок, включая его самого, с `.warrant/warrant.json`. Нет такого — `fallback`: каталог процесса, как сейчас. Тогда `cwd`, ушедший из всех проектов (`cd /tmp`), не выключает guard проекта процесса.
  - `guard` разбирает вход и находит корень, потом решает в `ctx` этого корня: `at(root)`.
  - `at` даёт команда: в `bin` — `productionCtx` с этим корнем (адаптеры от него же). По умолчанию — `{ ...ctx, root }`, для тестов без процесса.
  - `underWarrant` проверяется у найденного корня. Если вход не разобрался, проверяется каталог процесса, как сейчас: при каталоге не под WARRANT вход не читается (SCN-ENF-016).
- **D2. Вложенный checkout — вне проекта.** `projectFile(root, absolute)` — `projectPath` плюс проверка, что между `root` и каталогом пути нет `.warrant/warrant.json`. Иначе путь `undefined`, то есть вне проекта. Она заменяет `projectPath` в `projectFiles`, `outsidePaths` и `inProject` для `cd` под Run `review`. Так правка `.claude/worktrees/<имя>/…` из основного checkout'а:
  - без Run — `allow`, без hints, без события;
  - под Run `review` основного checkout'а — `deny`, как путь вне проекта вне временного каталога (SCN-ENF-041).

  Альтернатива — судить каждый путь проектом этого пути (Run worktree'а для правки из основного checkout'а). Отвергнута:
  - событие с путями двух проектов требует двух решений, двух записей событий и правила их слияния;
  - подъём к предку дал бы выход из Run `review`: путь основного checkout'а из worktree судился бы Run основного checkout'а, где Run `review` нет;
  - норма уже называет вызов из другого checkout'а пределом (INV-07).
- **D3. Версия.** CLI 0.10.1 первым изменением поставляемого после `v0.10.0` (R-14), раздел CHANGELOG `## 0.10.1`. Patch по [ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3: схемы, JSON, коды выхода и вердикт `warrant ci` прежние. guard — не судья. `kernel` остаётся 0.10, pin потребителя не меняется.

### 2. Альтернативы

- **Корень по `CLAUDE_PROJECT_DIR`.** Отвергнут: в worktree-сессии он указывает на основной checkout (см. Context). Да и это знание адаптера, а не ядра.
- **Корень — `git rev-parse --show-toplevel` от `cwd`.** Отвергнут: процесс git на каждый вызов хука. Кроме того, проект под WARRANT отмечает `.warrant/warrant.json`, а не git.
- **Подъём от `cwd` для всех команд CLI.** Отвергнут: «CLI вверх не ходит» — контракт путей вывода (`commands/context.ts`). guard — единственная команда, которую зовут из чужого каталога.

### 3. Порядок

Одна группа кода (D1, D2, тесты), затем версия и CHANGELOG (D3).

### 4. Риски

- **Лишние `stat` на каждый путь события** (D2): подъём от каталога пути до корня. Глубина пути — единицы каталогов, хук вызывается на действие агента.
- **`cwd` вне всех проектов.** Как сейчас, судит каталог процесса (D1). Абсолютный путь в проекте процесса по-прежнему его путь.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
