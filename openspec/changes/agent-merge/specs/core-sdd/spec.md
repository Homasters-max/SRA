## MODIFIED Requirements

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
