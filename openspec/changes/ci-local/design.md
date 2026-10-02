# Design: ci-local

## Context

База — `main` `20fa6d3`, CLI 0.10.0. Источник — [#143](https://github.com/Homasters-max/SRA/issues/143). Пути — от `packages/cli/src`.

- **`ctx.writes`** (`core/writes.ts`, REQ-KRN-034) — единственный путь записи состояния. `write(target, perform)`: `target` — путь от корня (POSIX) или `file://`-URI вне проекта. При `--dry-run` цели только собираются.
- **Что пишет `warrant ci`.** `judgePullRequest` (`core/ci/judge.ts`) гоняет checks impl-PR, и каждый пишет через `ctx.writes`:
  - каталог `raw/` (`core/check/execute.ts` `runOneIn`: цель — каталог, внутри `rmSync`, `mkdirSync`, файлы вывода);
  - запись и `manifest.json` (`core/evidence/write.ts` `storeRecord`: файл записи, затем manifest, пересобранный по каталогу, I-203).

  Ещё два факта:
  - Gates spec-PR считаются с `createWrites(true)` и не пишут ничего.
  - Lock checks берётся только у checks с `execution.exclusive: true` и снимается до `storeRecord` (`execute.ts`): прогон `ci` целиком под lock не идёт.
- **Сигналы** — `ctx.signals.onInterrupt(cleanup)` (`core/ports/signals.ts`): синхронная уборка на SIGINT / SIGTERM / SIGHUP.
- **Локально** записи несут `attestation.type: "none"`, и gates L1 impl-PR дают `BLOCKED` `ATTESTATION_REQUIRED`, код 1 — ожидаемый исход отладки (REQ-VER-011). Локальный судья полезен вердиктами L0, нарушениями PR и `scope`.
- **Manifest** перечисляет ровно записи каталога: `validate` проверяет это (REQ-KRN-021 п. 12). `ci fetch` (`core/ci/fetch.ts` → `core/evidence/store.ts` `importRecords`) пересобирает его из каталога и импорта.

## Goals / Non-Goals

**Goals:** локальный вердикт CI без остатка в состоянии WARRANT; `ci fetch` называет остатки.

**Non-Goals:** `verify --no-record`; удаление остатков; смена REQ-KRN-021; файлы checks вне `{out}`.

## Decisions

### 1. Решения

- **D1. `restoringWrites()`** в `core/writes.ts` — `Writes`, который выполняет запись и запоминает, как было.
  - **Снимок** снимается перед первым `perform` по цели:
    - цели не было — запоминаются и её предки, которых не было;
    - файл — его байты;
    - каталог — копия во временный каталог ОС (`cpSync`).
  - **После каждого `perform`** запоминается отпечаток цели: байты файла или список файлов каталога с размерами и временем.
  - **`restore()`** идёт по целям в обратном порядке. Цель, чей отпечаток совпадает с запомненным, удаляется (`rmSync` recursive, force), и на её место возвращается снимок. Созданные пустые предки удаляются, глубокие первыми.
  - Цель, которую после записи изменил другой процесс (отпечаток другой), не трогается. Она и цель, которую вернуть не удалось, — в `notRestored()`.
  - `collected()` пуст, `dryRun: false`: для команды это обычная запись. Lock на весь прогон отвергнут: checks с `exclusive` берут тот же lock сами, и вложенный захват дал бы `BUSY` (review раунда 1, F-3).
- **D2. `warrant ci --no-record`** (`commands/ci.ts`):
  - до чтения PR: с `--dry-run` или при `GITHUB_ACTIONS=true` — `USAGE`;
  - иначе `ctx` с `restoringWrites()`, `ctx.signals.onInterrupt(restore)` на время вызова, `restore()` в `finally`;
  - вывод — вывод `runCi` плюс `data.no_record: true` и `data.not_restored[]`, у ошибок тоже.

  Отдельная копия рабочего дерева (`git worktree add`) отвергнута: в ней нет `node_modules` и окружения checks проекта, и вердикт был бы другим.
- **D3. `data.untracked[]` у `ci fetch`.**
  - `fetch.ts` читает `.warrant/evidence/<change>/manifest.json` ревизии HEAD (`ctx.git.contents`); манифест, который не разбирается или которого нет, — пустой список.
  - `importRecords` возвращает записи каталога, которых нет ни в нём, ни среди записей попытки — в том числе уже лежащих с тем же содержимым.
  - Manifest пересобирается, как раньше (REQ-KRN-021 п. 12).

  Буквальное «перечислять только импортированное» отвергнуто: остаток лежит в каталоге, и `validate` на manifest без него даёт находку, код 3 (review раунда 1, F-1). Отказ `ci fetch` при остатке тоже отвергнут: guard потребителя не даёт агенту удалить запись, и archive-PR встал бы до акта человека.
- **D4. Версия** — 0.10.1 по [ADR-0056](../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md). Этот Change версию не поднимает, если её уже поднял первый impl-PR из пяти.

### 2. Риски

- **Неперехватываемое прерывание** (SIGKILL, падение процесса) оставляет остаток, как сейчас.
- **Дерево процессов check на Windows** гасится асинхронно и может дописать `raw/` после `restore()`. Такой `raw/` остаётся. На штатном конце дерево уже завершено.
- **Большой `raw/` прошлого прогона** копируется во временный каталог — единицы мегабайт вывода checks на вызов.
- **Последующие локальные записи** (`check`, `transition`, `archive`) пересобирают manifest по каталогу, и остаток входит в него, как раньше. От этого защищают `--no-record` и `data.untracked[]`.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
| I-1 | Review spec раунда 1 (NOT_PROVEN, BLOCKER 2, MAJOR 6, MINOR 4, INFO 2, RUN-01M3YBHGQ62WJGRSP8AZS4RTC3) закрыт правкой spec до раунда 2. F-1 (BLOCKER) — manifest по-прежнему ровно каталог, `ci fetch` называет остатки в `data.untracked[]` (D3). F-2 (BLOCKER) — сравнение SCN-VER-154 по полям вердикта, id записей новые. F-3 — отпечаток цели вместо lock (D1). F-4 — гарантия — цели `ctx.writes`. F-5 — `data.not_restored[]`. F-6 — `USAGE` в GitHub Actions. F-7 — утверждения proposal сужены. F-8 — записи попытки, включая лежащие. F-9 — manifest HEAD, который не разбирается. F-10 — пути записей названы. F-11 — `data.no_record` у каждого вывода. F-12 — исключение из синопсиса REQ-VER-011, строка backlog. F-13 — локальный исход `ATTESTATION_REQUIRED` (Context, 06 §8). F-14 — риск Windows | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
