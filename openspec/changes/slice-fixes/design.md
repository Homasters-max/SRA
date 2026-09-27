# Design: slice-fixes

## Context

База — `main` на `v0.7.0` плюс документы (ADR-0040). Код CLI после `v0.7.0` не менялся, поэтому архитектурный вход — снимок
аудита [2026-09-26-phase-4c](../../../docs/process/audits/2026-09-26-phase-4c.md) (решение maintainer'а 2026-09-27, повторного
аудита нет).

Что уже есть:
- `openBlockingUnknowns` (`core/gates/l0/blocking-unknowns-resolved.ts`): элемент открыт, пока `resolution` пуст.
- Controller: правило pack `blocking-unknown` (`WAIT`, `next: clarify`); `warrant status` показывает решение controller.
- `scanIds` учитывает `unknowns[]` / `assumptions[]` records, `allocateSpecLevel` выдаёт `UNK-<AREA>-NNN`. Единственный
  вызывающий — `warrant id`. Все три места `AREA_UNKNOWN` — без `hint`.
- Record пишет `writeRecord` (`core/record/write.ts`): проверка схемы, `ctx.writes`, `assertNotFrozen`. `classify` пишет мимо него:
  `writeJsonFile` без проверки схемы, поэтому невалидный `--propose` попадает в record (BL-60).
- `judgeRefs` (`core/ci/refs.ts`) вызывается из `judgePullRequest` для каждого вида PR. `ForgePort` — четыре метода.
- Guard: `defaultPrefix` обрезает `run.command` на первом слове с `-`, поэтому `python -m pytest` → `python` (BL-61). Hint
  `deny` вне Run — всегда `warrant run start`, вне `write_scope` — `run finish` + `run start` (BL-56, BL-63).
- `archivePlan` берёт `ctx.clock.today()` — дата по UTC; `openspec archive` 1.13.1 — локальная дата (BL-64).
- `WorkflowRun` без имени workflow; hint восстановления — литерал `ci.yml` (BL-53).

