## MODIFIED Requirements

### Requirement: Состав pack core-sdd 0.1
<!-- id: REQ-SDD-001 -->

Pack `core-sdd` версии `0.4.x` (`kernel: ">=0.1 <0.11"`; patch поднимается первым изменением поставляемого после релиза и
проверяется `npm run versions:check`, R-14) SHALL объявлять в `provides`: overlays `core-default`, `risk-low`, `risk-medium`, `risk-high`;
profiles `feature`, `chore`, `factory-change`; gates `spec-valid`, `required-artifacts-present`, `blocking-unknowns-resolved`, `ids-valid`,
`branch-isolated`, `tests-passed`, `scope-valid`, `analyze-clean`, `evidence-complete`, `human-approval`, `adversarial-review`,
`factory-golden-passed`, `spec-approved`; checks `openspec-validate`, `tests-passed`; `controller_rules` `controller/rules.json`; `skills`
`specification/adversarial-review@^0.2`; `risk_floors`, `risk_levels`, `openspec_schema`, `openspec_rules`, `templates` как в фазе 1;
`evidence_kinds` — `test-report` и `spec-report` как объекты с `metrics_schema` (`evidence/test-report.metrics.schema.json`:
`tests`, `failures`, `errors`, `skipped` — integer; `evidence/spec-report.metrics.schema.json`: `issues` — integer), `review` —
объект с `metrics_schema` (`evidence/review.metrics.schema.json`: `BLOCKER`, `MAJOR`, `MINOR`, `INFO` — integer), `human-approval` —
строкой (каждый kind, который `produces` какой-либо check pack, SHALL быть объявлен); `rules` — пустой список
(первое правило pack — по failure mode, D-23).
Один объект — один файл ([08 §7](../../../../docs/08-packs.md)); каждый файл SHALL проходить `warrant validate` своей схемой; `level` и
`waivable` gates SHALL совпадать с [06 §4](../../../../docs/06-verification.md), где `worktree-ready` заменён на `branch-isolated` (ADR-0011).
Profiles `bugfix`, `refactor`, `experiment` SHALL NOT входить в 0.4 (ADR-0013).

#### Scenario: Validate на pack
<!-- id: SCN-SDD-001 -->
- **WHEN** `warrant validate` вызван в корне репозитория WARRANT
- **THEN** `ok: true`; `data.checked.packs` содержит `core-sdd`; `warrant.lock.json` содержит в `packs["core-sdd"]` версию pack и один hash его содержимого, а в `skills["specification/adversarial-review"]` — версию, путь и hash skill

#### Scenario: Gate объявлен в одном месте
<!-- id: SCN-SDD-002 -->
- **WHEN** profile или overlay pack ссылается на gate
- **THEN** этот gate есть в `provides.gates` того же pack; ссылок на `mutation-score`, `rollback-rehearsed` и другие gates чужих packs нет

#### Scenario: Формы metrics
<!-- id: SCN-SDD-017 -->
- **WHEN** прочитан `pack.json` версии `0.4.x`
- **THEN** `provides.evidence_kinds` содержит объекты `test-report` и `spec-report` с существующими `metrics_schema`, а `warrant validate` применяет их к записям evidence этих kinds

#### Scenario: Версия после релиза
<!-- id: SCN-SDD-021 -->
- **WHEN** файлы pack `core-sdd` (кроме `golden/`) отличаются от последнего tag `v*`, а `pack.json.version` равна версии pack в этом tag
- **THEN** `npm run versions:check` и e2e `versions.test.ts` падают с именем pack

#### Scenario: Metrics review
<!-- id: SCN-SDD-024 -->
- **WHEN** запись `review` содержит `metrics: { "BLOCKER": "one" }`
- **THEN** `warrant validate` даёт `SCHEMA_VIOLATION` по `evidence/review.metrics.schema.json`; запись `run submit` с числами проходит
