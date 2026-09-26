# Tasks

После каждой группы должны быть зелёными: `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`,
`npm run versions:check`. Тесты — по уровням (`test:unit`, `test:app`, `test:contract`, `test:e2e`; BL-37). Закрытие — `/group-done`.
Коммит — один на группу, в `worktree/phase-4c`; после группы — `/group-stats`.

Обозначения: §N — разделы design.md; N-N — решения §1; A-N, BL-N, R-N — строки [docs/backlog.md](../../../docs/backlog.md).
Правка ожидаемого значения golden вне задач 1.1 и 2.1 — остановка и строка I-N.

## 1. Bump и швы (A-28, A-29)

- [x] 1.1 Bump:
  - CLI `0.7.0`;
  - pack `core-sdd` `0.3.3` с `kernel: ">=0.1 <0.8"`: 7 fixture-packs, `.warrant/warrant.json` `kernel: "0.7"`,
    `warrant.lock.json` репозитория и golden-фикстур — как I-156 (REQ-SDD-001 в части диапазона).

  Проверка: `npm run versions:check` зелёный; `core-sdd-catalog.test.ts` под новый диапазон.
- [x] 1.2 A-28: `EvidenceSubject` и `subjectOf` в `core/evidence/record.ts` (§2), строка `helpers`. Через него — `staleReason`,
  `approvalOf`, `specTreeFacts`, `mergedCommit`.

  Проверка:
  - `cs grep '["subject"]' --fixed --in packages/cli/src` — только владелец;
  - тесты `gate`, `transition`, `status` без правок ожидаемых значений.
- [x] 1.3 A-29 (§2):
  - `core/transition/merged.ts` — `mergedCommit`, `ciRunOf`, `assertOneRun`;
  - `ensureApproval` — в `core/evidence/approval.ts`;
  - `commands/transition.ts` — опции и вывод.

  Проверка:
  - `cs deps packages/cli/src/commands/transition.ts` — fan-out ≤ 17;
  - SCN-VER-029…035, SCN-VER-050…052 без правок ожидаемых значений.

## 2. Дерево merge в evidence и transition MERGED (REQ-KRN-012, REQ-VER-001, REQ-VER-003, REQ-VER-007)

- [x] 2.1 Схема `evidence.1.schema.json` — `subject.tree` (§3, REQ-KRN-012). Копия — `warrant sync`, golden —
  `npm run golden:update`.

  Проверка: SCN-KRN-141; SCN-KRN-024, SCN-KRN-025, SCN-KRN-092 без правок.
- [x] 2.2 Писатель и пред-фильтр (§3, REQ-VER-001, REQ-VER-003):
  - `evidenceSubject` с `tree`; `attestation.ref` с `/attempts/<GITHUB_RUN_ATTEMPT>`;
  - `PrefilterContext.mergeTree`;
  - `StaleReason` `tree`.

  Проверка:
  - unit на SCN-VER-069, SCN-VER-070; app на SCN-VER-002;
  - запись без `tree` и SCN-VER-012…018, SCN-VER-056, SCN-VER-057 — без правок ожидаемых значений.
- [x] 2.3 `transition MERGED` и `APPROVED` (§3, REQ-VER-007):
  - `--ref` — URL pull request;
  - одно CI-run по записям (`ciRunOf`);
  - `mergeTree` = дерево M.

  Проверка:
  - SCN-VER-031, SCN-VER-033, SCN-VER-052, SCN-VER-071 — app, ожидания переписаны по delta;
  - SCN-VER-050, SCN-VER-051 без правок.
- [x] 2.4 R-21: `analyzeFacts` и `ownState` читают оцениваемый commit через `git.contents` (§3).

  Проверка: app-кейс `transition MERGED` из archive-ветки, где рабочее дерево отличается от head impl-PR, — `analyze-clean` и
  `scope-valid` судят head.

## 3. ForgePort (§6)

- [x] 3.1 `core/ports/forge.ts` — четыре метода, `FORGE_UNAVAILABLE` с `hint`; порт в `Ctx`; `FakeForge` в `ProjectBuilder`
  (`withForge`), строки `test_helpers` и рангов `architecture.json`.

  Проверка: `architecture.test.ts`, `levels.test.ts` зелёные.
- [x] 3.2 `adapters/forge-gh.ts` через `adapters/exec.ts`: `gh api`, `gh run download`; `owner/repo` — из `GITHUB_REPOSITORY`
  или URL `origin`.

  Проверка: unit разбора URL `origin` (https, ssh) и ответов `gh api` на записанных телах.
