# Spec Delta: verification

## MODIFIED Requirements

### Requirement: Хранение evidence и attestation по окружению
<!-- id: REQ-VER-001 -->

Evidence Change SHALL храниться в `<state>/evidence/<change>/`: `manifest.json` (`warrant://evidence-manifest/1`) и по одному файлу
`<EVID>.json` (`warrant://evidence/1`) на запись; `<state>` = `WARRANT_STATE_DIR`, если переменная задана, иначе `.warrant`
(D-2; `changes/`, `waivers/`, `local/` всегда в `.warrant`). Сырой вывод check SHALL писаться в `<state>/evidence/<change>/raw/<check-id>/`
(плейсхолдер `{out}`), SHALL NOT считаться частью записи и SHALL быть перечислен в записи как `artifacts[{ "uri", "sha256" }]`
(`uri` относительно корня проекта); `warrant init` SHALL добавлять `.warrant/evidence/**/raw/` в `.gitignore` проекта.
Каждая запись SHALL нести `id` `EVID-<ULID>`, `subject.commit` (HEAD), `subject.base_commit` (D-20), `produced_by{type: "check", id, version}`
без `run` (Run — фаза 4), `effective_policy_hash`, `created_at`, `limitations[]`. Запись, которую пишет `warrant ci` на результате
merge ([REQ-VER-011](#requirement-команда-ci)), SHALL нести `subject.commit` — head PR (второй родитель результата merge),
`subject.base_commit` — tip базы (первый родитель) и `subject.tree` — id объекта дерева git результата merge
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 2). `attestation` SHALL определяться окружением:
`{ "type": "none" }` при локальном запуске; `{ "type": "ci", "ref": "<URL попытки run'а>" }` под GitHub Actions (переменные `GITHUB_ACTIONS`,
`GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`): `<server>/<repo>/actions/runs/<id>/attempts/<attempt>`,
без `GITHUB_RUN_ATTEMPT` — `<server>/<repo>/actions/runs/<id>`; попытка различает повторные запуски одного run (Re-run,
[ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 3). Каждая запись SHALL добавляться в `manifest.evidence[]`, `manifest.commit`
и `manifest.versions` SHALL обновляться при каждой записи; старые записи SHALL NOT удаляться.

#### Scenario: Локальная запись
<!-- id: SCN-VER-001 -->
- **WHEN** `warrant check add-search openspec-validate` выполнен вне CI
- **THEN** появляется `.warrant/evidence/add-search/EVID-<ULID>.json` с `attestation.type: "none"`, `produced_by.id: "openspec-validate"`, `subject.commit` равным HEAD, а `manifest.json` перечисляет этот `EVID` и проходит `warrant validate`

#### Scenario: Запись в CI
<!-- id: SCN-VER-002 -->
- **WHEN** тот же check выполнен с `GITHUB_ACTIONS=true`, `GITHUB_SERVER_URL=https://github.com`, `GITHUB_REPOSITORY=o/r`, `GITHUB_RUN_ID=42`, `GITHUB_RUN_ATTEMPT=2`
- **THEN** `attestation` равен `{ "type": "ci", "ref": "https://github.com/o/r/actions/runs/42/attempts/2" }`; без `GITHUB_RUN_ATTEMPT` — `"https://github.com/o/r/actions/runs/42"`

#### Scenario: Внешнее хранение состояния
<!-- id: SCN-VER-003 -->
- **WHEN** `WARRANT_STATE_DIR=/tmp/state` и выполнен `warrant check add-search openspec-validate`
- **THEN** запись и manifest лежат в `/tmp/state/evidence/add-search/`, `.warrant/evidence/` не изменён, а record читается из `.warrant/changes/add-search.json`

#### Scenario: Сырой вывод вне записи
<!-- id: SCN-VER-004 -->
- **WHEN** check с `parser: junit` записал `{out}/junit.xml`
- **THEN** файл лежит в `.warrant/evidence/add-search/raw/tests-passed/junit.xml`, запись содержит `artifacts[0].uri` с этим путём и `sha256` его содержимого, а `.gitignore` проекта после `warrant init` содержит `.warrant/evidence/**/raw/`

#### Scenario: Запись на результате merge
<!-- id: SCN-VER-068 -->
- **WHEN** `warrant ci` на impl-PR Change `add-search` выполняет checks при HEAD — merge-коммите с родителями `B` (tip `main`) и `H` (head PR)
- **THEN** каждая запись имеет `subject.commit` равным `H`, `subject.base_commit` равным `B` и `subject.tree` равным id дерева HEAD

### Requirement: Команда gate и алгоритм verdict
<!-- id: REQ-VER-003 -->

`warrant gate <change> [id...] [--transition <FROM->TO>] [--base <ref>]` SHALL вычислить `gate_verdict` каждого gate перехода
(по умолчанию — следующий вперёд из `change_state`) из effective policy. Сначала пред-фильтр допустимости (D-12): запись evidence
исключается с finding `STALE` (`data.findings[]`, `{ code: "STALE", evidence, reason }`), если `subject.commit` ≠ оцениваемый commit,
`subject.base_commit` ≠ текущий base (у записи с `subject.spec_tree` вместо этих двух сравнений — `spec_tree` ≠ hash дерева
`{proposal.md, specs/**}` каталога Change на оцениваемом commit, тот же набор, что у `spec-approved`, с `reason: "spec_tree"`;
[ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 3; у записи с `subject.tree` вместо сравнения
`base_commit` — `tree` ≠ дерево результата merge оцениваемого commit с `reason: "tree"`: в `warrant ci` при оценке `VERIFYING->MERGED` в виде
impl (оцениваемый commit — HEAD^2) — дерево HEAD, во всех остальных случаях (`transition`, `gate`, `verify`) — дерево merge-коммита M на
first-parent линии HEAD, чей второй родитель — оцениваемый commit;
такого M нет — `STALE` с `reason: "tree"` и причиной;
[ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 1–2), `metrics.threshold` ≠ effective param, `limitations` содержит `scoped:` или waiver `ACTIVE`,
на который ссылается `metrics.waivers[]`, отсутствует. `STALE` SHALL оставаться находкой пред-фильтра и SHALL NOT быть значением
`evidence_status`. Из допустимых записей по kind SHALL браться самая свежая по `created_at`.
Затем по порядку [06 §3](../../../../docs/06-verification.md): `applies_when.changed_paths` не пересекает diff, или все
`requires_evidence` имеют `NOT_APPLICABLE` от check → `NOT_APPLICABLE`; нет входа (не git-репозиторий, нет `openspec`, нет ни одной
допустимой записи требуемого kind) → `BLOCKED` с finding (`NO_EVIDENCE`, `NO_INPUT`); все `requires_evidence` `PROVEN` → `PASS`;
иначе `FAIL`. `NOT_APPLICABLE` SHALL засчитываться только из записи с `produced_by.type: "check"` (D-11, R-9); запись `NOT_APPLICABLE`
иного производителя SHALL считаться недоказанной (verdict как при `NOT_PROVEN`) с finding `NOT_APPLICABLE_UNTRUSTED`.
Waiver на этот gate и Change SHALL превращать `BLOCKED` и `FAIL` в `WAIVED` (finding `WAIVED_BY: <WAV>`; I-84), только если он
`ACTIVE`, `expires_at` не раньше сегодняшней даты UTC, gate имеет `waivable: true`, `approved_by` равен `human:<login>` с `login`,
входящим хотя бы в одну роль `roles` `warrant.json` (R-2), и `targets[]` пуст или отсутствует; иначе waiver SHALL NOT влиять на verdict,
а `findings[]` SHALL содержать `WAIVER_IGNORED` с `reason` (`waivable`, `approver`, `targets`, `expired`, `state`); такой waiver SHALL NOT
участвовать и в пред-фильтре, и в `evidence-complete`.
На переходе `VERIFYING->MERGED` запись с `attestation.type: "none"` SHALL NOT засчитываться, если gate не объявляет `none` в
`accepts_attestation` (06a §3): verdict `BLOCKED`, finding `ATTESTATION_REQUIRED`. Команда SHALL печатать `data.gates` (id → verdict),
`data.findings[]`, `data.transition`; код выхода — по controller ([REQ-VER-005](#requirement-controller)).

#### Scenario: PASS по свежей записи
<!-- id: SCN-VER-012 -->
- **WHEN** есть запись `spec-report` `PROVEN` на HEAD, gate `spec-valid` в `PROPOSED->SPECIFIED`
- **THEN** `data.gates["spec-valid"]` равен `PASS`, `findings` пусты

#### Scenario: STALE по commit
<!-- id: SCN-VER-013 -->
- **WHEN** единственная запись `spec-report` сделана на предыдущем commit
- **THEN** `findings[]` содержит `STALE` с `evidence` и `reason: "commit"`, `gates["spec-valid"]` равен `BLOCKED` с finding `NO_EVIDENCE`

#### Scenario: NOT_APPLICABLE по путям
<!-- id: SCN-VER-014 -->
- **WHEN** gate `factory-golden-passed` с `applies_when.changed_paths` не пересекает diff `base...HEAD`
- **THEN** verdict `NOT_APPLICABLE`, evidence не требуется

#### Scenario: WAIVED
<!-- id: SCN-VER-015 -->
- **WHEN** gate `adversarial-review` (`waivable: true`) не имеет записи, а `.warrant/waivers/WAV-2026-001.json` `ACTIVE` ссылается на этот gate и Change
- **THEN** verdict `WAIVED`, `findings[]` содержит `WAIVED_BY` с `WAV-2026-001`

#### Scenario: Waiver на невэйвабельный gate
<!-- id: SCN-VER-016 -->
- **WHEN** `ACTIVE` waiver ссылается на `scope-valid` (`waivable: false`), а gate иначе дал бы `FAIL`
- **THEN** verdict `FAIL`, `findings[]` содержит `WAIVER_IGNORED`

#### Scenario: FAIL по NOT_PROVEN
<!-- id: SCN-VER-017 -->
- **WHEN** свежая запись `test-report` имеет `NOT_PROVEN`
- **THEN** `gates["tests-passed"]` равен `FAIL`

#### Scenario: Локальная запись на merge
<!-- id: SCN-VER-018 -->
- **WHEN** `warrant gate add-search --transition VERIFYING->MERGED` при записи `test-report` `PROVEN` с `attestation.type: "none"`
- **THEN** `gates["tests-passed"]` равен `BLOCKED`, `findings[]` содержит `ATTESTATION_REQUIRED`

#### Scenario: Waiver от логина вне ролей
<!-- id: SCN-VER-043 -->
- **WHEN** gate `adversarial-review` не имеет записи, а `ACTIVE` waiver на него несёт `approved_by: "human:bob"`, `bob` нет ни в одной роли `roles`
- **THEN** `gates["adversarial-review"]` равен `BLOCKED`, `findings[]` содержит `WAIVER_IGNORED` с `reason: "approver"`

#### Scenario: NOT_APPLICABLE не от check
<!-- id: SCN-VER-044 -->
- **WHEN** единственная допустимая запись `test-report` имеет `evidence_status: "NOT_APPLICABLE"` и `produced_by.type: "human"`
- **THEN** `gates["tests-passed"]` равен `FAIL`, `findings[]` содержит `NOT_APPLICABLE_UNTRUSTED` с id записи

#### Scenario: Review переживает коммиты
<!-- id: SCN-VER-056 -->
- **WHEN** запись `review` `PROVEN` сделана `run submit` на commit A в spec-PR, а `warrant gate add-search --transition SPECIFIED->APPROVED` вычисляется на commit B после merge spec-PR, где `proposal.md` и `specs/**` Change не менялись
- **THEN** запись допустима, `gates["adversarial-review"]` равен `PASS`, `STALE` по ней нет

#### Scenario: Review устарел с правкой spec
<!-- id: SCN-VER-057 -->
- **WHEN** после той же записи изменён `openspec/changes/add-search/specs/search/spec.md`
- **THEN** `findings[]` содержит `STALE` с этой записью и `reason: "spec_tree"`, `gates["adversarial-review"]` равен `BLOCKED` с `NO_EVIDENCE`; правка только `design.md` запись не исключает

#### Scenario: Дерево merge совпало при сдвинутой базе
<!-- id: SCN-VER-069 -->
- **WHEN** запись `test-report` `PROVEN` с `attestation.type: "ci"`, `subject.commit` `H`, `subject.base_commit` `B` и `subject.tree` `T`, а impl-PR влит merge-коммитом M с `M^2 = H`, `M^1 ≠ B` и деревом `T`
- **THEN** на `VERIFYING->MERGED` с оцениваемым commit `H` запись допустима, `gates["tests-passed"]` равен `PASS`, `STALE` по ней нет

#### Scenario: Дерево merge разошлось
<!-- id: SCN-VER-070 -->
- **WHEN** в той же ситуации дерево M отличается от `T` (между прогоном CI и merge в `main` влит другой PR)
- **THEN** `findings[]` содержит `STALE` с этой записью и `reason: "tree"`, `gates["tests-passed"]` равен `BLOCKED` с `NO_EVIDENCE`; значения `STALE` в `evidence_status` нет

### Requirement: Команда transition
<!-- id: REQ-VER-007 -->

`warrant transition <change> <STATE> [--ref <url>] [--by <login>] [--commit <sha>]` SHALL записать переход в record только если он
допустим ([04 §2](../../../../docs/04-lifecycle.md)) и, для перехода вперёд, каждый gate перехода дал `PASS`, `WAIVED` или `NOT_APPLICABLE`
(иначе `ok: false`, `errors[0].code: "GATES_NOT_PASSED"`, `data.gates`, код выхода по controller, record не изменён). `APPROVED` и `MERGED`
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
на которых вынесены verdicts), `ref` при наличии. Переход назад (`VERIFYING->IMPLEMENTING`, `IMPLEMENTING->SPECIFIED`) SHALL записываться
без gates. `ABANDONED` SHALL удалить `openspec/changes/<change>/` и записать переход; после `ABANDONED` и `ARCHIVED` любая команда,
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

### Requirement: Команда analyze
<!-- id: REQ-VER-010 -->

`warrant analyze <change> [--base <ref>]` SHALL детерминированно сверить delta specs, `tasks.md` и тесты Change по ID и ссылкам
([06 §5](../../../../docs/06-verification.md), [ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 2) и SHALL NOT ничего записывать. Каталог Change —
`openspec/changes/<change>/`, а если его нет — каталог архива с именем ровно `<YYYY-MM-DD>-<change>`, при нескольких — с последней
датой (BL-43: `analyze-clean` на
`MERGED->ARCHIVED` вычисляется и после `openspec archive`). Входы: требования delta specs Change
по секциям `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` с их REQ и SCN; REQ и SCN main specs `openspec/specs/**`; текст
`tasks.md` каталога Change; файлы под `paths.tests`; пути diff `base...HEAD` (base — как у gate `scope-valid`).
ID «определён», если он объявлен в main specs или в `ADDED` / `MODIFIED` delta и не объявлен в `REMOVED` delta. Находки:
- `UNSATISFIED` `{ id, missing[] }` — REQ из `ADDED` или `MODIFIED`, если `tasks.md` не упоминает ни его, ни один его SCN
  (`missing` ∋ `task`), или ни один его SCN не встречается ни в одном файле под `paths.tests` (`missing` ∋ `test`; REQ без SCN —
  тоже `test`);
- `CONFLICT` `{ id, path }` — `tasks.md` упоминает REQ или SCN, который не определён;
- `ORPHAN` `{ id, path }` — файл под `paths.tests`, изменённый в diff и не удалённый, упоминает SCN, который не определён.

Без `paths.tests` проверка тестов в `UNSATISFIED` и `ORPHAN` не выполняется; без diff (нет git, base не разрешается) не
выполняется `ORPHAN`; каждый пропуск SHALL попадать в `data.skipped[]` с причиной. Вывод —
`data{ change, findings[], counts{ UNSATISFIED, CONFLICT, ORPHAN }, skipped[] }`, находки отсортированы по коду и id; код выхода 1
при хотя бы одной находке, иначе 0; Change нет ни в `openspec/changes/`, ни в архиве → `CHANGE_NOT_FOUND` с `hint`, код 3.
Находки `MISSING`, `AMBIGUOUS`, `STALE` SHALL NOT выдаваться этой версией команды.

#### Scenario: REQ без задачи
<!-- id: SCN-VER-062 -->
- **WHEN** delta `ADDED` содержит `REQ-SRC-004` со `SCN-SRC-010`, `tests/test_search.py` упоминает `SCN-SRC-010`, а `tasks.md` не упоминает ни одного из них
- **THEN** `warrant analyze add-search` даёт `UNSATISFIED` с `id: "REQ-SRC-004"` и `missing: ["task"]`, код 1, ни один файл не изменён

#### Scenario: REQ без теста
<!-- id: SCN-VER-063 -->
- **WHEN** `tasks.md` упоминает `REQ-SRC-004`, но `SCN-SRC-010` нет ни в одном файле под `paths.tests`
- **THEN** находка `UNSATISFIED` с `missing: ["test"]`

#### Scenario: Задача на удалённое требование
<!-- id: SCN-VER-064 -->
- **WHEN** delta `REMOVED` содержит `REQ-SRC-002`, а `tasks.md` упоминает `REQ-SRC-002`
- **THEN** находка `CONFLICT` с `id: "REQ-SRC-002"` и `path: "openspec/changes/add-search/tasks.md"`

#### Scenario: Тег неизвестного сценария
<!-- id: SCN-VER-065 -->
- **WHEN** `tests/test_search.py` изменён в diff и упоминает `SCN-SRC-099`, которого нет ни в main specs, ни в delta; неизменённый `tests/test_old.py` упоминает `SCN-SRC-098`
- **THEN** одна находка `ORPHAN` с `id: "SCN-SRC-099"` и `path: "tests/test_search.py"`

#### Scenario: Согласованный Change
<!-- id: SCN-VER-066 -->
- **WHEN** каждый REQ delta упомянут в `tasks.md` и покрыт тестом через SCN, тесты diff ссылаются только на определённые SCN
- **THEN** `data.findings` пуст, все `counts` равны 0, код 0

#### Scenario: Без git
<!-- id: SCN-VER-067 -->
- **WHEN** `warrant analyze add-search` в каталоге, который не является git-репозиторием
- **THEN** `data.skipped[]` содержит `ORPHAN` с причиной, `UNSATISFIED` и `CONFLICT` вычислены

#### Scenario: Архивированный Change
<!-- id: SCN-VER-072 -->
- **WHEN** после `warrant archive add-search` каталог Change перенесён в `openspec/changes/archive/2026-09-26-add-search/`, и вызван `warrant gate add-search --transition MERGED->ARCHIVED`
- **THEN** `analyze` читает delta specs и `tasks.md` из каталога архива, `gates["analyze-clean"]` равен `PASS` (не `BLOCKED` с `NO_INPUT`); если `tasks.md` архива упоминает удалённое требование, находка `CONFLICT` указывает путь `tasks.md` в архиве и gate — `FAIL`

## ADDED Requirements

### Requirement: Команда ci
<!-- id: REQ-VER-011 -->

`warrant ci [--dry-run]` SHALL выносить вердикт pull request в CI и SHALL NOT коммитить и пушить
([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md) п. 1). HEAD SHALL быть результатом merge — merge-коммитом
ровно с двумя родителями: первый — tip базы, второй — head PR ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 3);
иначе `USAGE` с `hint`, код 3. `warrant ci` SHALL работать с состоянием в `.warrant`: заданный `WARRANT_STATE_DIR` — `USAGE`,
код 3. Diff — `HEAD^1..HEAD`. Репозиторий форжа — `GITHUB_REPOSITORY`, иначе из URL remote `origin`
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 6).

**База требований.** Всё, из чего `warrant ci` выводит требования к PR, SHALL читаться из packs и `warrant.json` дерева HEAD^1
(базы), а не из PR ([ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md) п. 1): policy-пути (`match.paths`
profile `factory-change`), `paths.src`, `paths.tests`, `roles`, `approvals[]`, effective policy и классификация по путям diff.
PR предъявляет только предмет суждения. Встроенный pack (`source: bundled`) приходит с CLI: pack базы — тот, чей `hash`
записан в `warrant.lock.json` HEAD^1. Встроенный pack, которого lock базы не содержит с этим `hash`, — закон, изменённый самим
PR: в виде impl `classification.profiles` на HEAD SHALL содержать `factory-change` (`RECORD_MISMATCH`, причина `classification`),
в остальных видах — `SCOPE_VIOLATION` с путём `.warrant/warrant.lock.json`.

**Change и вид PR.** Change SHALL выводиться из records `.warrant/changes/*.json`, изменённых или удалённых в diff, а не из имени
ветки ([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 13):
- больше одного такого record — `TOPOLOGY_VIOLATION` с именами;
- удалённый record — `RECORD_MISMATCH`.
`data.kind` — по `change_state` record на HEAD:
- `spec` — `PROPOSED`, `SPECIFIED`;
- `impl` — `APPROVED`, `IMPLEMENTING`, `VERIFYING`;
- `archive` — `MERGED`, `ARCHIVED`;
- `abandon` — `ABANDONED`;
- `none` — без record в diff.

**Record.** Новые переходы — те, которых нет в record базы. SHALL выполняться, иначе `RECORD_MISMATCH` с переходом и причиной:
- `transitions[]` record на HEAD начинается с `transitions[]` record базы, а `change_state` равен `to` последнего перехода;
- новые переходы идут допустимой цепочкой состояний ([04 §2](../../../../docs/04-lifecycle.md)) от `change_state` базы, а без
  record в базе — начиная с `PROPOSED`;
- у каждого нового перехода вперёд, кроме `PROPOSED`, есть `effective_policy_hash`, а все значения `gates` — `PASS`, `WAIVED` или
  `NOT_APPLICABLE`;
- каждый id его `evidence[]` — файл `.warrant/evidence/<change>/<id>.json` на HEAD, валидный по `evidence/1`;
- record, замороженный в базе (`ARCHIVED`, `ABANDONED`), в diff не меняется;
- в видах impl, archive и abandon `classification` на HEAD не слабее базы: `profiles` — надмножество профилей record базы и
  профилей, которые `classify` по packs базы выводит из путей diff PR; `risk_level` effective policy по packs базы — не ниже,
  чем у record базы; иначе PR снял бы с себя gates своего merge (причина `classification`);
- у нового перехода `MERGED` `effective_policy_hash` равен hash effective policy, вычисленной по базе для `classification` на
  HEAD (причина `policy`); для каждого gate `PASS` этого перехода, чьи `requires_evidence` содержат kind, который производят
  checks перехода `VERIFYING->MERGED`, `evidence[]` содержит запись этого kind с `attestation.type: "ci"` (причина
  `ci_evidence`, [ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md) п. 2).
Требования к переходам выводятся из базы, а verdicts ни одного перехода record, в том числе новых, `warrant ci` заново
SHALL NOT вычислять. Доверие к ним держат другие проверки
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md), N44 уточнён review spec):
- ref подтверждений (ниже): maintainer слил spec-PR до `APPROVED` и impl-PR до `MERGED`;
- merge-вердикт impl-PR, пересчитанный из evidence своего run;
- проверка CI-evidence по ссылке на archive-PR.
У `ARCHIVED` и `ABANDONED` ref нет: их держат локальный `warrant`, повтор archive для `openspec/specs/**` и merge PR
maintainer'ом — остаточный риск MVP.

**Ref.** `ref` нового перехода `APPROVED` или `MERGED` SHALL верифицироваться через API форджа
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 5):
- pull request этого репозитория, слит, `merged_by` входит в `roles[<role>]` для роли из `approvals[]` перехода в effective policy
  Change, а при пустом `approvals[]` — в `roles.maintainer`; `roles` и `approvals[]` — из базы требований: иначе PR вписал бы
  себе подтверждающего;
- для `APPROVED` — merge-коммит PR лежит на first-parent линии HEAD^1 и вносит в record этого Change переход `SPECIFIED`;
- для `MERGED` — merge-коммит PR равен M, а head PR — второму родителю M. M — merge-коммит на first-parent линии HEAD^1, чей
  второй родитель равен общему `subject.commit` записей `attestation.type: "ci"` из `evidence[]` перехода; у них разные
  `subject.commit` — причина `merge_commit`. Таких записей нет (policy базы их не требует, правило `ci_evidence`) — M —
  merge-коммит PR из ref, если он лежит на first-parent линии HEAD^1 и вносит в record этого Change переход `VERIFYING`;
- если среди `evidence[]` перехода есть запись `human-approval`, её `produced_by.id` равен `merged_by`; нет такой записи
  (gate `human-approval` не требовался) — проверка не выполняется.
Иначе `REF_NOT_VERIFIED` с причиной (`repository`, `merged`, `merged_by`, `change`, `merge_commit`, `by`). Если `merged_by`
равен автору PR — это информационная находка `APPROVER_IS_AUTHOR` в `data.findings[]`, а не нарушение.

**Пути.** Собственное состояние Change ([REQ-VER-004](#requirement-вычисляемые-l0-gates-core-sdd)) SHALL быть разрешено во всех
видах. `openspec/specs/**` в diff SHALL быть допустим только в archive-PR с новым переходом `ARCHIVED` и равенством повтору
archive (ниже), иначе `SCOPE_VIOLATION` (R-16). Правила путей судят PR целиком и не зависят от gate `scope-valid`: тот
судит diff своего перехода и пересчитывается вместе с ним.

**Правила по виду.**
- **spec**: diff SHALL NOT трогать `paths.src`, `paths.tests`, каталоги `openspec/changes/<другой>/**`, состояние других Changes и
  policy-пути (`match.paths` profile `factory-change`) вне собственного состояния и waivers этого Change
  (`.warrant/waivers/*.json` с `change` этого Change — spec-PR их и активирует, ADR-0033 п. 4), иначе `SCOPE_VIOLATION` с путями. Без
  `paths.src` и `paths.tests` проверка кода SHALL пропускаться с причиной в `data.skipped[]`. Остальные пути (документы)
  разрешены. Gates `SPECIFIED->APPROVED` SHALL вычисляться на оцениваемом commit HEAD^2 с base `merge-base(HEAD^1, HEAD^2)`
  и выводиться без влияния на код выхода.
- **impl**: оцениваемый commit — HEAD^2, base — `merge-base(HEAD^1, HEAD^2)`, дерево результата merge — дерево HEAD.
  - SHALL выполнить checks перехода `VERIFYING->MERGED` на рабочем дереве HEAD при любом `change_state`, записать evidence
    ([REQ-VER-001](#requirement-хранение-evidence-и-attestation-по-окружению)) в `<state>/evidence/<change>/` рабочей копии и
    вывести `data.artifact{ name: "evidence-<change>-<attempt>", path }` — каталог, который workflow загружает artifact'ом
    (`<attempt>` — `GITHUB_RUN_ATTEMPT`, без него `1`);
  - SHALL вычислить gates перехода; записи kinds, которые производят checks перехода `VERIFYING->MERGED`, засчитываются только
    с `attestation.ref` текущей попытки run (ADR-0010 п. 3: L1 — только из evidence этого запуска), записи прочих kinds — по
    REQ-VER-003; закоммиченные записи этих kinds от других run не засчитываются;
  - каждый gate `FAIL` или `BLOCKED` — нарушение `GATE_NOT_PASSED` с id gate и verdict. Исключение — gate, чьи
    `requires_evidence` состоят только из kinds, которые пишет сам `warrant transition` (`human-approval`): он попадает в
    `data.deferred[]`;
  - вне GitHub Actions «текущий run» — этот вызов: его записи несут `attestation.type: "none"`, и gates L1 перехода дают
    `BLOCKED` с `ATTESTATION_REQUIRED` (REQ-VER-003), код 1 — ожидаемый исход локальной отладки;
  - approver'ы waivers (`approved_by` ∈ `roles`, REQ-VER-003) — по `roles` базы требований; правка `roles` в diff —
    информационная находка `ROLES_CHANGED`;
  - `change_state` не `VERIFYING` — нарушение `CHANGE_NOT_VERIFYING`;
  - ошибки checks (`CHECK_TIMEOUT`, `BUSY`, `CHECK_NOT_CONFIGURED`, `CHECK_LOCAL_FORBIDDEN`) — в `errors[]`, код выхода 3, как
    в [REQ-VER-006](#requirement-команда-verify);
  - `FRONTEND_HOOKS_INACTIVE` ([REQ-VER-009](#requirement-живость-hooks)) — в `data.findings[]` без влияния на код выхода.
- **archive**:
  - пути — как у spec-PR, плюс `openspec/specs/**` по общему правилу и каталог архива `openspec/changes/archive/<date>-<change>/**`;
  - каждая запись `evidence[]` нового перехода `MERGED` с `attestation.type: "ci"` SHALL нести `subject.commit` = M^2 и
    `subject.tree` = дерево M (M — как в правиле ref) и SHALL быть проверена
    через API форджа: попытка run из `attestation.ref` принадлежит репозиторию и имеет `conclusion: success`; у run события
    `pull_request` head sha равен `subject.commit`; run события `workflow_dispatch` запущен с ветки по умолчанию; других событий
    нет;
  - каждая закоммиченная запись с этим `attestation.ref` SHALL побайтно совпадать с файлом из artifact
    `evidence-<change>-<attempt>` этой попытки (ref без `/attempts/<n>` — попытка 1);
  - иначе, в том числе когда artifact истёк, — `EVIDENCE_NOT_VERIFIED` с причиной;
  - при новом переходе `ARCHIVED` diff `openspec/specs/**` SHALL совпадать с результатом `openspec archive <change>` на копии
    дерева HEAD^1, иначе `SPECS_NOT_ARCHIVED` с путями; archive-PR только с `MERGED` повтора не требует, а `openspec/specs/**`
    в его diff — `SCOPE_VIOLATION` по общему правилу. Повтор идёт той же проверкой версии OpenSpec, что `warrant archive`; сбой `openspec` или
    его версия вне диапазона — код 3 с выводом.
- **abandon**: diff SHALL содержать только собственное состояние Change и удаление `openspec/changes/<change>/**`, иначе
  `SCOPE_VIOLATION`.
- **none**: diff SHALL NOT трогать `openspec/changes/**`, `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**` и
  policy-пути, иначе `SCOPE_VIOLATION`.

**Вывод** — `data{ kind, change?, transitions[]{ to, at, ref? }, gates?, deferred[]?, findings[], skipped[], evidence[]?,
artifact?, dry_run?, would_write[]? }`; `transitions[]` — новые переходы; `evidence[]` — id записей, которые записал вид impl
или проверил через форж вид archive.

**Код выхода:**
- 0 — нарушений нет;
- 1 — хотя бы одно нарушение PR: коды выше, включая `TOPOLOGY_VIOLATION`, в `errors[]` с `hint`;
- 3 — ошибка конфигурации, `USAGE`, ошибка check или `openspec`, форж недоступен или не авторизован (`FORGE_UNAVAILABLE` с
  `hint` про `gh auth login` или `GH_TOKEN`).

`--dry-run` — только план (в отличие от [REQ-KRN-034](../kernel/spec.md)): SHALL вывести `data.dry_run: true`, вид PR, Change,
checks и `data.would_write[]` без запуска checks и без обращения к форжу.

#### Scenario: spec-PR трогает код
<!-- id: SCN-VER-073 -->
- **WHEN** при `paths.src: ["src/**"]` diff PR содержит новый record `add-search` в `PROPOSED`, `openspec/changes/add-search/proposal.md`, запись review `.warrant/evidence/add-search/EVID-….json`, файл Run Change, `docs/adr/0042.md` и `src/app.py`
- **THEN** `data.kind` равен `spec`, `errors[]` содержит `SCOPE_VIOLATION` только с путём `src/app.py`, код 1; без `src/app.py` — код 0

#### Scenario: specs вне archive-PR
<!-- id: SCN-VER-074 -->
- **WHEN** diff PR без record ни одного Change содержит `openspec/specs/search/spec.md`
- **THEN** `data.kind` равен `none`, `errors[]` содержит `SCOPE_VIOLATION` с этим путём, код 1

#### Scenario: Вердикт impl-PR
<!-- id: SCN-VER-075 -->
- **WHEN** `warrant ci` под GitHub Actions на результате merge impl-PR Change `add-search` с `risk_level: HIGH` в `VERIFYING`, checks проходят, gate `human-approval` перехода `VERIFYING->MERGED` без evidence
- **THEN** `data.kind` равен `impl`, записи evidence лежат в `.warrant/evidence/add-search/` рабочей копии с `attestation.type: "ci"`, `subject.commit` равным HEAD^2 и `subject.tree`, `data.artifact.name` равен `evidence-add-search-1` (без `GITHUB_RUN_ATTEMPT`; при `GITHUB_RUN_ATTEMPT=2` — `evidence-add-search-2`), `data.deferred[]` содержит `human-approval`, код 0; ни один commit не создан

#### Scenario: impl-PR с упавшим gate
<!-- id: SCN-VER-076 -->
- **WHEN** в той же ситуации junit содержит падение
- **THEN** `gates["tests-passed"]` равен `FAIL`, `errors[]` содержит `GATE_NOT_PASSED` с `tests-passed`, код 1

#### Scenario: Два Change в одном PR
<!-- id: SCN-VER-077 -->
- **WHEN** diff PR меняет records `add-search` и `fix-login`
- **THEN** `errors[0].code` равен `TOPOLOGY_VIOLATION` с обоими именами, checks не выполнялись, код 1

#### Scenario: Переход записан мимо gates
<!-- id: SCN-VER-078 -->
- **WHEN** record на HEAD содержит новый переход `SPECIFIED`, чей `evidence[]` называет `EVID-…` без файла в `.warrant/evidence/add-search/`, или переход `SPECIFIED` сразу после `PROPOSED` базы без `effective_policy_hash`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с переходом и причиной, код 1

#### Scenario: Подменённая запись CI
<!-- id: SCN-VER-079 -->
- **WHEN** на archive-PR запись `ci` перехода `MERGED` отличается от файла в artifact run `attestation.ref` одним полем `evidence_status`
- **THEN** `errors[]` содержит `EVIDENCE_NOT_VERIFIED` с id записи и причиной, код 1

#### Scenario: specs не результат archive
<!-- id: SCN-VER-080 -->
- **WHEN** archive-PR `add-search` содержит в `openspec/specs/search/spec.md` строку, которой нет в результате `openspec archive add-search` на дереве первого родителя
- **THEN** `errors[]` содержит `SPECS_NOT_ARCHIVED` с этим путём, код 1

#### Scenario: Подтверждение не maintainer'ом
<!-- id: SCN-VER-081 -->
- **WHEN** новый переход `APPROVED` несёт `ref` spec-PR этого Change, который слил логин вне `roles.maintainer`
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с причиной `merged_by`, код 1; если слил maintainer, он же автор PR, — `REF_NOT_VERIFIED` нет, а `data.findings[]` содержит `APPROVER_IS_AUTHOR` (код выхода задают остальные правила, SCN-VER-090)

#### Scenario: Живость hooks в отчёте ci
<!-- id: SCN-VER-082 -->
- **WHEN** impl-PR меняет `src/app.py` без события `post` в Runs Change, остальное проходит
- **THEN** `data.findings[]` содержит `FRONTEND_HOOKS_INACTIVE` с `src/app.py`, код 0

#### Scenario: HEAD не результат merge
<!-- id: SCN-VER-083 -->
- **WHEN** `warrant ci` вызван при HEAD с одним родителем или с тремя (octopus)
- **THEN** `errors[0].code` равен `USAGE`, `hint` описывает merge head PR в tip базы, код 3

#### Scenario: Форж недоступен
<!-- id: SCN-VER-084 -->
- **WHEN** archive-PR требует проверки run, а `gh` не авторизован
- **THEN** `errors[0].code` равен `FORGE_UNAVAILABLE` с `hint` про `gh auth login` или `GH_TOKEN`, код 3

#### Scenario: Пробный ci
<!-- id: SCN-VER-085 -->
- **WHEN** `warrant ci --dry-run` на результате merge impl-PR
- **THEN** `data.dry_run: true`, `data.kind` равен `impl`, `data.would_write[]` перечисляет каталог evidence Change, checks не запускались, к форжу не было обращений, код 0

#### Scenario: Первый коммит impl-PR с двумя переходами
<!-- id: SCN-VER-090 -->
- **WHEN** impl-PR вносит одним коммитом переходы `APPROVED` (ref — слитый maintainer'ом spec-PR этого Change) и `IMPLEMENTING`, в CI ветки нет (detached HEAD)
- **THEN** `errors[]` не содержит `RECORD_MISMATCH` и `REF_NOT_VERIFIED` (структура record и ref `APPROVED` в порядке), но содержит `CHANGE_NOT_VERIFYING`, код 1: impl-PR до `VERIFYING` не готов к merge

#### Scenario: Честный archive-PR
<!-- id: SCN-VER-091 -->
- **WHEN** archive-PR `add-search` содержит новые переходы `MERGED` (ref — impl-PR, слитый merge-коммитом M) и `ARCHIVED`, записи `ci`, положенные `ci fetch` из run с деревом M, и `openspec/specs/**`, равные повтору archive
- **THEN** `data.kind` равен `archive`; M найден по `subject.commit` записей `ci`, их `subject.tree` равен дереву M, ref `MERGED` — PR с merge-коммитом M, попытка run и artifact подтверждены, `errors` пуст, код 0

#### Scenario: specs в abandon-PR
<!-- id: SCN-VER-092 -->
- **WHEN** abandon-PR `add-search` кроме record и удаления `openspec/changes/add-search/**` меняет `openspec/specs/search/spec.md`
- **THEN** `data.kind` равен `abandon`, `errors[]` содержит `SCOPE_VIOLATION` с этим путём, код 1

#### Scenario: ref чужого PR
<!-- id: SCN-VER-093 -->
- **WHEN** новый переход `MERGED` несёт `ref` слитого PR, чей merge-коммит не равен M, найденному по записям `ci` его `evidence[]`
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с причиной `merge_commit`, код 1

#### Scenario: policy-путь без Change
<!-- id: SCN-VER-094 -->
- **WHEN** diff PR без record ни одного Change содержит `packs/core-sdd/gates/spec-valid.json` и `openspec/changes/add-search/tasks.md`
- **THEN** `data.kind` равен `none`, `errors[]` содержит `SCOPE_VIOLATION` с обоими путями, код 1

#### Scenario: Check не уложился в timeout
<!-- id: SCN-VER-095 -->
- **WHEN** на impl-PR check `tests-passed` прерван по `execution.timeout_s`
- **THEN** `errors[]` содержит `CHECK_TIMEOUT`, `gates["tests-passed"]` равен `BLOCKED`, код 3

#### Scenario: Чужой run в impl-PR не засчитывается
<!-- id: SCN-VER-098 -->
- **WHEN** в impl-PR закоммичена запись `test-report` `PROVEN` с `attestation.type: "ci"` другого run, `subject.commit` = HEAD^2 и более поздним `created_at`, а прогон текущей попытки даёт `NOT_PROVEN`
- **THEN** `gates["tests-passed"]` равен `FAIL` по записи текущей попытки, `errors[]` содержит `GATE_NOT_PASSED`, код 1

#### Scenario: Waiver своего Change в spec-PR
<!-- id: SCN-VER-099 -->
- **WHEN** diff spec-PR `add-search` кроме артефактов и record содержит `.warrant/waivers/WAV-2026-020.json` с `change: "add-search"` и `.warrant/waivers/WAV-2026-021.json` с `change: "fix-login"`
- **THEN** `errors[]` содержит `SCOPE_VIOLATION` только с путём `WAV-2026-021.json`, код 1

#### Scenario: Код в archive-PR
<!-- id: SCN-VER-100 -->
- **WHEN** честный archive-PR `add-search` дополнительно меняет `src/app.py` при `paths.src: ["src/**"]`
- **THEN** `errors[]` содержит `SCOPE_VIOLATION` с `src/app.py`, код 1

#### Scenario: Ослабленная классификация в impl-PR
<!-- id: SCN-VER-105 -->
- **WHEN** impl-PR `add-search` убирает `factory-change` из `classification.profiles` record, который в базе содержит `chore` и `factory-change`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `classification`, код 1

#### Scenario: archive-PR только с MERGED
<!-- id: SCN-VER-106 -->
- **WHEN** честный archive-PR `add-search` (как SCN-VER-091) вносит только переход `MERGED` (архивация — следующим PR) и не меняет `openspec/specs/**`
- **THEN** `data.kind` равен `archive`, повтор `openspec archive` не выполняется, `SPECS_NOT_ARCHIVED` нет, код 0

#### Scenario: Попытка run вне ветки по умолчанию
<!-- id: SCN-VER-102 -->
- **WHEN** запись `ci` перехода `MERGED` сделана run `workflow_dispatch`, запущенным с ветки `feature/x`
- **THEN** `errors[]` содержит `EVIDENCE_NOT_VERIFIED` с причиной `branch`, код 1

#### Scenario: PR сужает policy-пути
<!-- id: SCN-VER-107 -->
- **WHEN** impl-PR `add-search` с `classification.profiles` `["feature"]` убирает `packs/**` из `match.paths` profile `factory-change` в `packs/core-sdd/profiles/factory-change.json`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `classification` и профилем `factory-change`, выведенным по packs базы, код 1

#### Scenario: MERGED без CI-evidence
<!-- id: SCN-VER-108 -->
- **WHEN** честный archive-PR `add-search` вносит переход `MERGED` с `gates["tests-passed"]` `PASS`, чей `evidence[]` не содержит записей `ci`; либо `MERGED` с пустым `gates`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `ci_evidence`; для пустого `gates` — с причиной `policy`; код 1

### Requirement: Команда ci fetch
<!-- id: REQ-VER-012 -->

`warrant ci fetch <pr> [--dry-run]` SHALL положить в `<state>/evidence/<change>/` evidence CI слитого impl-PR
([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 14, [ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 4).
`<pr>` — номер или URL pull request этого репозитория.

**Ошибки входа** (код 3, ничего не записано):
- URL другого репозитория — `USAGE`;
- заданный `WARRANT_STATE_DIR` — `USAGE`: записи едут в archive-PR, состояние — в `.warrant`, как у `warrant ci`;
- PR не найден — `PR_NOT_FOUND`;
- форж недоступен — `FORGE_UNAVAILABLE` с `hint`;
- PR не слит или слит не merge-коммитом (squash, rebase) — `PR_NOT_MERGED`;
- merge-коммита M нет в локальном репозитории — `COMMIT_NOT_FOUND` с `hint` `git fetch`;
- Change — тот, чей record меняет diff `M^1..M`; не ровно один — `TOPOLOGY_VIOLATION` (ошибка входа команды);
- record Change на M не в `VERIFYING` (PR — не impl-PR) — `PR_NOT_IMPL` с `hint` про номер impl-PR.

**Кандидаты** — попытки runs этого репозитория с `conclusion: success`, новые первыми; каждая попытка run, а не только
последняя:
- события `pull_request` с head sha, равным M^2;
- события `workflow_dispatch` с ветки по умолчанию, созданные после merge M (восстановление, ADR-0037 п. 4).
Попытка без artifact `evidence-<change>-<attempt>` (истёк) пропускается с причиной в `data.skipped[]`.

**Выбранная попытка** — первая, в чьём artifact есть хотя бы одна запись с `attestation.ref`, равным URL этой попытки (ref без
`/attempts/<n>` — попытка 1), и все такие записи
несут `subject.commit` = M^2 и `subject.tree` = дерево M. Подходящего run нет → `NO_CI_EVIDENCE`, код 3, с `hint` запустить
workflow вручную со входом `merge_commit` = M; ничего не записано.

**Запись.** SHALL записываться побайтно ровно записи выбранной попытки с её `attestation.ref`; их id добавляются в локальный manifest
по правилам [REQ-VER-001](#requirement-хранение-evidence-и-attestation-по-окружению), `manifest.commit` — HEAD, как у любой
локальной записи. `manifest.json` и `raw/` artifact'а SHALL NOT импортироваться. Импорт SHALL идти под lock Change, как `check`:
занятый lock — `BUSY`, код 3. Файлы записей пишутся до manifest: прерванный импорт доводит повторный `ci fetch`. Запись с тем же id и тем же содержимым пропускается — повторный `ci fetch` ничего не меняет. Запись с тем же id и
другим содержимым → `EVIDENCE_CONFLICT`; запись, не проходящая схему `evidence/1`, или файл, чьё имя не равно `id`, →
`SCHEMA_VIOLATION` с путём; в обоих случаях код 3, ничего не записано.

Вывод — `data{ pr, change, merge_commit, tree, run, evidence[], skipped[] }`. `--dry-run` SHALL выбрать run и вывести
`data.dry_run: true` и `data.would_write[]` без записи.

#### Scenario: Run на дереве merge
<!-- id: SCN-VER-086 -->
- **WHEN** impl-PR `add-search` слит merge-коммитом M; у head PR два успешных run: новый — с `subject.tree` ≠ дерево M (`main` сдвинулся), старый — с деревом M
- **THEN** `warrant ci fetch 9` записывает записи старого run, `data.run` — его URL, `data.tree` — дерево M, код 0

#### Scenario: Нет run на дереве merge
<!-- id: SCN-VER-087 -->
- **WHEN** ни один успешный run head PR и ни один run `workflow_dispatch` после merge не несёт `subject.tree`, равный дереву M
- **THEN** `errors[0].code` равен `NO_CI_EVIDENCE`, `hint` называет ручной запуск workflow с `merge_commit` M, ни один файл не изменён, код 3

#### Scenario: PR не слит merge-коммитом
<!-- id: SCN-VER-088 -->
- **WHEN** `warrant ci fetch 9` для PR, слитого squash; или `warrant ci fetch https://github.com/other/repo/pull/9`
- **THEN** `errors[0].code` равен `PR_NOT_MERGED`; для чужого репозитория — `USAGE`; код 3, ни один файл не изменён

#### Scenario: Пробный fetch
<!-- id: SCN-VER-089 -->
- **WHEN** `warrant ci fetch 9 --dry-run` при подходящем run
- **THEN** `data.dry_run: true`, `data.would_write[]` перечисляет файлы записей и manifest, ни один файл не изменён, код 0

#### Scenario: Run восстановления
<!-- id: SCN-VER-096 -->
- **WHEN** runs `pull_request` head PR несут дерево ≠ дерево M, а после merge выполнен `workflow_dispatch` со входом `merge_commit` M (head sha run — tip `main`), чьи записи несут `subject.commit` = M^2 и `subject.tree` = дерево M
- **THEN** `warrant ci fetch 9` выбирает run восстановления, код 0; `warrant ci` на archive-PR подтверждает его без сравнения head sha

#### Scenario: Повторная попытка run
<!-- id: SCN-VER-103 -->
- **WHEN** у head PR один run: попытка 1 — с деревом ≠ дерево M, попытка 2 (Re-run до merge) — с деревом M
- **THEN** `warrant ci fetch 9` записывает записи попытки 2, `data.run` оканчивается на `/attempts/2`, код 0

#### Scenario: fetch не impl-PR
<!-- id: SCN-VER-104 -->
- **WHEN** `warrant ci fetch 7` для слитого spec-PR, чей record Change на M в `SPECIFIED`
- **THEN** `errors[0].code` равен `PR_NOT_IMPL` с `hint`, ни один файл не изменён, код 3

#### Scenario: Повторный fetch
<!-- id: SCN-VER-097 -->
- **WHEN** `warrant ci fetch 9` выполнен второй раз после успешного первого
- **THEN** ни один файл не изменён, `data.evidence[]` перечисляет те же id, код 0

#### Scenario: fetch во внешнее состояние
<!-- id: SCN-VER-109 -->
- **WHEN** `warrant ci fetch 9` при заданном `WARRANT_STATE_DIR`
- **THEN** `errors[0].code` равен `USAGE` с `hint` снять переменную, к форжу не было обращений, ни один файл не изменён, код 3
