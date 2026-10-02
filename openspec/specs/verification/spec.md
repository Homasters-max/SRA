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
`evidence_status`. Из допустимых записей по kind SHALL браться самая свежая по `created_at`; у элемента `requires_evidence[]` с
`check` — самая свежая из записей этого kind с `produced_by.type: "check"` и `produced_by.id`, равным `check`: записи других
producers того же kind SHALL NOT закрывать и маскировать требование, а finding `NO_EVIDENCE` называет check
([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 6).
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

#### Scenario: Требование к записи одного check
<!-- id: SCN-VER-119 -->
- **WHEN** gate требует `{ kind: "test-report", status: "PROVEN", check: "dev-check" }`, а допустимые записи — `test-report` `PROVEN` от check `tests-passed` (новее) и `test-report` `NOT_PROVEN` от check `dev-check`
- **THEN** verdict `FAIL` по записи `dev-check`; без записи `dev-check` — `BLOCKED` с finding `NO_EVIDENCE`, называющим `dev-check`; то же требование без `check` — `PASS` по записи `tests-passed`

### Requirement: Вычисляемые L0 gates core-sdd
<!-- id: REQ-VER-004 -->

Gates без `requires_evidence` SHALL вычисляться CLI из состояния проекта: `required-artifacts-present` — каждый artifact
`artifacts.required` effective policy имеет статус `done` по `openspec status --json` (для `chore` со `skip_specs` — `skipped`
засчитывается для `specs`); `ids-valid` — проверка (5) `validate` без находок; `blocking-unknowns-resolved` — в record нет элемента `unknowns[]`
с `blocking: true` без непустого `resolution` (finding `BLOCKING_UNKNOWN`) и нет blocking-элемента с непустым `resolution`,
но без `resolved_as: "decision"` и `ref` (finding `DECISION_WITHOUT_REF`; blocking UNKNOWN закрывает только решение
maintainer'а, автора проверяет `warrant ci`, [REQ-VER-013](#requirement-решения-unknown-в-warrant-ci)); не-blocking элементы gate
не судит; `branch-isolated` — текущая ветка git существует и не равна base (`main`); `evidence-complete` —
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

#### Scenario: Blocking без решения
<!-- id: SCN-VER-110 -->
- **WHEN** record содержит `unknowns: [{ "id": "UNK-SRC-001", "text": "…", "blocking": true, "resolution": "Нет", "resolved_as": "decision" }]` без `ref`, либо тот же элемент с `resolved_as: "fact"`
- **THEN** `gates["blocking-unknowns-resolved"]` равен `FAIL` с finding `DECISION_WITHOUT_REF`, перечисляющим `UNK-SRC-001`; с `resolved_as: "decision"` и `ref` — `PASS`; не-blocking элемент с `resolved_as: "fact"` без `ref` — `PASS`

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

### Requirement: Команда analyze
<!-- id: REQ-VER-010 -->

`warrant analyze <change> [--base <ref>]` SHALL детерминированно сверить delta specs, `tasks.md` и тесты Change по ID и ссылкам
([06 §5](../../../../docs/06-verification.md), [ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 2) и SHALL NOT ничего записывать. Каталог Change —
`openspec/changes/<change>/`, а если его нет — каталог архива с именем ровно `<YYYY-MM-DD>-<change>`, при нескольких — с последней
датой (BL-43: `analyze-clean` на
`MERGED->ARCHIVED` вычисляется и после `openspec archive`). Входы: требования delta specs Change
по секциям `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` с их REQ и SCN; REQ и SCN main specs `openspec/specs/**`; текст
`tasks.md` каталога Change; файлы под `paths.tests`; пути diff `base...HEAD` (base — как у gate `scope-valid`); REQ и SCN
секций `ADDED` и `MODIFIED` delta specs других открытых Change — каждого каталога `openspec/changes/<другой>/`, кроме
`archive/` и каталога самого Change, независимо от record. Все входы читаются из одного дерева: рабочего дерева у команды,
оцениваемого commit у gate `analyze-clean`. Запись в `openspec/changes/`, которая не каталог, каталог без `specs/` и delta,
которая не разбирается, ID не дают и в `data.skipped[]` не попадают.
ID «определён», если он объявлен в main specs или в `ADDED` / `MODIFIED` delta и не объявлен в `REMOVED` delta. Находки:
- `UNSATISFIED` `{ id, missing[] }` — REQ из `ADDED` или `MODIFIED`, если `tasks.md` не упоминает ни его, ни один его SCN
  (`missing` ∋ `task`), или ни один его SCN не встречается ни в одном файле под `paths.tests` (`missing` ∋ `test`; REQ без SCN —
  тоже `test`);
- `CONFLICT` `{ id, path }` — `tasks.md` упоминает REQ или SCN, который не определён;
- `ORPHAN` `{ id, path }` — файл под `paths.tests`, изменённый в diff и не удалённый, упоминает SCN, который не определён и
  не объявлен в delta другого открытого Change (даже если delta самого Change его удаляет в `REMOVED`). Так тест Change, чей
  impl-PR слит раньше archive-PR, не держит `analyze-clean` чужого Change: его SCN объявлены в delta, пока archive-PR не
  перенёс их в main specs.

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

#### Scenario: SCN другого открытого Change
<!-- id: SCN-VER-152 -->
- **WHEN** `tests/test_store.py` изменён в diff и упоминает `SCN-STO-001`, которого нет ни в main specs, ни в delta `add-search`,
  а delta `openspec/changes/add-store/specs/` объявляет его в `ADDED`; тот же файл упоминает `SCN-STO-009`, объявленный только
  в delta `openspec/changes/archive/2026-09-01-old-store/specs/`
- **THEN** `warrant analyze add-search` даёт одну находку `ORPHAN` с `id: "SCN-STO-009"` и `path: "tests/test_store.py"`,
  `counts.ORPHAN` равен 1, код 1; `SCN-STO-001` находкой не является

#### Scenario: Gate на commit со слитым чужим impl-PR
<!-- id: SCN-VER-153 -->
- **WHEN** на оцениваемом commit тест `tests/test_store.py` из diff упоминает только `SCN-STO-001`, объявленный в delta
  открытого Change `add-store`, а `add-search` в `MERGED`; вызван `warrant gate add-search --transition MERGED->ARCHIVED`
- **THEN** `gates["analyze-clean"]` равен `PASS`; если `add-store` на этом commit уже в архиве, а `SCN-STO-001` нет в main
  specs, — `FAIL` с находкой `ORPHAN`

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

### Requirement: Reusable workflow job warrant
<!-- id: REQ-VER-014 -->

WARRANT SHALL поставлять job `warrant` ([REQ-VER-011](#requirement-команда-ci)) как reusable workflow
`.github/workflows/warrant.yml` своего репозитория с триггером `workflow_call` ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 7).
Входы: `warrant` — обязательный: тег CLI (`v<semver>`), который устанавливается глобально из tarball этого тега — `npm pack
"github:Homasters-max/SRA#<тег>" --ignore-scripts=false` в каталоге вне checkout вызывающего (временный каталог runner'а: `.npmrc`
проекта не отключает сборку `prepare`), затем `npm i -g` файла tarball (глобальная установка git-зависимости не исполняет
`prepare` и не собирает CLI — BL-52, [ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 7); тега нет, сборка
или реестр npm отказали — шаг установки падает до `warrant ci`, или буквально
`checkout` — CLI из checkout вызывающего, только если checkout — репозиторий WARRANT (`packages/cli/package.json` с именем пакета
CLI; design I-208); другое значение или `checkout` в чужом репозитории SHALL останавливать job до `warrant ci` с ошибкой шага,
называющей допустимые значения; `setup` — команды подготовки проекта (bash, default пусто), выполняемые после
checkout и merge PR в tip базы; `node-version` (default `22`); `openspec-version` (default `1.13.1`); `merge_commit` — merge-коммит
impl-PR для recovery-прогона ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 4, default пусто).
Шаги SHALL быть шагами job `warrant`: checkout head PR (или `merge_commit`) с полной историей, merge в tip базы (кроме recovery),
`setup`, OpenSpec, CLI, `warrant validate` и `warrant sync --check` (красный шаг — красный job: дрейф сгенерированных файлов и lock против `warrant.json`; согласованную правку с перегенерацией держит защита форжа, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 3, 7), `warrant ci` с выводом вне checkout, upload artifact по `data.artifact`. Секретов workflow SHALL NOT
требовать: токен — `github.token` вызывающего; вызывающий SHALL дать job права `contents: read`, `actions: read`,
`pull-requests: read`, `issues: read` (форж `warrant ci`). Тег CLI во входе `warrant` и ref, по которому вызван workflow, выбирает
вызывающий; пример 06 §8 даёт один тег в обоих местах. Workflow `ci.yml` этого репозитория SHALL вызывать job `warrant` через
него с `warrant: checkout` (один источник); проект под WARRANT вызывает его по тегу CLI вместо копии job. Имя проверки в GitHub
становится `warrant / warrant`: обязательные проверки branch protection настраивает maintainer проекта; WARRANT их не требует
(показ настроек форжа — класс C модели угроз, [ADR-0048](../../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2, цикл 1; 06 §8).

#### Scenario: Job warrant из reusable workflow
<!-- id: SCN-VER-122 -->
- **WHEN** читаются `.github/workflows/warrant.yml` и `.github/workflows/ci.yml` репозитория
- **THEN** `warrant.yml` объявляет `workflow_call` со входами `setup`, `node-version`, `openspec-version`, `warrant` (обязательный), `merge_commit`, шаг проверки входа `warrant` до установки CLI, шаги `warrant validate` и `warrant sync --check` после установки CLI и до шага `warrant ci`; для тега CLI ставится `npm pack "github:Homasters-max/SRA#<тег>" --ignore-scripts=false` в каталоге под `$RUNNER_TEMP` и `npm i -g` файла `.tgz`, установки `npm i -g github:` нет; job `warrant` в `ci.yml` — `uses: ./.github/workflows/warrant.yml` с `warrant: checkout`, без собственных `steps`, с правами `contents`, `actions`, `pull-requests`, `issues` на чтение; `merge_commit` передаётся из входа `workflow_dispatch`

### Requirement: Job test репозитория по shard
<!-- id: REQ-VER-015 -->

Workflow `ci.yml` репозитория WARRANT SHALL на каждом PR гонять все файлы тестов всех уровней (ADR-0025 п. 8) в matrix job `test`
со `strategy.fail-fast: false`: на `ubuntu-latest` — одним job без `--shard`, на `windows-latest` — двумя параллельными job
`vitest --shard` `1/2` и `2/2`, вместе покрывающими все файлы. Имена проверок SHALL быть ровно `test (ubuntu-latest)`,
`test (windows-latest, 1/2)`, `test (windows-latest, 2/2)`. Typecheck, установка CLI из checkout и `warrant validate` (репозиторий
и фикстура) SHALL выполняться один раз на ОС — в job ubuntu и в shard `1/2`. Job `test` — сигнал разработки, не evidence: gate
`tests-passed` получает evidence от полного `npm test`, который check `tests-passed` запускает в job `warrant`
([REQ-VER-011](#requirement-команда-ci)); shard его не сужают. Обязательные проверки branch protection `main` — настройка репозитория
вне WARRANT (REQ-VER-014): при смене имён проверок их обновляет maintainer.

#### Scenario: Windows по shard
<!-- id: SCN-VER-124 -->
- **WHEN** читается `.github/workflows/ci.yml` репозитория
- **THEN** job `test` — `strategy.fail-fast: false`, matrix `include` ровно из `ubuntu-latest` с пустым `shard`, `windows-latest` с `shard` `1/2` и `windows-latest` с `shard` `2/2`; имя job — `test (${{ matrix.os }})` с `, <shard>` только при непустом `shard`; шаг `Test` передаёт `--shard=<shard>` в `npm test` только при непустом `shard`; шаги `Typecheck`, `Install warrant from the checkout`, `warrant validate (repository)` и `warrant validate (fixture project)` пропускаются в shard `2/2`

### Requirement: Канарейка поставки
<!-- id: REQ-VER-016 -->

Репозиторий WARRANT SHALL исполнять поставку так, как её получает потребитель ([ADR-0048](../../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 5, WS-02).
До merge: e2e SHALL ставить tarball `npm pack` checkout'а глобально в изолированный префикс и вызывать установленный CLI в
пустом каталоге вне репозитория — зависимости и `dist` приходят только из tarball; вызов SHALL загружать команду (`warrant
validate`), а не только печатать версию. После тега: workflow `.github/workflows/canary.yml` SHALL на push тега `v*` и на
`workflow_dispatch` вызывать reusable workflow того же коммита (`uses: ./.github/workflows/warrant.yml`) с `warrant: ${{
github.ref_name }}` и правами `contents`, `actions`, `pull-requests`, `issues` на чтение, без собственных `steps`; запуск не с
тега `v*` job SHALL пропускать. Тег релиза стоит на merge-коммите archive-PR релиза (шаг тега навыка `change-archive-pr`,
[ADR-0047](../../../../docs/adr/WARRANT-ADR-0047-pr-cycle.md) п. 4): на нём `warrant ci` судит archive-PR, как в его CI. Тег ставит
сессия push'ем — канарейку запускает push; тег, поставленный workflow с `GITHUB_TOKEN`, push-событий не порождает — тот
workflow SHALL запускать `gh workflow run canary.yml --ref <тег>`. Красная канарейка — не evidence и не gate: упал шаг установки
CLI — поставка сломана, patch до потребителя; упал `warrant ci` — суждение на коммите тега, строка backlog.

#### Scenario: Канарейка на теге
<!-- id: SCN-VER-125 -->
- **WHEN** читается `.github/workflows/canary.yml` репозитория
- **THEN** триггеры — `push` с `tags: ["v*"]` и `workflow_dispatch`; единственный job — `if: startsWith(github.ref, 'refs/tags/v')`, `uses: ./.github/workflows/warrant.yml` с `warrant: ${{ github.ref_name }}`, без собственных `steps`, с правами `contents`, `actions`, `pull-requests`, `issues` на чтение

#### Scenario: CLI из tarball вне репозитория
<!-- id: SCN-VER-126 -->
- **WHEN** tarball `npm pack` checkout'а WARRANT установлен `npm i -g --prefix <временный каталог>`, и установленный CLI вызван в пустом временном каталоге: `warrant --version`, затем `warrant validate`
- **THEN** `--version` — код 0 и версия из `package.json` репозитория; `validate` — JSON-ответ `command: "validate"`, `ok: false`, ошибка `CONFIG_MISSING`