- [x] 3.3 Контракт `test/contract/forge.contract.test.ts` на настоящем GitHub (§6): PR #53, run `36203233664`, свежий run
  impl-PR для `downloadArtifact`. В `ci.yml` — `GH_TOKEN` у шага `npm test` и `permissions`.

  Проверка: контракт зелёный локально (`gh auth`) и в CI; без авторизации — падение с `hint`.

## 4. warrant ci (REQ-VER-011; A-30)

- [x] 4.1 `core/ci/kind.ts`: HEAD — результат merge; records Changes в diff; вид по `change_state`; `TOPOLOGY_VIOLATION`.
  Разбор переходов — через `core/record/lifecycle.ts` (§4). `core/ci/base.ts` — база требований из `worktreeAt(HEAD^1)`
  (I-171): policy-пути, `paths.*`, `roles`, `approvals[]`, effective policy; `dispose` в `finally`.

  Проверка:
  - unit на SCN-VER-077, SCN-VER-083;
  - `GitPort.parents`, `GitPort.worktreeAt(commit)` — адаптер, `FakeGit`, контракт соответствия, `dispose` при ошибке.
- [x] 4.2 `core/ci/record.ts` (N44 суженный, §4): префикс `transitions[]`, `change_state`, цепочка состояний, gates новых
  переходов вперёд, файлы и схема `evidence[]`, замороженный record, классификация не слабее базы и профилей `classify` по базе на путях diff (I-171); новый `MERGED` —
  `effective_policy_hash` по базе и записи `ci` у gates `PASS` (I-172); `RECORD_MISMATCH`. Verdicts прошлых переходов не
  пересчитываются.

  Проверка: app на SCN-VER-078, SCN-VER-090, SCN-VER-105, SCN-VER-107, SCN-VER-108.
- [x] 4.3 `core/ci/refs.ts` — `ref` новых переходов через `ForgePort.pullRequest`: `REF_NOT_VERIFIED`, `APPROVER_IS_AUTHOR`.

  Проверка: app на SCN-VER-081, SCN-VER-093 с `FakeForge`.
- [x] 4.4 Правила путей: общее для `openspec/specs/**`, виды `spec`, `abandon`, `none` (N47), gates `SPECIFIED->APPROVED`
  информационно.

  Проверка: app на SCN-VER-073, SCN-VER-074, SCN-VER-092, SCN-VER-094, SCN-VER-099, SCN-VER-100.
- [x] 4.5 Вид `impl`: `runVerify` на HEAD с `mergeTree`, `deferred[]`, `CHANGE_NOT_VERIFYING`, `FRONTEND_HOOKS_INACTIVE` в
  отчёте.

  Проверка: app на SCN-VER-068, SCN-VER-075, SCN-VER-076, SCN-VER-082, SCN-VER-095, SCN-VER-098 (`GITHUB_*` в окружении,
  ни одного нового коммита).
- [x] 4.6 `commands/ci.ts`, `warrant ci [--dry-run]` в `bin/warrant.ts`, `--help` с примером (линза `cli-contract`), коды
  0/1/3.

  Вывод — с `evidence[]`, `dry_run`, `would_write[]` (I-175).

  Проверка:
  - app на SCN-VER-084, SCN-VER-085;
  - e2e `--help`.
- [x] 4.7 A-30: `ProjectBuilder.json(rel)` и `readJsonFile` в `test/helpers/`, строки `test_helpers`; 9 копий `readJson` и
  `record(state)` в `unit/record/write.test.ts` — через них.

  Проверка: `cs dups --in packages/cli/test` без `readJson`.

## 5. archive-PR и ci fetch (REQ-VER-011, REQ-VER-012)

- [ ] 5.1 `core/ci/archive.ts` — проверка CI-записей `MERGED` (run, head sha, `conclusion`, побайтовое сравнение с artifact),
  `EVIDENCE_NOT_VERIFIED` (§5).

  Проверка: app на SCN-VER-079, SCN-VER-102 с `FakeForge`.
- [ ] 5.2 R-16: повтор `openspec archive` в `worktreeAt(HEAD^1)` и сравнение `openspec/specs/**`, `SPECS_NOT_ARCHIVED`;
  правило путей archive-PR; `worktreeAt` — из задачи 4.1 (I-171).

  Проверка: app на SCN-VER-080, SCN-VER-091, SCN-VER-106.
