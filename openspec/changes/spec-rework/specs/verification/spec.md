## ADDED Requirements

### Requirement: Переделка spec до APPROVED
<!-- id: REQ-VER-018 -->

Change в `SPECIFIED`, в `transitions[]` которого нет `APPROVED`, SHALL возвращаться в `PROPOSED` переходом назад
`warrant transition <change> PROPOSED` ([ADR-0056](../../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 3): без gates;
record, его переходы, `unknowns[]` и evidence Change SHALL сохраняться. Change, однажды одобренный (`APPROVED` есть в
`transitions[]`, в том числе после `IMPLEMENTING->SPECIFIED`), — `STATE_INVALID`, код 3, record не изменён: переделка после
одобрения — spec-approved ([ADR-0024](../../../../docs/adr/WARRANT-ADR-0024-spec-approved-contract.md)). После возврата Change идёт путём
spec-PR заново: Run `specify` и `review` (они стартуют в `PROPOSED`), `verify`, `transition SPECIFIED` с gates `PROPOSED->SPECIFIED`.

Судья `warrant ci` ([REQ-VER-011](#requirement-команда-ci); правила ниже дополняют её, не меняя её текста):
- вид PR — по `change_state` на HEAD, как прежде: PR переделки (`PROPOSED` или `SPECIFIED` на HEAD) — вид `spec`, сливает его
  maintainer, как любой spec-PR; новая запись перехода `SPECIFIED->PROPOSED` или `SPECIFIED` после неё в PR другого вида —
  `RECORD_MISMATCH` с причиной `chain`, код 1; так же `SPECIFIED->PROPOSED` у record, где уже есть `APPROVED`;
- **ref `APPROVED` после переделки.** Если в record на HEAD перед новым `APPROVED` есть переход `SPECIFIED->PROPOSED`, `--ref`
  `APPROVED` SHALL называть spec-PR, чей merge-коммит приносит переход `SPECIFIED`, последний перед этим `APPROVED` и после
  последнего `SPECIFIED->PROPOSED`; ref на spec-PR более раннего `SPECIFIED` — `REF_NOT_VERIFIED` с причиной `change`, код 1.
  Record без переделки судится, как прежде;
- **монотонность `unknowns[]`** (REQ-VER-011) после переделки SHALL действовать, как при базе в `SPECIFIED`: критерий — в record
  базы есть переход в `SPECIFIED`, а не `change_state` базы. Так blocking UNKNOWN не теряет решение, как ни дели переделку на PR.

#### Scenario: Возврат в PROPOSED
<!-- id: SCN-VER-157 -->
- **WHEN** `warrant transition add-search PROPOSED` при `change_state: SPECIFIED`, `ids-valid` `FAIL` и без `APPROVED` в
  `transitions[]`; тот же вызов при `change_state: APPROVED`; тот же вызов в `SPECIFIED` после `IMPLEMENTING->SPECIFIED`
- **THEN** первый — record получает transition `{ to: "PROPOSED", by: "cli:local" }` без `gates`, прежние переходы и файлы evidence
  на месте, `change_state` равен `PROPOSED`, `warrant run start add-search --operation specify` стартует, код 0; второй и третий —
  `STATE_INVALID`, код 3, record не изменён

#### Scenario: Ref APPROVED после переделки
<!-- id: SCN-VER-158 -->
- **WHEN** spec-PR #3 принёс `SPECIFIED`, PR #5 — `SPECIFIED->PROPOSED` и новый `SPECIFIED`, оба слиты maintainer'ом; impl-PR несёт
  `APPROVED` с `--ref` PR #3, затем — с `--ref` PR #5; отдельно — impl-PR, который сам несёт `SPECIFIED->PROPOSED`, `SPECIFIED` и
  `APPROVED` с `--ref` PR #3
- **THEN** `warrant ci` на PR #5 даёт `kind: "spec"` без нарушений; на impl-PR с ref PR #3 — `REF_NOT_VERIFIED` с причиной `change`,
  код 1; с ref PR #5 — ref подтверждён; impl-PR с переделкой внутри — `RECORD_MISMATCH` с причиной `chain`, код 1

#### Scenario: UNKNOWN после переделки
<!-- id: SCN-VER-159 -->
- **WHEN** слит PR только с `SPECIFIED->PROPOSED` (база следующего PR — `PROPOSED`), а следующий PR удаляет blocking UNKNOWN,
  решённый `decision`
- **THEN** `warrant ci` даёт `RECORD_MISMATCH` монотонности `unknowns[]`, как при базе в `SPECIFIED`, код 1

## MODIFIED Requirements

### Requirement: Команда transition
<!-- id: REQ-VER-007 -->

`warrant transition <change> <STATE> [--ref <url>] [--by <login>] [--commit <sha>]` SHALL записать переход в record только если он
допустим ([04 §2](../../../../docs/04-lifecycle.md)) и, для перехода вперёд, каждый gate перехода дал `PASS`, `WAIVED` или `NOT_APPLICABLE`
(иначе `ok: false`, `errors[0].code: "GATES_NOT_PASSED"`, `data.gates`, код выхода 2 — класс ожидания `GATES_NOT_PASSED`, а при `controller_action` `STOP` — 1
([REQ-KRN-003](../kernel/spec.md)); `CONTINUE` при не пройденном gate кода 0 не даёт; record не изменён). `APPROVED` и `MERGED`
без `--ref` SHALL давать `USAGE`; `--ref` этих переходов SHALL быть URL pull request форджа (путь `/<owner>/<repo>/pull/<N>`, фрагмент
допускается): spec-PR для `APPROVED`, impl-PR для `MERGED` ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 5), иначе
`USAGE` с `hint`. Если effective policy требует gate `human-approval` на переходе, `--by <login>` SHALL быть обязателен,
`login` ∈ `roles[<role>]` для `role` из `approvals[]` перехода, и команда SHALL до вычисления gates записать evidence kind `human-approval`
(`produced_by: { "type": "human", "id": "<login>" }`, `attestation: { "type": "human-review", "ref": <--ref> }`, `evidence_status: "PROVEN"`,
`limitations: ["ref not verified (phase 4: warrant ci)"]`): локально `--ref` проверяется только по форме, `--by` — заявление; ref
верифицирует через API форджа `warrant ci` ([REQ-VER-011](#requirement-команда-ci), R-10).
Для `MERGED` оцениваемый commit SHALL быть `--commit` или commit самой свежей записи evidence Change и SHALL быть head влитого impl-PR:
родителем, кроме первого, merge-коммита M на first-parent линии HEAD; commit, не являющийся предком HEAD, commit first-parent линии,
ранний commit PR (предок head, но не родитель M) и fast-forward SHALL давать `COMMIT_NOT_MERGED`, код 3, с указанием head M, если M найден
(R-1); base — точка ответвления `merge-base(M^1, commit)` (I-97; impl-PR вливается merge-коммитом, squash и rebase дают `COMMIT_NOT_MERGED`);
запись с `subject.tree` судится деревом M ([REQ-VER-003](#requirement-команда-gate-и-алгоритм-verdict)).
Все записи перехода `MERGED` SHALL быть на этом commit, а все записи с `attestation.type: "ci"`, на которых вынесены verdicts, SHALL
иметь один и тот же `attestation.ref` — evidence одного CI-run (иначе `REF_MISMATCH` с id записей, код 3, record не изменён; R-6).
Запись transition SHALL содержать `to`, `at`, `by: "cli:local"`, `effective_policy_hash`, `gates{}`, `evidence[]` (id записей,
на которых вынесены verdicts), `ref` при наличии. Переход назад (`VERIFYING->IMPLEMENTING`, `IMPLEMENTING->SPECIFIED`, `SPECIFIED->PROPOSED`) SHALL записываться
без gates; `--by` у него не требуется и не записывается (переданный — строка предупреждения в stderr). `SPECIFIED->PROPOSED` —
только у Change, в `transitions[]` которого нет `APPROVED` ([REQ-VER-018](#requirement-переделка-spec-до-approved)). `ABANDONED` SHALL удалить `openspec/changes/<change>/` и записать переход; после `ABANDONED` и `ARCHIVED` любая команда,
меняющая record, SHALL отказывать с `RECORD_FROZEN`, код 3. Флага `--force` SHALL NOT быть.

#### Scenario: Переход с прошедшими gates
<!-- id: SCN-VER-029 -->
- **WHEN** `warrant transition add-search SPECIFIED` при `PASS` всех gates `PROPOSED->SPECIFIED`
- **THEN** record получает transition `{ to: "SPECIFIED", by: "cli:local", gates: {…PASS}, evidence: ["EVID-…"], effective_policy_hash }`, `change_state` равен `SPECIFIED`, код 0

#### Scenario: Отказ при FAIL
<!-- id: SCN-VER-030 -->
- **WHEN** `warrant transition add-search SPECIFIED` при `spec-valid: FAIL`
- **THEN** `errors[0].code` равен `GATES_NOT_PASSED`, record не изменён, код выхода 2

#### Scenario: APPROVED с ref и by
<!-- id: SCN-VER-031 -->
- **WHEN** `warrant transition add-search APPROVED --ref https://github.com/o/r/pull/7 --by kat` при `roles.maintainer: ["kat"]`, waiver на `adversarial-review` и `PASS` остальных gates
- **THEN** записана evidence `human-approval` с `attestation.ref` равным `--ref` и `limitations` содержит `ref not verified (phase 4: warrant ci)`, `gates["human-approval"]` равен `PASS`, transition несёт `ref`

#### Scenario: by вне роли
<!-- id: SCN-VER-032 -->
- **WHEN** `--by bob`, а `bob` нет в `roles.maintainer`
- **THEN** `errors[0].code` равен `ROLE_REQUIRED`, evidence не записано, код 3

#### Scenario: MERGED на commit evidence
<!-- id: SCN-VER-033 -->
- **WHEN** на ветке archive после merge impl-PR `https://github.com/o/r/pull/9` merge-коммитом M выполнен `warrant transition add-search MERGED --ref https://github.com/o/r/pull/9 --commit <impl-head>` при записях `attestation: { type: "ci", ref: <ci-run-url> }` на `<impl-head>` — втором родителе M, с `subject.tree` равным дереву M
- **THEN** gates `VERIFYING->MERGED` вычислены на `<impl-head>` с base `merge-base(M^1, <impl-head>)`, переход записан с `ref` равным URL impl-PR

#### Scenario: Commit не влит
<!-- id: SCN-VER-034 -->
- **WHEN** `--commit <sha>` не является предком HEAD
- **THEN** `errors[0].code` равен `COMMIT_NOT_MERGED`, код 3, record не изменён

#### Scenario: ABANDONED
<!-- id: SCN-VER-035 -->
- **WHEN** `warrant transition add-search ABANDONED` при `change_state: SPECIFIED`
- **THEN** каталог `openspec/changes/add-search/` удалён, record в `ABANDONED`, `warrant status add-search` даёт `stale: []`, повторный `transition` отказывает с `RECORD_FROZEN`

#### Scenario: Ранний commit impl-PR
<!-- id: SCN-VER-050 -->
- **WHEN** `--commit` указывает на commit impl-PR, предшествующий его head (предок второго родителя M, но не он сам)
- **THEN** `errors[0].code` равен `COMMIT_NOT_MERGED`, сообщение называет head M, record не изменён

#### Scenario: Fast-forward
<!-- id: SCN-VER-051 -->
- **WHEN** impl-ветка влита fast-forward, и `--commit` — её последний commit на first-parent линии HEAD
- **THEN** `errors[0].code` равен `COMMIT_NOT_MERGED`, код 3

#### Scenario: ref не совпадает с run записей
<!-- id: SCN-VER-052 -->
- **WHEN** `warrant transition add-search MERGED --ref https://github.com/o/r/pull/9 --commit <impl-head>`, а verdicts вынесены на записях `ci` на `<impl-head>` с `attestation.ref` `…/actions/runs/1` и `…/actions/runs/2`
- **THEN** `errors[0].code` равен `REF_MISMATCH` с id записей, код 3, record не изменён

#### Scenario: ref не pull request
<!-- id: SCN-VER-071 -->
- **WHEN** `warrant transition add-search MERGED --ref https://github.com/o/r/actions/runs/42 --by kat`
- **THEN** `errors[0].code` равен `USAGE`, `hint` называет URL impl-PR, evidence не записано, record не изменён, код 3