Нормы:
- [ADR-0040](../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) — решения N59–N66;
- [ADR-0024](../../../docs/adr/WARRANT-ADR-0024-spec-approved-contract.md) п. 4;
- [ADR-0037](../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 5, 6;
- ADR-0025 (порты, уровни тестов), ADR-0030 / ADR-0035 (ранги, реестры, храповик);
- [02 §1](../../../docs/02-vocabulary.md) — `warrant unknown add | resolve`.

Ограничения:
- kernel-схемы остаются `major = 1`;
- после каждой группы зелёные `warrant validate`, `fmt --check`, `sync --check`, `versions:check`;
- guard основной сессии в этом репозитории не включается (ADR-0034 п. 4).

## Goals / Non-Goals

**Goals:**
- blocking UNKNOWN пишется и закрывается командой; `WAIT` исполним; решение закрывает вопрос только с ref на комментарий
  maintainer'а, и это проверяет CI;
- путь ADR-0024 п. 4 исполним под guard;
- отказы slice BL-53, BL-56 (hint), BL-58, BL-60, BL-61, BL-64 закрыты;
- швы `core/ci` (A-31, A-32, A-35, A-36) — до новой логики `core/ci`, как велит ADR-0039 п. 7.

**Non-Goals:** — proposal «Non-Goals».

## Decisions

### 1. Решения grilling (N59–N66)

Нормативные — в ADR-0040, здесь — сводка.

| # | Решение |
|---|---|
| N59 | Один Change, пять групп; CLI 0.8.0, `core-sdd` 0.3.4 (`kernel <0.9`) |
| N60 | `warrant unknown add \| resolve` по 02 §1; `resolved_as`, `ref` в `unknowns[]`; `assumption add` — BL-66 |
| N61 | Ref решения проверяет `warrant ci` через форж: форма, автор ∈ `roles.maintainer`, PR — spec-PR из ref `APPROVED`; пятый метод `ForgePort` |
| N62 | `write_scope` `implement` += `design.md`, `specs/**`; контроль — gate `spec-approved` + waiver |
| N63 | `MERGED` без `--by`; gate `human-approval` на `VERIFYING->MERGED` не вводится |
| N64 | Швы A-31, A-32, A-35, A-36; A-33 — строкой I-N; A-37 и BL-53 с группой 3; мелкие BL-60, BL-58, BL-64, BL-61, hint BL-56 |
| N65 | Pin в slice — руками maintainer'а; форма установки по BL-52 |
| N66 | Второй Change slice `rate-limiter-precision` — `WAIT` и путь waiver |

Уточнение N64 при записи spec: BL-58 — не предупреждение, а отказ `BASE_BEHIND_UPSTREAM` до записи (REQ-KRN-028).
Предупреждение после записи бесполезно: повторный `classify` запись не ослабляет, а исправить её средствами `warrant`
нельзя. Отказ дешевле пересчёта ошибочной записи, который остаётся Non-Goal.

### 2. Группа 1 — швы `core/ci` (без изменения поведения, кроме одного крайнего случая)

- **A-31** — новый `core/evidence/attestation.ts` (R1, реестр `helpers`):
  - `attestationOf(record) → { type, ref?, … }` — единственный читатель `json["attestation"]`. Через него идут семь
    читателей: `ciRefs`, `ciRef`, `recordsOf`, `mergedRules`, `judgeRefs`, `isApprovalBy`, `attestationAccepted`;
  - `ciRunKey(ref) → string | null` на `parseCiRef` (репозиторий в нижнем регистре, id run, попытка; нет попытки → `1`).
    `ciRunOf` и обе копии `normalRef` уходят;
  - `artifactName(change, attempt)` — `evidence-<change>-<attempt>`: пишет `impl.ts`, читают `archive.ts` и `fetch.ts`.
  Крайний случай: `…/runs/7` и `…/runs/7/attempts/1` теперь один run и для `transition MERGED` (раньше `REF_MISMATCH`), как
  уже было для `ci fetch` и archive-PR. REQ-VER-007 («записи одного run по `attestation.ref`») это не меняет: уточняется
  только равенство run. Тест — app `transition MERGED` с двумя формами ref одного run.
- **A-32** — в `core/record/lifecycle.ts` карта `CONFIRMED_BY: { APPROVED: { transition: "SPECIFIED->APPROVED", broughtBy:
  "SPECIFIED", pr: "spec" }, MERGED: { transition: "VERIFYING->MERGED", broughtBy: "VERIFYING", pr: "impl" } }`.
  `REF_REQUIRED_STATES` выводится из её ключей. `APPROVAL_AT`, `BROUGHT_BY_PR` (`core/ci/refs.ts`) и `pullRequestOf`
  (`commands/transition.ts`) читают её. Ключи объектных литералов в проверке `enum` `architecture.test.ts` — строкой
  backlog, не здесь.
- **A-35:**
  - `recordRel` (`core/ci/kind.ts`) заменяется на `recordPath`;
  - `evidenceRel(change)` в `core/evidence/store.ts` вместо четырёх литералов `.warrant/evidence/<change>` в `core/ci`;
  - обратный к `projectPath` помощник `absolutePath(root, rel)` в `core/fs.ts` — для `absoluteOf` ×2; остальные 14 мест — по
    мере правок (строка A-35 сужается).
- **A-36** — `isMergeKind(kind)` (`impl`, `archive`, `abandon`) в `core/record/lifecycle.ts`; исключение храповика
  `pr-kind` уходит вместе со строкой.
- **A-33** — ручная сборка `judgeImpl` остаётся (строка I-187); `EvaluateOptions.admit` удаляется. `Prepared.admit`
  остаётся: его задаёт только `judgeImpl`.
- Выход группы, как у `core-seams`: golden, `app`, `contract`, `e2e` без правок ожидаемых значений, кроме теста крайнего
  случая A-31; ни одной строки spec.

### 3. Группа 2 — `warrant unknown`

- **Модуль** `core/unknowns/` (R2, строка рангов `architecture.json`):
  - `addUnknown(record, { id, text, blocking })` и `resolveUnknown(record, id, { as, text, ref? })` — чистые функции над
    record, ошибки `UNKNOWN_NOT_FOUND` (hint — открытые id), `UNKNOWN_RESOLVED`;
  - id — `allocateSpecLevel(root, "UNK", area)`. Он уже учитывает records, поэтому номер уникален и для UNKNOWN, записанных
    раньше.
- **Команда** `commands/unknown.ts`, регистрация подкомандами `unknown add` и `unknown resolve` (как `run start`):
  - `readChangeRecord`, проверка состояния (`STATE_INVALID` с `hint`, `assertNotFrozen`), `writeRecord`, `withDryRun`;
  - вывод `data{ change, unknown, open_blocking[] }`;
  - `--help` с примером на каждую подкоманду.
  Порядок проверок `resolve`: форма (`--as`, `--ref`) → record → элемент → состояние. Ошибки формы не читают файлов.
- **Контракт CLI** (навык `cli-contract`):
  - коды: 0 — записано; 3 — `USAGE`, `AREA_UNKNOWN`, `UNKNOWN_NOT_FOUND`, `UNKNOWN_RESOLVED`, `STATE_INVALID`,
    `RECORD_FROZEN`;
  - каждая ошибка называет исправление в `hint`;
  - JSON стабилен и покрыт app-тестами SCN-KRN-148…153;
  - `--dry-run` печатает тот же `data.unknown`.
- **Схема** `change-record.1.schema.json`: у элемента `unknowns[]` появляются `resolved_as` (`enum` `decision`, `fact`,
  `assumption`), `ref` (`format: uri`, `^https?://`) и `dependentRequired: { resolved_as: [resolution], ref: [resolution] }`.
  Копия — `warrant sync`, golden — `npm run golden:update`.
- **Gate** `blocking-unknowns-resolved`: второй список `decisionsWithoutRef` → finding `DECISION_WITHOUT_REF`.
  `openBlockingUnknowns` не меняется, поэтому вход controller `blocking_unknowns` тот же. Решение без ref даёт `FAIL` gate,
  но не `WAIT clarify`: вопрос уже отвечен, не хватает доказательства.
- **`AREA_UNKNOWN`** в `allocate.ts` (два места) и `checkAreas` (`scan.ts`) получает `hint` — объявленные AREA и правку
  `.warrant/local/areas.json` человеком (BL-56, REQ-KRN-024).
- Коды `UNKNOWN_NOT_FOUND`, `UNKNOWN_RESOLVED` — в `core/errors.ts`.
- Alternatives:
  - отдельные `unknown list` и `show` — отвергнуто: `warrant status` и record уже показывают;
  - `--area` по умолчанию из единственной объявленной AREA — отвергнуто: неявное, а `hint` и так перечисляет AREA.

### 4. Группа 3 — решения UNKNOWN в `warrant ci`, A-37, BL-53

- **`ForgePort.comment(ref: CommentRef) → Promise<Comment | null>`**:
  - вход — `CommentRef { repository, pullRequest, kind: "issue" | "review", id }`;
  - выход — `Comment { author, pullRequest }`;
  - `ForgeGh`: `issue` — `gh api repos/<r>/issues/comments/<id>` (`user.login`, номер из `issue_url`); `review` —
    `gh api repos/<r>/pulls/<N>/reviews/<id>` (`user.login`, номер из `pull_request_url`); 404 → `null`.
  Уточняет ADR-0037 п. 6 (ADR-0040 п. 3).
- **`parseCommentUrl`** — рядом с `parsePullUrl` в `core/ci/refs.ts`: `…/pull/<N>#issuecomment-<id>` и
  `#pullrequestreview-<id>`; остальное → `form`.
- **`core/ci/decisions.ts`** — `judgeDecisions(ctx, subject, base, record, approvedPr?)`:
  - вызывается из `judgePullRequest` после `judgeRefs`;
  - `approvedPr` — номер PR из ref нового `APPROVED` (карта A-32);
  - проверяет элементы `blocking` + `resolved_as: "decision"`, причины `form`, `repository`, `missing`, `author`,
    `pull_request`;
  - с новым `APPROVED` — ошибки `REF_NOT_VERIFIED` (`RefReason` += `decision`), иначе — находки `DECISION_NOT_VERIFIED`;
  - `roles.maintainer` — из базы требований (ADR-0038).
- **Права job:** `issues: read` в `.github/workflows/ci.yml`. Комментарии PR — ресурс issues API, а `pull-requests: read`
  на него может не распространяться. В slice та же строка едет pin-Change'ем (ADR-0040 п. 7).
- **`FakeForge`** — `addComment`. **Контракт** `forge.contract.test.ts` — на настоящем комментарии maintainer'а в spec-PR
  этого Change (issue comment) и на review того же PR; id фиксируются задачей 3.3.
- **A-37** — `test/app/helpers/ci.ts`: `advance`, `pullRequest`, `artifactOf` из `ci.test.ts` и `ci-fetch.test.ts`;
  `codes` в e2e — из `helpers/synced.ts`; строки `test_helpers`.
- **BL-53** — `WorkflowRun.workflowPath` (поле `path` ответа `gh`, например `.github/workflows/warrant.yml`):
  - hint восстановления в `archive.ts` (×2) и `fetch.ts` называет `gh workflow run <basename>` по run head PR;
  - run нет — `gh workflow run <файл workflow с job warrant>` без литерала;
  - help `ci fetch` в `bin/warrant.ts` — без литерала.
- Alternatives:
  - проверять решения только на spec-PR — отвергнуто: связь с PR `APPROVED` видна лишь в impl-PR, а spec-PR до merge
    правится;
  - `ref` — URL PR, а не комментария — отвергнуто: не называет, кто решил.

### 5. Группа 4 — `write_scope` `implement` (BL-63)

- `writeScopeOf("implement")` = `codeScope` + `tasks.md`, `design.md`, `specs/**` каталога Change. `proposal.md` не входит.
- Context Pack не меняется: `items[]` уже содержит `design.md` и `specs/**`.
- Ожидания `write_scope` в `run.test.ts`, `guard.test.ts`, `frontend-claude.contract.test.ts`, `frontend-lifecycle.test.ts` —
  по delta REQ-ENF-002 (SCN-ENF-036); остальные SCN-ENF без правок.
- Путь ADR-0024 п. 4 под guard: Run `implement` → строка I-N в `design.md` и правка delta spec → `warrant waive` (агент,
  `PROPOSED`) → maintainer `--activate`. Шаг — в навыке `change-impl-pr` и в тексте процесса slice (pin-Change).
- Alternatives — ADR-0040: операция `amend`, только `design.md`.

### 6. Группа 5 — мелкие правки

- **BL-60** (`commands/classify.ts`):
  - `parseProposal` проверяет значения `risk` по порядку измерения (risk-levels подключённых packs, 05 §4) и `profiles` по
    объявленным profiles → `USAGE` с допустимыми значениями;
  - запись — через `writeRecord`: проверка схемы и `ctx.writes`.
  `--dry-run` у `classify` не добавляется (Non-Goal).
- **BL-58:**
  - `GitPort.upstreamAhead(base) → { upstream, ahead } | null` (`git rev-parse --abbrev-ref <base>@{upstream}`,
    `git rev-list --count <base>..<upstream>`);
  - `ahead > 0` → `BASE_BEHIND_UPSTREAM` до записи (§1, REQ-KRN-028). Без upstream или без git (`--paths`) проверка не
    выполняется;
  - контракт `GitPort` — на временном репозитории с upstream.
- **BL-64:**
  - `ClockPort.localToday()` — локальная дата процесса (`getFullYear` / `getMonth` / `getDate`, как `formatLocalDate`
    OpenSpec);
  - `archivePlan` берёт её, `today()` (UTC) остаётся у остальных;
  - unit — дочерний процесс с `TZ=Etc/GMT-3` на `2026-09-26T22:54:00Z`; app — `FakeClock` (SCN-KRN-147).
- **BL-61** (`core/guard/shell.ts`) — `defaultPrefix` сохраняет `-m <модуль>` сразу после первого слова (SCN-ENF-037);
  `guard_prefixes` проекта по-прежнему сильнее.
- **BL-56 hint** (`core/guard/decide.ts`):
  - `writableByRun(path, config)` — под `codeScope` или `openspec/changes/**` вне `archive/`;
  - для `deny` пути вне него `editWithRun` и `editWithoutRun` дают hint «правку делает человек (maintainer) в Change
    `factory-change`, ADR-0040 п. 7» вместо `run start` / `run finish` (SCN-ENF-038).
- Коды `BASE_BEHIND_UPSTREAM` — в `core/errors.ts`; находки `DECISION_WITHOUT_REF`, `DECISION_NOT_VERIFIED` — в реестре кодов
  находок, если он есть у владельца gate / `ci`.

### 7. Версии, навыки, документы

- Bump первой задачей: CLI `0.8.0`; pack `core-sdd` `0.3.4` с `kernel: ">=0.1 <0.9"`; 7 fixture-packs, `.warrant/warrant.json`
  `kernel: "0.8"`, `warrant.lock.json` репозитория и golden-фикстур — как задача 1.1 `phase-4c` (REQ-SDD-001).
- Навыки:
  - `change-spec-pr` — blocking UNKNOWN: `warrant unknown add --blocking`, решение — комментарий maintainer'а в PR, затем
    `unknown resolve --as decision --ref`;
  - `change-impl-pr` — правка spec в Run `implement` по ADR-0024 п. 4.
- Документы:
  - 04 §10 — синтаксис `warrant unknown`, `assumption add` — позже;
  - 06 §4 — `blocking-unknowns-resolved` с `ref` решения;
  - `backlog.md` — закрыть A-31…A-33, A-35…A-37, BL-53, BL-59…BL-61, BL-63, BL-64; сузить A-35 (14 мест), BL-56 (без hint),
    BL-58 (без пересчёта и `--dry-run`).

### 8. Порядок групп

Группы 1 → 2 → 3 → 4 → 5, по одному коммиту на группу. Группа 3 зависит от 1 (карта A-32, attestation) и 2 (поля
`resolved_as`, `ref`); группы 4 и 5 независимы.

### 9. Dogfooding

- Этот Change — первый, чей record может нести UNKNOWN через команду. Команда появится только в impl-PR, поэтому в spec-PR
  UNKNOWN записать нечем: открытые вопросы решены grilling (ADR-0040).
- Проверка — вторым малым Change slice (`rate-limiter-precision`, ADR-0040 п. 8) после тега `v0.8.0` и pin-Change.

## Risks / Trade-offs

- [`GITHUB_TOKEN` без `issues: read` не читает комментарий] → строка прав в `ci.yml` и в pin-Change slice; сбой — `FORGE_UNAVAILABLE`,
  не ложный `PASS`.
- [Решение в review-комментарии без текста] → `pullrequestreview` принимается: review — тоже решение maintainer'а, текст
  ответа хранит `resolution`.
- [Комментарий maintainer'а удалён после `APPROVED`] → причина `missing` на следующем impl-PR; ref переходов прошлого PR
  `warrant ci` не пересчитывает (N44), остаточный риск тот же.
- [Отказ `BASE_BEHIND_UPSTREAM` без сети] → проверка только по локальному upstream: устаревший `origin/main` не ловится, но
  и ложного отказа нет.
- [`write_scope` `implement` шире — агент правит spec без решения] → `spec-approved` `FAIL` до waiver, который активирует
  maintainer; finding с путями виден в impl-PR.
- [Kernel 0.8 — `LOCK_MISMATCH` у проектов на 0.7] → `hint` `warrant sync`; в slice — шаг pin-Change.

## Migration Plan

1. **Spec-PR:** артефакты, record, `classify`, review субагентом; `transition SPECIFIED` по «merge #N».
2. **Impl-PR:** первым коммитом `APPROVED --ref <URL spec-PR> --by` и `IMPLEMENTING`; группы 1–5 и закрывающая; последним —
   `VERIFYING`. Вердикт — job `warrant`.
3. **Archive-PR:** `warrant ci fetch <impl-PR>`, `transition MERGED --ref <URL impl-PR>`, `warrant archive slice-fixes`, tag
   `v0.8.0`, `npm link`.
4. **Откат:** `git revert` группы; схема `change-record/1` аддитивна, records без новых полей валидны.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-187 | A-33 ([ADR-0040](../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 6): `judgeImpl` собирает оценку вручную — `admit` зависит от записей этого запуска и не выражается опцией `evaluate`; мёртвая `EvaluateOptions.admit` удалена | §2 |
