# Design: phase-4c

## Context

База — `main` на `v0.6.0` (`phase-4b` закрыт). Что уже есть:
- producers `adversarial-review` (`run submit`) и `analyze-clean` (`core/analyze`);
- пред-фильтр с `spec_tree`, общий сборщик evidence (A-23);
- `transition MERGED` с `--commit` / `--ref` и правилом одного run (`assertRunRef`);
- job `evidence` в `ci.yml` на head `worktree/*`, шаг «specs только через archive-PR» по имени ветки.

Порта форжа нет; `gh` на машине maintainer'а авторизован, на runner'ах GitHub предустановлен.

Нормы:
- [ADR-0037](../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md): `subject.tree`, `STALE` `tree`, merge считает job,
  восстановление — `workflow_dispatch`, ref подтверждения — слитый PR, `ForgePort` из четырёх методов, I-169;
- [ADR-0034](../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 9, 12–14; ADR-0010 (CI не пишет, доверие по ссылке);
- ADR-0011 (топология PR); ADR-0025 (порты, контракт на настоящем GitHub); ADR-0030 / ADR-0035 (ранги, реестры, храповик).

Аудит [2026-09-26-phase-4b](../../../docs/process/audits/2026-09-26-phase-4b.md): A-28 и A-29 — первой группой, A-30 — с
тестами `ci`.

Ограничения:
- kernel-схемы остаются `major = 1`;
- `warrant validate` репозитория зелёный после каждой группы;
- CI не коммитит и не пушит;
- guard основной сессии в этом репозитории не включается (ADR-0034 п. 4).

## Goals / Non-Goals

**Goals:**
- Критерий 4c ([13 §2](../../../docs/13-roadmap.md)): verdict impl-PR в CI без ручного переноса artifact'а; archive-PR получает
  evidence командой `ci fetch` и проверяется по ссылке; spec-PR 4c — первый без пары waivers.
- Evidence merge судит то, что влито в `main` (R-12); specs меняются только результатом archive — по record (R-16).
- Правила `MERGED` и чтение `subject` — по одному владельцу до того, как `ci` и `ci fetch` добавят к ним копии (A-28, A-29).

**Non-Goals:** — proposal «Non-Goals»: полное INV-03, branch protection, evidence на каждый push, `paths.tests` репозитория,
таблица gates, slice.

## Decisions

### 1. Решения grilling (N29–N47)

Нормативные — в ADR-0037, здесь — сводка и детали без нормы.

| # | Решение |
|---|---|
| N29 | Объём: ядро CI (R-12, R-16, BL-7, BL-12); A-28, A-29 первой группой, A-30 — с тестами `ci`; R-20, R-21, BL-26 (SCN-SDD-001), BL-40, BL-42, BL-43, I-169. R-22 и BL-41 — только если правится `core/sync/claude.ts` |
| N30 | `STALE` — причина пред-фильтра `reason: "tree"`, не статус; реестр `evidence-status` не меняется (ADR-0037 п. 1) |
| N31 | CI-запись: `commit` — head PR, `base_commit` — tip базы, `tree` — дерево результата merge; допуск по `commit` и дереву вместо `base_commit` (п. 2) |
| N32 | Результат merge считает job, Re-run до merge лечит `STALE` (п. 3) |
| N33 | Одна команда `warrant ci`, вид PR по `change_state` record из diff; два Change — `TOPOLOGY_VIOLATION`. Уточнение при записи spec: флага `--base` нет — HEAD обязан быть результатом merge, база и head — его родители (§4) |
| N34 | impl-PR: checks `VERIFYING->MERGED` на результате merge, evidence в рабочую копию, artifact; нарушение — gate `FAIL`/`BLOCKED`, кроме gates `human-approval` (`deferred[]`). Job `warrant` на всех PR |
| N35 | archive-PR: run принадлежит репозиторию, head sha, `conclusion`, повторное скачивание artifact'а и побайтовое сравнение; R-16 — повтор `openspec archive` на дереве первого родителя |
| N36 | Ref подтверждения — URL слитого PR, `merged_by ∈` роль; `merged_by = author` — `APPROVER_IS_AUTHOR`, не отказ (п. 5) |
| N37 | BL-42 — правило путей spec-PR в `warrant ci`; BL-43 — `analyze` через `findChangeDir` с архивом |
| N38 | I-169 — статус-кво (п. 7) |
| N39 | BL-40 — находка `REVIEWER_SKILL_MISSING` в `data.findings[]` `sync`, код 0 |
| N40 | После merge — `workflow_dispatch` со входом `merge_commit` (п. 4) |
| N41 | `ci fetch` выбирает run по head sha, `success` и `subject.tree` = дерево M; иначе `NO_CI_EVIDENCE` с `hint` |
| N42 | `transition MERGED --ref` — URL impl-PR; run — из записей; `--commit` — head (п. 5) |
| N43 | `ForgePort`: `pullRequest`, `workflowRun`, `listRuns`, `downloadArtifact` (п. 6) |
| N44 | Переходы из diff: gates без `requires_evidence` пересчитываются на оцениваемом commit перехода, записи `evidence[]` — существуют и допустимы; сверка с `gates` record. Следующий переход impl-PR — полный L0/L1 |
| N45 | `owner/repo` — `GITHUB_REPOSITORY` или URL `origin`; токен — `gh`; ключа `forge` в `warrant.json` нет |
| N46 | ADR-0037 едет в spec-PR 4c |
| N47 | spec-PR не трогает `paths.src`, `paths.tests`, `openspec/specs/**`, чужие Changes и их состояние, policy-пути; документы разрешены |

### 2. Первая группа — швы (без изменения поведения)

- **A-28** — в `core/evidence/record.ts`:
  - тип `EvidenceSubject { commit, baseCommit?, specRevision?, specTree?, tree? }` и `subjectOf(record)` рядом с писателем
    `evidenceSubject`;
  - четыре читателя через него: `staleReason`, `approvalOf`, `specTreeFacts`, `mergedCommit`;
  - строка `helpers`.
  `tree` пока не добавляется: писатель и читатель получают его одним изменением в группе 2.
- **A-29** — в `core/transition/merged.ts` (R2):
  - `mergedCommit(ctx, change, requested)`;
  - `ciRunOf(records) → { ref } | { mismatched[] }` — общий для `transition MERGED`, `ci` и `ci fetch`;
  - `assertOneRun`.
  `ensureApproval` переезжает в `core/evidence/approval.ts` к `buildApprovalRecord`. В `commands/transition.ts` остаются опции,
  выбор перехода и вывод; fan-out файла — меньше 17.
- Выход группы, как у `core-seams`: golden, `app`, `contract`, `e2e` без правок ожидаемых значений; ни одной строки spec.

### 3. `subject.tree`, пред-фильтр, `transition MERGED`

- **Схема.** `evidence.1.schema.json`: `subject.tree` — `^[0-9a-f]{40}([0-9a-f]{24})?$`. Копия в `.warrant/schemas/`, golden —
  `npm run golden:update`.
- **Писатель.** `evidenceSubject` получает `tree` только от `warrant ci`. Локальный `check` и `verify` дерево не пишут: их
  запись судится по `commit` и `base_commit`, как раньше.
- **Пред-фильтр.** `PrefilterContext.mergeTree?: Availability<string>` — дерево результата merge оцениваемого commit:
  - в `warrant ci` при оценке следующего перехода impl-PR (оцениваемый commit — HEAD^2) — `HEAD^{tree}`;
  - во всех остальных случаях (`transition`, `gate`, `verify`, `replay` в `ci`) — `M^{tree}` merge-коммита M на first-parent
    линии HEAD (в `ci` — HEAD^1), чей второй родитель — оцениваемый commit; поиск M — общий с `mergedCommit` (A-29);
  - M нет — запись с `tree` получает `STALE` `tree` «результата merge нет».
  Так `gate` и `verify` в archive-ветке предсказывают `transition MERGED` (находка F-29 review).
  Порядок в `staleReason`: `spec_tree`, затем `commit`; для записи с `tree` — сравнение дерева вместо `base_commit`; дальше
  `threshold`, `scoped:`, waivers, как раньше.
- **`transition MERGED`:**
  - `--ref` проверяется по форме URL pull request (`/<owner>/<repo>/pull/<N>`);
  - правило одного run — `ciRunOf` по записям verdicts, без сравнения с `--ref`;
  - код `REF_MISMATCH` сохраняется, меняется только смысл: два run вместо «не тот run».
  Для `APPROVED` форма `--ref` та же (URL spec-PR). Так dogfooding и делает с фазы 3, и новое ограничение ничего не ломает.
- **R-21.** `analyzeFacts` (`core/transition/facts.ts`) и `ownState` (`core/run/state.ts`) читают файлы через
  `git.contents(commit, …)` оцениваемого commit, а не рабочее дерево. На `transition MERGED` в archive-ветке рабочее дерево
  — это не head impl-PR.
- Alternatives:
  - `tree` у каждой записи, в том числе локальной — отвергнуто: локальный прогон не знает результата merge;
  - сравнивать дерево head вместо дерева merge — отвергнуто: не судит сдвиг `main` (R-12).

### 4. `warrant ci`

Модули `core/ci/` (R2); `commands/ci.ts` — опции и вывод.

- **`kind.ts`** — вход: результат merge.
  - HEAD — merge-коммит с двумя родителями (`GitPort.parents`), иначе `USAGE`;
  - diff `HEAD^1..HEAD`; records Changes в diff; вид — по `change_state` record на HEAD;
  - разбор переходов — через владельца `core/record/lifecycle.ts`, а не разбором JSON в `ci` (аудит §3.4).
  Флага `--base` нет (уточнение N33): база и head определяются родителями HEAD — в CI это делает job, в режиме восстановления
  это сам M. Локально для отладки: `git merge --no-ff` в detached HEAD и `warrant ci`.
- **`replay.ts`** — пересчёт переходов из diff.
  - Префикс `transitions[]` сохранён и `change_state` равен `to` последнего перехода, иначе `RECORD_MISMATCH`; удалённый record —
    тоже `RECORD_MISMATCH`.
  - Оцениваемый commit нового перехода:
    - для `MERGED` — по REQ-VER-007 (`mergedCommit` через `subject.commit` записей);
    - для остальных — родитель коммита, внёсшего запись перехода. Его находит обход коммитов `HEAD^1..HEAD^2`, меняющих файл
      record (`GitPort.log(range, path)`), с чтением record на каждом (`git.contents`); переходы одного коммита делят его.
  - `branch-isolated` не пересчитывается: он судит ветку окружения, а в CI и во временном worktree ветки нет (F-1).
  - Gates без `requires_evidence` вычисляются тем же `evaluate`, что у `transition`, во временном detached worktree этого
    commit (`GitPort.worktreeAt(commit) → { root, dispose }`): L0-калькуляторы вроде `required-artifacts-present` зовут
    `openspec` по рабочему дереву.
  - Gates с evidence сверяют существование и допуск записей `evidence[]`; L1 заново не прогоняется (ADR-0010 п. 3: заново
    считается только merge-вердикт).
- **`refs.ts`** — `ref` новых переходов (`APPROVED`, `MERGED`):
  - `ForgePort.pullRequest(n)` — PR этого репозитория (URL сверяется с `owner/repo`), `merged`,
    `mergedBy ∈ roles.maintainer` (ADR-0037 п. 5; `approvals[]` у `MERGED` есть не при любом риске);
  - связь с Change: для `APPROVED` — diff `mergeCommit^1..mergeCommit` вносит переход `SPECIFIED` в record этого Change; для
    `MERGED` — `mergeCommit = M`, `headSha` = оцениваемый commit;
  - `mergedBy === author` — `APPROVER_IS_AUTHOR`.
- **Виды:**
  - **Общее правило путей:** собственное состояние (`ownState`) разрешено всюду; `openspec/specs/**` — только в archive-PR с
    новым `ARCHIVED` и равенством повтору archive (ADR-0034 п. 13).
  - **spec** — пути diff против запрещённого множества N47 за вычетом `ownState`. Policy-пути — `policyPaths(loaded)` (A-24),
    чужие Changes — через `otherState` (`core/run/state.ts`, N27 4b) и `openspec/changes/<other>/**`. Без `paths.src` и
    `paths.tests` (так в этом репозитории) проверка кода — `skipped[]`: BL-42 для WARRANT держат остальные запреты. Gates
    `SPECIFIED->APPROVED` — в `data.gates` информационно.
  - **impl** — `runVerify` (`VERIFYING->MERGED`) с оцениваемым commit HEAD^2, base `merge-base(HEAD^1, HEAD^2)` и `mergeTree` =
    `HEAD^{tree}`; checks — на рабочем дереве HEAD, evidence в `<state>` рабочей копии, `data.artifact` называет каталог для
    upload. Ошибки checks — код 3, как у `verify`.
    Нарушение — каждый gate `FAIL`/`BLOCKED`, кроме `deferred[]`: gate, чьи `requires_evidence` — только `human-approval`
    (константа владельца `core/evidence/approval.ts`). Плюс `CHANGE_NOT_VERIFYING`. `FRONTEND_HOOKS_INACTIVE` приходит из
    `verify`, как сейчас.
  - **archive** — §5.
  - **abandon** — `replay` и пути: только `ownState` и удаление `openspec/changes/<change>/**`.
  - **none** — `openspec/changes/**`, `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**` и policy-пути в diff —
    `SCOPE_VIOLATION`. История репозитория: все правки `.warrant/**` шли в Changes, process-PR их не трогают.
- **Коды выхода.** Нарушения — `errors[]` с `hint` и код 1. Ошибки конфигурации и форжа — код 3. Код controller'а на `ci` не
  проецируется: `WAIT` при `BLOCKED` gate — это нарушение, код 1. У CI нет «подожди», есть «не сливать».
- **`--dry-run`** — `kind.ts` и план checks; ни checks, ни форжа.
- Alternatives:
  - подкоманды по видам PR — отвергнуто: источником вида снова стал бы флаг или ветка (R-16);
  - пересчёт L1 прошлых переходов — отвергнуто: тесты на каждом старом коммите, а ADR-0010 п. 3 требует заново только
    merge-вердикт;
  - `--base <sha>` — отвергнуто при записи: второй источник базы рядом с родителями HEAD.

### 5. archive-PR и `ci fetch`

- **Проверка CI-записей** (`core/ci/archive.ts`). Для записей `evidence[]` перехода `MERGED` с `attestation.type: "ci"`:
  - `ForgePort.workflowRun(id из attestation.ref)`: `repository` = `owner/repo`, `conclusion = success`; для `event:
    pull_request` — `headSha = subject.commit`. У run `workflow_dispatch` head sha — tip ветки запуска: его связь с M держат
    `subject.tree` записи (пред-фильтр на дереве M) и побайтовое равенство artifact'у (F-5);
  - `ForgePort.downloadArtifact(run, "evidence-<change>")` → каталог; файл `<EVID>.json` побайтно равен закоммиченному.
  Одна загрузка на run.
- **R-16.** `worktreeAt(HEAD^1)` → `openspec archive <change> --yes` (порт `openspec`) → дерево `openspec/specs/**` сравнивается
  с HEAD (`git.contents`) по путям и блобам. Имя каталога архива с датой не сравнивается. Отдельного пересчёта gates
  `MERGED->ARCHIVED` на HEAD нет: переход `ARCHIVED` пересчитывает `replay` на его оцениваемом commit (F-3; после BL-43
  `analyze-clean` там вычисляется).
- **`ci fetch <pr>`** (`core/ci/fetch.ts`, `commands/ci.ts`):
  - `pullRequest(n)`: `merged`, `mergeCommit`; M с двумя родителями, иначе `PR_NOT_MERGED`;
  - Change — из diff record `M^1..M` (`kind.ts`);
  - кандидаты — `listRuns({ headSha: M^2, event: "pull_request" })` и `listRuns({ event: "workflow_dispatch", createdAfter:
    mergedAt })`, `conclusion: success`, новые первыми; `downloadArtifact` → записи с `attestation.ref` = URL run, все с
    `subject.commit = M^2` и `subject.tree = M^{tree}`; берётся первый подходящий run, run без artifact — `skipped[]`;
  - запись — `importRecords` владельца `core/evidence/store.ts`: только записи выбранного run, побайтно, проверка схемой,
    id — в локальный manifest; `manifest.json` и `raw/` artifact'а не импортируются; тот же id с тем же содержимым —
    пропуск (повторный `ci fetch` идемпотентен);
  - коллизия id — `EVIDENCE_CONFLICT`.
  Нет подходящего run — `NO_CI_EVIDENCE` с `hint` `gh workflow run ci.yml -f merge_commit=<M>`.
- Alternatives:
  - доверять метаданным run без повторного скачивания — отвергнуто N35;
  - `ci fetch` берёт последний run — отвергнуто N41: положил бы заведомо `STALE`.

### 6. `ForgePort`

- **`core/ports/forge.ts`** (R0, седьмой порт `Ctx`):
  - `pullRequest(number) → { number, url, author, merged, mergedAt, mergedBy, mergeCommit, headSha }`;
  - `workflowRun(id) → { id, url, repository, event, headSha, conclusion, createdAt }`;
  - `listRuns({ headSha?, event?, createdAfter? }) → WorkflowRun[]`;
  - `downloadArtifact(runId, name) → Map<path, Buffer> | null`.
  Сбой авторизации или сети — `FORGE_UNAVAILABLE` с `hint`.
- **`adapters/forge-gh.ts`** — через `adapters/exec.ts`:
  - `gh api repos/{owner}/{repo}/pulls/{n}`, `…/actions/runs/{id}`, `…/actions/runs?head_sha=`;
  - `gh run download <id> -n <name> -D <tmp>` — распаковку делает `gh`, зависимости zip нет.
  Реестр внешних пакетов не меняется: `gh` — процесс.
- **`FakeForge`** заполняет `ProjectBuilder` (`.withForge({ pulls, runs, artifacts })`); строка реестра `test_helpers`.
- **Контракт** `test/contract/forge.contract.test.ts` — на настоящем GitHub против этого репозитория:
  - PR #53 (impl-PR `phase-4b`, слит merge-коммитом) — `pullRequest`;
  - run `36203233664` — `workflowRun`, `listRuns({ headSha })`;
  - `downloadArtifact` — на последнем успешном run impl-PR из `listRuns` по head последнего слитого impl-PR (artifacts живут
    90 дней, исторический run их теряет).
  В CI — `GH_TOKEN: ${{ github.token }}` у шага `npm test` и `permissions: actions: read, pull-requests: read`; локально —
  `gh auth`. Без `skipIf`: нет авторизации — тест падает с `hint`.
- Alternatives:
  - REST через `fetch` с токеном — отвергнуто: вторая авторизация, а ADR-0034 п. 9 решил одну через `gh`;
  - `reviews` сейчас — отвергнуто ADR-0037 п. 6.

### 7. Мелкие строки

- **BL-43.** `commands/analyze.ts` и `signals.analyze` находят каталог через `findChangeDir` (`core/openspec/changes.ts`), в
  том числе архив; путь `tasks.md` в находках — фактический.
- **BL-40.** `core/sync/plan.ts`: нет skill review в lock при `frontends ∋ "claude"` — находка в `data.findings[]` `sync`
  (новое поле вывода, пустое по умолчанию); `--check` на неё не реагирует.
- **R-20.** `core/run/submit.ts#checkSkill` сверяет имя skill с `REVIEW_SKILL`, а не с любым skill lock. `REVIEW_SKILL`
  переезжает из `core/sync/claude.ts` к владельцу skill review (`core/run/types.ts`), `sync` импортирует его оттуда.
- **BL-26.** THEN SCN-SDD-001 переписан (delta `core-sdd`); тег SCN-SDD-001 — в тесте `core-sdd-catalog.test.ts`, который
  сверяет форму lock. Остаток BL-26 (SDD-008, SDD-019, KRN-083) не меняется.

### 8. CI репозитория

Job `warrant` (ubuntu) вместо `evidence`:
- **Триггеры:** `pull_request` (все) и `workflow_dispatch` со входом `merge_commit`.
- **Шаги:**
  1. checkout с `fetch-depth: 0`;
  2. merge: на `pull_request` — `git checkout <base tip на момент запуска>`, затем `git merge --no-ff <head sha>`
     (конфликт — exit 3); на dispatch — `git checkout <merge_commit>`;
  3. `npm ci`, OpenSpec, `npm i -g .`;
  4. `warrant ci > ci.json`;
  5. `data.change` → upload artifact `evidence-<change>`: `manifest.json`, `EVID-*.json`, `raw/`, `if: always()` при
     непустом `change`.
- **Permissions:** `contents: read`, `actions: read`, `pull-requests: read`; `GH_TOKEN: ${{ github.token }}`.
- **Удаляются** шаги «Change of the branch» и «Main specs only through an archive-PR». `pr-form.js` остаётся в job `test`
  (форма разработки, ADR-0033 п. 10).
- **Навыки:** `change-archive-pr` — шаг `warrant ci fetch <impl-PR>` вместо скачивания artifact'а, `transition MERGED --ref
  <URL impl-PR>`; `change-impl-pr` — ожидание зелёного `warrant` вместо `evidence`.

### 9. Версии, порядок групп

- **Задача 1.1:**
  - CLI `0.7.0`;
  - pack `core-sdd` `0.3.3` с `kernel: ">=0.1 <0.8"` (7 fixture-packs, lock golden — как I-156);
  - `.warrant/warrant.json` `kernel: "0.7"`.
- **Группы:**
  1. швы A-28, A-29;
  2. `subject.tree`, пред-фильтр, `transition MERGED`, R-21;
  3. `ForgePort`, адаптер, `FakeForge`, контракт;
  4. `warrant ci`: вид, `replay`, `refs`, spec / none / impl; A-30 с тестами `ci`;
  5. archive-PR и `ci fetch`;
  6. BL-43, BL-40, R-20, BL-26;
  7. `ci.yml`, навыки, документы, e2e.
- **Зависимости:** 2 → 1; 4 → 2, 3; 5 → 4; 6 независима; 7 → 5, 6.

### 10. Dogfooding

- **spec-PR 4c** — первый без пары waivers:
  - `adversarial-review` — субагент `warrant-reviewer` (`run start --operation review`, `npm link` в worktree);
  - `analyze-clean` судит impl-PR.
  `classify` по diff spec-PR — вероятно `factory-change` (`packs/**`, схемы в impl-PR; в spec-PR — ADR и документы).
- **impl-PR 4c** гоняет workflow из своей ветки: вердикт выносит уже новый job `warrant` с `warrant ci` из checkout —
  критерий (1) на себе.
- **archive-PR 4c** — первый `warrant ci fetch`.

## Risks / Trade-offs

- [Artifacts живут 90 дней (ADR-0010 Consequences)] → `ci fetch` на старом PR даёт `NO_CI_EVIDENCE` с `hint` dispatch;
  контракт `downloadArtifact` берёт свежий run, а не исторический.
- [Merge job'а и merge кнопки GitHub дают разные деревья (rename, стратегия)] → сверка дерева на `MERGED` даёт `STALE`,
  восстановление — dispatch на M; ложный `PASS` невозможен.
- [Приватный репозиторий: красный `warrant ci` не блокирует кнопку merge] → навык `git-land` сливает только при зелёном CI;
  форж-замок — вне MVP.
- [`worktreeAt` на каждый переход замедляет `ci`] → переходов в PR 1–3; worktree detached во временном каталоге,
  `dispose` в `finally`.
- [`gh` не установлен локально] → `FORGE_UNAVAILABLE` с `hint`. Форж нужен `ci fetch`, проверкам archive-PR и проверке ref
  новых `APPROVED` / `MERGED` (impl-PR с первым коммитом и archive-PR); spec-PR и PR без Change форжа не требуют.
- [Один аккаунт: `merged_by = author`] → `APPROVER_IS_AUTHOR` информирует; полное INV-03 — BL-44.
- [Старые CI-записи без `tree` в архивах] → судятся по-старому (`commit`, `base_commit`); миграции нет.

## Migration Plan

1. **Spec-PR:** артефакты, ADR-0037, record, `classify`, review субагентом; `transition SPECIFIED` по «merge #N».
2. **Impl-PR:** первым коммитом `APPROVED --ref <URL spec-PR> --by` и `IMPLEMENTING`; группы 1–7; последним — `VERIFYING`.
   Вердикт — job `warrant`.
3. **Archive-PR:** `warrant ci fetch <impl-PR>`, `transition MERGED --ref <URL impl-PR>`, `warrant archive phase-4c`, tag
   `v0.7.0`.
4. **Откат:** `git revert` группы. Откат группы 7 возвращает job `evidence`; группы 2 — записи без `tree`.

## Review spec

Первый review (`RUN-01M3DS3AZG69WQW4VWPW78GY7D`, `FAILED`: envelope не сдан — `warrant` на PATH без `run submit`) дал 7
BLOCKER, 12 MAJOR, 8 MINOR, 2 INFO; spec исправлена до повторного review:
- F-1…F-7 (BLOCKER) — `branch-isolated` вне `replay`, дерево M для `replay` и `gate`, пересчёт `ARCHIVED` только в `replay`,
  собственное состояние в правиле spec-PR, run восстановления по содержимому artifact'а, `merged_by ∈ roles.maintainer`,
  общее правило `openspec/specs/**` и пути abandon-PR;
- F-8…F-19 (MAJOR) — оцениваемый commit и base в REQ-VER-011, связь ref с Change и M, `skipped[]` без `paths`, запреты PR
  без Change, `change_state` и удалённый record, ошибки checks и `openspec`, ошибки входа и импорт `ci fetch`, контракт
  artifact (`data.artifact`), `validate` и `sync` без review-skill, положительные сценарии (SCN-VER-090…097);
- F-20…F-29 (MINOR, INFO) — proposal и ADR-0037 согласованы со spec, `kind` перечислен, octopus — `USAGE`, выбор каталога
  архива, риск в SCN-VER-075, пути `.warrant/…`, `ci --dry-run` — только план. F-27 (заголовок REQ-SDD-001 «0.1») — не
  правится: переименование требования — `RENAMED` в отдельном Change.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
