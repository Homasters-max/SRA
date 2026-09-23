# Spec Delta: core-sdd

## MODIFIED Requirements

### Requirement: Состав pack core-sdd 0.1
<!-- id: REQ-SDD-001 -->

Pack `core-sdd` версии `0.2.0` (`kernel: ">=0.1 <0.4"`) SHALL объявлять в `provides`: overlays `core-default`, `risk-low`, `risk-medium`, `risk-high`;
profiles `feature`, `chore`, `factory-change`; gates `spec-valid`, `required-artifacts-present`, `blocking-unknowns-resolved`, `ids-valid`,
`branch-isolated`, `tests-passed`, `scope-valid`, `analyze-clean`, `evidence-complete`, `human-approval`, `adversarial-review`,
`factory-golden-passed`; checks `openspec-validate`, `tests-passed`; `controller_rules` `controller/rules.json`; `skills`
`specification/adversarial-review@^0.1`; `risk_floors`, `risk_levels`, `openspec_schema`, `openspec_rules`, `templates` как в фазе 1;
`evidence_kinds` — `test-report` и `spec-report` как объекты с `metrics_schema` (`evidence/test-report.metrics.schema.json`:
`tests`, `failures`, `errors`, `skipped` — integer; `evidence/spec-report.metrics.schema.json`: `issues` — integer), `review`,
`human-approval` — строками (каждый kind, который `produces` какой-либо check pack, SHALL быть объявлен); `rules` — пустой список
(первое правило pack — по failure mode, D-23).
Один объект — один файл ([08 §7](../../../../docs/08-packs.md)); каждый файл SHALL проходить `warrant validate` своей схемой; `level` и
`waivable` gates SHALL совпадать с [06 §4](../../../../docs/06-verification.md), где `worktree-ready` заменён на `branch-isolated` (ADR-0011).
Profiles `bugfix`, `refactor`, `experiment` SHALL NOT входить в 0.2 (ADR-0013).

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
- **WHEN** прочитан `pack.json` версии `0.2.0`
- **THEN** `provides.evidence_kinds` содержит объекты `test-report` и `spec-report` с существующими `metrics_schema`, а `warrant validate` применяет их к записям evidence этих kinds

### Requirement: Gates, checks и controller rules как данные
<!-- id: REQ-SDD-007 -->

Каждый gate SHALL иметь `level`, `waivable` и `requires_evidence` по [06 §3–4](../../../../docs/06-verification.md);
`human-approval`, `spec-valid`, `scope-valid`, `ids-valid`, `required-artifacts-present`, `blocking-unknowns-resolved`, `tests-passed`,
`evidence-complete`, `factory-golden-passed` SHALL быть `waivable: false`. Check `openspec-validate` SHALL описывать
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
- **THEN** `waivable: true` только у `branch-isolated`, `analyze-clean`, `adversarial-review`

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

### Requirement: Golden fixtures
<!-- id: REQ-SDD-009 -->

`packs/core-sdd/golden/<profile>/` для `feature`, `chore`, `factory-change` SHALL содержать минимальный проект (`.warrant/warrant.json`,
lock, `.warrant/changes/<name>.json` с полной `classification`, `openspec/changes/<name>/` с artifacts profile) и `expected/resolve.json`,
`expected/status.json`, `expected/verify.json`. e2e-тест `golden.test.ts` SHALL для каждого golden сравнить вывод `warrant resolve <name> --explain`,
`warrant status <name>` (поля `effective_policy`, `stale`, `change_state`, `verification`; поля с временем и путями машины исключены) и
`warrant verify <name> --transition PROPOSED->SPECIFIED` (поля `gates`, `controller_action`, `rule`, `findings[].code`; fake `openspec validate`
отвечает `valid: true`) с ожидаемым побайтно после канонизации. `sources` проектного слоя SHALL использовать content hash, не git-sha,
чтобы snapshot был стабилен вне git. Изменение любого файла pack, меняющее effective policy, SHALL ломать хотя бы один golden
(это будущий gate `factory-golden-passed`).

#### Scenario: Golden стабилен
<!-- id: SCN-SDD-015 -->
- **WHEN** `npm test` выполнен дважды на одном коммите
- **THEN** `golden.test.ts` зелёный оба раза, `expected/*.json` не изменены

#### Scenario: Golden ловит изменение policy
<!-- id: SCN-SDD-016 -->
- **WHEN** из `profiles/feature.json` удалён gate `scope-valid`
- **THEN** golden `feature` и `factory-change` падают с diff по `gates["VERIFYING->MERGED"]`

#### Scenario: Golden verify
<!-- id: SCN-SDD-020 -->
- **WHEN** `warrant verify feature --transition PROPOSED->SPECIFIED` на golden `feature`
- **THEN** `data.gates` равен `{ "ids-valid": "PASS", "required-artifacts-present": "PASS", "spec-valid": "PASS" }`, `controller_action` равен `CONTINUE`, результат равен `expected/verify.json`
