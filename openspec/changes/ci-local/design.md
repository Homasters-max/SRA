# Design: ci-local

## Context

База — `main` `20fa6d3`, CLI 0.10.0. Источник — [#143](https://github.com/Homasters-max/SRA/issues/143). Пути — от `packages/cli/src`.

- **`ctx.writes`** (`core/writes.ts`, REQ-KRN-034) — единственный путь записи состояния. `write(target, perform)`: `target` — путь от корня (POSIX) или `file://`-URI вне проекта. При `--dry-run` вызов только собирает цели.
- **Что пишет `warrant ci`.** `judgePullRequest` (`core/ci/judge.ts`) гоняет checks impl-PR, и каждый пишет через `ctx.writes`:
  - каталог `raw/` (`core/check/execute.ts` `runOneIn`: цель — каталог, внутри `rmSync`, `mkdirSync`, файлы вывода);
  - запись и `manifest.json` (`core/evidence/write.ts` `storeRecord`: файл записи, затем manifest, пересобранный по каталогу, I-203).

  Gates spec-PR считаются с `createWrites(true)` и не пишут ничего. Lock checks берётся и снимается вне `ctx.writes`. `--dry-run` у `ci` — только план, checks не запускаются.
- **Сигналы** — `ctx.signals.onInterrupt(cleanup)` (`core/ports/signals.ts`): синхронная уборка на SIGINT / SIGTERM / SIGHUP. Через него же снимается lock.
- **`ci fetch`** (`core/ci/fetch.ts` → `core/evidence/store.ts` `importRecords`): пишет новые записи и пересобирает manifest как `buildManifest(readManifest(dir), { evidence: [...listRecordIds(dir), ...ids] })`. Основа — manifest на диске, список — все записи каталога.
- **Git** — `ctx.git.contents(rev, paths)` (`core/ports/git.ts`) читает файлы ревизии.

## Goals / Non-Goals

**Goals:**
- локальный вердикт CI без остатка в рабочем дереве;
- manifest archive-PR без чужих остатков.

**Non-Goals:** `verify --no-record`; удаление остатков; пересборка manifest у `check` и `transition`.

## Decisions

### 1. Решения

- **D1. `restoringWrites()`** в `core/writes.ts` — `Writes`, который выполняет запись и запоминает, как было. Перед первым `perform` по цели снимается снимок:
  - цели не было — запоминаются и её предки, которых не было;
  - файл — его байты;
  - каталог — копия во временный каталог ОС (`cpSync`).

  `restore()` идёт по целям в обратном порядке. Каждая цель удаляется (`rmSync` recursive, force), затем снимок возвращается на место. Созданные командой пустые предки удаляются, глубокие первыми. Ошибка возврата — строка в stderr с путём, вердикт не меняется. `collected()` пуст, `dryRun: false`: для команды это обычная запись.
- **D2. `warrant ci --no-record`** (`commands/ci.ts`):
  - `ctx` с `restoringWrites()`, `ctx.signals.onInterrupt(restore)` на время вызова, `restore()` в `finally`;
  - вывод — вывод `runCi` плюс `data.no_record: true`;
  - `--no-record` с `--dry-run` — `USAGE` до чтения PR.

  Отдельная копия рабочего дерева (`git worktree add`) отвергнута: в ней нет `node_modules` и окружения checks проекта, и вердикт был бы другим.
- **D3. Manifest `ci fetch` из HEAD.** `fetch.ts` читает `.warrant/evidence/<change>/manifest.json` ревизии HEAD (`ctx.git.contents`) и передаёт его в `importRecords`. Новый manifest — `buildManifest(<manifest HEAD>, { evidence: [...evidence HEAD, ...ids] })`. Пишется, если записан хоть один файл записи или его `evidence[]` отличается от manifest на диске. Если manifest в HEAD нет (первый импорт), основа пуста. `WARRANT_STATE_DIR` у `ci fetch` запрещён, поэтому путь ровно этот.
- **D4. Версия.** Новый флаг — новая функциональность, minor по [ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 1, 3. Версию релиза решает maintainer ([#139](https://github.com/Homasters-max/SRA/issues/139#issuecomment-5950664575)). Этот Change версию не поднимает, если её уже поднял `guard-worktree`.

### 2. Риски

- **Прерывание сигналом, который не ловится** (SIGKILL, падение процесса): остаток, как сейчас. `--no-record` его не создаёт в штатном конце и на SIGINT / SIGTERM.
- **Большой `raw/` прошлого прогона** копируется во временный каталог. Это единицы мегабайт вывода checks, на один вызов.
- **Параллельная запись того же каталога другим процессом** во время `--no-record` будет откатана. Lock checks не даёт двум `check` писать одновременно, а `ci --no-record` идёт под тем же lock.
- **Последующая локальная запись** (`check`, `transition`) пересобирает manifest по каталогу (I-203) и снова перечислит остаток, если он есть. Против остатков работает `--no-record`, D3 защищает только `ci fetch`.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
