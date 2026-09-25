# verification Specification

## Purpose
Исполнение policy WARRANT: команды `check`, `gate`, `verify`, `transition`, `archive`, хранение evidence и manifest, алгоритм verdict
с пред-фильтром допустимости, controller и запись переходов Change record. Наблюдается через файлы `.warrant/evidence/**`,
`.warrant/changes/**` и JSON-вывод команд.

## Requirements

### Requirement: Хранение evidence и attestation по окружению
<!-- id: REQ-VER-001 -->

Evidence Change SHALL храниться в `<state>/evidence/<change>/`: `manifest.json` (`warrant://evidence-manifest/1`) и по одному файлу
`<EVID>.json` (`warrant://evidence/1`) на запись; `<state>` = `WARRANT_STATE_DIR`, если переменная задана, иначе `.warrant`
(D-2; `changes/`, `waivers/`, `local/` всегда в `.warrant`). Сырой вывод check SHALL писаться в `<state>/evidence/<change>/raw/<check-id>/`
(плейсхолдер `{out}`), SHALL NOT считаться частью записи и SHALL быть перечислен в записи как `artifacts[{ "uri", "sha256" }]`
(`uri` относительно корня проекта); `warrant init` SHALL добавлять `.warrant/evidence/**/raw/` в `.gitignore` проекта.
Каждая запись SHALL нести `id` `EVID-<ULID>`, `subject.commit` (HEAD), `subject.base_commit` (D-20), `produced_by{type: "check", id, version}`
без `run` (Run — фаза 4), `effective_policy_hash`, `created_at`, `limitations[]`. `attestation` SHALL определяться окружением:
`{ "type": "none" }` при локальном запуске; `{ "type": "ci", "ref": "<URL run'а>" }` под GitHub Actions (переменные `GITHUB_ACTIONS`,
`GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`). Каждая запись SHALL добавляться в `manifest.evidence[]`, `manifest.commit`
и `manifest.versions` SHALL обновляться при каждой записи; старые записи SHALL NOT удаляться.

#### Scenario: Локальная запись
<!-- id: SCN-VER-001 -->
- **WHEN** `warrant check add-search openspec-validate` выполнен вне CI
- **THEN** появляется `.warrant/evidence/add-search/EVID-<ULID>.json` с `attestation.type: "none"`, `produced_by.id: "openspec-validate"`, `subject.commit` равным HEAD, а `manifest.json` перечисляет этот `EVID` и проходит `warrant validate`

#### Scenario: Запись в CI
<!-- id: SCN-VER-002 -->
- **WHEN** тот же check выполнен с `GITHUB_ACTIONS=true`, `GITHUB_SERVER_URL=https://github.com`, `GITHUB_REPOSITORY=o/r`, `GITHUB_RUN_ID=42`
- **THEN** `attestation` равен `{ "type": "ci", "ref": "https://github.com/o/r/actions/runs/42" }`

#### Scenario: Внешнее хранение состояния
<!-- id: SCN-VER-003 -->
- **WHEN** `WARRANT_STATE_DIR=/tmp/state` и выполнен `warrant check add-search openspec-validate`
- **THEN** запись и manifest лежат в `/tmp/state/evidence/add-search/`, `.warrant/evidence/` не изменён, а record читается из `.warrant/changes/add-search.json`

#### Scenario: Сырой вывод вне записи
<!-- id: SCN-VER-004 -->
- **WHEN** check с `parser: junit` записал `{out}/junit.xml`
- **THEN** файл лежит в `.warrant/evidence/add-search/raw/tests-passed/junit.xml`, запись содержит `artifacts[0].uri` с этим путём и `sha256` его содержимого, а `.gitignore` проекта после `warrant init` содержит `.warrant/evidence/**/raw/`

### Requirement: Команда check
<!-- id: REQ-VER-002 -->

