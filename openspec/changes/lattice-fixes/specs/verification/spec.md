## MODIFIED Requirements

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
Parser `junit` SHALL считать документ по элементам `<testcase>`, где бы они ни лежали (в том числе вне любого `<testsuite>`):
`tests` — их число; у каждого `<testcase>` — один исход по первому подходящему дочернему элементу в порядке `<skipped>` →
`skipped`, `<failure>` → `failures`, `<error>` → `errors` (упавший `todo` `node:test` несёт `<skipped>` и `<failure>` и прогон не
валит; падение и ошибка teardown pytest — одно падение); комментарии и CDATA — не разметка; атрибуты `<testsuite>` SHALL
учитываться только у документа без единого `<testcase>`, итоги `<testsuites>` — никогда; документы без `<testcase>` и
`<testsuite>` — `INCONCLUSIVE` с limitation `junit: no <testcase> or <testsuite> found in {out}` (`{out}` — буквально)
([ADR-0042](../../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) п. 2).
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

#### Scenario: Отчёт node:test
<!-- id: SCN-VER-117 -->
- **WHEN** junit override'а `tests-passed` — отчёт `node --test --test-reporter=junit`: четыре `<testcase>` прямо в `<testsuites>` (один с `<failure>`, два с `<skipped>`) и `<testsuite>` с одним `<testcase>` и вложенным `<testsuite>` из двух `<testcase>` (один с `<failure>`), атрибуты suite — `tests="2" failures="1" skipped="1"` и `tests="2" failures="1"`
- **THEN** запись имеет `evidence_status: "NOT_PROVEN"` и `metrics` `{ "tests": 7, "failures": 2, "errors": 0, "skipped": 2 }`; отчёт только из двух `<testcase>` без `<testsuite>` и падений — `PROVEN` с `tests: 2`; `<testcase>` с `<skipped type="todo">` и `<failure>` считается пропуском, с `<failure>` и `<error>` — падением
