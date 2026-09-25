# Spec Delta: verification

## MODIFIED Requirements

### Requirement: Команда gate и алгоритм verdict
<!-- id: REQ-VER-003 -->

`warrant gate <change> [id...] [--transition <FROM->TO>] [--base <ref>]` SHALL вычислить `gate_verdict` каждого gate перехода
(по умолчанию — следующий вперёд из `change_state`) из effective policy. Сначала пред-фильтр допустимости (D-12): запись evidence
исключается с finding `STALE` (`data.findings[]`, `{ code: "STALE", evidence, reason }`), если `subject.commit` ≠ оцениваемый commit,
`subject.base_commit` ≠ текущий base (у записи с `subject.spec_tree` вместо этих двух сравнений — `spec_tree` ≠ hash дерева
`{proposal.md, specs/**}` каталога Change на оцениваемом commit, тот же набор, что у `spec-approved`, с `reason: "spec_tree"`;
[ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 3), `metrics.threshold` ≠ effective param, `limitations` содержит `scoped:` или waiver `ACTIVE`,
на который ссылается `metrics.waivers[]`, отсутствует. Из допустимых записей по kind SHALL браться самая свежая по `created_at`.
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

### Requirement: Вычисляемые L0 gates core-sdd
<!-- id: REQ-VER-004 -->

Gates без `requires_evidence` SHALL вычисляться CLI из состояния проекта: `required-artifacts-present` — каждый artifact
`artifacts.required` effective policy имеет статус `done` по `openspec status --json` (для `chore` со `skip_specs` — `skipped`
засчитывается для `specs`); `ids-valid` — проверка (5) `validate` без находок; `blocking-unknowns-resolved` — в record нет `unknowns[]`
с `blocking: true` без `resolution`; `branch-isolated` — текущая ветка git существует и не равна base (`main`); `evidence-complete` —
для каждого kind из `evidence.required` у Change есть хотя бы одна запись этого kind на любом commit в статусе `PROVEN` или
`NOT_APPLICABLE` (свежесть проверяют gates, читающие этот kind; I-96, R-8), либо на waivable gate, требующий этот kind в
`requires_evidence`, есть waiver этого Change, который засчитывается по правилам [REQ-VER-003](#requirement-команда-gate-и-алгоритм-verdict)
(`ACTIVE`, срок, `approved_by` ∈ roles, без `targets[]`); иначе `FAIL` с finding `EVIDENCE_MISSING` и недостающими kinds;
`spec-approved` — hash дерева `{proposal.md, specs/**}` каталога Change на commit (`subject.commit`) записи `human-approval`, id
которой перечислен в `evidence[]` последнего перехода `APPROVED` record, равен hash того же дерева на оцениваемом commit; `design.md` и
`tasks.md` не входят (V-9, ADR-0024); нет перехода `APPROVED`, такой записи или git → `BLOCKED` с finding `NO_INPUT`; расхождение →
`FAIL` с finding `SPEC_CHANGED_AFTER_APPROVAL` и списком изменённых путей; `scope-valid` — пути diff `base...HEAD` входят в множество, разрешённое
переходу ([ADR-0011](../../../../docs/adr/WARRANT-ADR-0011-pr-topology.md), D-15). Собственное состояние Change — record
`.warrant/changes/<change>.json`, каталог evidence `<state>/evidence/<change>/**`, файлы Run `<state>/runs/<id>.json` с `change`
этого Change и их `<id>.result.json` — SHALL быть разрешено на каждом из трёх переходов и SHALL NOT считаться policy-путём;
состояние других Changes (records, evidence, Runs) SHALL быть запрещено. Сверх собственного состояния: для `SPECIFIED->APPROVED` —
`openspec/changes/<change>/**`; для `VERIFYING->MERGED` — всё, кроме `openspec/specs/**`, `openspec/changes/archive/**` и policy-путей
(`match.paths` profile `factory-change`), если `factory-change` не в profiles; для `MERGED->ARCHIVED` —
`openspec/changes/archive/<date>-<change>/**`, `openspec/specs/**`, `openspec/changes/<change>/**` (удаление). Каждый FAIL SHALL сопровождаться finding с путями или именами, вызвавшими его. `analyze-clean` — находки
[`warrant analyze`](#requirement-команда-analyze) на оцениваемом commit с base перехода: хотя бы одна находка `UNSATISFIED`,
`CONFLICT` или `ORPHAN` → `FAIL` с этими находками; нет находок → `PASS`; diff недоступен (нет git, base не разрешается) → `BLOCKED`
с `NO_INPUT` ([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 2).

#### Scenario: Impl-PR трогает specs
<!-- id: SCN-VER-019 -->
- **WHEN** `warrant gate add-search --transition VERIFYING->MERGED` при diff, содержащем `openspec/specs/search/spec.md`, profiles `["feature"]`
- **THEN** `gates["scope-valid"]` равен `FAIL`, `findings[]` содержит `SCOPE_VIOLATION` с этим путём

#### Scenario: Archive-PR в своём каталоге
<!-- id: SCN-VER-020 -->
- **WHEN** переход `MERGED->ARCHIVED`, diff содержит `openspec/changes/archive/2026-09-22-add-search/proposal.md`, `openspec/specs/search/spec.md` и удаление `openspec/changes/add-search/**`
- **THEN** `gates["scope-valid"]` равен `PASS`

#### Scenario: factory-change и policy-пути
<!-- id: SCN-VER-021 -->
- **WHEN** diff impl-PR содержит `packs/core-sdd/gates/spec-valid.json`, а profiles record — `["feature"]` без `factory-change`
- **THEN** `gates["scope-valid"]` равен `FAIL` с finding `SCOPE_VIOLATION`; при profiles `["factory-change"]` — `PASS`

#### Scenario: Блокирующий UNKNOWN
<!-- id: SCN-VER-022 -->
- **WHEN** record содержит `unknowns: [{ "id": "UNK-SRC-001", "blocking": true }]` без `resolution`
- **THEN** `gates["blocking-unknowns-resolved"]` равен `FAIL`, finding перечисляет `UNK-SRC-001`

#### Scenario: Ветка не изолирована
<!-- id: SCN-VER-023 -->
- **WHEN** `warrant gate add-search --transition APPROVED->IMPLEMENTING` на ветке `main`
- **THEN** `gates["branch-isolated"]` равен `FAIL`

#### Scenario: evidence-complete не принимает NOT_PROVEN
<!-- id: SCN-VER-045 -->
- **WHEN** `evidence.required` содержит `review`, у Change есть только запись `review` с `evidence_status: "NOT_PROVEN"`, waiver на `adversarial-review` нет
- **THEN** `gates["evidence-complete"]` равен `FAIL`, `findings[]` содержит `EVIDENCE_MISSING` с `review`; при `ACTIVE` waiver на `adversarial-review` от логина из `roles` — `PASS`

#### Scenario: Правка design после approval
<!-- id: SCN-VER-046 -->
- **WHEN** после перехода `APPROVED` (запись `human-approval` на commit A) в impl-PR изменены только `design.md` и `tasks.md` Change, gate `spec-approved` на `VERIFYING->MERGED`
- **THEN** `gates["spec-approved"]` равен `PASS`

#### Scenario: Правка spec после approval
<!-- id: SCN-VER-047 -->
- **WHEN** в той же ситуации изменён `openspec/changes/add-search/specs/search/spec.md`
- **THEN** `gates["spec-approved"]` равен `FAIL`, `findings[]` содержит `SPEC_CHANGED_AFTER_APPROVAL` с этим путём; при `ACTIVE` waiver maintainer'а на `spec-approved` — `WAIVED`

#### Scenario: Нет approval
<!-- id: SCN-VER-048 -->
- **WHEN** record не содержит перехода `APPROVED` с записью `human-approval` в `evidence[]`
- **THEN** `gates["spec-approved"]` равен `BLOCKED`, `findings[]` содержит `NO_INPUT`

#### Scenario: analyze-clean с находкой
<!-- id: SCN-VER-058 -->
- **WHEN** delta spec Change содержит `REQ-SRC-004`, который не упомянут в `tasks.md` ни сам, ни через свои SCN, gate `analyze-clean` на `VERIFYING->MERGED`
- **THEN** `gates["analyze-clean"]` равен `FAIL`, `findings[]` содержит `UNSATISFIED` с `id: "REQ-SRC-004"`

#### Scenario: analyze-clean без находок
<!-- id: SCN-VER-059 -->
- **WHEN** каждый REQ delta упомянут в `tasks.md` и хотя бы один его SCN встречается в файле под `paths.tests`, а тесты diff ссылаются только на определённые SCN
- **THEN** `gates["analyze-clean"]` равен `PASS` без waiver

#### Scenario: Review в spec-PR
<!-- id: SCN-VER-060 -->
- **WHEN** diff spec-PR содержит `openspec/changes/add-search/proposal.md`, запись `.warrant/evidence/add-search/EVID-….json`, файл Run `.warrant/runs/RUN-….json` с `change: "add-search"` и его `.result.json`, gate `scope-valid` на `SPECIFIED->APPROVED`, profiles `["feature"]`
- **THEN** `gates["scope-valid"]` равен `PASS`; файл Run с `change: "other"` в том же diff даёт `FAIL` с `SCOPE_VIOLATION`

#### Scenario: Runs в impl-PR не factory
<!-- id: SCN-VER-061 -->
- **WHEN** diff impl-PR содержит `src/app.py` и файлы Run Change `add-search`, profiles `["feature"]` без `factory-change`, gate `scope-valid` на `VERIFYING->MERGED`
- **THEN** `gates["scope-valid"]` равен `PASS`: файлы Run своего Change не считаются policy-путём `.warrant/**`

## ADDED Requirements

### Requirement: Команда analyze
<!-- id: REQ-VER-010 -->

`warrant analyze <change> [--base <ref>]` SHALL детерминированно сверить delta specs, `tasks.md` и тесты Change по ID и ссылкам
([06 §5](../../../../docs/06-verification.md), [ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 2) и SHALL NOT ничего записывать. Входы: требования delta specs Change
по секциям `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` с их REQ и SCN; REQ и SCN main specs `openspec/specs/**`; текст
`openspec/changes/<change>/tasks.md`; файлы под `paths.tests`; пути diff `base...HEAD` (base — как у gate `scope-valid`).
ID «определён», если он объявлен в main specs или в `ADDED` / `MODIFIED` delta и не объявлен в `REMOVED` delta. Находки:
- `UNSATISFIED` `{ id, missing[] }` — REQ из `ADDED` или `MODIFIED`, если `tasks.md` не упоминает ни его, ни один его SCN
  (`missing` ∋ `task`), или ни один его SCN не встречается ни в одном файле под `paths.tests` (`missing` ∋ `test`; REQ без SCN —
  тоже `test`);
- `CONFLICT` `{ id, path }` — `tasks.md` упоминает REQ или SCN, который не определён;
- `ORPHAN` `{ id, path }` — файл под `paths.tests`, изменённый в diff и не удалённый, упоминает SCN, который не определён.

Без `paths.tests` проверка тестов в `UNSATISFIED` и `ORPHAN` не выполняется; без diff (нет git, base не разрешается) не
выполняется `ORPHAN`; каждый пропуск SHALL попадать в `data.skipped[]` с причиной. Вывод —
`data{ change, findings[], counts{ UNSATISFIED, CONFLICT, ORPHAN }, skipped[] }`, находки отсортированы по коду и id; код выхода 1
при хотя бы одной находке, иначе 0; Change нет → `CHANGE_NOT_FOUND` с `hint`, код 3. Находки `MISSING`, `AMBIGUOUS`, `STALE`
SHALL NOT выдаваться этой версией команды.

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
