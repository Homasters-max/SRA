## MODIFIED Requirements

### Requirement: Команда check
<!-- id: REQ-VER-002 -->

`warrant check <change> [id...] [--paths <a,b>] [--base <ref>]` SHALL выполнить указанные checks (без `id` — checks перехода:
для каждого элемента `requires_evidence` gates следующего перехода вперёд из `change_state` record с `check` — только этот check,
для элемента без `check` — все checks, чьи `produces` содержат его `kind`; объединение по id, [ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 6;
тот же набор — checks перехода у `verify` и `warrant ci`; `check` элемента, не называющий загруженный check с этим `kind` в
`produces`, — `CONFIG_INVALID` с `path` элемента, код 3, до запуска checks, design I-204), каждый — командой `run.command`
после подстановки плейсхолдеров `{out}`, `{change}`, `{paths}` ([REQ-KRN-010](#requirement-схема-check)); с `--paths` SHALL выполняться
`run.scoped_command`, а запись SHALL нести `limitations: ["scoped: <paths>"]`; check без `scoped_command` при `--paths` SHALL выполнять
полный `run.command` без этой пометки с предупреждением в stderr (I-80). Check без `run.command` (например, `tests-passed` pack'а без
override в `.warrant/local/checks/`) SHALL давать `CHECK_NOT_CONFIGURED`, код 3. Check с `execution.local: "scoped-only"` при attestation
`none` (локальный запуск, [REQ-VER-001](#requirement-хранение-evidence-и-attestation-по-окружению)) SHALL выполняться только с `--paths`;
без них — `CHECK_LOCAL_FORBIDDEN`, код 3, команда не запускается, evidence не записано; под GitHub Actions ограничение не действует;
`local: "allowed"` (default) ограничений не вводит (ADR-0017 п. 4). Вывод SHALL разбираться parser'ом (`junit` → kind
`test-report`; `openspec-validate` → kind `spec-report`) в `evidence_status` (`PROVEN` при отсутствии падений и пропущенных тестов
сценариев — ниже, иначе `NOT_PROVEN`;
`NOT_APPLICABLE` — когда parser детерминированно установил отсутствие предмета проверки, D-11) и `metrics` по форме kind'а; junit, в
котором не выполнен ни один тест (`tests − skipped ≤ 0`), SHALL давать `INCONCLUSIVE` с limitation `junit: all N tests skipped` (R-4).
Parser `junit` SHALL считать документ по элементам `<testcase>`, где бы они ни лежали (в том числе вне любого `<testsuite>`):
`tests` — их число; `skipped` — с дочерним `<skipped>`, `failures` — с `<failure>` и без `<skipped>` (упавший `todo` `node:test`
несёт `<skipped>` и `<failure>` и прогон не валит), `errors` — с `<error>`, всегда (ошибку teardown пропущенного или упавшего теста
pytest ничто не снимает; падение и ошибка teardown — одно падение и одна ошибка, как в счётчиках pytest); комментарии и CDATA — не
разметка; атрибуты `<testsuite>` SHALL учитываться только у документа без единого `<testcase>`, итоги `<testsuites>` — никогда;
документ без `<testcase>` и `<testsuite>` не учитывается, а если таких все — `INCONCLUSIVE` с limitation
`junit: no <testcase> or <testsuite> found in {out}` (`{out}` — буквально; design I-196)
([ADR-0042](../../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) п. 2).
Пропущенный `<testcase>` (с дочерним `<skipped>`, в том числе `todo`), в значении атрибута `name` которого (после раскрытия
сущностей XML) есть ссылка на сценарий `SCN-<AREA>-NNN` ([ADR-0012](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)),
SHALL делать запись `NOT_PROVEN` с limitation `junit: skipped <SCN>[, <SCN>…]` — id без повторов, по файлам отчёта в `{out}` в
порядке имени (code units), внутри файла — в порядке появления, даже если
падений нет; правило «ни один тест не выполнен — `INCONCLUSIVE`» SHALL применяться только к отчёту без таких testcase
([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 2).
Команда SHALL завершаться кодом 0, если каждая запись записана (в том числе `NOT_PROVEN`); check SHALL прерываться по `execution.timeout_s`
(default `defaults.check_timeout_s` из `warrant.json`, иначе `1800`, D-17) с `CHECK_TIMEOUT`, код 4, `retryable: true`, без записи evidence.
Check с `execution.exclusive: true` SHALL брать file lock `<git-common-dir>/warrant/check.lock` на время выполнения; занятый замок →
код 4, `errors[0].code: "BUSY"` с `retryable: true`, `data.holder{pid, check, started_at}`; замок SHALL освобождаться при любом завершении процесса,
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
- **THEN** код выхода 4, `errors[0].code` равен `BUSY` с `retryable: true`, `data.holder.pid` — pid держателя, команда check не запускалась

#### Scenario: Timeout
<!-- id: SCN-VER-009 -->
- **WHEN** `execution.timeout_s: 1` и команда check не завершается за секунду
- **THEN** процесс check прерван, `errors[0].code` равен `CHECK_TIMEOUT` с `retryable: true`, код 4, замок свободен, evidence не записано

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

#### Scenario: Отчёт node:test
<!-- id: SCN-VER-117 -->
- **WHEN** junit override'а `tests-passed` — отчёт `node --test --test-reporter=junit`: четыре `<testcase>` прямо в `<testsuites>` (один с `<failure>`, два с `<skipped>`) и `<testsuite>` с одним `<testcase>` и вложенным `<testsuite>` из двух `<testcase>` (один с `<failure>`), атрибуты suite — `tests="2" failures="1" skipped="1"` и `tests="2" failures="1"`
- **THEN** запись имеет `evidence_status: "NOT_PROVEN"` и `metrics` `{ "tests": 7, "failures": 2, "errors": 0, "skipped": 2 }`; отчёт только из двух `<testcase>` без `<testsuite>` и падений — `PROVEN` с `tests: 2`; `<testcase>` с `<skipped type="todo">` и `<failure>` — пропуск; с `<skipped>` и `<error>` — пропуск и ошибка (`NOT_PROVEN`); с `<failure>` и `<error>` — падение и ошибка

#### Scenario: Пропущенный тест сценария
<!-- id: SCN-VER-118 -->
- **WHEN** junit override'а `tests-passed` — три `<testcase>` без падений, один из них `<testcase name="SCN-VER-001 &amp; retry">` с `<skipped/>`, другой — `<testcase name="cache">` с `<skipped/>`
- **THEN** запись имеет `evidence_status: "NOT_PROVEN"`, `limitations` содержит `junit: skipped SCN-VER-001`, `metrics.skipped` равен 2, код выхода 0; без `SCN-VER-001` в имени того же отчёта — `PROVEN`; пропущенный `todo` `node:test` с `SCN-…` в имени — тоже `NOT_PROVEN`

#### Scenario: Checks перехода при требовании с check
<!-- id: SCN-VER-123 -->
- **WHEN** gate следующего перехода требует `{ kind: "test-report", status: "PROVEN", check: "dev-check" }`, другой gate того же перехода — `{ kind: "test-report", status: "PROVEN" }`, загружены checks `tests-passed` и `dev-check`, оба производят `test-report`, и вызван `warrant check add-search` без `id`
- **THEN** выполнены оба check; если бы второго gate не было — только `dev-check`, `tests-passed` не запускается и не даёт `CHECK_NOT_CONFIGURED`; если `dev-check` не загружен — `CONFIG_INVALID` с `path`, оканчивающимся на `#/requires_evidence/0/check`, код 3, ни один check не запущен

### Requirement: Controller
<!-- id: REQ-VER-005 -->

После вычисления gates CLI SHALL вычислить входы controller из record, effective policy и verdicts: `policy_conflict`, `gate_verdict`
(худший verdict перехода в порядке `FAIL` > `BLOCKED` > `WAIVED` > `NOT_APPLICABLE` > `PASS`) и `gate_waivable` этого gate,
`blocking_unknowns`, `pending_approvals`, `gates_awaiting_attestation`, `unevaluated_gates`, `missing_required_artifacts`;
применить правила `controller/rules.json` всех подключённых packs в порядке загрузки, первое совпавшее — результат
(`controller_action`, `next`?, `rule`); правило, дающее `CONTINUE` при `gate_verdict` `FAIL` или `BLOCKED`, SHALL пропускаться с finding
`CONTROLLER_RULE_IGNORED` (id правила), а сопоставление — продолжаться (R-13); ни одно не совпало и худший verdict — `BLOCKED` → правило
kernel `verify-incomplete` (`WAIT`, `next: "verify"`; P-7, I-91); ни одно не совпало иначе → `CONTINUE` без `next`, `rule: null`.
Controller SHALL быть чистой функцией входов. Код выхода `gate` и `verify`: `CONTINUE` → 0, `STOP` → 1, `WAIT` и `ESCALATE` → 2;
при непустом `errors[]` — старший из кода действия и кодов ошибок по приоритету [REQ-KRN-003](../kernel/spec.md).

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
соответствующие gates получают `BLOCKED`, ошибка попадает в `errors[]`, код выхода — старший из кода ошибки и кода controller по
приоритету [REQ-KRN-003](../kernel/spec.md): `CHECK_TIMEOUT` или `BUSY` при `WAIT` — 4, `CHECK_NOT_CONFIGURED` или
`CHECK_LOCAL_FORBIDDEN` — 3.

#### Scenario: Повторяемый сбой check
<!-- id: SCN-VER-136 -->
- **WHEN** `warrant verify add-search --transition VERIFYING->MERGED`, где check `tests-passed` прерван по `execution.timeout_s`, а controller дал `WAIT`
- **THEN** `errors[]` содержит `CHECK_TIMEOUT` с `retryable: true`, `gates["tests-passed"]` равен `BLOCKED`, `controller_action` равен `WAIT`, код выхода 4

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

### Requirement: Команда ci
<!-- id: REQ-VER-011 -->

`warrant ci [--dry-run]` SHALL выносить вердикт pull request в CI и SHALL NOT коммитить и пушить
([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md) п. 1). HEAD SHALL быть результатом merge — merge-коммитом
ровно с двумя родителями: первый — tip базы, второй — head PR ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 3);
иначе `USAGE` с `hint`, код 3. `warrant ci` SHALL работать с состоянием в `.warrant`: заданный `WARRANT_STATE_DIR` — `USAGE`,
код 3. Diff — `HEAD^1..HEAD`. Репозиторий форжа — `GITHUB_REPOSITORY`, иначе из URL remote `origin`
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 6). Репозиторий SHALL определяться при первом обращении к форжу; вызов,
который к форжу не обращается (`--dry-run`, вид без проверки ref и run), его не проверяет. `GITHUB_REPOSITORY` не вида
`<owner>/<repo>`, а без него — `origin` нет или он не указывает на репозиторий форжа, — `USAGE` с `hint`, код 3: это ошибка
окружения, а не недоступный форж.

**База требований.** Всё, из чего `warrant ci` выводит требования к PR, SHALL читаться из packs и `warrant.json` дерева HEAD^1
(базы), а не из PR ([ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md) п. 1): policy-пути (`match.paths`
profile `factory-change`), `paths.src`, `paths.tests`, `roles`, `approvals[]`, effective policy и классификация по путям diff.
PR предъявляет только предмет суждения. Встроенный pack (`source: bundled`) приходит с CLI: pack базы — тот, чей `hash`
записан в `warrant.lock.json` HEAD^1. Встроенный pack, которого lock базы не содержит с этим `hash`, — закон, изменённый самим
PR: в виде impl `classification.profiles` на HEAD SHALL содержать `factory-change` (`RECORD_MISMATCH`, причина `classification`),
в остальных видах — `SCOPE_VIOLATION` с путём `.warrant/warrant.lock.json`. Ошибка загрузки базы `PACK_VERSION_RANGE` у такого pack
(его версия вне диапазона `warrant.json` базы) — следствие изменённого закона, а не сломанная база: `warrant ci` её не сообщает и
судит PR дальше; `PACK_VERSION_RANGE` у pack, совпадающего с lock базы, — код 3. Различие SHALL держаться на коде ошибки, а не на
тексте её `message` ([ADR-0052](../../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 2).

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
- при `change_state` record базы `SPECIFIED` и дальше каждый элемент `unknowns[]` базы остаётся на HEAD с тем же `id` и не
  ослабевает ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 3): `blocking: true` остаётся `true`, непустой
  `resolution` — непустым, заданные `resolved_as` и `ref` не удаляются и `resolved_as` не меняется, а blocking-элемент, закрытый
  на HEAD, несёт `resolved_as: "decision"` — его `ref` судит [REQ-VER-013](#requirement-решения-unknown-в-warrant-ci); иначе PR
  снял бы `WAIT` без maintainer'а, ведь verdict gate `blocking-unknowns-resolved` `warrant ci` не пересчитывает (причина
  `unknowns` с id UNKNOWN);
- в видах impl, archive и abandon `classification` на HEAD не слабее базы: `profiles` — надмножество профилей record базы и
  профилей, которые `classify` по packs базы выводит из путей diff PR; `risk_level` effective policy по packs базы — не ниже,
  чем у record базы; иначе PR снял бы с себя gates своего merge (причина `classification`);
- gate с вердиктом `WAIVED` нового перехода SHALL иметь хотя бы один waiver этого Change на этот gate (версия — по файлу, id WAV) — файл `.warrant/waivers/<WAV>.json`
  базы, а если в базе такого файла нет, то HEAD (новый waiver лежит на пути класса приёмки человеком, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 2) —
  засчитываемый по правилу waiver [REQ-VER-003](#requirement-команда-gate-и-алгоритм-verdict) на дату прогона `warrant ci` (UTC):
  `ACTIVE`, срок не истёк, `approved_by` в `roles` базы, gate `waivable` по определению базы, без `targets[]` (причина
  `waiver`; [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 5);
- gate с вердиктом `NOT_APPLICABLE` нового перехода SHALL иметь основание, как у REQ-VER-003, — одно из двух (иначе причина
  `not_applicable`):
  - в определении базы есть `applies_when`; у `MERGED` он SHALL быть не выполнен на diff `merge-base(M^1, M^2)..M^2` (M — из
    правила ref ниже; M не найден — diff не проверяется, нарушение даёт правило ref `merge_commit`); у остальных переходов diff их
    вычисления судье недоступен — достаточно наличия `applies_when` (остаточный риск, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 5);
  - `requires_evidence` определения базы непуст, и каждый его элемент удовлетворён (kind, а у элемента с `check` —
    `produced_by.id`) записью из `evidence[]` перехода с `evidence_status: "NOT_APPLICABLE"` и `produced_by.type: "check"`, у
    `MERGED` — ещё с `attestation.type: "ci"` и `subject.commit` M^2 (как правило `ci_evidence`). Gate без `requires_evidence`
    основания по evidence не имеет;
- у нового перехода `MERGED` `effective_policy_hash` равен hash effective policy, вычисленной по базе для `classification` на
  HEAD (причина `policy`); для каждого gate `PASS` этого перехода, чьи `requires_evidence` содержат kind, который производят
  checks перехода `VERIFYING->MERGED`, `evidence[]` содержит запись этого kind с `attestation.type: "ci"`, а у элемента с `check` —
  запись этого check (`produced_by.id`; [ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 6) (причина
  `ci_evidence`, [ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md) п. 2).
Требования к переходам выводятся из базы, а verdicts ни одного перехода record, в том числе новых, `warrant ci` заново
SHALL NOT вычислять; проверка основания записанных `WAIVED` и `NOT_APPLICABLE` (выше) — не вычисление: она читает файлы waiver и записи evidence, но не пересчитывает verdict. Доверие к ним держат другие проверки
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md), N44 уточнён review spec):
- ref подтверждений (ниже): maintainer слил spec-PR до `APPROVED` и impl-PR до `MERGED` (без gate `human-approval` — член `roles` или агент);
- merge-вердикт impl-PR, пересчитанный из evidence своего run;
- проверка CI-evidence по ссылке на archive-PR.
У `ARCHIVED` и `ABANDONED` ref нет: их держат локальный `warrant`, повтор archive для `openspec/specs/**` и merge PR — остаточный риск MVP; archive-PR сливает агент: состояние Change держат повтор archive и CI-evidence ref `MERGED`, правку путей класса приёмки в нём — только форж (`CODEOWNERS`, класс C).

**Ref.** `ref` нового перехода `APPROVED` или `MERGED` SHALL верифицироваться через API форджа
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 5):
- pull request этого репозитория, слит, `merged_by` входит в `roles[<role>]` для роли из `approvals[]` перехода в effective policy
  Change, а при пустом `approvals[]` — в `roles.maintainer`; `roles` и `approvals[]` — из базы требований: иначе PR вписал бы
  себе подтверждающего. Для ref `MERGED` `roles`, `approvals[]`, `identities.agents` и policy (packs, `.warrant/local/**`,
  конфигурация) берутся из M^1 — базы impl-PR, а не archive-PR: impl-PR, слитый агентом, не снимет с себя приёмку и не впишет себе
  роль. Классификация для этой policy — `classification` record Change на M, дополненная профилями, которые `classify` по packs
  M^1 выводит из diff `merge-base(M^1, M^2)..M^2`. Если effective policy по M^1 не содержит gate `human-approval` на
  `VERIFYING->MERGED`, `merged_by` SHALL входить в любую роль `roles` M^1 или в `identities.agents` M^1 ([ADR-0050](../../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 2, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md)
  п. 4): merge не акт одобрения, его держат merge-вердикт impl-PR и CI-evidence. Исключения нет (fail-closed), если policy по M^1
  содержит `human-approval`, если она не вычисляется текущим CLI (packs, lock, `kernel`, профиль `classification`, которого нет в
  packs M^1) или если record Change на M^1 есть и его `change_state` дальше `SPECIFIED` (реализация влита не одним impl-PR M —
  diff M не несёт кода прежних PR). Без вычисленной policy роль одобрения — `roles.maintainer` конфигурации M^1. Когда исключение
  закрыто не gate `human-approval`, а одной из двух других причин, вывод SHALL содержать информационную находку
  `{ code: "AGENT_MERGE_CLOSED", message }` с причиной — при любом исходе ref. Impl-PR, слитый не членом нужной роли,
  восстанавливается повтором impl-PR без правок кода (`VERIFYING->IMPLEMENTING->VERIFYING`), который сливает член роли одобрения;
- для `APPROVED` — merge-коммит PR лежит на first-parent линии HEAD^1 и вносит в record этого Change переход `SPECIFIED`;
- для `MERGED` — merge-коммит PR равен M, а head PR — второму родителю M. M — merge-коммит на first-parent линии HEAD^1, чей
  второй родитель равен общему `subject.commit` записей `attestation.type: "ci"` из `evidence[]` перехода; у них разные
  `subject.commit` — причина `merge_commit`. Таких записей нет (policy базы их не требует, правило `ci_evidence`) — M —
  merge-коммит PR из ref, если он лежит на first-parent линии HEAD^1 и вносит в record этого Change переход `VERIFYING`;
- если среди `evidence[]` перехода есть запись `human-approval`, её `produced_by.id` равен `merged_by`; нет такой записи
  (gate `human-approval` не требовался) — проверка не выполняется.
Иначе `REF_NOT_VERIFIED` с причиной (`repository`, `merged`, `merged_by`, `change`, `merge_commit`, `by`); причину `decision` даёт
проверка решений UNKNOWN ([REQ-VER-013](#requirement-решения-unknown-в-warrant-ci)). Идентичности агентов — логины
`identities.agents[].login` базы требований, для ref `MERGED` — M^1 ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 3). Если список
пуст, каждый ref без нарушения SHALL давать информационную находку `{ code: "SHARED_IDENTITY", message }` в `data.findings[]`
(акт maintainer'а не отличить от акта агента под тем же аккаунтом; ref с `REF_NOT_VERIFIED` находки не даёт), а `merged_by`,
равный автору PR, — информационную находку `APPROVER_IS_AUTHOR`, не нарушение. Если список непуст, `merged_by`, равный автору PR
(INV-03) или входящий в `identities.agents` (для ref `MERGED` — M^1), SHALL быть `REF_NOT_VERIFIED` с причиной `merged_by`, кроме ref `MERGED`, к которому применено исключение (выше); находки `APPROVER_IS_AUTHOR` и
`SHARED_IDENTITY` не выдаются. Если ни один объект policy базы (packs и `.warrant/local/**`) не добавляет gate `human-approval` на `VERIFYING->MERGED`, вывод SHALL содержать информационную находку `{ code: "NO_HUMAN_ACCEPTANCE", message }` в `data.findings[]`: merge impl-PR агентом не ограничен ни одним путём ([ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 4).

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
  - ошибки checks (`CHECK_TIMEOUT`, `BUSY`, `CHECK_NOT_CONFIGURED`, `CHECK_LOCAL_FORBIDDEN`) — в `errors[]` с кодом выхода их класса
    ([REQ-KRN-003](../kernel/spec.md): `CHECK_TIMEOUT` и `BUSY` — 4, остальные — 3), как в [REQ-VER-006](#requirement-команда-verify);
    gate с verdict `BLOCKED`, хотя бы один элемент `requires_evidence` которого удовлетворил бы check перехода, завершившийся
    такой ошибкой (элемент с `check` — только этот check, без `check` — любой check, чьи `produces` содержат kind элемента),
    SHALL NOT давать `GATE_NOT_PASSED`: его verdict — в `data.gates`, причина — ошибка check в
    `errors[]`; остальные gates `FAIL` и `BLOCKED` (например, `BLOCKED` с `ATTESTATION_REQUIRED` по kind другого check) дают
    `GATE_NOT_PASSED` по общему правилу;
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
- **none**: diff SHALL NOT трогать `openspec/changes/**`, `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**`,
  policy-пути, `paths.src` и `paths.tests` (код без Change, [ADR-0049](../../../../docs/adr/WARRANT-ADR-0049-flow.md) п. 7, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 8), иначе `SCOPE_VIOLATION`; без
  `paths.src` и `paths.tests` — запись в `skipped[]`.

**Вывод** — `data{ kind, change?, transitions[]{ to, at, ref? }, gates?, deferred[]?, findings[], skipped[], evidence[]?,
artifact?, dry_run?, would_write[]? }`; `transitions[]` — новые переходы; `evidence[]` — id записей, которые записал вид impl
или проверил через форж вид archive.

**Код выхода:**
- 0 — нарушений нет;
- 1 — хотя бы одно нарушение PR: коды выше, включая `TOPOLOGY_VIOLATION`, в `errors[]` с `hint`;
- 2 — `POLICY_CONFLICT` effective policy (класс ожидания, [REQ-KRN-003](../kernel/spec.md));
- 3 — ошибка конфигурации, `USAGE`, ошибка check `CHECK_NOT_CONFIGURED` или `CHECK_LOCAL_FORBIDDEN`, ошибка `openspec`, отказ
  доступа к форжу — `gh` не найден, не авторизован (HTTP 401) или получил HTTP 403 не из-за лимита запросов (`FORGE_ACCESS` с
  `hint` про `gh auth login` или `GH_TOKEN`). Репозиторий, невидимый токену, форж GitHub отдаёт как HTTP 404 — его не отличить от
  отсутствующего объекта, и он даёт ту же ошибку, что отсутствующий PR, run или комментарий;
- 4 — сбой инфраструктуры, повтор может пройти (`retryable: true`): форж недоступен (`FORGE_UNAVAILABLE`) — сеть, таймаут, ответ
  5xx, HTTP 429 или 403 лимита запросов, ответ, который не удалось разобрать (обрезанный или чужой — прокси), сбой загрузки
  неистёкшего artifact, а также любой другой сбой `gh`, не названный в коде 3; `CHECK_TIMEOUT`, `BUSY`. Artifact, который форж
  называет истёкшим, — не сбой форжа: `EVIDENCE_NOT_VERIFIED` (archive-PR) или запись в `data.skipped[]` (`ci fetch`);
- старший из кодов — по приоритету [REQ-KRN-003](../kernel/spec.md): нарушение PR (1) старше сбоя (4), и повтор его не снимет.
Исключение — проверка решений UNKNOWN в PR без нового перехода `APPROVED`: недоступный форж и отказ доступа там — находка
`DECISION_NOT_VERIFIED` (REQ-VER-013).

`--dry-run` — только план (в отличие от [REQ-KRN-034](../kernel/spec.md)): SHALL вывести `data.dry_run: true`, вид PR, Change,
checks и `data.would_write[]` без запуска checks и без обращения к форжу.

#### Scenario: spec-PR трогает код
<!-- id: SCN-VER-073 -->
- **WHEN** при `paths.src: "src"` diff PR содержит новый record `add-search` в `PROPOSED`, `openspec/changes/add-search/proposal.md`, запись review `.warrant/evidence/add-search/EVID-….json`, файл Run Change, `docs/adr/0042.md` и `src/app.py`
- **THEN** `data.kind` равен `spec`, `errors[]` содержит `SCOPE_VIOLATION` только с путём `src/app.py`, код 1; без `src/app.py` — код 0

#### Scenario: specs вне archive-PR
<!-- id: SCN-VER-074 -->
- **WHEN** diff PR без record ни одного Change содержит `openspec/specs/search/spec.md`
- **THEN** `data.kind` равен `none`, `errors[]` содержит `SCOPE_VIOLATION` с этим путём, код 1

#### Scenario: Вердикт impl-PR
<!-- id: SCN-VER-075 -->
- **WHEN** `warrant ci` под GitHub Actions на результате merge impl-PR Change `add-search` в `VERIFYING`, чья effective policy даёт `human-approval` на `VERIFYING->MERGED` (профиль приёмки), checks проходят, gate `human-approval` перехода `VERIFYING->MERGED` без evidence
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
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с причиной `merged_by`, код 1; если слил maintainer, он же автор PR, а `identities.agents` базы пуст, — `REF_NOT_VERIFIED` нет, а `data.findings[]` содержит `APPROVER_IS_AUTHOR` и `SHARED_IDENTITY` (код выхода задают остальные правила, SCN-VER-090)

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
- **WHEN** archive-PR требует проверки run, а `gh` не авторизован; или `gh api` не получил ответа (сеть) либо получил ответ 502
- **THEN** в первом случае `errors[0].code` равен `FORGE_ACCESS` с `hint` про `gh auth login` или `GH_TOKEN`, без `retryable`, код 3; во втором — `FORGE_UNAVAILABLE` с `retryable: true`, код 4

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
- **THEN** `errors[]` содержит `CHECK_TIMEOUT` с `retryable: true` и не содержит `GATE_NOT_PASSED` с `tests-passed`, `gates["tests-passed"]` равен `BLOCKED`, код 4; тот же PR с ещё и `SCOPE_VIOLATION` — код 1

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
- **WHEN** честный archive-PR `add-search` дополнительно меняет `src/app.py` при `paths.src: "src"`
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
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `ci_evidence`; для пустого `gates` — с причиной `policy`; gate `PASS` перехода `MERGED` требует `{ kind: "test-report", check: "dev-check" }`, а `evidence[]` перехода несёт CI-запись `test-report` только от `tests-passed` — тоже `RECORD_MISMATCH` с причиной `ci_evidence` (design I-205); код 1

#### Scenario: Решение UNKNOWN не ослабляется
<!-- id: SCN-VER-116 -->
- **WHEN** record базы impl-PR в `SPECIFIED` содержит blocking `UNK-SRC-004`, закрытый решением с `ref`, а на HEAD этот элемент удалён; либо на HEAD у него `blocking: false`; либо `resolved_as: "fact"`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `unknowns` и `UNK-SRC-004`, код 1; открытый в базе blocking `UNK-SRC-005`, закрытый на HEAD решением с `ref`, `RECORD_MISMATCH` не даёт (его `ref` судит REQ-VER-013)

#### Scenario: Общий аккаунт и самослияние
<!-- id: SCN-VER-120 -->
- **WHEN** impl-PR вносит переход `APPROVED` с `ref` spec-PR, который слил `kat` из `roles.maintainer`, он же автор PR; `identities.agents` базы пуст
- **THEN** `REF_NOT_VERIFIED` нет, `data.findings[]` содержит `SHARED_IDENTITY` и `APPROVER_IS_AUTHOR`; при `identities.agents` базы `[{ "login": "warrant-agent[bot]" }]` — `REF_NOT_VERIFIED` с причиной `merged_by`, код 1, находок `SHARED_IDENTITY` и `APPROVER_IS_AUTHOR` нет; spec-PR открыл `warrant-agent[bot]`, слил `kat` — нет ни `REF_NOT_VERIFIED`, ни этих находок; слил `warrant-agent[bot]` — `REF_NOT_VERIFIED` с причиной `merged_by`

#### Scenario: WAIVED без засчитываемого waiver
<!-- id: SCN-VER-127 -->
- **WHEN** archive-PR вносит переход `MERGED` с `tests-passed: WAIVED`, а waiver этого Change на `tests-passed` в базе `REVOKED` и на HEAD `ACTIVE`, либо его нет ни в базе, ни на HEAD, либо его срок раньше даты прогона
- **THEN** `RECORD_MISMATCH` с причиной `waiver`, код 1; waiver `ACTIVE` в базе, одобренный логином из `roles` базы, со сроком не раньше даты прогона, при `waivable: true` gate — правило не нарушено

#### Scenario: NOT_APPLICABLE без основания
<!-- id: SCN-VER-128 -->
- **WHEN** переход `MERGED` записывает `NOT_APPLICABLE` gate с `applies_when.changed_paths: ["packages/cli/src/**"]`, diff `merge-base(M^1, M^2)..M^2` правит `packages/cli/src/a.ts`, а у записи evidence gate `evidence_status: "PROVEN"`
- **THEN** `RECORD_MISMATCH` с причиной `not_applicable`, код 1; тот же переход, где каждый элемент `requires_evidence` gate удовлетворён CI-записью `NOT_APPLICABLE` от check на M^2, — правило не нарушено; `scope-valid: NOT_APPLICABLE` (без `applies_when` и без `requires_evidence`) — `not_applicable`

#### Scenario: Реализация не одним impl-PR
<!-- id: SCN-VER-135 -->
- **WHEN** PR1 с кодом класса и record в `IMPLEMENTING` слит в `main`; impl-PR M несёт только `IMPLEMENTING->VERIFYING`, его слил `homasters`; record Change на M^1 — `IMPLEMENTING`, effective policy по M^1 не содержит `human-approval`
- **THEN** `REF_NOT_VERIFIED` с причиной `merged_by` и находка `AGENT_MERGE_CLOSED`, код 1; тот же PR, слитый членом `roles.maintainer` M^1 (не автором PR), — ref верифицирован, находка `AGENT_MERGE_CLOSED` есть, код 0; в SCN-VER-131 находки нет

#### Scenario: Impl-PR снял с себя приёмку
<!-- id: SCN-VER-129 -->
- **WHEN** impl-PR, слитый `homasters` из `identities.agents`, правит `packages/cli/src/core/ci/refs.ts`, сузил `match.paths` профиля приёмки в `.warrant/local/**` и убрал профиль из record; archive-PR вносит `MERGED` с его `ref`. Либо тот же impl-PR перенёс `homasters` из `identities.agents` в `roles.maintainer`
- **THEN** `REF_NOT_VERIFIED` с причиной `merged_by`, код 1: `classify` по packs M^1 выводит профиль приёмки из diff impl-PR, а `roles` и agents берутся из M^1

#### Scenario: Impl-PR слил агент без human-approval
<!-- id: SCN-VER-130 -->
- **WHEN** archive-PR вносит `MERGED` с `ref` impl-PR, который открыл и слил `homasters` из `identities.agents` M^1, а effective policy по M^1 не содержит `human-approval` на `VERIFYING->MERGED`
- **THEN** ref верифицирован: нет `REF_NOT_VERIFIED`, нет находок `SHARED_IDENTITY` и `APPROVER_IS_AUTHOR`, код 0; тот же PR, слитый логином вне `roles` и `identities.agents` M^1, — `REF_NOT_VERIFIED` с причиной `merged_by`, код 1

#### Scenario: Impl-PR слил агент при human-approval
<!-- id: SCN-VER-131 -->
- **WHEN** тот же archive-PR, но effective policy по M^1 содержит `human-approval` на `VERIFYING->MERGED` (профиль приёмки по путям diff)
- **THEN** `REF_NOT_VERIFIED` с причиной `merged_by`, код 1

#### Scenario: Spec-PR слил агент
<!-- id: SCN-VER-132 -->
- **WHEN** impl-PR вносит `APPROVED` с `ref` spec-PR, который слил `homasters` из `identities.agents` базы; `approvals[]` перехода `SPECIFIED->APPROVED` пуст
- **THEN** `REF_NOT_VERIFIED` с причиной `merged_by`, код 1: одобрение spec — член `roles.maintainer`

#### Scenario: Код без Change
<!-- id: SCN-VER-133 -->
- **WHEN** PR без Change (вид none) правит `src/a.ts` при `paths.src: "src"`
- **THEN** `SCOPE_VIOLATION` с путём `src/a.ts`, код 1; без `paths.src` и `paths.tests` — запись в `skipped[]`, нарушения нет, код 0

#### Scenario: Проект без приёмки человеком
<!-- id: SCN-VER-134 -->
- **WHEN** `warrant ci` в проекте, где ни pack, ни `.warrant/local/**` не дают `human-approval` на `VERIFYING->MERGED`
- **THEN** `data.findings[]` содержит `NO_HUMAN_ACCEPTANCE`; находка информационная, код выхода она не меняет

#### Scenario: Замок check занят в ci
<!-- id: SCN-VER-137 -->
- **WHEN** на impl-PR check перехода `VERIFYING->MERGED` с `exclusive: true` не запущен: `<git-common-dir>/warrant/check.lock` держит другой процесс
- **THEN** `errors[]` содержит `BUSY` с `retryable: true` и не содержит `GATE_NOT_PASSED`, gate этого check — `BLOCKED` в `data.gates`, код 4

#### Scenario: Неверный GITHUB_REPOSITORY
<!-- id: SCN-VER-138 -->
- **WHEN** archive-PR требует проверки run, а `GITHUB_REPOSITORY` равен `not-a-repo`
- **THEN** `errors[0].code` равен `USAGE` с `hint` про форму `<owner>/<repo>`, без `retryable`, код 3; к форжу не было обращений; тот же `GITHUB_REPOSITORY` у spec-PR без нового перехода `APPROVED` и без решений UNKNOWN — код 0, а у spec-PR с решением UNKNOWN — `USAGE`, код 3, без находки `DECISION_NOT_VERIFIED`

#### Scenario: Изменённый PR pack вне диапазона базы
<!-- id: SCN-VER-139 -->
- **WHEN** impl-PR поднимает встроенный pack `core-sdd` с `0.3.4` до `0.4.0` и диапазон в `warrant.json` до `^0.4.0`, а `warrant.json` базы задаёт `^0.3.0`
- **THEN** `PACK_VERSION_RANGE` базы в `errors[]` нет, PR судится по остальным правилам; тот же `PACK_VERSION_RANGE` у pack, чей `hash` есть в lock базы, — код 3

### Requirement: Команда ci fetch
<!-- id: REQ-VER-012 -->

`warrant ci fetch <pr> [--dry-run]` SHALL положить в `<state>/evidence/<change>/` evidence CI слитого impl-PR
([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 14, [ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 4).
`<pr>` — номер или URL pull request этого репозитория.

**Ошибки** (ничего не записано; код — по классу кода, [REQ-KRN-003](../kernel/spec.md): 3, если не назван другой):
- URL другого репозитория — `USAGE`;
- заданный `WARRANT_STATE_DIR` — `USAGE`: записи едут в archive-PR, состояние — в `.warrant`, как у `warrant ci`;
- PR не найден (в том числе репозиторий, невидимый токену: HTTP 404) — `PR_NOT_FOUND`;
- отказ доступа к форжу — `FORGE_ACCESS` с `hint`; форж недоступен — `FORGE_UNAVAILABLE` с `retryable: true`, код 4;
- PR не слит или слит не merge-коммитом (squash, rebase) — `PR_NOT_MERGED`;
- merge-коммита M нет в локальном репозитории — `COMMIT_NOT_FOUND` с `hint` `git fetch`;
- Change — тот, чей record меняет diff `M^1..M`; не ровно один — `TOPOLOGY_VIOLATION`, код 1: класс кода один во всех командах ([REQ-KRN-003](../kernel/spec.md)), как у `warrant ci`;
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
занятый lock — `BUSY` с `retryable: true`, код 4. Файлы записей пишутся до manifest: прерванный импорт доводит повторный `ci fetch`. Запись с тем же id и тем же содержимым пропускается — повторный `ci fetch` ничего не меняет. Запись с тем же id и
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

### Requirement: Решения UNKNOWN в warrant ci
<!-- id: REQ-VER-013 -->

`warrant ci` ([REQ-VER-011](#requirement-команда-ci)) SHALL проверять через форж каждый элемент `unknowns[]` record Change на HEAD
с `blocking: true` и `resolved_as: "decision"` ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 3). Деталь нарушения:
- `form` — `ref` не URL комментария pull request вида `https://<host>/<owner>/<repo>/pull/<N>#issuecomment-<id>` или
  `…#pullrequestreview-<id>` (в том числе `#discussion_r…`);
- `repository` — `<owner>/<repo>` не репозиторий форжа;
- `missing` — комментария нет;
- `author` — автор комментария не входит в `roles.maintainer` базы требований (HEAD^1) или входит в `identities.agents` базы
  ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 3);
- `text` — текст комментария не содержит id этого UNKNOWN;
- `pull_request` — комментарий по ответу форжа принадлежит не PR `<N>` из `ref` (id комментария уникален в репозитории, а не в PR);
  либо PR вносит новый переход `APPROVED`, а `<N>` не номер PR из `ref` этого перехода (spec-PR Change).
В PR с новым переходом `APPROVED` нарушение SHALL быть ошибкой `REF_NOT_VERIFIED`: `message` начинается с
`unknowns/<i> (<UNK>) ref <URL>: decision: <деталь>`, `path` — `.warrant/changes/<change>.json#/unknowns/<i>/ref`, код 1;
недоступный форж — `FORGE_UNAVAILABLE` (код 4), отказ доступа — `FORGE_ACCESS` (код 3), как у ref переходов. В остальных видах PR
решение ещё не судит переход: нарушение, недоступный форж и отказ доступа (деталь `forge`; неверный репозиторий форжа — ошибка
окружения `USAGE`, код 3, а не находка) SHALL быть находкой `{ code: "DECISION_NOT_VERIFIED", message }` в `data.findings[]` с тем же
началом `message`, код выхода от неё не меняется. Причина `decision` и находка вместо `FORGE_UNAVAILABLE` и `FORGE_ACCESS` — исключения из списка причин
`REF_NOT_VERIFIED` и кодов форжа [REQ-VER-011](#requirement-команда-ci), названные и там.
При пустом `identities.agents` базы каждое проверенное решение без нарушения SHALL давать информационную находку
`{ code: "SHARED_IDENTITY", message }` с тем же началом `message`: комментарий maintainer'а не отличить от комментария агента под тем
же аккаунтом ([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md), Alternatives); код выхода от неё не меняется.

#### Scenario: Решение maintainer'а в spec-PR
<!-- id: SCN-VER-111 -->
- **WHEN** impl-PR вносит переход `APPROVED` с `ref` `https://github.com/o/r/pull/7`, а record содержит blocking `UNK-SRC-004` с `resolved_as: "decision"` и `ref` `https://github.com/o/r/pull/7#issuecomment-11`; комментарий оставил `kat` из `roles.maintainer` базы, его текст содержит `UNK-SRC-004`
- **THEN** `REF_NOT_VERIFIED` нет, код 0

#### Scenario: Решение не maintainer'а или не о том
<!-- id: SCN-VER-112 -->
- **WHEN** тот же impl-PR, но автор комментария `issuecomment-11` — `bob` вне `roles.maintainer` базы; либо автор `kat`, а текст не содержит `UNK-SRC-004`
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с `message`, начинающимся с `unknowns/0 (UNK-SRC-004) ref https://github.com/o/r/pull/7#issuecomment-11: decision: author` (во втором случае — `decision: text`), `path` `.warrant/changes/add-search.json#/unknowns/0/ref`, код 1

#### Scenario: Решение в чужом PR или не комментарий
<!-- id: SCN-VER-113 -->
- **WHEN** ref решения — `https://github.com/o/r/pull/5#issuecomment-3` (комментарий `kat` с id UNKNOWN), а ref перехода `APPROVED` — PR 7; либо ref решения — `https://github.com/o/r/pull/7#issuecomment-3`, а форж отвечает, что этот комментарий оставлен в PR 5; либо ref решения — `https://github.com/o/r/pull/7#discussion_r9`
- **THEN** в первых двух случаях `REF_NOT_VERIFIED` с деталью `decision: pull_request`, в третьем — `decision: form`, код 1

#### Scenario: Нет комментария или чужой репозиторий
<!-- id: SCN-VER-115 -->
- **WHEN** форж отвечает, что комментария `issuecomment-11` нет; либо ref решения — `https://github.com/x/y/pull/7#issuecomment-11` при репозитории `o/r`
- **THEN** `REF_NOT_VERIFIED` с деталью `decision: missing`, во втором случае — `decision: repository`, код 1

#### Scenario: Решение в spec-PR до approval
<!-- id: SCN-VER-114 -->
- **WHEN** spec-PR закрывает blocking UNKNOWN решением с `ref` на комментарий `bob` вне `roles.maintainer`; либо форж недоступен
- **THEN** `data.findings[]` содержит `{ code: "DECISION_NOT_VERIFIED" }` с `message`, содержащим `decision: author` (во втором случае — `decision: forge`), `errors[]` без `REF_NOT_VERIFIED` и `FORGE_UNAVAILABLE` по решению, код не меняется от этой находки

#### Scenario: Решение от идентичности агента
<!-- id: SCN-VER-121 -->
- **WHEN** impl-PR вносит переход `APPROVED`; blocking `UNK-SRC-004` закрыт решением с `ref` на комментарий `warrant-agent[bot]`, который входит в `identities.agents` базы (и, ошибкой конфигурации, в `roles.maintainer`); либо комментарий оставил `kat`, а `identities.agents` базы пуст
- **THEN** в первом случае `REF_NOT_VERIFIED` с `message`, содержащим `decision: author`, код 1; во втором — `REF_NOT_VERIFIED` нет, `data.findings[]` содержит `SHARED_IDENTITY` с `message`, начинающимся с `unknowns/0 (UNK-SRC-004) ref`
