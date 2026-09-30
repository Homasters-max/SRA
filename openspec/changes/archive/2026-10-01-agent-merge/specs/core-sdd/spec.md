## MODIFIED Requirements

### Requirement: Состав pack core-sdd 0.1
<!-- id: REQ-SDD-001 -->

Pack `core-sdd` версии `0.4.x` (`kernel: ">=0.1 <0.10"`; patch поднимается первым изменением поставляемого после релиза и
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

### Requirement: Profile factory-change
<!-- id: REQ-SDD-005 -->

Profile `factory-change@1.1.0` SHALL иметь `extends: ["feature"]`, дополнительно gate `factory-golden-passed` на `VERIFYING->MERGED`,
`capabilities.forbidden: ["PRODUCTION_WRITE"]`, `match.paths`: `.warrant/**`, `openspec/schemas/**`, `openspec/config.yaml`, `packs/**`,
`packages/cli/schemas/**`, `sra/skills/**`, `.github/workflows/**`, `packages/cli/src/**`, `packages/cli/package.json`. Workflows
CI и судья `warrant ci` — часть фабрики: run `pull_request` исполняет workflow из самого PR и ставит CLI из его checkout, и их
правка в обычном Change подменила бы producer evidence CI ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md),
[ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md) п. 3).

#### Scenario: Golden factory-change
<!-- id: SCN-SDD-007 -->
- **WHEN** `warrant resolve --explain` на golden `factory-change` (profiles `["factory-change"]`, `blast_radius` `SYSTEM`)
- **THEN** `risk_level` равен `HIGH`; `gates["VERIFYING->MERGED"]` содержит `factory-golden-passed`; `capabilities.forbidden` равен `["PRODUCTION_WRITE"]`;
  `explain[]` относит `tests-passed` к `profile/feature` (через `extends`) и `adversarial-review` на `SPECIFIED->APPROVED` к `overlay/risk-high`; `gates["VERIFYING->MERGED"]` не содержит `human-approval`

#### Scenario: Репозиторий WARRANT — сам себе golden
<!-- id: SCN-SDD-008 -->
- **WHEN** `warrant classify phase-2-core-sdd --base main` выполнен на этой ветке
- **THEN** `profiles` содержит `factory-change`, `risk.blast_radius` равен `SYSTEM` от floor, `warrant resolve phase-2-core-sdd` показывает `risk_level: HIGH`, а `warrant status` — `stale: []` и `overlay/risk-high` в `sources`

#### Scenario: Правка CI — factory-change
<!-- id: SCN-SDD-026 -->
- **WHEN** diff Change профиля `feature` содержит `.github/workflows/ci.yml`
- **THEN** `warrant classify` добавляет `factory-change` в `profiles`; без переклассификации gate `scope-valid` на `VERIFYING->MERGED` даёт `FAIL` с `SCOPE_VIOLATION` и этим путём

#### Scenario: Правка судьи — factory-change
<!-- id: SCN-SDD-027 -->
- **WHEN** diff Change профиля `feature` содержит `packages/cli/src/core/ci/kind.ts` или `packages/cli/package.json`
- **THEN** `warrant classify` добавляет `factory-change` в `profiles`

### Requirement: Risk overlays
<!-- id: REQ-SDD-006 -->

Overlays `risk-low`, `risk-medium` (`1.0.0`), `risk-high` (`2.0.0`) SHALL иметь `match: {risk_level: [<LEVEL>]}`. `risk-low` SHALL быть пустым по policy.
`risk-medium` SHALL добавлять gate `adversarial-review` на `SPECIFIED->APPROVED`. `risk-high` SHALL добавлять `adversarial-review` на
`SPECIFIED->APPROVED` и SHALL NOT добавлять `human-approval` и approvals: приёмку человеком задаёт профиль путей проекта в
`.warrant/local/**` ([ADR-0050](../../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 3; [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 2, 6).
Gates других packs SHALL NOT упоминаться; [05 §4](../../../../docs/05-policy.md) SHALL быть уточнён: `mutation-score` и `rollback-rehearsed`
добавляют overlays packs `bdd-tdd` и `data` по `match.risk_level`.

#### Scenario: Уровень HIGH из одного измерения
<!-- id: SCN-SDD-009 -->
- **WHEN** classification содержит `reversibility: IRREVERSIBLE`, остальные измерения минимальны
- **THEN** `risk_level` равен `HIGH`, `sources` содержит `risk-high` и не содержит `risk-medium`

#### Scenario: Strengthen-only на risk-high
<!-- id: SCN-SDD-010 -->
- **WHEN** `.warrant/local/risk-high.json` с `overrides: "core-sdd:risk-high"` убирает `adversarial-review` с `SPECIFIED->APPROVED`
- **THEN** `warrant validate` даёт `OVERRIDE_WEAKENS`, код выхода 3

#### Scenario: Приёмка человеком — профиль путей
<!-- id: SCN-SDD-028 -->
- **WHEN** `warrant resolve` для Change с `risk_level: HIGH` без локальных объектов; затем тот же Change, когда `.warrant/local/profiles/human-acceptance.json` (`match.paths: ["packages/cli/src/**"]`, `gates: {"VERIFYING->MERGED": ["human-approval"]}`, approval `maintainer`) в `profiles` его `classification`
- **THEN** в первом случае `gates["VERIFYING->MERGED"]` не содержит `human-approval`; во втором — содержит, а `explain[]` относит его к локальному профилю
