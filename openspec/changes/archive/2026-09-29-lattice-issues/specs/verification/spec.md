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
- при `change_state` record базы `SPECIFIED` и дальше каждый элемент `unknowns[]` базы остаётся на HEAD с тем же `id` и не
  ослабевает ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 3): `blocking: true` остаётся `true`, непустой
  `resolution` — непустым, заданные `resolved_as` и `ref` не удаляются и `resolved_as` не меняется, а blocking-элемент, закрытый
  на HEAD, несёт `resolved_as: "decision"` — его `ref` судит [REQ-VER-013](#requirement-решения-unknown-в-warrant-ci); иначе PR
  снял бы `WAIT` без maintainer'а, ведь verdict gate `blocking-unknowns-resolved` `warrant ci` не пересчитывает (причина
  `unknowns` с id UNKNOWN);
- в видах impl, archive и abandon `classification` на HEAD не слабее базы: `profiles` — надмножество профилей record базы и
  профилей, которые `classify` по packs базы выводит из путей diff PR; `risk_level` effective policy по packs базы — не ниже,
  чем у record базы; иначе PR снял бы с себя gates своего merge (причина `classification`);
- у нового перехода `MERGED` `effective_policy_hash` равен hash effective policy, вычисленной по базе для `classification` на
  HEAD (причина `policy`); для каждого gate `PASS` этого перехода, чьи `requires_evidence` содержат kind, который производят
  checks перехода `VERIFYING->MERGED`, `evidence[]` содержит запись этого kind с `attestation.type: "ci"`, а у элемента с `check` —
  запись этого check (`produced_by.id`; [ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 6) (причина
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
Иначе `REF_NOT_VERIFIED` с причиной (`repository`, `merged`, `merged_by`, `change`, `merge_commit`, `by`); причину `decision` даёт
проверка решений UNKNOWN ([REQ-VER-013](#requirement-решения-unknown-в-warrant-ci)). Идентичности агентов — логины
`identities.agents[].login` базы требований ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 3). Если список
пуст, каждый ref без нарушения SHALL давать информационную находку `{ code: "SHARED_IDENTITY", message }` в `data.findings[]`
(акт maintainer'а не отличить от акта агента под тем же аккаунтом; ref с `REF_NOT_VERIFIED` находки не даёт), а `merged_by`,
равный автору PR, — информационную находку `APPROVER_IS_AUTHOR`, не нарушение. Если список непуст, `merged_by`, равный автору PR
(INV-03) или входящий в `identities.agents`, SHALL быть `REF_NOT_VERIFIED` с причиной `merged_by`; находки `APPROVER_IS_AUTHOR` и
`SHARED_IDENTITY` не выдаются.

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
  `hint` про `gh auth login` или `GH_TOKEN`); исключение — проверка решений UNKNOWN в PR без
  нового перехода `APPROVED`: недоступный форж там — находка `DECISION_NOT_VERIFIED` (REQ-VER-013).

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
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `ci_evidence`; для пустого `gates` — с причиной `policy`; gate `PASS` перехода `MERGED` требует `{ kind: "test-report", check: "dev-check" }`, а `evidence[]` перехода несёт CI-запись `test-report` только от `tests-passed` — тоже `RECORD_MISMATCH` с причиной `ci_evidence` (design I-205); код 1

#### Scenario: Решение UNKNOWN не ослабляется
<!-- id: SCN-VER-116 -->
- **WHEN** record базы impl-PR в `SPECIFIED` содержит blocking `UNK-SRC-004`, закрытый решением с `ref`, а на HEAD этот элемент удалён; либо на HEAD у него `blocking: false`; либо `resolved_as: "fact"`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `unknowns` и `UNK-SRC-004`, код 1; открытый в базе blocking `UNK-SRC-005`, закрытый на HEAD решением с `ref`, `RECORD_MISMATCH` не даёт (его `ref` судит REQ-VER-013)

#### Scenario: Общий аккаунт и самослияние
<!-- id: SCN-VER-120 -->
- **WHEN** impl-PR вносит переход `APPROVED` с `ref` spec-PR, который слил `kat` из `roles.maintainer`, он же автор PR; `identities.agents` базы пуст
- **THEN** `REF_NOT_VERIFIED` нет, `data.findings[]` содержит `SHARED_IDENTITY` и `APPROVER_IS_AUTHOR`; при `identities.agents` базы `[{ "login": "warrant-agent[bot]" }]` — `REF_NOT_VERIFIED` с причиной `merged_by`, код 1, находок `SHARED_IDENTITY` и `APPROVER_IS_AUTHOR` нет; spec-PR открыл `warrant-agent[bot]`, слил `kat` — нет ни `REF_NOT_VERIFIED`, ни этих находок; слил `warrant-agent[bot]` — `REF_NOT_VERIFIED` с причиной `merged_by`

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
недоступный форж — `FORGE_UNAVAILABLE`, как у ref переходов. В остальных видах PR решение ещё не судит переход: нарушение и
недоступный форж (деталь `forge`) SHALL быть находкой `{ code: "DECISION_NOT_VERIFIED", message }` в `data.findings[]` с тем же
началом `message`, код выхода от неё не меняется. Причина `decision` и находка вместо `FORGE_UNAVAILABLE` — исключения из списка причин
`REF_NOT_VERIFIED` и кода 3 недоступного форжа [REQ-VER-011](#requirement-команда-ci), названные и там.
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

## ADDED Requirements

### Requirement: Reusable workflow job warrant
<!-- id: REQ-VER-014 -->

WARRANT SHALL поставлять job `warrant` ([REQ-VER-011](#requirement-команда-ci)) как reusable workflow
`.github/workflows/warrant.yml` своего репозитория с триггером `workflow_call` ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 7).
Входы: `warrant` — обязательный: тег CLI (`v<semver>`), который устанавливается глобально из репозитория WARRANT, или буквально
`checkout` — CLI из checkout вызывающего, только если checkout — репозиторий WARRANT (`packages/cli/package.json` с именем пакета
CLI; design I-208); другое значение или `checkout` в чужом репозитории SHALL останавливать job до `warrant ci` с ошибкой шага,
называющей допустимые значения; `setup` — команды подготовки проекта (bash, default пусто), выполняемые после
checkout и merge PR в tip базы; `node-version` (default `22`); `openspec-version` (default `1.13.1`); `merge_commit` — merge-коммит
impl-PR для recovery-прогона ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 4, default пусто).
Шаги SHALL быть шагами job `warrant`: checkout head PR (или `merge_commit`) с полной историей, merge в tip базы (кроме recovery),
`setup`, OpenSpec, CLI, `warrant ci` с выводом вне checkout, upload artifact по `data.artifact`. Секретов workflow SHALL NOT
требовать: токен — `github.token` вызывающего; вызывающий SHALL дать job права `contents: read`, `actions: read`,
`pull-requests: read`, `issues: read` (форж `warrant ci`). Тег CLI во входе `warrant` и ref, по которому вызван workflow, выбирает
вызывающий; пример 06 §8 даёт один тег в обоих местах. Workflow `ci.yml` этого репозитория SHALL вызывать job `warrant` через
него с `warrant: checkout` (один источник); проект под WARRANT вызывает его по тегу CLI вместо копии job. Имя проверки в GitHub
становится `warrant / warrant`: обязательные проверки branch protection, если они настроены, обновляет maintainer (в этом
репозитории branch protection вне MVP, 06 §8).

#### Scenario: Job warrant из reusable workflow
<!-- id: SCN-VER-122 -->
- **WHEN** читаются `.github/workflows/warrant.yml` и `.github/workflows/ci.yml` репозитория
- **THEN** `warrant.yml` объявляет `workflow_call` со входами `setup`, `node-version`, `openspec-version`, `warrant` (обязательный), `merge_commit`, шаг проверки входа `warrant` до установки CLI и шаг `warrant ci`; job `warrant` в `ci.yml` — `uses: ./.github/workflows/warrant.yml` с `warrant: checkout`, без собственных `steps`, с правами `contents`, `actions`, `pull-requests`, `issues` на чтение; `merge_commit` передаётся из входа `workflow_dispatch`
