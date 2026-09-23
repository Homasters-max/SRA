## MODIFIED Requirements

### Requirement: Состав pack core-sdd 0.1
<!-- id: REQ-SDD-001 -->

Pack `core-sdd` версии `0.3.x` (`kernel: ">=0.1 <0.5"`; patch поднимается первым изменением поставляемого после релиза и
проверяется `npm run versions:check`, R-14) SHALL объявлять в `provides`: overlays `core-default`, `risk-low`, `risk-medium`, `risk-high`;
profiles `feature`, `chore`, `factory-change`; gates `spec-valid`, `required-artifacts-present`, `blocking-unknowns-resolved`, `ids-valid`,
`branch-isolated`, `tests-passed`, `scope-valid`, `analyze-clean`, `evidence-complete`, `human-approval`, `adversarial-review`,
`factory-golden-passed`, `spec-approved`; checks `openspec-validate`, `tests-passed`; `controller_rules` `controller/rules.json`; `skills`
`specification/adversarial-review@^0.1`; `risk_floors`, `risk_levels`, `openspec_schema`, `openspec_rules`, `templates` как в фазе 1;
`evidence_kinds` — `test-report` и `spec-report` как объекты с `metrics_schema` (`evidence/test-report.metrics.schema.json`:
`tests`, `failures`, `errors`, `skipped` — integer; `evidence/spec-report.metrics.schema.json`: `issues` — integer), `review`,
`human-approval` — строками (каждый kind, который `produces` какой-либо check pack, SHALL быть объявлен); `rules` — пустой список
(первое правило pack — по failure mode, D-23).
Один объект — один файл ([08 §7](../../../../docs/08-packs.md)); каждый файл SHALL проходить `warrant validate` своей схемой; `level` и
`waivable` gates SHALL совпадать с [06 §4](../../../../docs/06-verification.md), где `worktree-ready` заменён на `branch-isolated` (ADR-0011).
Profiles `bugfix`, `refactor`, `experiment` SHALL NOT входить в 0.3 (ADR-0013).

#### Scenario: Validate на pack
<!-- id: SCN-SDD-001 -->
- **WHEN** `warrant validate` вызван в корне репозитория WARRANT
- **THEN** `ok: true`; `data.checked.packs` содержит `core-sdd`; lock содержит hash каждого файла `provides` и skill

#### Scenario: Gate объявлен в одном месте
<!-- id: SCN-SDD-002 -->
- **WHEN** profile или overlay pack ссылается на gate
- **THEN** этот gate есть в `provides.gates` того же pack; ссылок на `mutation-score`, `rollback-rehearsed` и другие gates чужих packs нет

#### Scenario: Формы metrics
<!-- id: SCN-SDD-017 -->
- **WHEN** прочитан `pack.json` версии `0.3.x`
- **THEN** `provides.evidence_kinds` содержит объекты `test-report` и `spec-report` с существующими `metrics_schema`, а `warrant validate` применяет их к записям evidence этих kinds

#### Scenario: Версия после релиза
<!-- id: SCN-SDD-021 -->
- **WHEN** файлы pack `core-sdd` (кроме `golden/`) отличаются от последнего tag `v*`, а `pack.json.version` равна версии pack в этом tag
- **THEN** `npm run versions:check` и e2e `versions.test.ts` падают с именем pack

### Requirement: Общий слой core-default
<!-- id: REQ-SDD-002 -->

Overlay `core-default` SHALL иметь пустой `match` и вносить: `gates` `PROPOSED->SPECIFIED`: `spec-valid`, `ids-valid`;
`SPECIFIED->APPROVED`: `spec-valid`, `ids-valid`; `VERIFYING->MERGED`: `ids-valid`, `spec-approved`; `MERGED->ARCHIVED`: `spec-valid`,
`ids-valid`. Он SHALL попадать в слой `default` resolver'а и в `sources` каждого Change как
`core-sdd@<версия pack>:overlay/core-default@<версия overlay>`.

#### Scenario: Пустая classification
<!-- id: SCN-SDD-003 -->
- **WHEN** `warrant resolve <change>` для record без `classification`
- **THEN** `gates["PROPOSED->SPECIFIED"]` равен `["ids-valid", "spec-valid"]`, `risk_level` равен `MEDIUM`, `sources` содержит `core-default` и `risk-medium`

