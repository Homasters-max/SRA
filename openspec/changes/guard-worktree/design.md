# Design: guard-worktree

## Context

База — `main` `20fa6d3`: CLI 0.10.0 выпущен (тег `v0.10.0`), `kernel` 0.10, pack `core-sdd` 0.4.1. Источник — [#138](https://github.com/Homasters-max/SRA/issues/138). Пути ниже — от `packages/cli/src`.

**Корень сейчас.** `commands/context.ts` `projectRoot()` возвращает `process.cwd()`: CLI вверх не ходит. `bin/warrant.ts` `productionCtx` строит от этого корня `ctx` и адаптеры `OpenSpecCli`, `GitCli`, `ForgeGh`. `warrant guard` (обе формы) получает этот `ctx`:
- `core/guard/guard.ts` `guard` и `guardFrontend` проверяют `underWarrant(ctx.root)` до разбора входа;
- `pre` и `post` берут `projectFiles(ctx.root, event)`, `activeRun(ctx.root, env)` → `readCurrent`, `loadPacks(ctx.root)`, `cliWrittenState(ctx.root, env)`;
- `post` гоняет `runFileChecks(validateRun(ctx, loaded), files)`, а он может звать `ctx.openspec` (`validate/generated.ts`);
- `appendGuardEvent(ctx, run, …)` пишет событие в файл Run под `ctx.root`.

`cwd` события нужен только для относительных путей (`path.resolve(event.cwd, given)`) и для `cd` под Run `review` (`reviewShellPlaces`). Путь вне проекта даёт `allow` при любом Run, кроме `review` (`projectFiles` его отбрасывает).

**Claude Code в worktree** (Claude Code desktop, Windows, 2026-10-02, сессия worktree `.claude/worktrees/trusting-taussig-ce1dc3` этого репозитория):
- `CLAUDE_PROJECT_DIR` хуков — основной checkout. Хук `SessionStart` (`scripts/dev/brief.js`, корень — `CLAUDE_PROJECT_DIR` или `cwd`) назвал `D:/project/SRA [main]`.
- `cwd` входа хука — worktree. Хук `PreToolUse` `scripts/dev/git-hook.js` судит `git merge` без `cd` по `input.cwd`. Строку `git merge --no-commit <ref>` он пропустил, а из основного checkout'а запретил бы правилом `main-checkout` (`git-hook-lib.js` `isMainCheckout`).
- #138: тот же вход, поданный вручную из worktree, решается верно, а хук — нет. Значит, каталог процесса хука — не worktree.

Отсюда: каталог процесса расходится с `cwd` входа, а `cwd` входа указывает на верный checkout.

**Норма.** REQ-ENF-004 уже требует определять проект и Run по `cwd` события, но код ей не следует. Кроме того, норма не говорит:
- как найти проект от `cwd`-подкаталога (тест SCN-ENF-036 шлёт `cwd` = `<root>/src`);
- где судить вход, который не разбирается;
- что такое «другой checkout».

Каталог с `.warrant/warrant.json` бывает и не checkout'ом: проекты golden pack `packs/core-sdd/golden/*/` в этом репозитории.

## Goals / Non-Goals

**Goals:**
- guard в worktree-сессии судит Run и policy worktree'а;
- под активным Run правка пути другого checkout'а под WARRANT не проходит молча.

**Non-Goals:**
- суд правки пути другого checkout'а его собственным Run (D2);
- WS-26 — шум hint без Run.

## Decisions

### 1. Решения

- **D1. Корень события.** `checkoutOf(dir)` — каталог, где есть и `.warrant/warrant.json`, и `.git` (каталог основного checkout'а или файл git worktree'а). `guardRoot(cwd, fallback)` — ближайший такой каталог от `path.resolve(fallback, cwd)` вверх, включая сам `cwd`. Нет такого — `fallback`, каталог процесса, как сейчас.
  - `cwd`, ушедший из всех checkout'ов (`cd /tmp`), не выключает guard проекта процесса.
  - Каталог golden с одним `warrant.json` проектом не становится (review раунда 2, F-1).
  - `guard` разбирает вход, находит корень и решает в `ctx` этого корня: `at(root)`. В `bin` `at` — `productionCtx` с этим корнем (адаптеры от него же), по умолчанию — `{ ...ctx, root }`.
  - Вход, который не разбирается, судится в каталоге процесса, как сейчас. Если тот не под WARRANT — `allow` (адаптер `claude` — пустой stdout, код 0), иначе отказ (код 2 адаптера).
- **D2. Путь другого checkout'а — вне проекта, под Run — `deny`.** `otherCheckout(root, file)` — ближайший к пути предок-checkout под WARRANT (D1), отличный от `root`. Вложенный: `root/.claude/worktrees/<имя>`. Объемлющий: основной checkout для пути из worktree'а под ним. Соседний: `../SRA-<имя>`.
  - Путь такого checkout'а — вне проекта, даже если лежит в каталоге проекта. Он не попадает в `files` и `guard_events[].paths`.
  - При активном Run, кроме `review`, правка такого пути — `deny`. Reason: путь в другом checkout'е под WARRANT, Run судит только свой. Hint: сессия того checkout'а или `warrant run finish`. Путь не называется: reason уходит в `guard_events[]`, как у Run `review`.
  - Без Run — `allow` без hints, как любой путь вне проекта.
  - Под Run `review` — прежнее правило пути вне проекта (временный каталог). `cd` в путь другого checkout'а — выход из проекта (`inProject`).

  Почему так (review раундов 1–2, I-1, I-2):
  - Без `deny` под Run `cd` в основной checkout или абсолютный путь основного checkout'а из worktree'а уводили бы правку из-под `write_scope` (F-4 раунда 1, F-2 раунда 2).
  - Суд каждого пути проектом этого пути отвергнут: событие с путями двух проектов требует двух решений, двух записей и правила слияния, а под Run `review` правка другого checkout'а ушла бы из-под запрета.
  - «Путь проекта, как сейчас» (раунд 1) оставлял правку worktree'а из основного checkout'а на policy основного и не закрывал случай объемлющего checkout'а.
- **D3. Версия.** CLI 0.10.1 — первое изменение поставляемого после `v0.10.0` (R-14), раздел CHANGELOG `## 0.10.1`. Patch по [ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3: схемы, JSON, коды выхода и вердикт `warrant ci` прежние, а guard — не судья. `kernel` остаётся 0.10, pin потребителя не меняется. Версию релиза решает maintainer ([#139](https://github.com/Homasters-max/SRA/issues/139#issuecomment-5950664575)). Если он выберет minor, её поднимет следующий Change.

### 2. Альтернативы

- **Корень по `CLAUDE_PROJECT_DIR`.** Отвергнут: в worktree-сессии он указывает на основной checkout (Context). Это знание адаптера, а не ядра.
- **Корень — `git rev-parse --show-toplevel` от `cwd`.** Отвергнут: процесс git на каждый вызов хука. Проверка `.git` и `.warrant/warrant.json` — два `stat`.
- **Подъём от `cwd` для всех команд CLI.** Отвергнут: «CLI вверх не ходит» — контракт путей вывода (`commands/context.ts`). guard — единственная команда, которую зовут из чужого каталога.

### 3. Порядок

Одна группа кода (D1, D2, тесты), затем версия и CHANGELOG (D3).

### 4. Риски

- **Признак checkout'а подделывается.** Агент может создать `x/.warrant/warrant.json` и `x/.git` и сделать `cd x`. Это класс B (обходящий агент, ADR-0048 п. 2): guard не обязан это предотвращать, `scope-valid` и судья в CI видят правку вне scope.
- **`stat` на путь события** (D2): подъём от каталога пути до корня диска. Глубина — единицы каталогов, хук вызывается на действие агента.
- **CLI основного checkout'а судит закрепление worktree'а.** С полем `cli` хук worktree-сессии исполняет `${CLAUDE_PROJECT_DIR}/<cli>`, файл основного checkout'а, а после D1 грузит `warrant.json` worktree'а.
  - Если worktree закрепил `kernel` или pack новее этого CLI (pin-Change в работе), policy не грузится. guard worktree'а переходит в режим восстановления ADR-0053 п. 2: правка путей проекта — `deny`, reason называет версии. Выход — CLI не старше закрепления: собрать CLI основного checkout'а или поставить CLI тега на машину.
  - До этого Change ту же картину давал бы `cwd` основного checkout'а.
  - Без поля `cli` (LATTICE, глобальный CLI тега) хук и worktree исполняют один CLI.
- **Подъём через несуществующие каталоги.** `cwd` удалённого worktree'а внутри основного checkout'а находит основной checkout, как сейчас.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
| I-1 | Review spec раунда 1 (NOT_PROVEN, BLOCKER 1, MAJOR 5, MINOR 2, INFO 1, RUN-01M3Y3A3KMWF1ZJBZ113NPFHPM) закрыт правкой spec до раунда 2. F-1 (BLOCKER) — признак «`.warrant/warrant.json` между корнем и путём» снят. F-2 — допущение о `cwd` с источниками. F-3 — риск CLI основного checkout'а. F-6 — вход, который не разбирается, судится в каталоге процесса (норма и SCN-ENF-016). F-7 — относительный `cwd`, подъём без `realpath` через несуществующие каталоги — в норме. F-9 — пример Claude Code вынесен из нормы в design. Новый SCN-ENF-057 — `cwd` вне проектов | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
| I-2 | Review spec раунда 2 (NOT_PROVEN, BLOCKER 1, MAJOR 3, MINOR 2, INFO 1, RUN-01M3Y3T4KFRJWJAAAMHZY19YKJ) закрыт правкой spec до раунда 3. F-1 (BLOCKER) — проект события — checkout под WARRANT (`.warrant/warrant.json` и `.git`), каталог golden — часть проекта, SCN-ENF-059 (D1). F-2, F-3 (и F-4, F-5, F-8 раунда 1) — путь другого checkout'а вне проекта, под Run — `deny`, `cd` в него под `review` — выход из проекта, SCN-ENF-058 (D2). F-4 — REQ-ENF-005 в delta: вход, который не разбирается, в каталоге не под WARRANT — пустой stdout, код 0, SCN-ENF-021. F-5 — каталог процесса не под WARRANT в SCN-ENF-056. F-6 — абсолютный и относительный путь в SCN-ENF-057. F-7 — `cwd` входа подтверждён зондом `git-hook.js` (Context), довод о `cd` в D2 поправлен | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