- [ ] 5.3 `core/ci/fetch.ts` и `warrant ci fetch <pr> [--dry-run]`:
  - выбор run по дереву M;
  - `importRecords` в `core/evidence/store.ts`;
  - ошибки `PR_NOT_MERGED`, `NO_CI_EVIDENCE` с `hint`, `EVIDENCE_CONFLICT`;
  - I-175: `WARRANT_STATE_DIR` — `USAGE`; lock Change (`BUSY`), manifest последним, `manifest.commit` — HEAD; попытки run —
    `workflowRun(id, n)` от последней к первой.

  Проверка: app на SCN-VER-086…089, SCN-VER-096, SCN-VER-097, SCN-VER-103, SCN-VER-104, SCN-VER-109 с `FakeForge`.

## 6. Мелкие строки (REQ-VER-010, REQ-KRN-033, REQ-SDD-001; R-20)

- [ ] 6.1 BL-43: `analyze` и `signals.analyze` через `findChangeDir` с архивом (REQ-VER-010).

  Проверка:
  - app на SCN-VER-072;
  - SCN-VER-062…067 без правок.
- [ ] 6.2 BL-40: находка `REVIEWER_SKILL_MISSING` в `data.findings[]` `sync` (REQ-KRN-033).

  Проверка: app на SCN-KRN-142; SCN-KRN-130…134, SCN-KRN-139, SCN-KRN-140 без правок.
- [ ] 6.3 R-20: `checkSkill` сверяет имя с `REVIEW_SKILL`; константа — у владельца skill review (§7).

  Проверка: app `run submit` с envelope другого skill подключённого pack — `SKILL_RESULT_INVALID` с путём `/skill`; SCN-ENF-030…035
  без правок.
- [ ] 6.4 BL-26: тег SCN-SDD-001 в `core-sdd-catalog.test.ts` — форма lock по THEN delta (REQ-SDD-001).

  Проверка: `node scripts/dev/scn-coverage.js --main` на ветке не теряет SCN-SDD-001.
- [ ] 6.5 Profile `factory-change` `1.1.0`: `.github/workflows/**`, `packages/cli/src/**`, `packages/cli/package.json` в
  `match.paths` (REQ-SDD-005, I-173); golden и lock — `sync`, `golden:update`.

  Проверка: app `classify` на SCN-SDD-026, SCN-SDD-027; SCN-SDD-007, SCN-SDD-008 без правок.

## 7. CI, навыки, документы, сквозная проверка

- [ ] 7.1 `.github/workflows/ci.yml` (§8):
  - job `warrant` на `pull_request` и `workflow_dispatch` (`merge_commit`);
  - merge в job;
  - `warrant ci`, artifact `data.artifact.name` (`evidence-<change>-<attempt>`);
  - `permissions`;
  - удалить job `evidence` и шаг «Main specs only through an archive-PR».

  Проверка: CI impl-PR 4c зелёный, `warrant ci` дал `kind: impl` и artifact.
- [ ] 7.2 Навыки `change-archive-pr` (`ci fetch`, `--ref` — URL impl-PR), `change-impl-pr` (job `warrant`) и `change-spec-pr`
  (review `PROVEN` с MAJOR — решение в impl-PR по ADR-0024 п. 4, I-176).

  Проверка: `dev-context.test.ts`.
- [ ] 7.3 e2e критерия 4c на фикстуре с `FakeForge` и git:
  - impl-PR: результат merge → `warrant ci` → evidence с `tree`;
  - merge-коммит M → `ci fetch` → `transition MERGED --ref <URL impl-PR>` → `archive`;
  - `warrant ci` archive-PR — код 0;
  - сдвиг `main` до merge — `STALE` `tree` и `NO_CI_EVIDENCE`.

  Проверка: e2e зелёный на ubuntu и windows.
- [ ] 7.4 Документы:
  - 01 — INV-03, `merged_by`;
  - 04 §6–7 — `warrant ci` по record, `ci fetch`;
  - 06 §3 — `tree`;
  - 06a — `subject.tree`;
  - 13 — строка 4c;
  - `backlog.md` — закрыть A-28…A-30, R-12, R-16, R-20, R-21, BL-7, BL-12, BL-40, BL-42, BL-43; в BL-26 — остаток без
    SDD-001.

  Проверка: `dev-context.test.ts`, `hygiene.js` без битых ссылок.
- [ ] 7.5 `warrant analyze phase-4c` на ветке impl-PR — без находок.

  Проверка: код 0; иначе правка `tasks.md` или тестов, а не waiver.
