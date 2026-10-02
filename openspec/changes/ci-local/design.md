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
  - **`restore()`** зовётся один раз, после конца последнего check (дерево его процессов завершено) и до вывода. Он идёт по целям в обратном порядке: цель удаляется (`rmSync` recursive, force), снимок возвращается — файл атомарной записью (REQ-KRN-036), каталог копией. Созданные пустые предки удаляются, глубокие первыми.
  - Ошибка возврата — путь в `notRestored()`.
  - Другой писатель того же `<state>` во время прогона не поддерживается: его запись в цели этой команды откатывается. Отпечаток цели (раунд 1) снят: `raw/` дописывает дочерний процесс check, а `manifest.json` переписывается на каждый check, и сравнение отпечатков давало ложные «изменено другим» и пропуски (review раунда 2, F-1, F-2). Lock на весь прогон тоже отвергнут: checks с `exclusive` берут тот же lock сами, и вложенный захват дал бы `BUSY`.
  - `collected()` пуст, `dryRun: false`: для команды это обычная запись.
- **D2. `warrant ci --no-record`** (`commands/ci.ts`):
  - до чтения PR: с `--dry-run` или при `GITHUB_ACTIONS=true` — `USAGE`;
  - иначе `ctx` с `restoringWrites()`, `ctx.signals.onInterrupt(restore)` на время вызова (при сигнале невозвращённые пути — строками в stderr), `restore()` в `finally`;
  - вывод — вывод `runCi` плюс `data.no_record: true` и `data.not_restored[]`, у ошибок тоже.

  Отдельная копия рабочего дерева (`git worktree add`) отвергнута: в ней нет `node_modules` и окружения checks проекта, и вердикт был бы другим.
- **D3. `data.untracked[]` у `ci fetch`.**
  - `fetch.ts` читает `.warrant/evidence/<change>/manifest.json` ревизии HEAD (`ctx.git.contents`); манифест, который не разбирается или которого нет, — пустой список.
  - `importRecords` возвращает записи каталога, которых нет ни в нём, ни среди записей попытки — в том числе уже лежащих с тем же содержимым; список — в порядке кодовых единиц, при непустом — `hint`: удалить (человек) и повторить `ci fetch`.
  - Manifest пересобирается по каталогу (REQ-KRN-021 п. 12) и пишется и тогда, когда новых файлов записей нет, но `evidence[]` отличается от каталога: повтор после удаления остатка его убирает (review раунда 2, F-3; путь «удалить и повторить» выбран из трёх в D-1 раунда 2 — он не требует правки kernel и не коммитит остаток).

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
| I-3 | Review spec раунда 3 (PROVEN, MAJOR 2, MINOR 5, INFO 2, RUN-01M3YCK38C0AGWH2RNBQQFWV4R) закрыт правкой spec и раундом 4 — последним (прецедент I-249): F-1 — записи из `evidence[]` переходов record — не остаток; F-2 — `hint` в находке `EVIDENCE_UNTRACKED` `data.findings[]`; F-3 — SCN-VER-097, 104 в задаче 2.2; F-4 — proposal о другом писателе; F-5 — `artifact.path` после команды прежний; F-6 — неснятый снимок — `INTERNAL` до записи; F-7 — manifest HEAD без файла — пустой `evidence[]`; F-8 — `gates` manifest после `ci fetch` переносятся, как прежде (`buildManifest`), и их перепроверяет `transition`; F-9 — CHANGELOG «Вердикт» и «Миграция» (задача 3.1) | `specs/**`, `proposal.md`, `tasks.md`, `design.md` |
| I-2 | Review spec раунда 2 (NOT_PROVEN, BLOCKER 1, MAJOR 2, MINOR 6, INFO 1, RUN-01M3YC46G97BVNB9QP7H2S4NEZ) закрыт правкой spec до раунда 3. F-1 (BLOCKER), F-2 — отпечаток снят: `restore()` после последнего check, другой писатель не поддерживается (D1). F-3 — manifest переписывается, если отличается от каталога; `hint` «удалить и повторить», SCN-VER-156 с повтором (D3). F-4 — возврат файла атомарный. F-5 — при сигнале — stderr. F-6 — `CHECK_TIMEOUT` в SCN-VER-154. F-7 — `untracked[]` под `--dry-run`, не в ошибке. F-8 — порядок кодовых единиц. F-9 — гарантия SCN-VER-154 — `.warrant/`, gate назван. F-10 — ветка влила `main` с ADR-0056 | `specs/**`, `design.md` |
| I-1 | Review spec раунда 1 (NOT_PROVEN, BLOCKER 2, MAJOR 6, MINOR 4, INFO 2, RUN-01M3YBHGQ62WJGRSP8AZS4RTC3) закрыт правкой spec до раунда 2. F-1 (BLOCKER) — manifest по-прежнему ровно каталог, `ci fetch` называет остатки в `data.untracked[]` (D3). F-2 (BLOCKER) — сравнение SCN-VER-154 по полям вердикта, id записей новые. F-3 — отпечаток цели вместо lock (D1). F-4 — гарантия — цели `ctx.writes`. F-5 — `data.not_restored[]`. F-6 — `USAGE` в GitHub Actions. F-7 — утверждения proposal сужены. F-8 — записи попытки, включая лежащие. F-9 — manifest HEAD, который не разбирается. F-10 — пути записей названы. F-11 — `data.no_record` у каждого вывода. F-12 — исключение из синопсиса REQ-VER-011, строка backlog. F-13 — локальный исход `ATTESTATION_REQUIRED` (Context, 06 §8). F-14 — риск Windows | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
