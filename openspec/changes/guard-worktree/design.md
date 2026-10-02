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

**Допущение A-1: `cwd` входа хука worktree-сессии — каталог worktree'а.** Источники:
- документация хуков Claude Code: `cwd` — рабочий каталог сессии в момент хука;
- #138: тот же вход, поданный вручную с `cwd` = worktree, решается верно, а хук — нет. Значит, расходится каталог процесса, а не `cwd`.

Зонд в worktree-сессии (`scripts/dev/probe-hooks.js`, интерактивно) — акт maintainer'а, строка backlog. Если допущение неверно, D1 не вредит: `cwd` основного checkout'а даёт тот же корень, что сейчас.

**Норма.** REQ-ENF-004 уже требует определять проект и Run по `cwd` события. Код ей не следует. Норма не говорит, как найти проект от `cwd`-подкаталога: тест SCN-ENF-036 шлёт `cwd` = `<root>/src`. Не говорит и о том, где судить вход, который не разбирается.

## Goals / Non-Goals

**Goals:** guard в worktree-сессии судит Run и policy worktree'а.

**Non-Goals:** суд правки файла worktree'а его Run из сессии основного checkout'а (D2). WS-26 — шум hint без Run.

## Decisions

### 1. Решения

- **D1. Корень события.** `guardRoot(cwd, fallback)` — ближайший к `path.resolve(fallback, cwd)` каталог-предок, включая его самого, с `.warrant/warrant.json`. Нет такого — `fallback`: каталог процесса, как сейчас. Тогда `cwd`, ушедший из всех проектов (`cd /tmp`), не выключает guard проекта процесса.
  - `guard` разбирает вход и находит корень, потом решает в `ctx` этого корня: `at(root)`.
  - `at` даёт команда: в `bin` — `productionCtx` с этим корнем (адаптеры от него же). По умолчанию — `{ ...ctx, root }`, для тестов без процесса.
  - `underWarrant` проверяется у найденного корня. Если вход не разобрался, проверяется каталог процесса, как сейчас: при каталоге не под WARRANT вход не читается (SCN-ENF-016).
- **D2. Путь другого checkout'а в каталоге проекта — путь проекта, как сейчас.** Правка `.claude/worktrees/<имя>/…` из сессии основного checkout'а судится его policy и его Run. Без Run — hint `run start` (шум WS-26). При Run основного checkout'а — его `write_scope`. Отвергнуты (review раунда 1, I-1):
  - **«вне проекта»** при `.warrant/warrant.json` между корнем и путём. Признак ложен: у golden pack (`packs/core-sdd/golden/*/.warrant/warrant.json`) он есть без `.git`, и их пути ушли бы из-под policy `factory-change`. Агент создаёт его сам (`mkdir docs/.warrant`) и выводит пути из-под `write_scope`. `cd` в основной checkout выводил бы из-под `write_scope` Run worktree'а. При Run `implement` основного checkout'а правка worktree'а стала бы `allow` — ослабление;
  - **суд каждого пути проектом этого пути.** Событие с путями двух проектов требует двух решений, двух записей и правила слияния. Под Run `review` основного checkout'а правка worktree'а ушла бы из-под запрета. Норма уже называет вызов из другого checkout'а пределом (INV-07).
- **D3. Версия.** CLI 0.10.1 первым изменением поставляемого после `v0.10.0` (R-14), раздел CHANGELOG `## 0.10.1`. Patch по [ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3: схемы, JSON, коды выхода и вердикт `warrant ci` прежние. guard — не судья. `kernel` остаётся 0.10, pin потребителя не меняется.

### 2. Альтернативы

- **Корень по `CLAUDE_PROJECT_DIR`.** Отвергнут: в worktree-сессии он указывает на основной checkout (см. Context). Да и это знание адаптера, а не ядра.
- **Корень — `git rev-parse --show-toplevel` от `cwd`.** Отвергнут: процесс git на каждый вызов хука. Кроме того, проект под WARRANT отмечает `.warrant/warrant.json`, а не git.
- **Подъём от `cwd` для всех команд CLI.** Отвергнут: «CLI вверх не ходит» — контракт путей вывода (`commands/context.ts`). guard — единственная команда, которую зовут из чужого каталога.

### 3. Порядок

Одна группа кода (D1, тесты), затем версия и CHANGELOG (D3).

### 4. Риски

- **`cwd` вне всех проектов.** Как сейчас, судит каталог процесса (D1, SCN-ENF-057). Абсолютный путь в проекте процесса по-прежнему его путь.
- **CLI основного checkout'а судит закрепление worktree'а.** С полем `cli` хук worktree-сессии исполняет `${CLAUDE_PROJECT_DIR}/<cli>`, то есть файл основного checkout'а. После D1 он грузит `warrant.json` worktree'а. Если worktree закрепил `kernel` или pack новее этого CLI (pin-Change в работе), policy не грузится, и guard worktree'а переходит в режим восстановления ADR-0053 п. 2: правка путей проекта — `deny`, reason называет версии, выход — CLI не старше закрепления (собрать CLI основного checkout'а или CLI тега на машине). До этого Change ту же картину давал бы `cwd` основного checkout'а. Без поля `cli` (LATTICE, глобальный CLI тега) хук и worktree исполняют один CLI.
- **Подъём через несуществующие каталоги.** `cwd` удалённого worktree'а внутри основного checkout'а находит основной checkout — как сейчас.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
| I-1 | Review spec раунда 1 (NOT_PROVEN, BLOCKER 1, MAJOR 5, MINOR 2, INFO 1, RUN-01M3Y3A3KMWF1ZJBZ113NPFHPM) закрыт правкой spec до раунда 2. F-1 (BLOCKER), F-4, F-5, F-8 — правило «вложенный checkout — вне проекта» снято, путь другого checkout'а в каталоге проекта — путь проекта (D2). F-2 — допущение A-1 с источниками. F-3 — риск CLI основного checkout'а. F-6 — вход, который не разбирается, судится в каталоге процесса, в норме и SCN-ENF-016. F-7 — относительный `cwd`, подъём без `realpath` через несуществующие каталоги — в норме. F-9 — пример Claude Code вынесен из нормы в design. Новый SCN-ENF-057 — `cwd` вне проектов | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