#### Scenario: spec-approved на merge у всех profiles
<!-- id: SCN-SDD-022 -->
- **WHEN** `warrant resolve` для record с profiles `["feature"]`, `["chore"]` и `["factory-change"]`
- **THEN** `gates["VERIFYING->MERGED"]` каждого содержит `spec-approved`, `explain` указывает источник `core-default`

### Requirement: Gates, checks и controller rules как данные
<!-- id: REQ-SDD-007 -->

Каждый gate SHALL иметь `level`, `waivable` и `requires_evidence` по [06 §3–4](../../../../docs/06-verification.md);
`human-approval`, `spec-valid`, `scope-valid`, `ids-valid`, `required-artifacts-present`, `blocking-unknowns-resolved`, `tests-passed`,
`evidence-complete`, `factory-golden-passed` SHALL быть `waivable: false`; gate `spec-approved` — `level: "L0"`, без `requires_evidence`,
`waivable: true` (правка контракта после approval снимается waiver'ом maintainer'а; V-9, ADR-0024). Gates `tests-passed` и
`factory-golden-passed` SHALL объявлять `accepts_attestation: ["ci"]` (R-5). Check `openspec-validate` SHALL описывать
`openspec validate {change} --strict --json` с `produces: ["spec-report"]`, `parser: "openspec-validate"` и `execution: { "timeout_s": 300 }`;
check `tests-passed` SHALL описывать только формат (`parser: junit`, `produces: ["test-report"]`, `execution: { "exclusive": true }`),
а команду проект задаёт override'ом в `.warrant/local/checks/` с `{out}` в аргументах. Gate `spec-valid` SHALL требовать evidence `spec-report`.
`controller/rules.json` SHALL содержать ровно три правила в порядке [04 §4](../../../../docs/04-lifecycle.md): `POLICY_CONFLICT` → `ESCALATE`;
verdict gate `FAIL` → `WAIT`; открытый blocking `UNKNOWN` → `WAIT` с операцией `clarify`. `openspec/rules.json` pack'а SHALL содержать в
`rules.design` пункт «отклонение от spec фиксируется строкой `I-N` в таблице решений design.md». Исполнение gates, checks и controller —
[REQ-VER-002](../verification/spec.md)…[REQ-VER-005](../verification/spec.md).

#### Scenario: Waivable по каталогу
<!-- id: SCN-SDD-011 -->
- **WHEN** прочитаны все `gates/*.json` pack'а
- **THEN** `waivable: true` только у `branch-isolated`, `analyze-clean`, `adversarial-review`, `spec-approved`

#### Scenario: Controller rules валидны
<!-- id: SCN-SDD-012 -->
- **WHEN** `warrant validate` читает `controller/rules.json`
- **THEN** файл проходит `warrant://controller-rules/1`, `rules.length` равен 3, первый `when` — `policy_conflict`, последний — blocking UNKNOWN

#### Scenario: Checks с execution
<!-- id: SCN-SDD-018 -->
- **WHEN** прочитаны `checks/openspec-validate.json` и `checks/tests-passed.json`
- **THEN** первый содержит `{change}` в `run.command` и `execution.timeout_s: 300`, второй — `execution.exclusive: true` и не содержит `run`; оба проходят `warrant://check/1`

#### Scenario: Override tests-passed в репозитории WARRANT
<!-- id: SCN-SDD-019 -->
- **WHEN** `.warrant/local/checks/tests-passed.json` с `"overrides": "core-sdd:tests-passed"` задаёт команду vitest с junit-репортёром в `{out}/junit.xml`
- **THEN** `warrant check phase-3-verification tests-passed` пишет `test-report` с `metrics.tests` > 0 и `warrant validate` даёт `ok: true`

#### Scenario: Attestation merge-gates
<!-- id: SCN-SDD-023 -->
- **WHEN** прочитаны `gates/tests-passed.json` и `gates/factory-golden-passed.json`
- **THEN** оба содержат `accepts_attestation: ["ci"]`; `gates/spec-approved.json` не содержит `requires_evidence` и имеет `waivable: true`
