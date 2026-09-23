# core-sdd Specification

## Purpose
Pack `core-sdd@0.1` — baseline policy spec-driven workflow: какие profiles, overlays, gates, checks, controller rules и skill
поставляет pack и какую effective policy resolver обязан вычислить для каждого profile и уровня risk.

## Requirements

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

### Requirement: Profile feature
<!-- id: REQ-SDD-003 -->

Profile `feature@1.0.0` SHALL требовать artifacts `proposal`, `specs`, `design`, `tasks`; gates по переходам ровно как в
[04 §5](../../../../docs/04-lifecycle.md): `PROPOSED->SPECIFIED`: `required-artifacts-present`, `spec-valid`, `ids-valid`;
`SPECIFIED->APPROVED`: `spec-valid`, `required-artifacts-present`, `ids-valid`, `blocking-unknowns-resolved`, `adversarial-review`, `human-approval`;
`APPROVED->IMPLEMENTING`: `branch-isolated`; `VERIFYING->MERGED`: `tests-passed`, `scope-valid`, `analyze-clean`, `ids-valid`, `evidence-complete`;
`MERGED->ARCHIVED`: `spec-valid`, `required-artifacts-present`, `analyze-clean`; approvals `{role: "maintainer", at: "SPECIFIED->APPROVED"}`;
evidence `required`: `test-report`, `review`, `human-approval`. `match.paths` SHALL быть пустым: `feature` не выводится из diff.

#### Scenario: Golden feature
<!-- id: SCN-SDD-004 -->
- **WHEN** `warrant resolve --explain` на golden `packs/core-sdd/golden/feature/` (profiles `["feature"]`, все измерения заданы, `risk_level` `MEDIUM`)
- **THEN** результат побайтно равен `expected/resolve.json`; `explain[]` относит `adversarial-review` к `profile/feature` и к `overlay/risk-medium`

### Requirement: Profile chore
<!-- id: REQ-SDD-004 -->

Profile `chore@1.0.0` SHALL требовать artifacts `proposal`, `tasks` (specs пропускаются через `skip_specs`), `recommended` `design`;
gates `PROPOSED->SPECIFIED`: `required-artifacts-present`, `ids-valid`; `SPECIFIED->APPROVED`: `required-artifacts-present`, `ids-valid`, `human-approval`;
`APPROVED->IMPLEMENTING`: `branch-isolated`; `VERIFYING->MERGED`: `tests-passed`, `scope-valid`; `MERGED->ARCHIVED`: `required-artifacts-present`;
approvals роли `maintainer` на `SPECIFIED->APPROVED`; `match.paths`: `docs/**`, `**/*.md`, `package.json`, `package-lock.json`.

#### Scenario: Golden chore
<!-- id: SCN-SDD-005 -->
- **WHEN** `warrant resolve --explain` на golden `chore` (profiles `["chore"]`, все измерения минимальны, `risk_level` `LOW`)
- **THEN** результат равен `expected/resolve.json`; `gates["SPECIFIED->APPROVED"]` не содержит `adversarial-review`, `sources` содержит `risk-low`

#### Scenario: Chore по diff
<!-- id: SCN-SDD-006 -->
- **WHEN** `warrant classify` по diff, содержащему только `docs/04-lifecycle.md`
- **THEN** `profiles` содержит `chore` с `from: "match:core-sdd:chore"`

### Requirement: Profile factory-change
<!-- id: REQ-SDD-005 -->

Profile `factory-change@1.0.0` SHALL иметь `extends: ["feature"]`, дополнительно gate `factory-golden-passed` на `VERIFYING->MERGED`,
`capabilities.forbidden: ["PRODUCTION_WRITE"]`, `match.paths`: `.warrant/**`, `openspec/schemas/**`, `openspec/config.yaml`, `packs/**`,
`packages/cli/schemas/**`, `sra/skills/**`.

#### Scenario: Golden factory-change
<!-- id: SCN-SDD-007 -->
- **WHEN** `warrant resolve --explain` на golden `factory-change` (profiles `["factory-change"]`, `blast_radius` `SYSTEM`)
- **THEN** `risk_level` равен `HIGH`; `gates["VERIFYING->MERGED"]` содержит `factory-golden-passed`; `capabilities.forbidden` равен `["PRODUCTION_WRITE"]`;
  `explain[]` относит `tests-passed` к `profile/feature` (через `extends`) и `human-approval` на `VERIFYING->MERGED` к `overlay/risk-high`

#### Scenario: Репозиторий WARRANT — сам себе golden
<!-- id: SCN-SDD-008 -->
- **WHEN** `warrant classify phase-2-core-sdd --base main` выполнен на этой ветке
- **THEN** `profiles` содержит `factory-change`, `risk.blast_radius` равен `SYSTEM` от floor, `warrant resolve phase-2-core-sdd` показывает `risk_level: HIGH`, а `warrant status` — `stale: []` и `overlay/risk-high` в `sources`

### Requirement: Risk overlays
<!-- id: REQ-SDD-006 -->

Overlays `risk-low`, `risk-medium`, `risk-high` (`1.0.0`) SHALL иметь `match: {risk_level: [<LEVEL>]}`. `risk-low` SHALL быть пустым по policy.
`risk-medium` SHALL добавлять gate `adversarial-review` на `SPECIFIED->APPROVED`. `risk-high` SHALL добавлять `adversarial-review` на
`SPECIFIED->APPROVED` и `human-approval` на `VERIFYING->MERGED` с approval `{role: "maintainer", at: "VERIFYING->MERGED"}`.
Gates других packs SHALL NOT упоминаться; [05 §4](../../../../docs/05-policy.md) SHALL быть уточнён: `mutation-score` и `rollback-rehearsed`
добавляют overlays packs `bdd-tdd` и `data` по `match.risk_level`.

#### Scenario: Уровень HIGH из одного измерения
<!-- id: SCN-SDD-009 -->
- **WHEN** classification содержит `reversibility: IRREVERSIBLE`, остальные измерения минимальны
- **THEN** `risk_level` равен `HIGH`, `sources` содержит `risk-high` и не содержит `risk-medium`

#### Scenario: Strengthen-only на risk-high
<!-- id: SCN-SDD-010 -->
- **WHEN** `.warrant/local/risk-high.json` с `overrides: "core-sdd:risk-high"` убирает `human-approval` с `VERIFYING->MERGED`
- **THEN** `warrant validate` даёт `OVERRIDE_WEAKENS`, код выхода 3

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

### Requirement: Skill adversarial review в lock
<!-- id: REQ-SDD-008 -->

Pack SHALL ссылаться на skill `specification/adversarial-review@^0.1`, лежащий в `sra/skills/specification/adversarial-review/SKILL.md`
с frontmatter `name`, `version: 0.1.0`, `description`. `warrant sync` SHALL записать в lock путь и hash файла; `warrant validate`
SHALL сообщать `LOCK_MISMATCH` при изменении файла без `sync`. Содержание skill в фазе 2 — краткое описание категорий
[06 §7](../../../../docs/06-verification.md); полноценный skill — фаза 4.

#### Scenario: Skill в lock
<!-- id: SCN-SDD-013 -->
- **WHEN** `warrant sync` выполнен
- **THEN** `warrant.lock.json` содержит `skills["specification/adversarial-review"]` с `version: "0.1.0"`, `path` и `hash`

#### Scenario: Изменённый skill
<!-- id: SCN-SDD-014 -->
- **WHEN** в `SKILL.md` изменена одна строка без `sync`
- **THEN** `warrant validate` даёт `LOCK_MISMATCH` с путём skill, код выхода 3

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
