## MODIFIED Requirements

### Requirement: Risk overlays
<!-- id: REQ-SDD-006 -->

Overlays `risk-low`, `risk-medium` (`1.0.0`), `risk-high` (`2.0.0`) SHALL иметь `match: {risk_level: [<LEVEL>]}`. `risk-low` SHALL быть пустым по policy.
`risk-medium` SHALL добавлять gate `adversarial-review` на `SPECIFIED->APPROVED`. `risk-high` SHALL добавлять `adversarial-review` на
`SPECIFIED->APPROVED` и SHALL NOT добавлять `human-approval` и approvals: приёмку человеком задаёт профиль путей проекта
([ADR-0050](../../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 3; [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 3).
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