`warrant check <change> [id...] [--paths <a,b>] [--base <ref>]` SHALL выполнить указанные checks (без `id` — все checks, чьи
`produces` пересекаются с `requires_evidence` gates следующего перехода вперёд из `change_state` record), каждый — командой `run.command`
после подстановки плейсхолдеров `{out}`, `{change}`, `{paths}` ([REQ-KRN-010](#requirement-схема-check)); с `--paths` SHALL выполняться
`run.scoped_command`, а запись SHALL нести `limitations: ["scoped: <paths>"]`; check без `scoped_command` при `--paths` SHALL выполнять
полный `run.command` без этой пометки с предупреждением в stderr (I-80). Check без `run.command` (например, `tests-passed` pack'а без
override в `.warrant/local/checks/`) SHALL давать `CHECK_NOT_CONFIGURED`, код 3. Check с `execution.local: "scoped-only"` при attestation
`none` (локальный запуск, [REQ-VER-001](#requirement-хранение-evidence-и-attestation-по-окружению)) SHALL выполняться только с `--paths`;
без них — `CHECK_LOCAL_FORBIDDEN`, код 3, команда не запускается, evidence не записано; под GitHub Actions ограничение не действует;
`local: "allowed"` (default) ограничений не вводит (ADR-0017 п. 4). Вывод SHALL разбираться parser'ом (`junit` → kind
`test-report`; `openspec-validate` → kind `spec-report`) в `evidence_status` (`PROVEN` при отсутствии падений, иначе `NOT_PROVEN`;
`NOT_APPLICABLE` — когда parser детерминированно установил отсутствие предмета проверки, D-11) и `metrics` по форме kind'а; junit, в
котором не выполнен ни один тест (`tests − skipped ≤ 0`), SHALL давать `INCONCLUSIVE` с limitation `junit: all N tests skipped` (R-4).
Команда SHALL завершаться кодом 0, если каждая запись записана (в том числе `NOT_PROVEN`); check SHALL прерываться по `execution.timeout_s`
(default `defaults.check_timeout_s` из `warrant.json`, иначе `1800`, D-17) с `CHECK_TIMEOUT`, код 3, без записи evidence.
Check с `execution.exclusive: true` SHALL брать file lock `<git-common-dir>/warrant/check.lock` на время выполнения; занятый замок →
код 2, `errors[0].code: "BUSY"`, `data.holder{pid, check, started_at}`; замок SHALL освобождаться при любом завершении процесса,
включая timeout и сигналы `SIGINT`, `SIGTERM`, `SIGHUP` (на Windows также `SIGBREAK`; R-3). `--base` SHALL задавать `subject.base_commit`
(default `merge-base(HEAD, main)`).

#### Scenario: spec-report от openspec-validate
<!-- id: SCN-VER-005 -->
- **WHEN** `warrant check add-search openspec-validate` при валидном change
- **THEN** запись имеет `kind: "spec-report"`, `evidence_status: "PROVEN"`, `level: "L1"`, а команда `openspec validate add-search --strict --json` выполнена с `{change}` = `add-search`

#### Scenario: test-report не доказан
<!-- id: SCN-VER-006 -->
- **WHEN** override `.warrant/local/checks/tests-passed.json` задаёт команду, чей junit содержит одно падение
- **THEN** запись имеет `kind: "test-report"`, `evidence_status: "NOT_PROVEN"`, `metrics` `{ "tests": N, "failures": 1, … }`, код выхода 0

#### Scenario: Check без команды
<!-- id: SCN-VER-007 -->
- **WHEN** `warrant check add-search tests-passed` в проекте без override `tests-passed`
- **THEN** `errors[0].code` равен `CHECK_NOT_CONFIGURED` с путём check pack'а, код 3, evidence не записано

#### Scenario: Замок занят
<!-- id: SCN-VER-008 -->
- **WHEN** `<git-common-dir>/warrant/check.lock` удерживается другим процессом, а check имеет `exclusive: true`
- **THEN** код выхода 2, `errors[0].code` равен `BUSY`, `data.holder.pid` — pid держателя, команда check не запускалась

#### Scenario: Timeout
<!-- id: SCN-VER-009 -->
- **WHEN** `execution.timeout_s: 1` и команда check не завершается за секунду
- **THEN** процесс check прерван, `errors[0].code` равен `CHECK_TIMEOUT`, код 3, замок свободен, evidence не записано

#### Scenario: Суженный прогон
<!-- id: SCN-VER-010 -->
- **WHEN** `warrant check add-search tests-passed --paths src/a.py,src/b.py` при заданном `run.scoped_command`
- **THEN** выполнен `scoped_command` с `{paths}` → `src/a.py src/b.py`, запись несёт `limitations: ["scoped: src/a.py,src/b.py"]`

#### Scenario: Все checks перехода
<!-- id: SCN-VER-011 -->
- **WHEN** `warrant check add-search` без `id` при `change_state: PROPOSED` и gate `spec-valid` в `PROPOSED->SPECIFIED`
- **THEN** выполнен только `openspec-validate` (единственный check, производящий `spec-report`), `data.checks[]` перечисляет его

#### Scenario: Все тесты пропущены
<!-- id: SCN-VER-040 -->
- **WHEN** junit override'а `tests-passed` содержит `tests="3" skipped="3" failures="0" errors="0"`
- **THEN** запись имеет `evidence_status: "INCONCLUSIVE"` и `limitations` содержит `junit: all 3 tests skipped`, код выхода 0

#### Scenario: scoped-only локально без путей
<!-- id: SCN-VER-041 -->
- **WHEN** override `tests-passed` задаёт `execution.local: "scoped-only"`, и `warrant check add-search tests-passed` выполнен вне CI без `--paths`
- **THEN** `errors[0].code` равен `CHECK_LOCAL_FORBIDDEN`, код 3, команда check не запускалась, evidence не записано; с `--paths src/a.py` выполнен `scoped_command`

#### Scenario: scoped-only в CI
<!-- id: SCN-VER-042 -->
- **WHEN** тот же check выполнен без `--paths` с `GITHUB_ACTIONS=true` и переменными run'а
- **THEN** выполнен полный `run.command`, запись имеет `attestation.type: "ci"` и не несёт `scoped:`

### Requirement: Команда gate и алгоритм verdict
<!-- id: REQ-VER-003 -->

`warrant gate <change> [id...] [--transition <FROM->TO>] [--base <ref>]` SHALL вычислить `gate_verdict` каждого gate перехода
(по умолчанию — следующий вперёд из `change_state`) из effective policy. Сначала пред-фильтр допустимости (D-12): запись evidence
исключается с finding `STALE` (`data.findings[]`, `{ code: "STALE", evidence, reason }`), если `subject.commit` ≠ оцениваемый commit,
`subject.base_commit` ≠ текущий base, `metrics.threshold` ≠ effective param, `limitations` содержит `scoped:` или waiver `ACTIVE`,
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
- **WHEN** gate `analyze-clean` (`waivable: true`) не имеет записи, а `.warrant/waivers/WAV-2026-001.json` `ACTIVE` ссылается на этот gate и Change
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
- **WHEN** gate `analyze-clean` не имеет записи, а `ACTIVE` waiver на него несёт `approved_by: "human:bob"`, `bob` нет ни в одной роли `roles`
- **THEN** `gates["analyze-clean"]` равен `BLOCKED`, `findings[]` содержит `WAIVER_IGNORED` с `reason: "approver"`

#### Scenario: NOT_APPLICABLE не от check
<!-- id: SCN-VER-044 -->
- **WHEN** единственная допустимая запись `test-report` имеет `evidence_status: "NOT_APPLICABLE"` и `produced_by.type: "human"`
- **THEN** `gates["tests-passed"]` равен `FAIL`, `findings[]` содержит `NOT_APPLICABLE_UNTRUSTED` с id записи

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
переходу ([ADR-0011](../../../../docs/adr/WARRANT-ADR-0011-pr-topology.md), D-15): для `SPECIFIED->APPROVED` — `openspec/changes/<change>/**`
и `.warrant/changes/<change>.json`; для `VERIFYING->MERGED` — всё, кроме `openspec/specs/**`, `openspec/changes/archive/**`,
records и evidence других Changes, и кроме policy-путей (`match.paths` profile `factory-change`), если `factory-change` не в profiles;
для `MERGED->ARCHIVED` — `openspec/changes/archive/<date>-<change>/**`, `openspec/specs/**`, `openspec/changes/<change>/**` (удаление),
record и evidence этого Change. Каждый FAIL SHALL сопровождаться finding с путями или именами, вызвавшими его. `analyze-clean` SHALL
давать `BLOCKED` с finding `NO_INPUT` («`warrant analyze` не реализован»), пока `analyze` не существует.

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

### Requirement: Controller
<!-- id: REQ-VER-005 -->

После вычисления gates CLI SHALL вычислить входы controller из record, effective policy и verdicts: `policy_conflict`, `gate_verdict`
(худший verdict перехода в порядке `FAIL` > `BLOCKED` > `WAIVED` > `NOT_APPLICABLE` > `PASS`) и `gate_waivable` этого gate,
`blocking_unknowns`, `pending_approvals`, `gates_awaiting_attestation`, `unevaluated_gates`, `missing_required_artifacts`;
применить правила `controller/rules.json` всех подключённых packs в порядке загрузки, первое совпавшее — результат
(`controller_action`, `next`?, `rule`); правило, дающее `CONTINUE` при `gate_verdict` `FAIL` или `BLOCKED`, SHALL пропускаться с finding
`CONTROLLER_RULE_IGNORED` (id правила), а сопоставление — продолжаться (R-13); ни одно не совпало и худший verdict — `BLOCKED` → правило
kernel `verify-incomplete` (`WAIT`, `next: "verify"`; P-7, I-91); ни одно не совпало иначе → `CONTINUE` без `next`, `rule: null`.
Controller SHALL быть чистой функцией входов. Код выхода `gate` и `verify`: `CONTINUE` → 0, `STOP` → 1, `WAIT` и `ESCALATE` → 2.

#### Scenario: Gate FAIL → WAIT
<!-- id: SCN-VER-024 -->
- **WHEN** хотя бы один gate перехода дал `FAIL` при правилах core-sdd
- **THEN** `data.controller_action` равен `WAIT`, `data.rule` равен `gate-failed`, код выхода 2

#### Scenario: Blocking UNKNOWN → clarify
<!-- id: SCN-VER-025 -->
- **WHEN** gates не дали `FAIL`, а record содержит открытый blocking `UNKNOWN`
- **THEN** `controller_action` равен `WAIT`, `next` равен `clarify`, `rule` равен `blocking-unknown`

#### Scenario: Ничего не совпало
<!-- id: SCN-VER-026 -->
- **WHEN** все gates перехода `PASS`, `WAIVED` или `NOT_APPLICABLE`, конфликтов и UNKNOWN нет
- **THEN** `controller_action` равен `CONTINUE`, `rule` равен `null`, код выхода 0

#### Scenario: Только BLOCKED
<!-- id: SCN-VER-039 -->
- **WHEN** gates перехода не дали `FAIL`, хотя бы один — `BLOCKED` (например, `NO_EVIDENCE` после нового commit), правила packs не совпали
- **THEN** `controller_action` равен `WAIT`, `next` равен `verify`, `rule` равен `verify-incomplete`, код выхода 2

#### Scenario: Правило проекта не пропускает BLOCKED
<!-- id: SCN-VER-049 -->
- **WHEN** `.warrant/local/controller/rules.json` содержит правило `{ "when": { "gate_verdict": "BLOCKED" }, "action": "CONTINUE" }`, а худший verdict перехода — `BLOCKED`
- **THEN** правило пропущено, `findings[]` содержит `CONTROLLER_RULE_IGNORED` с его id, `controller_action` равен `WAIT`, `rule` равен `verify-incomplete`, код выхода 2

### Requirement: Команда verify
<!-- id: REQ-VER-006 -->

`warrant verify <change> [--transition <FROM->TO>] [--base <ref>] [--paths <a,b>]` SHALL выполнить [REQ-VER-002](#requirement-команда-check)
для checks перехода, затем [REQ-VER-003](#requirement-команда-gate-и-алгоритм-verdict) и [REQ-VER-005](#requirement-controller),
и напечатать `data{ transition, checks[], gates, findings[], controller_action, next?, rule, effective_policy{hash, risk_level} }`.
Падение check (`CHECK_TIMEOUT`, `BUSY`, `CHECK_NOT_CONFIGURED`, `CHECK_LOCAL_FORBIDDEN`) SHALL NOT прерывать вычисление gates:
соответствующие gates получают `BLOCKED`, ошибка попадает в `errors[]`, код выхода — максимум из кода ошибки и кода controller.

#### Scenario: Полный цикл локально
<!-- id: SCN-VER-027 -->
- **WHEN** `warrant verify add-search` при `change_state: PROPOSED` и валидных artifacts
- **THEN** выполнен `openspec-validate`, `gates` содержит `required-artifacts-present`, `spec-valid`, `ids-valid` со значением `PASS`, `controller_action` равен `CONTINUE`, код 0

#### Scenario: Check не сконфигурирован
<!-- id: SCN-VER-028 -->
- **WHEN** `warrant verify add-search --transition VERIFYING->MERGED` без override `tests-passed`
- **THEN** `errors[]` содержит `CHECK_NOT_CONFIGURED`, `gates["tests-passed"]` равен `BLOCKED`, остальные gates вычислены, код выхода 3

### Requirement: Команда transition
<!-- id: REQ-VER-007 -->

`warrant transition <change> <STATE> [--ref <url>] [--by <login>] [--commit <sha>]` SHALL записать переход в record только если он
допустим ([04 §2](../../../../docs/04-lifecycle.md)) и, для перехода вперёд, каждый gate перехода дал `PASS`, `WAIVED` или `NOT_APPLICABLE`
(иначе `ok: false`, `errors[0].code: "GATES_NOT_PASSED"`, `data.gates`, код выхода по controller, record не изменён). `APPROVED` и `MERGED`
без `--ref` SHALL давать `USAGE`. Если effective policy требует gate `human-approval` на переходе, `--by <login>` SHALL быть обязателен,
`login` ∈ `roles[<role>]` для `role` из `approvals[]` перехода, и команда SHALL до вычисления gates записать evidence kind `human-approval`
(`produced_by: { "type": "human", "id": "<login>" }`, `attestation: { "type": "human-review", "ref": <--ref> }`, `evidence_status: "PROVEN"`,
`limitations: ["ref not verified (phase 4: warrant ci)"]`): `--ref` проверяется только как http(s) URL, `--by` — заявление; верификацию
ref через API форджа ([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md) п. 2) выполняет `warrant ci` фазы 4 (R-10).
Для `MERGED` оцениваемый commit SHALL быть `--commit` или commit самой свежей записи evidence Change и SHALL быть head влитого impl-PR:
родителем, кроме первого, merge-коммита M на first-parent линии HEAD; commit, не являющийся предком HEAD, commit first-parent линии,
ранний commit PR (предок head, но не родитель M) и fast-forward SHALL давать `COMMIT_NOT_MERGED`, код 3, с указанием head M, если M найден
(R-1); base — точка ответвления `merge-base(M^1, commit)` (I-97; impl-PR вливается merge-коммитом, squash и rebase дают `COMMIT_NOT_MERGED`).
Все записи перехода `MERGED` SHALL быть на этом commit, а каждая запись с `attestation.type: "ci"`, на которой вынесены verdicts, SHALL
иметь `attestation.ref`, равный `--ref` (иначе `REF_MISMATCH`, код 3, record не изменён; R-6).
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
- **WHEN** `warrant transition add-search APPROVED --ref https://github.com/o/r/pull/7#pullrequestreview-1 --by kat` при `roles.maintainer: ["kat"]`, waiver на `adversarial-review` и `PASS` остальных gates
- **THEN** записана evidence `human-approval` с `attestation.ref` равным `--ref` и `limitations` содержит `ref not verified (phase 4: warrant ci)`, `gates["human-approval"]` равен `PASS`, transition несёт `ref`

#### Scenario: by вне роли
<!-- id: SCN-VER-032 -->
- **WHEN** `--by bob`, а `bob` нет в `roles.maintainer`
- **THEN** `errors[0].code` равен `ROLE_REQUIRED`, evidence не записано, код 3

#### Scenario: MERGED на commit evidence
<!-- id: SCN-VER-033 -->
- **WHEN** на ветке archive после merge impl-PR merge-коммитом M выполнен `warrant transition add-search MERGED --ref <ci-run-url> --commit <impl-head>` при записях `attestation: { type: "ci", ref: <ci-run-url> }` на `<impl-head>` — втором родителе M
- **THEN** gates `VERIFYING->MERGED` вычислены на `<impl-head>` с base `merge-base(M^1, <impl-head>)`, переход записан

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
- **WHEN** `warrant transition add-search MERGED --ref https://github.com/o/r/actions/runs/1 --commit <impl-head>`, а записи `ci` на `<impl-head>` несут `attestation.ref` `…/actions/runs/2`
- **THEN** `errors[0].code` равен `REF_MISMATCH` с id записей, код 3, record не изменён

### Requirement: Команда archive
<!-- id: REQ-VER-008 -->

`warrant archive <change>` SHALL требовать `change_state: MERGED` (иначе `STATE_INVALID`, код 3); выполнить `openspec validate <change>
--strict --json`; вычислить gates `MERGED->ARCHIVED` ([REQ-VER-003](#requirement-команда-gate-и-алгоритм-verdict)) и при их прохождении
вызвать `openspec archive <change> --yes --json`, затем записать transition `ARCHIVED` (`by: "cli:local"`, `gates{}`, `evidence[]`).
При `GATES_NOT_PASSED` `openspec archive` SHALL NOT вызываться. После записи `warrant status <change>` SHALL давать `stale: []`.

#### Scenario: Архив через warrant
<!-- id: SCN-VER-036 -->
- **WHEN** `warrant archive add-search` при `MERGED`, `PASS`/`WAIVED` gates `MERGED->ARCHIVED`
- **THEN** существует `openspec/changes/archive/<date>-add-search/`, record в `ARCHIVED` с verdicts, `warrant status add-search` даёт `stale: []`, код 0

#### Scenario: Не MERGED
<!-- id: SCN-VER-037 -->
- **WHEN** `warrant archive add-search` при `change_state: VERIFYING`
- **THEN** `errors[0].code` равен `STATE_INVALID`, `openspec archive` не вызван, код 3

#### Scenario: Gate архива не прошёл
<!-- id: SCN-VER-038 -->
- **WHEN** `spec-valid` даёт `FAIL` на `MERGED->ARCHIVED`
- **THEN** `errors[0].code` равен `GATES_NOT_PASSED`, каталог Change не перемещён, record не изменён

### Requirement: Живость hooks
<!-- id: REQ-VER-009 -->

CLI SHALL вычислять для Change finding `FRONTEND_HOOKS_INACTIVE`
([ADR-0018](../../../../docs/adr/WARRANT-ADR-0018-frontend-adapters.md) п. 5, D-14): пути diff Change, кроме удалённых (base — как у gate
`scope-valid`), под `paths.src` ∪ `paths.tests`, ни один Run Change (`<state>/runs/*.json` с `change` этого Change) для которых
не содержит события `phase: "post"` с этим путём в `paths[]`. Finding — `{ code: "FRONTEND_HOOKS_INACTIVE", paths[], more }`:
не больше 10 путей по порядку, `more` — число остальных. `warrant status` SHALL добавлять его в `verification.findings[]` Change в состоянии
`IMPLEMENTING` и дальше; `warrant verify` и `warrant gate` — в `data.findings[]` для перехода `VERIFYING->MERGED`. Finding SHALL
NOT менять verdict, `controller_action` и код выхода: правки человека без hooks легитимны. Без `paths.src` и `paths.tests`
finding не вычисляется.

#### Scenario: Правка без hooks
<!-- id: SCN-VER-053 -->
- **WHEN** Change в `VERIFYING` меняет `src/app.py`, а ни в одном Run Change нет события `post` с `src/app.py`
- **THEN** `warrant verify add-search --transition VERIFYING->MERGED` содержит в `data.findings[]` `FRONTEND_HOOKS_INACTIVE` с `paths: ["src/app.py"]`, а verdicts и код выхода те же, что без него

#### Scenario: Все правки под hooks
<!-- id: SCN-VER-054 -->
- **WHEN** каждый путь diff под `paths.src` и `paths.tests` есть в событии `post` одного из Runs Change, а `docs/notes.md` изменён без события
- **THEN** `FRONTEND_HOOKS_INACTIVE` отсутствует в `warrant status add-search` и в отчёте `verify`

#### Scenario: Много путей
<!-- id: SCN-VER-055 -->
- **WHEN** без событий guard изменено 13 файлов под `paths.src`
- **THEN** finding содержит 10 путей и `more: 3`
