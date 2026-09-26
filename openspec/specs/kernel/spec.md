# kernel Specification

## Purpose
Kernel WARRANT: JSON Schemas контрактов (`warrant://<name>/1`) и команды CLI фазы 1 —
`init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status`. Поведение, наблюдаемое через файлы и JSON-вывод.

## Requirements

### Requirement: Адресация и форма JSON Schema kernel
<!-- id: REQ-KRN-001 -->

CLI SHALL поставлять JSON Schema (draft 2020-12) для каждого `warrant://<name>/<major>` kernel. `$id` схемы
SHALL совпадать с этим URI. Каждое свойство SHALL иметь `description`. Объекты SHALL запрещать неизвестные ключи
(`additionalProperties: false`), кроме ключа `$comment`, который допустим в любом объекте, и кроме двух объектов, форму которых
задаёт pack (D-13): `evidence.metrics` и `waiver.targets[]` — kernel-схема допускает их как object, а `warrant validate` вторым шагом
применяет JSON Schema pack: для `metrics` — `metrics_schema` kind'а из `provides.evidence_kinds`, для `targets[]` — схему pack,
поставляющего gate; kind или gate без объявленной формы при непустом `metrics` / `targets` SHALL давать ошибку `PACK_FORM_UNKNOWN`.
Файл SHALL сопоставляться со схемой только по своему полю `$schema`.

#### Scenario: Известная схема
<!-- id: SCN-KRN-001 -->
- **WHEN** файл содержит `"$schema": "warrant://config/1"`
- **THEN** файл проверяется схемой `config`, major `1`

#### Scenario: Неизвестная схема
<!-- id: SCN-KRN-002 -->
- **WHEN** файл содержит `"$schema": "warrant://unknown/1"` или `$schema` отсутствует
- **THEN** `warrant validate` сообщает ошибку `SCHEMA_UNKNOWN` с путём файла и завершается кодом 3

#### Scenario: Комментарий в JSON
<!-- id: SCN-KRN-003 -->
- **WHEN** объект на любом уровне содержит ключ `$comment` со строкой
- **THEN** файл валиден, а любой другой неизвестный ключ отклоняется с указанием JSON Pointer

#### Scenario: Metrics по форме pack
<!-- id: SCN-KRN-084 -->
- **WHEN** запись evidence `kind: "test-report"` содержит `metrics: { "tests": "many" }`, а `metrics_schema` kind'а требует integer
- **THEN** `warrant validate` даёт ошибку с путём файла и JSON Pointer `/metrics/tests`; при `kind` без `metrics_schema` и непустом `metrics` — `PACK_FORM_UNKNOWN`

### Requirement: Контракт JSON-вывода CLI
<!-- id: REQ-KRN-002 -->

Каждая команда SHALL уметь печатать в stdout ровно один JSON-объект `{ "command", "ok", "change"?, "data", "errors" }`.
JSON SHALL быть форматом по умолчанию, когда stdout не TTY, и SHALL включаться флагом `--json` всегда.
`errors[]` SHALL состоять из объектов `{ "code", "message", "path"?, "hint"? }`, где `code` — UPPER_SNAKE, `message` — что не
так, `hint` — команда или действие, которое исправляет ошибку ([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 8).
Текст исправления SHALL NOT повторяться в `message`, если он есть в `hint`. Ошибки команд `run`, `guard` и новые коды фазы 4
SHALL нести `hint`.
Диагностика, не входящая в контракт, SHALL идти в stderr.

#### Scenario: Успешный вызов без TTY
<!-- id: SCN-KRN-004 -->
- **WHEN** `warrant fmt --check` вызван с перенаправленным stdout и все файлы канонические
- **THEN** stdout содержит один объект с `"command": "fmt"`, `"ok": true`, `"errors": []`

#### Scenario: Ошибка в контракте
<!-- id: SCN-KRN-005 -->
- **WHEN** `warrant validate --json` находит невалидный файл
- **THEN** `"ok": false`, `errors[]` содержит запись с `code`, `message` и `path` файла, а stdout не содержит ничего кроме объекта

#### Scenario: Подсказка отдельно от сообщения
<!-- id: SCN-KRN-125 -->
- **WHEN** `warrant validate` в проекте без `.warrant/warrant.lock.json`
- **THEN** `errors[]` содержит `LOCK_MISMATCH` с `message` о пропавшем lock без слов `run`, и `hint` равен `` run `warrant sync` ``

### Requirement: Коды выхода
<!-- id: REQ-KRN-003 -->

CLI SHALL завершаться кодом `0` при `ok: true`; `1` при verdict `FAIL` / `STOP` и при `fmt --check` с расхождениями;
`2` при `WAIT` / `ESCALATE`; `3` при ошибке конфигурации, невалидном файле, неизвестной команде или неверных аргументах.
Код выхода SHALL выставляться после полной записи JSON-объекта в stdout: при перенаправлении stdout в pipe вывод любого размера
SHALL доходить целиком (B4).

#### Scenario: Неверные аргументы
<!-- id: SCN-KRN-006 -->
- **WHEN** вызвано `warrant id REQ` без AREA или `warrant nosuchcommand`
- **THEN** код выхода 3 и `errors[0].code` равен `USAGE`

#### Scenario: Ошибка конфигурации
<!-- id: SCN-KRN-007 -->
- **WHEN** `.warrant/warrant.json` отсутствует, а вызвана команда, которой он нужен (`validate`, `sync`, `resolve`, `status`, `id`)
- **THEN** код выхода 3 и `errors[0].code` равен `CONFIG_MISSING`

#### Scenario: Большой вывод в pipe
<!-- id: SCN-KRN-085 -->
- **WHEN** `warrant status` (все Changes) с выводом больше 64 KiB вызван с stdout, перенаправленным в pipe, на Windows и Linux
- **THEN** читатель pipe получает полный JSON-объект, разбираемый без ошибки, и код выхода команды

### Requirement: Схема config
<!-- id: REQ-KRN-004 -->

Схема `warrant://config/1` SHALL описывать `.warrant/warrant.json` ([08 §3](../../../../docs/08-packs.md)):
обязательные `kernel` (major.minor), `openspec` (диапазон `1.13.x`), `packs` (id kebab-case → `{ "version": semver-range, "params"? }`);
необязательные `defaults` (`check_timeout_s` — положительное целое, [ADR-0017](../../../../docs/adr/WARRANT-ADR-0017-check-execution.md)),
`paths` (`adr`, `glossary`, `tests`, `src`), `roles` (роль → список логинов), `identities.agents[]`
([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md)), `trusted_signers[]`,
`frontends[]` — уникальные имена frontend, для которых `warrant sync` генерирует файлы (в фазе 4 — только `claude`,
[ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 1).

#### Scenario: Пример из документации
<!-- id: SCN-KRN-008 -->
- **WHEN** проверяется пример `warrant.json` из 08 §3, дополненный `"$schema"`
- **THEN** файл валиден

#### Scenario: Pack без версии
<!-- id: SCN-KRN-009 -->
- **WHEN** `packs.core-sdd` не содержит `version` или `version` не semver-диапазон
- **THEN** файл невалиден с указанием `/packs/core-sdd/version`

#### Scenario: Timeout по умолчанию
<!-- id: SCN-KRN-086 -->
- **WHEN** `defaults.check_timeout_s` равен `0` или строке
- **THEN** файл невалиден с указанием `/defaults/check_timeout_s`; при отсутствии `defaults` файл валиден

#### Scenario: Frontend
<!-- id: SCN-KRN-126 -->
- **WHEN** `frontends` равен `["claude"]`, `["codex"]` или `["claude", "claude"]`
- **THEN** первый файл валиден, второй и третий невалидны с указанием `/frontends`

### Requirement: Схема lock
<!-- id: REQ-KRN-005 -->

Схема `warrant://lock/1` SHALL описывать `.warrant/warrant.lock.json`: `kernel` и `openspec` (точные версии),
`packs` (id → `{ "version", "source", "hash" }`), `skills` (`namespace/name` → `{ "version", "path", "hash", "source"? }`, где
`source` — `bundled`, а `path` тогда относителен корню поставки — каталогу с bundled `packs/`, I-52, I-72), `generated` (путь относительно корня проекта → `hash`).
Все `hash` SHALL иметь вид `sha256:<64 hex>`.

#### Scenario: Lock, записанный sync
<!-- id: SCN-KRN-010 -->
- **WHEN** проверяется lock, записанный `warrant sync`
- **THEN** файл валиден

#### Scenario: Hash не sha256
<!-- id: SCN-KRN-011 -->
- **WHEN** `packs.core-sdd.hash` равен `"abc"`
- **THEN** файл невалиден с указанием `/packs/core-sdd/hash`

#### Scenario: Skill вне проекта
<!-- id: SCN-KRN-087 -->
- **WHEN** `warrant sync` выполнен в проекте, где skill найден только внутри bundled pack вне корня проекта
- **THEN** lock содержит `skills["specification/adversarial-review"]` с `source: "bundled"`, `path` относительно корня поставки и `hash`, а `warrant validate` проверяет hash по этому пути

### Requirement: Схема pack
<!-- id: REQ-KRN-006 -->

Схема `warrant://pack/1` SHALL описывать `pack.json` ([08 §2](../../../../docs/08-packs.md)): `id`, `version` (semver),
`kernel` (semver-диапазон), `depends_on`, `provides` со списками относительных путей `profiles`, `overlays`, `gates`,
`checks`, `risk_floors`, `risk_levels`, `controller_rules`, `recipes`, `templates`, `rules` (файлы `warrant://rule/1`,
[ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md)), строками `openspec_schema`, `openspec_rules`, списками `skills`
(`namespace/name@range`) и `evidence_kinds` (элемент — строка kind или объект `{ "kind", "metrics_schema" }`, где `metrics_schema` —
относительный путь к JSON Schema формы `metrics`, D-13); `params_schema`. Пути SHALL быть относительными без `..`.

#### Scenario: Манифест core-sdd
<!-- id: SCN-KRN-012 -->
- **WHEN** проверяется `packs/core-sdd/pack.json`
- **THEN** файл валиден

#### Scenario: Путь за пределами pack
<!-- id: SCN-KRN-013 -->
- **WHEN** `provides.gates` содержит `"../other/gate.json"`
- **THEN** файл невалиден с указанием `/provides/gates/0`

#### Scenario: Две формы evidence_kinds
<!-- id: SCN-KRN-088 -->
- **WHEN** `provides.evidence_kinds` равен `["review", { "kind": "test-report", "metrics_schema": "evidence/test-report.metrics.schema.json" }]`
- **THEN** файл валиден; объект без `kind` или с `metrics_schema` вне pack — невалиден с указанием элемента

### Requirement: Схема profile
<!-- id: REQ-KRN-007 -->

Схема `warrant://profile/1` SHALL описывать profile ([05 §3](../../../../docs/05-policy.md)): `id` (kebab-case), `version` (semver),
`extends[]`, `match.paths[]`, `artifacts` (`required`, `recommended`, `forbidden`), `gates` (ключ — переход
`<FROM>-><TO>` из состояний [02 §2](../../../../docs/02-vocabulary.md), значение — список id gates), `capabilities.forbidden[]`,
`approvals[{ "role", "at" }]`, `evidence.required[]`.

#### Scenario: Пример data-change
<!-- id: SCN-KRN-014 -->
- **WHEN** проверяется пример profile из 05 §3
- **THEN** файл валиден

#### Scenario: Неизвестный переход
<!-- id: SCN-KRN-015 -->
- **WHEN** `gates` содержит ключ `"DRAFT->DONE"`
- **THEN** файл невалиден с указанием `/gates`

### Requirement: Схема overlay
<!-- id: REQ-KRN-008 -->

Схема `warrant://overlay/1` SHALL описывать overlay ([05 §4](../../../../docs/05-policy.md)): `id`, `version`, `match`
(объект, где ключ — `risk_level`, `profiles` или одно из измерений risk, значение — список допустимых значений
из [05 §4](../../../../docs/05-policy.md)), и те же поля policy, что у profile (`artifacts`, `gates`, `capabilities`, `approvals`, `evidence`).

#### Scenario: Overlay по измерению
<!-- id: SCN-KRN-016 -->
- **WHEN** проверяется `{ "id": "security-high", "match": { "security_impact": ["HIGH"] } }` с `$schema` и `version`
- **THEN** файл валиден

#### Scenario: Недопустимое значение измерения
<!-- id: SCN-KRN-017 -->
- **WHEN** `match.data_loss` содержит `"CRITICAL"`
- **THEN** файл невалиден с указанием `/match/data_loss/0`

### Requirement: Схема gate
<!-- id: REQ-KRN-009 -->

Схема `warrant://gate/1` SHALL описывать gate ([06 §3](../../../../docs/06-verification.md)): `id`, `version`, `level` (`L0` | `L1` | `L2`),
`applies_when.changed_paths[]`, `requires_evidence[{ "kind", "status" }]` со `status` из `evidence_status`,
`waivable` (boolean), `accepts_attestation[]` ⊆ `ci`, `human-review`, `signature`, `none`.

#### Scenario: Пример tests-passed
<!-- id: SCN-KRN-018 -->
- **WHEN** проверяется пример gate из 06 §3
- **THEN** файл валиден

#### Scenario: Waivable не указан
<!-- id: SCN-KRN-019 -->
- **WHEN** в gate отсутствует `waivable`
- **THEN** файл невалиден: значение по умолчанию не подразумевается (INV-10)

### Requirement: Схема check
<!-- id: REQ-KRN-010 -->

Схема `warrant://check/1` SHALL описывать check ([06 §2](../../../../docs/06-verification.md)): `id`, `version`, `level` (`L0` | `L1`),
`run.command[]` и необязательный `run.scoped_command[]` (списки строк; допустимы плейсхолдеры `{out}`, `{change}`, а в
`scoped_command` — и `{paths}`; любой другой `{…}` SHALL отклоняться), необязательный `execution` (`exclusive` boolean,
`timeout_s` положительное целое, `local` ∈ `allowed` | `scoped-only` | `ci-only`, `guard_prefixes` — список списков строк;
[ADR-0017](../../../../docs/adr/WARRANT-ADR-0017-check-execution.md)), `produces[]` (evidence kinds), `parser`.
Уровень `L2` SHALL отклоняться: check не использует LLM.

#### Scenario: Пример pytest
<!-- id: SCN-KRN-020 -->
- **WHEN** проверяется пример check из 06 §2
- **THEN** файл валиден

#### Scenario: Check уровня L2
<!-- id: SCN-KRN-021 -->
- **WHEN** `level` равен `"L2"`
- **THEN** файл невалиден с указанием `/level`

#### Scenario: Execution и scoped_command
<!-- id: SCN-KRN-089 -->
- **WHEN** проверяется пример `mutation` из 06 §2 «Execution» (`scoped_command` с `{paths}`, `execution` с четырьмя полями)
- **THEN** файл валиден

#### Scenario: Неизвестный плейсхолдер
<!-- id: SCN-KRN-090 -->
- **WHEN** `run.command` содержит `"{base}"` или `run.command` содержит `"{paths}"`
- **THEN** файл невалиден с указанием элемента команды

### Requirement: Схема change-record
<!-- id: REQ-KRN-011 -->

Схема `warrant://change-record/1` SHALL описывать `.warrant/changes/<change>.json` ([04 §9](../../../../docs/04-lifecycle.md)):
`change` (kebab-case, равен имени файла), `change_state` из [02 §2](../../../../docs/02-vocabulary.md), необязательный `classification`
(`profiles[]`, `risk` — измерение → `{ "value", "from", "ref"? }` где `from` соответствует `floor`, `proposer:<id>` или `human:<login>`,
а `ref` (URL) допустим только при `from: human:<login>` и фиксирует approval понижения ниже floor ([REQ-KRN-028](#requirement-команда-classify));
`risk_level`), `transitions[]` (`to`, `at` (RFC 3339), `by`, `effective_policy_hash`?, `gates`?, `evidence`?, `ref`? (URL)),
`unknowns[]` (`id` `UNK-AREA-NNN`, `text`, `blocking`, `resolution`?), `assumptions[]` (`id` `ASM-AREA-NNN`, `text`),
необязательные `amends[]` и `supersedes[]` (kebab-case имена Changes, [ADR-0021](../../../../docs/adr/WARRANT-ADR-0021-archive-immutability.md)).

#### Scenario: Пример из документации
<!-- id: SCN-KRN-022 -->
- **WHEN** проверяется пример record из 04 §9 с `by` вида `cli:local` и `ref` в виде URL форджа
- **THEN** файл валиден

#### Scenario: Значение risk без источника
<!-- id: SCN-KRN-023 -->
- **WHEN** `classification.risk.data_loss` равен строке `"NONE"` вместо объекта с `from`
- **THEN** файл невалиден с указанием `/classification/risk/data_loss`

#### Scenario: Связи между Changes
<!-- id: SCN-KRN-091 -->
- **WHEN** record содержит `"amends": ["add-search"]` и `"supersedes": []`
- **THEN** файл валиден; `"amends": ["Add Search"]` — невалиден с указанием `/amends/0`

#### Scenario: ref у значения risk
<!-- id: SCN-KRN-110 -->
- **WHEN** `classification.risk.blast_radius` равен `{ "value": "LOCAL", "from": "human:kat", "ref": "https://github.com/o/r/pull/7#issuecomment-1" }`
- **THEN** файл валиден; тот же `ref` при `from: "floor:core-sdd:2"` — невалиден с указанием `/classification/risk/blast_radius`

### Requirement: Схема evidence
<!-- id: REQ-KRN-012 -->

Схема `warrant://evidence/1` SHALL описывать запись evidence ([06a §2](../../../../docs/06a-evidence.md)): `id` (`EVID-<ULID>`),
`claim{ "text", "targets"[] }`, `kind`, `level`, `evidence_status`, `subject{ "commit", "base_commit"?, "spec_revision", "dataset_snapshot" }`,
`produced_by{ "type" ∈ check | skill | human, "id", "version", "run" }`, `attestation{ "type", "ref"? }`, `context_hash`,
`effective_policy_hash`, `created_at`, `artifacts[{ "uri", "sha256" }]`, `limitations[]`, необязательный `metrics` (object; форму задаёт
pack для kind, [REQ-KRN-001](#requirement-адресация-и-форма-json-schema-kernel), [ADR-0016](../../../../docs/adr/WARRANT-ADR-0016-mutation-diff-scope.md)).

#### Scenario: Запись с ULID
<!-- id: SCN-KRN-024 -->
- **WHEN** проверяется пример из 06a §2 с `id` вида `EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3` и `attestation.ref` в виде URL
- **THEN** файл валиден

#### Scenario: Счётчик вместо ULID
<!-- id: SCN-KRN-025 -->
- **WHEN** `id` равен `"EVID-000921"`
- **THEN** файл невалиден с указанием `/id` ([ADR-0012](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md))

#### Scenario: Metrics и base_commit
<!-- id: SCN-KRN-092 -->
- **WHEN** запись содержит `subject.base_commit: "abc1234"` и `metrics: { "tests": 387, "failures": 0 }`
- **THEN** файл валиден kernel-схемой; `metrics: 5` — невалиден с указанием `/metrics`

### Requirement: Схема evidence-manifest
<!-- id: REQ-KRN-013 -->

Схема `warrant://evidence-manifest/1` SHALL описывать `.warrant/evidence/<change>/manifest.json` ([06a §5](../../../../docs/06a-evidence.md)):
`change`, `commit`, `versions{ "warrant", "openspec", "lock_hash", "effective_policy_hash" }`, `runs[]` (`RUN-<ULID>`),
`evidence[]` (`EVID-<ULID>`), `gates` (id → `gate_verdict`).

#### Scenario: Manifest валиден
<!-- id: SCN-KRN-026 -->
- **WHEN** проверяется пример из 06a §5 с ULID-идентификаторами
- **THEN** файл валиден

#### Scenario: Verdict вне enum
<!-- id: SCN-KRN-027 -->
- **WHEN** `gates.tests-passed` равен `"OK"`
- **THEN** файл невалиден с указанием `/gates/tests-passed`

### Requirement: Схема controller-rules
<!-- id: REQ-KRN-014 -->

Схема `warrant://controller-rules/1` SHALL описывать таблицу controller ([04 §4](../../../../docs/04-lifecycle.md)): `rules[]` с `id`,
`when` (объект: ключ — вход controller, значение — boolean, строка enum или сравнение вида `">0"`),
`action` из `controller_action`, `next`? (operation). Порядок правил SHALL сохраняться.

#### Scenario: Таблица core-sdd
<!-- id: SCN-KRN-028 -->
- **WHEN** проверяется пример из 04 §4
- **THEN** файл валиден и `rules` читается в исходном порядке

#### Scenario: Неизвестное действие
<!-- id: SCN-KRN-029 -->
- **WHEN** `action` равен `"RETRY"`
- **THEN** файл невалиден с указанием `/rules/0/action`

### Requirement: Схема risk-floor
<!-- id: REQ-KRN-015 -->

Схема `warrant://risk-floor/1` SHALL описывать floor rules ([05 §4](../../../../docs/05-policy.md)): `floors[{ "paths"[], "set" }]`,
где `set` — измерение → значение из enum этого измерения.

#### Scenario: Пример floors
<!-- id: SCN-KRN-030 -->
- **WHEN** проверяется пример из 05 §4
- **THEN** файл валиден

#### Scenario: Значение чужого измерения
<!-- id: SCN-KRN-031 -->
- **WHEN** `set.data_loss` равен `"BREAKING"`
- **THEN** файл невалиден с указанием `/floors/0/set/data_loss`

### Requirement: Схема risk-levels
<!-- id: REQ-KRN-016 -->

Схема `warrant://risk-levels/1` SHALL описывать правило уровня risk ([05 §4](../../../../docs/05-policy.md)): `high.when_any`,
`low.when_all` (измерение → список значений), `default` из `LOW` | `MEDIUM` | `HIGH`.

#### Scenario: Пример уровней
<!-- id: SCN-KRN-032 -->
- **WHEN** проверяется пример из 05 §4
- **THEN** файл валиден

#### Scenario: Отсутствует default
<!-- id: SCN-KRN-033 -->
- **WHEN** ключ `default` отсутствует
- **THEN** файл невалиден

### Requirement: Схема openspec-rules
<!-- id: REQ-KRN-017 -->

Схема `warrant://openspec-rules/1` SHALL описывать источник `config.yaml` ([08 §8](../../../../docs/08-packs.md), [ADR-0015](../../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md)):
`context` (строка), `rules` (artifact id → список строк), `operations` (`apply` | `archive` → `{ "guidance"[] }`).
Все поля необязательны; пустой объект с `$schema` валиден.

#### Scenario: Пример из документации
<!-- id: SCN-KRN-034 -->
- **WHEN** проверяется пример из 08 §8
- **THEN** файл валиден

#### Scenario: Неизвестная operation
<!-- id: SCN-KRN-035 -->
- **WHEN** `operations` содержит ключ `"deploy"`
- **THEN** файл невалиден с указанием `/operations`

### Requirement: Схема openspec-schema
<!-- id: REQ-KRN-018 -->

Схема `warrant://openspec-schema/1` SHALL описывать источник `schema.yaml` OpenSpec ([ADR-0015](../../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md)):
`name`, `version` (integer), `description`, `artifacts[{ "id", "generates", "description", "template", "instruction"?, "requires"[] }]`,
`apply{ "requires"[], "tracks", "instruction"? }`. `requires` SHALL ссылаться только на id artifacts этого же файла.

#### Scenario: Схема warrant-sdd
<!-- id: SCN-KRN-036 -->
- **WHEN** проверяется `openspec/schema.json` с четырьмя artifacts `proposal`, `specs`, `design`, `tasks`
- **THEN** файл валиден

#### Scenario: Ссылка на несуществующий artifact
<!-- id: SCN-KRN-037 -->
- **WHEN** `artifacts[1].requires` содержит `"adr"`, а artifact `adr` не объявлен
- **THEN** `warrant validate` сообщает ошибку `ARTIFACT_UNKNOWN` с указанием `/artifacts/1/requires/0`

### Requirement: Схема waiver
<!-- id: REQ-KRN-019 -->

Схема `warrant://waiver/1` SHALL описывать waiver ([05 §7](../../../../docs/05-policy.md)): `id` (`WAV-<year>-NNN`), `change`, `gate`, `reason`,
`risk`, `compensating_controls[]`, обязательные `owner`, `expires_at` (дата), `waiver_state` из [02 §2](../../../../docs/02-vocabulary.md),
`approved_by` (вид `human:<login>`) — обязателен во всех состояниях, кроме `PROPOSED` (предложенный waiver ещё не одобрен, 05 §7),
необязательный `targets[]` (object[]; форму задаёт pack gate, D-13).

#### Scenario: Пример waiver
<!-- id: SCN-KRN-038 -->
- **WHEN** проверяется пример из 05 §7
- **THEN** файл валиден

#### Scenario: Без срока
<!-- id: SCN-KRN-039 -->
- **WHEN** `expires_at` отсутствует
- **THEN** файл невалиден с указанием отсутствующего поля

#### Scenario: Частичный waiver
<!-- id: SCN-KRN-093 -->
- **WHEN** waiver содержит `targets` из примера 05 §7 «Частичный waiver»
- **THEN** файл валиден kernel-схемой; `targets: ["x"]` — невалиден с указанием `/targets/0`

#### Scenario: Предложенный waiver без approved_by
<!-- id: SCN-KRN-111 -->
- **WHEN** waiver в `waiver_state: "PROPOSED"` не содержит `approved_by`
- **THEN** файл валиден; тот же waiver в `ACTIVE` — невалиден с указанием отсутствующего `approved_by`

### Requirement: Схема areas
<!-- id: REQ-KRN-020 -->

Схема `warrant://areas/1` SHALL описывать `.warrant/local/areas.json` ([ADR-0012 §5](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)):
ключ — AREA (2–5 заглавных латинских букв), значение — `{ "capability": <kebab-case путь под openspec/specs/> }`.

#### Scenario: Реестр из одной AREA
<!-- id: SCN-KRN-040 -->
- **WHEN** проверяется `{ "$schema": "warrant://areas/1", "KRN": { "capability": "kernel" } }`
- **THEN** файл валиден

#### Scenario: AREA в нижнем регистре
<!-- id: SCN-KRN-041 -->
- **WHEN** ключ равен `"krn"`
- **THEN** файл невалиден с указанием `/krn`

### Requirement: Команда validate
<!-- id: REQ-KRN-021 -->

`warrant validate` SHALL проверять и сообщать все находки за один вызов: (1) каждый `*.json` под `.warrant/**`
(кроме сырого вывода checks `.warrant/evidence/**/raw/**` — он не часть записи, [REQ-VER-001](../verification/spec.md), I-76)
и в подключённых packs имеет `$schema` и валиден; (2) `warrant.json` и lock согласованы — версии packs в диапазонах,
hash каждого pack, skill и сгенерированного файла совпадает с содержимым, а pack, присутствующий в lock, но отсутствующий в
`warrant.json`, даёт `LOCK_MISMATCH` (B3); (3) объекты с одним `id` не объявлены
в двух packs, а override в `.warrant/local/` несёт `"overrides": "<pack>:<id>"` ([08 §4](../../../../docs/08-packs.md)) и не ослабляет
переопределяемый объект: не сужает `match` overlay, не удаляет элементы `extends` profile, не убирает gates, artifacts, evidence,
approvals и `forbidden`; каталог `.warrant/local/<id>/` с `pack.json`, чей `id` не подключён в `warrant.json`, SHALL давать `CONFIG_INVALID`,
а его файлы SHALL NOT попадать в project-слой;
(4) `openspec/config.yaml` и `openspec/schemas/<schema>/**` побайтно равны результату генерации, `openspec schema validate`
проходит, ключи `rules` входят в artifacts schema ([ADR-0015](../../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md));
(5) stable ID в `openspec/specs/**` и `openspec/changes/**` (по `openspec show --json`) имеют верный формат, стоят
непосредственно под заголовком с непустым телом ([ADR-0012 §7](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)), уникальны и используют AREA из реестра;
при этом объявление ID в `openspec/changes/archive/**` SHALL NOT считаться дубликатом объявления того же ID в `openspec/specs/**`
(archive — история, а не второе объявление), но SHALL считаться занятым для `warrant id`;
(6) в `.warrant/**` (кроме `.warrant/evidence/**/raw/**`) и `.claude/**` нет строк, похожих на токены ([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md));
(7) все JSON-файлы `.warrant/**`, кроме `.warrant/evidence/**/raw/**`, канонические ([REQ-KRN-022](#requirement-команда-fmt));
(8) правила `warrant://rule/1` pack'ов и `.warrant/local/rules/` имеют `id`, равный имени файла, и `paths`, не лежащие целиком в
`openspec/changes/**` (иначе `RULE_SCOPE`, [ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 4);
(9) stable ID, объявленный в `HEAD` в `openspec/specs/**` или в `openspec/changes/<change>/**` при record `<change>` в состоянии
`APPROVED` и далее, не изменён и не удалён в рабочем дереве (иначе `ID_IMMUTABLE` с путём и ID; D-18, [ADR-0019](../../../../docs/adr/WARRANT-ADR-0019-post-edit-hints.md) п. 1c);
ID требования `openspec/specs/**`, которое delta Change, перенесённого в `openspec/changes/archive/**` в рабочем дереве относительно
`HEAD`, перечисляет под `## REMOVED Requirements` (по заголовку требования), и ID его сценариев SHALL NOT давать `ID_IMMUTABLE` (I-77);
(10) каждая цель `amends[]` — существующий Change в `MERGED` или `ARCHIVED`, каждая цель `supersedes[]` — в `ABANDONED` (иначе `LINK_TARGET_INVALID`);
(11) каждый waiver `.warrant/waivers/*.json` ссылается на существующие Change и gate, gate имеет `waivable: true`, `approved_by`, если
задан, входит в `roles` `warrant.json` (иначе `WAIVER_INVALID`); `ACTIVE` waiver с `expires_at` в прошлом даёт предупреждение
`WAIVER_EXPIRED` в stderr, не ошибку;
(12) записи `.warrant/evidence/<change>/*.json` и `manifest.json` валидны схемами, `metrics` и `targets[]` — формами pack
([REQ-KRN-001](#requirement-адресация-и-форма-json-schema-kernel)), `kind` каждой записи объявлен подключённым pack, а `manifest.evidence[]` перечисляет ровно записи каталога;
(13) каждая ссылка вида `REQ-AREA-NNN` или `SCN-AREA-NNN` в `tasks.md` активных Changes (`openspec/changes/<change>/tasks.md`, кроме
`archive/`) и в файлах под `paths.tests` `warrant.json` (если задан) объявлена в `openspec/specs/**` или `openspec/changes/**`, включая
archive (иначе `ID_DANGLING` с путём, строкой и ID; [ADR-0019](../../../../docs/adr/WARRANT-ADR-0019-post-edit-hints.md) п. 1d).
Любая находка SHALL давать `ok: false` и код выхода 3. Флага `--no-generated` SHALL NOT быть: `config.yaml` генерируется целиком
([REQ-KRN-025](#requirement-команда-sync)).

#### Scenario: Проект после init
<!-- id: SCN-KRN-042 -->
- **WHEN** в пустом sample-проекте выполнены `warrant init` и `warrant sync`
- **THEN** `warrant validate` возвращает `ok: true`, `errors: []`, код 0

#### Scenario: Pack core-sdd
<!-- id: SCN-KRN-043 -->
- **WHEN** `warrant validate` вызван в корне monorepo с `packs/core-sdd/`
- **THEN** каждый файл pack проверен своей схемой и результат `ok: true`

#### Scenario: Дубликат ID объекта
<!-- id: SCN-KRN-044 -->
- **WHEN** два pack объявляют gate с `id` `tests-passed`, и в `.warrant/local/` нет `overrides`
- **THEN** `errors[]` содержит `DUPLICATE_OBJECT_ID` с обоими путями, код выхода 3

#### Scenario: Отредактированный config.yaml
<!-- id: SCN-KRN-045 -->
- **WHEN** в `openspec/config.yaml` вручную изменена одна строка
- **THEN** `errors[]` содержит `GENERATED_DRIFT` с путём файла, код выхода 3

#### Scenario: Stable ID над заголовком
<!-- id: SCN-KRN-046 -->
- **WHEN** в spec Change комментарий `<!-- id: REQ-KRN-099 -->` стоит над `### Requirement:`, а не под ним
- **THEN** `errors[]` содержит `ID_PLACEMENT` с путём файла и ID

#### Scenario: Неизвестная AREA
<!-- id: SCN-KRN-047 -->
- **WHEN** spec содержит `REQ-ZZZ-001`, а `ZZZ` нет в `.warrant/local/areas.json`
- **THEN** `errors[]` содержит `AREA_UNKNOWN`

#### Scenario: Токен в настройках
<!-- id: SCN-KRN-048 -->
- **WHEN** `.claude/settings.json` содержит строку вида `ghp_` + 36 символов
- **THEN** `errors[]` содержит `SECRET_LIKE` с путём файла без самой строки, код выхода 3

#### Scenario: Override сужает match
<!-- id: SCN-KRN-078 -->
- **WHEN** pack объявляет overlay `risk-high` с `match: {risk_level: ["HIGH"]}`, а `.warrant/local/risk-high.json` с `"overrides": "core-sdd:risk-high"`
  задаёт `match: {risk_level: ["HIGH"], profiles: ["never"]}`
- **THEN** `errors[]` содержит `OVERRIDE_WEAKENS` с путём override и полем `match`, код выхода 3

#### Scenario: Override удаляет extends
<!-- id: SCN-KRN-079 -->
- **WHEN** profile pack'а имеет `extends: ["base"]`, а его override в `.warrant/local/` — `extends: []`
- **THEN** `errors[]` содержит `OVERRIDE_WEAKENS` с полем `extends`

#### Scenario: Неподключённый pack в local
<!-- id: SCN-KRN-080 -->
- **WHEN** в `.warrant/local/experimental/pack.json` лежит pack `experimental`, которого нет в `warrant.json.packs`
- **THEN** `errors[]` содержит `CONFIG_INVALID` с путём `pack.json`, а его overlays не входят в `resolve` ни одного Change

#### Scenario: ID после archive
<!-- id: SCN-KRN-081 -->
- **WHEN** `REQ-KRN-001` объявлен в `openspec/specs/kernel/spec.md` и в `openspec/changes/archive/2026-09-22-phase-1-kernel/specs/kernel/spec.md`
- **THEN** `validate` не сообщает `ID_DUPLICATE`, а `warrant id REQ KRN` учитывает archive в максимуме

#### Scenario: Флаг удалён
<!-- id: SCN-KRN-082 -->
- **WHEN** вызван `warrant validate --no-generated`
- **THEN** `errors[0].code` равен `USAGE`, код выхода 3

#### Scenario: Pack удалён из warrant.json
<!-- id: SCN-KRN-094 -->
- **WHEN** lock содержит `packs.bdd-tdd`, а `warrant.json.packs` — нет
- **THEN** `errors[]` содержит `LOCK_MISMATCH` с путём lock и указанием `/packs/bdd-tdd`, код выхода 3

#### Scenario: Правило внутри openspec/changes
<!-- id: SCN-KRN-095 -->
- **WHEN** `.warrant/local/rules/spec-style.json` имеет `paths: ["openspec/changes/**/*.md"]`
- **THEN** `errors[]` содержит `RULE_SCOPE` с путём файла; правило с `paths: ["**"]` проходит

#### Scenario: Изменён stable ID в specs
<!-- id: SCN-KRN-096 -->
- **WHEN** в рабочем дереве `openspec/specs/kernel/spec.md` комментарий `REQ-KRN-002` заменён на `REQ-KRN-200`, а `HEAD` содержит `REQ-KRN-002`
- **THEN** `errors[]` содержит `ID_IMMUTABLE` с путём файла и `REQ-KRN-002`

#### Scenario: Удалён ID в Change до APPROVED
<!-- id: SCN-KRN-097 -->
- **WHEN** в `openspec/changes/add-search/specs/search/spec.md` удалён `SCN-SRC-003`, объявленный в `HEAD`, а record `add-search` в `SPECIFIED`
- **THEN** `validate` не сообщает `ID_IMMUTABLE`; при record в `APPROVED` — сообщает

#### Scenario: Цель amends не в MERGED
<!-- id: SCN-KRN-098 -->
- **WHEN** record содержит `amends: ["add-search"]`, а record `add-search` в `SPECIFIED`
- **THEN** `errors[]` содержит `LINK_TARGET_INVALID` с путём record и `/amends/0`

#### Scenario: Waiver с неверной ролью
<!-- id: SCN-KRN-099 -->
- **WHEN** `.warrant/waivers/WAV-2026-001.json` ссылается на gate `scope-valid` или `approved_by: "human:bob"` при `bob` вне `roles`
- **THEN** `errors[]` содержит `WAIVER_INVALID` с путём waiver и причиной; валидный waiver с `expires_at` в прошлом даёт `WAIVER_EXPIRED` в stderr и `ok: true`

#### Scenario: REMOVED в коммите archive
<!-- id: SCN-KRN-112 -->
- **WHEN** `HEAD` содержит `openspec/specs/search/spec.md` с требованием «Поиск по тегам» (`REQ-SRC-004`, `SCN-SRC-009`), а в рабочем дереве после `openspec archive` оно удалено, и появился `openspec/changes/archive/2026-09-24-drop-tags/specs/search/spec.md` с этим заголовком под `## REMOVED Requirements`
- **THEN** `validate` не сообщает `ID_IMMUTABLE` ни для `REQ-SRC-004`, ни для `SCN-SRC-009`; удаление того же требования без архивной delta — сообщает

#### Scenario: Висячая ссылка в tasks.md
<!-- id: SCN-KRN-113 -->
- **WHEN** `openspec/changes/add-search/tasks.md` содержит `SCN-SRC-042`, который не объявлен ни в `openspec/specs/**`, ни в `openspec/changes/**`
- **THEN** `errors[]` содержит `ID_DANGLING` с путём `tasks.md`, номером строки и `SCN-SRC-042`, код выхода 3

#### Scenario: Тесты и архив
<!-- id: SCN-KRN-114 -->
- **WHEN** `warrant.json` задаёт `paths.tests: "tests"`, `tests/search.test.py` ссылается на `REQ-SRC-001` из архивной delta и на необъявленный `REQ-SRC-777`, а архивный `tasks.md` ссылается на необъявленный ID
- **THEN** `ID_DANGLING` сообщён только для `REQ-SRC-777`; без `paths.tests` файлы тестов не проверяются

### Requirement: Команда fmt
<!-- id: REQ-KRN-022 -->

`warrant fmt [paths...]` SHALL приводить JSON-файлы `.warrant/**` (по умолчанию) или указанные пути к каноническому
виду: `$schema` первым, затем ключи в порядке `properties` схемы, остальные — по алфавиту; отступ 2 пробела;
LF; завершающий перевод строки; UTF-8 без BOM. `--check` SHALL не менять файлы и возвращать код 1 при расхождении.
Файл без `$schema` или с неизвестной схемой SHALL форматироваться только по алфавиту с предупреждением в stderr.

#### Scenario: Канонический файл
<!-- id: SCN-KRN-049 -->
- **WHEN** файл уже канонический
- **THEN** байты файла не меняются и `data.changed` равен `[]`

#### Scenario: Перестановка ключей
<!-- id: SCN-KRN-050 -->
- **WHEN** в `warrant.json` ключ `paths` стоит раньше `packs`, а `$schema` — последним
- **THEN** после `warrant fmt` `$schema` первый, `packs` раньше `paths`, значения не изменены

#### Scenario: Режим проверки
<!-- id: SCN-KRN-051 -->
- **WHEN** `warrant fmt --check` находит неканонический файл
- **THEN** файл не изменён, `data.changed` содержит его путь, код выхода 1

### Requirement: Команда init
<!-- id: REQ-KRN-023 -->

`warrant init` SHALL создать в проекте `.warrant/warrant.json` (`kernel` текущей CLI, `openspec` по `openspec --version`,
`packs.core-sdd`), `.warrant/local/areas.json` (пустой), `.warrant/local/openspec/rules.json` (пустой),
каталоги `changes/`, `waivers/`, `evidence/`, `runs/` с `.gitkeep`, копии схем kernel в `.warrant/schemas/<name>.<major>.schema.json`,
и затем выполнить `warrant sync`. Существующие файлы SHALL NOT перезаписываться без `--force`.
`warrant init change <name>` SHALL вызвать `openspec new change <name> --schema <schema из config.yaml> --json`
и создать `.warrant/changes/<name>.json` в `PROPOSED` с одной transition `by: cli:local` и без `classification`;
SHALL отказывать кодом 3, если имя уже есть в `.warrant/changes/` или `openspec/changes/archive/*-<name>` ([ADR-0012 §6](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)).

#### Scenario: Пустой проект
<!-- id: SCN-KRN-052 -->
- **WHEN** `warrant init` выполнен в каталоге с `openspec/` и без `.warrant/`
- **THEN** созданы перечисленные файлы, `warrant validate` даёт `ok: true`, а `data.created[]` перечисляет пути

#### Scenario: Повторный init
<!-- id: SCN-KRN-053 -->
- **WHEN** `warrant init` выполнен при существующем `.warrant/warrant.json` без `--force`
- **THEN** файл не изменён, `errors[]` содержит `ALREADY_INITIALIZED`, код выхода 3

#### Scenario: Новый Change
<!-- id: SCN-KRN-054 -->
- **WHEN** `warrant init change add-search` выполнен в инициализированном проекте
- **THEN** существуют `openspec/changes/add-search/.openspec.yaml` и `.warrant/changes/add-search.json` с `change_state: PROPOSED`

#### Scenario: Имя из archive
<!-- id: SCN-KRN-055 -->
- **WHEN** существует `openspec/changes/archive/2026-09-01-add-search/`
- **THEN** `warrant init change add-search` отказывает с `CHANGE_NAME_TAKEN`, код 3, и `openspec new change` не вызывается

### Requirement: Команда id
<!-- id: REQ-KRN-024 -->

`warrant id <PREFIX> <AREA>` для `REQ`, `SCN`, `TASK`, `UNK`, `ASM` SHALL выдать `PREFIX-AREA-NNN`, где `NNN` =
максимум по `openspec/specs/**` и `openspec/changes/**` (включая archive) + 1, три цифры с ведущими нулями;
AREA SHALL быть в `.warrant/local/areas.json`. `warrant id EVID` и `warrant id RUN` SHALL выдать `PREFIX-<ULID>`.
`warrant id WAV` SHALL выдать `WAV-<год>-NNN`. `warrant id renumber <old> <new> --change <name>` SHALL переписать
все вхождения `<old>` внутри `openspec/changes/<name>/**` и `paths.tests`, отказывая кодом 3, если `<new>` уже
существует где-либо в проекте или record Change в состоянии `MERGED` / `ARCHIVED` ([ADR-0012](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)).

#### Scenario: Следующий номер с учётом archive
<!-- id: SCN-KRN-056 -->
- **WHEN** в `openspec/specs/` максимум `REQ-KRN-007`, а в `openspec/changes/archive/` есть `REQ-KRN-012`
- **THEN** `warrant id REQ KRN` возвращает `REQ-KRN-013`

#### Scenario: Неизвестная AREA
<!-- id: SCN-KRN-057 -->
- **WHEN** `warrant id REQ ZZZ` и `ZZZ` не в реестре
- **THEN** `errors[0].code` равен `AREA_UNKNOWN`, код выхода 3

#### Scenario: Сквозной ID
<!-- id: SCN-KRN-058 -->
- **WHEN** `warrant id EVID` вызван дважды подряд
- **THEN** оба ID соответствуют `EVID-[0-9A-HJKMNP-TV-Z]{26}` и различаются

#### Scenario: Перенумерация
<!-- id: SCN-KRN-059 -->
- **WHEN** `warrant id renumber REQ-KRN-007 REQ-KRN-013 --change add-search` при record в `SPECIFIED`
- **THEN** все вхождения внутри каталога Change заменены, файлы вне каталога не тронуты, `data.rewritten[]` перечисляет файлы

#### Scenario: Перенумерация после MERGED
<!-- id: SCN-KRN-060 -->
- **WHEN** record Change в состоянии `MERGED`
- **THEN** `renumber` отказывает с `ID_IMMUTABLE`, код выхода 3, файлы не изменены

### Requirement: Команда sync
<!-- id: REQ-KRN-025 -->

`warrant sync` SHALL прочитать `warrant.json`, разрешить packs (bundled с CLI и `.warrant/local/`) в порядке `depends_on`,
слить `openspec/rules.json` packs и проекта (`.warrant/local/openspec/rules.json`) по [ADR-0015 п. 2](../../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md), записать `openspec/config.yaml`
целиком — `schema`, `context`, `rules`, `operations`; никакая часть `config.yaml` SHALL NOT считаться ручной —
`openspec/schemas/<schema>/schema.yaml` и `templates/**` детерминированно ([ADR-0015 п. 3](../../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md)),
обновить копии схем в `.warrant/schemas/` и записать `warrant.lock.json` с hash каждого pack, skill и сгенерированного файла.
Строки YAML, которые парсер YAML прочитал бы не как строку (`null`, `true`, `false`, `yes`, `no`, числа), SHALL записываться в кавычках
и как ключи, и как значения (B5). Pack SHALL NOT задавать язык или другие свойства конкретного проекта в своём `context`: это место
`.warrant/local/openspec/rules.json`. Повторный `sync` без изменений входов SHALL NOT менять ни одного байта. `--check` SHALL только
сообщать расхождения (код 1).

#### Scenario: Идемпотентность
<!-- id: SCN-KRN-061 -->
- **WHEN** `warrant sync` выполнен дважды подряд
- **THEN** второй вызов возвращает `data.changed: []`, и git не видит изменений

#### Scenario: Слияние rules
<!-- id: SCN-KRN-062 -->
- **WHEN** pack задаёт `rules.specs: ["A"]`, а проект — `rules.specs: ["B", "A"]`
- **THEN** в `config.yaml` `rules.specs` равен `["A", "B"]`, `context` проекта идёт после `context` pack через пустую строку

#### Scenario: Первая строка
<!-- id: SCN-KRN-063 -->
- **WHEN** сгенерированы `config.yaml` и `schema.yaml`
- **THEN** первая строка каждого — `# generated by warrant — do not edit`, а `openspec schema validate <schema> --json` даёт `valid: true`

#### Scenario: Pack не найден
<!-- id: SCN-KRN-064 -->
- **WHEN** `warrant.json` ссылается на pack `bdd-tdd`, которого нет ни в bundled, ни в `.warrant/local/`
- **THEN** ничего не записано, `errors[0].code` равен `PACK_NOT_FOUND`, код выхода 3

#### Scenario: Репозиторий WARRANT
<!-- id: SCN-KRN-083 -->
- **WHEN** `warrant sync` выполнен в корне репозитория WARRANT с `.warrant/local/openspec/rules.json`, несущим `context` «Language: Russian…»
- **THEN** `openspec/config.yaml` имеет `schema: warrant-sdd`, `context` проекта, и `warrant validate` без флагов даёт `ok: true`

#### Scenario: Ключи, похожие на не-строки
<!-- id: SCN-KRN-100 -->
- **WHEN** `rules.json` проекта содержит `"operations": { "apply": { "guidance": ["yes"] } }` и artifact с id `null` в schema
- **THEN** в сгенерированном YAML эти значения и ключи стоят в кавычках, а повторный парсинг YAML возвращает строки

### Requirement: Команда resolve
<!-- id: REQ-KRN-026 -->

`warrant resolve <change> [--explain] [--classification <file>]` SHALL вычислить effective policy как чистую функцию
от classification (из record или из файла), overlays packs и `.warrant/local/` в порядке
`default → project → profile(s) → risk → waiver` по правилам [05 §5](../../../../docs/05-policy.md): объединение множеств, запрет ослабления,
`forbidden` абсолютен, конфликт `required` ∧ `forbidden` → `POLICY_CONFLICT`; kind из `evidence.required`, которого нет в
`requires_evidence` ни одного gate effective policy (ни на одном переходе), SHALL давать `POLICY_CONFLICT` с элементом
`{ "code": "EVIDENCE_KIND_UNGATED", "kind" }` (такой kind нечем проверить по свежести и attestation; R-7). Результат SHALL содержать `hash`
(SHA-256 canonical JSON, RFC 8785), `sources[]`, `risk_level`, `artifacts`, `gates`, `capabilities`, `approvals`, `evidence`,
а с `--explain` — происхождение каждого элемента. Одинаковый вход SHALL давать одинаковый `hash`.

#### Scenario: Детерминизм
<!-- id: SCN-KRN-065 -->
- **WHEN** `resolve` вызван дважды на одном record и одном lock
- **THEN** оба `hash` совпадают, а `explain` перечисляет источник каждого gate

#### Scenario: Объединение gates
<!-- id: SCN-KRN-066 -->
- **WHEN** profile даёт `VERIFYING->MERGED: ["tests-passed"]`, а overlay risk — `["adversarial-review"]`
- **THEN** effective `gates["VERIFYING->MERGED"]` содержит оба, `explain` указывает источник каждого

#### Scenario: Конфликт policy
<!-- id: SCN-KRN-067 -->
- **WHEN** один overlay требует artifact `adr`, другой запрещает `adr`
- **THEN** `ok: false`, `errors[0].code` равен `POLICY_CONFLICT`, `data.controller_action` равен `ESCALATE`, код выхода 2

#### Scenario: Без classification
<!-- id: SCN-KRN-068 -->
- **WHEN** record Change не содержит `classification` и `--classification` не задан
- **THEN** effective policy строится только из `default` и `project`, `risk_level` равен `MEDIUM`, `explain` это отмечает

#### Scenario: Golden case
<!-- id: SCN-KRN-069 -->
- **WHEN** classification из golden case подана через `--classification`
- **THEN** результат (без `hash`) равен ожидаемому JSON golden case

#### Scenario: Kind без gate
<!-- id: SCN-KRN-115 -->
- **WHEN** overlay проекта добавляет в `evidence.required` kind `perf-report`, который не требует ни один gate effective policy
- **THEN** `ok: false`, `errors[0].code` равен `POLICY_CONFLICT`, конфликт содержит `EVIDENCE_KIND_UNGATED` с `perf-report`, `controller_action` равен `ESCALATE`, код выхода 2

### Requirement: Команда status
<!-- id: REQ-KRN-027 -->

`warrant status [change]` SHALL вернуть для каждого Change (одного или всех в `.warrant/changes/`): `change_state`,
`classification`, `effective_policy.hash`, `sources` и `risk_level`, artifacts OpenSpec (`openspec status --json`: `done` / `ready` /
`blocked` / `skipped`), `stale[]` — расхождения record с производными сигналами ([04 §9](../../../../docs/04-lifecycle.md)):
каталог Change отсутствует и не в archive (`CHANGE_DIR_MISSING`), но не для `ABANDONED`; каталог в archive, а состояние не `ARCHIVED`
(`ARCHIVED_WITHOUT_TRANSITION`); record `ABANDONED`, а каталог есть (`ABANDONED_DIR_PRESENT`; D-22) — и `verification`: `transition`
(следующий вперёд), `gates` (id → verdict по уже записанному evidence, без запуска checks), `findings[]`, `controller_action`, `next`?,
`rule`. Для каждого Change SHALL вычисляться `amended_by[]` и `superseded_by[]` просмотром `amends`/`supersedes` остальных records
([ADR-0021](../../../../docs/adr/WARRANT-ADR-0021-archive-immutability.md) п. 5). Вывод без аргумента SHALL содержать `rules{ total,
unenforced }` — число правил `rule/1` и число правил без `enforced_by` ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 4).
Команда SHALL NOT запускать checks и SHALL NOT менять файлы.

#### Scenario: Свежий Change
<!-- id: SCN-KRN-070 -->
- **WHEN** после `warrant init change add-search` вызван `warrant status add-search`
- **THEN** `change_state: PROPOSED`, `artifacts.proposal: ready`, `stale: []`, код выхода 0

#### Scenario: Archive без транзиции
<!-- id: SCN-KRN-071 -->
- **WHEN** каталог Change перенесён в `openspec/changes/archive/2026-09-22-add-search`, а record в `MERGED`
- **THEN** `stale[]` содержит `ARCHIVED_WITHOUT_TRANSITION`, код выхода 0

#### Scenario: Неизвестный Change
<!-- id: SCN-KRN-072 -->
- **WHEN** `warrant status nosuch` без record
- **THEN** `errors[0].code` равен `CHANGE_NOT_FOUND`, код выхода 3

#### Scenario: Verdicts без запуска checks
<!-- id: SCN-KRN-101 -->
- **WHEN** `warrant status add-search` при `PROPOSED`, записи `spec-report` `PROVEN` на HEAD и валидных artifacts
- **THEN** `effective_policy.risk_level` присутствует, `verification.transition` равен `PROPOSED->SPECIFIED`, `verification.gates["spec-valid"]` равен `PASS`, `controller_action` равен `CONTINUE`, ни одна команда check не запускалась

#### Scenario: Брошенный Change с каталогом
<!-- id: SCN-KRN-102 -->
- **WHEN** record в `ABANDONED`, а `openspec/changes/add-search/` существует
- **THEN** `stale[]` содержит `ABANDONED_DIR_PRESENT`; при отсутствии каталога и `ABANDONED` — `stale: []`

#### Scenario: Обратные ссылки
<!-- id: SCN-KRN-103 -->
- **WHEN** record `fix-search` содержит `amends: ["add-search"]`
- **THEN** `warrant status add-search` показывает `amended_by: ["fix-search"]`, а в record `add-search` этого поля нет

#### Scenario: Доля правил без enforced_by
<!-- id: SCN-KRN-104 -->
- **WHEN** подключённые packs и `.warrant/local/rules/` содержат три правила, из них одно без `enforced_by`
- **THEN** `warrant status` без аргумента печатает `rules: { "total": 3, "unenforced": 1 }`

### Requirement: Команда classify
<!-- id: REQ-KRN-028 -->

`warrant classify <change>` SHALL вычислить `classification` Change из детерминированных источников и записать её в
`.warrant/changes/<change>.json`: (1) список изменённых путей — `git diff --name-only <base>...HEAD` с `--base` (по умолчанию `main`)
или `--paths <file>` (по строке на путь; без git); (2) floor rules (`warrant://risk-floor/1`) всех подключённых packs — минимальное
значение измерения по совпавшим путям; (3) `match.paths` profiles — предлагаемые profiles; собственное состояние Change (record, каталог evidence, файлы Run этого Change и их
`.result.json` — [REQ-VER-004](../verification/spec.md)) SHALL NOT участвовать в сверке с `match.paths` и floor rules; (4) `--propose <json>` — profiles и значения
измерений от proposer'а; (5) `--set <dim>=<value>` и `--set profile=<id>` (повторяемые) — значения человека, требуют `--by <login>`,
где `login` входит хотя бы в одну роль `roles` `warrant.json` (иначе `ROLE_REQUIRED`, код 3), и записываются с `from: human:<login>`.
Итог измерения = максимум по порядку значений [05 §4](../../../../docs/05-policy.md) из floor, proposer и human; каждое значение
SHALL нести `from` (`floor:<pack>:<rule-index>`, `proposer`, `human:<login>`, ранее записанное — `record`). `--set` ниже floor без
`--ref` SHALL отказывать с `BELOW_FLOOR`, код 3, record не изменён. Понижение ниже floor ([04 §8](../../../../docs/04-lifecycle.md)) SHALL
выполняться только как `--set <dim>=<value> --by <login> --ref <url>` (http(s) URL approval), где `login` входит в роль из `approvals[]`
перехода `SPECIFIED->APPROVED` effective policy (без `approvals[]` — `maintainer`; иначе `ROLE_REQUIRED`), и только при `change_state`
`PROPOSED` или `SPECIFIED` (иначе `STATE_INVALID`, код 3); значение записывается как `{ value, from: "human:<login>", ref }`, и
последующие `classify` SHALL сохранять его, пока нет нового `--set` этого измерения: floor по этому измерению попадает в `data.ignored[]`
с причиной `approved-below-floor`. `ref` не верифицируется до `warrant ci` (фаза 4). Повторный `classify` SHALL NOT понижать ранее
записанное значение измерения и SHALL NOT удалять ранее записанный profile. `risk_level` SHALL NOT записываться: его вычисляет resolver.
Измерения без значения SHALL остаться отсутствующими (resolver трактует их как `UNKNOWN`). Команда SHALL печатать итоговую
`classification` и `effective_policy` из `resolve` в `data`.

#### Scenario: Floor по путям
<!-- id: SCN-KRN-073 -->
- **WHEN** diff содержит `.warrant/local/areas.json`, а pack `core-sdd` задаёт floor `{".warrant/**": {blast_radius: SYSTEM}}`
- **THEN** record получает `risk.blast_radius = {value: "SYSTEM", from: "floor:core-sdd:2"}` и `profiles` содержит `factory-change`

#### Scenario: Proposer не понижает floor
<!-- id: SCN-KRN-074 -->
- **WHEN** floor даёт `blast_radius: SYSTEM`, а `--propose` содержит `blast_radius: LOCAL`
- **THEN** записано `SYSTEM` с `from: "floor:…"`, `data.ignored[]` содержит `blast_radius` с причиной `below-floor`

#### Scenario: Повторный запуск монотонен
<!-- id: SCN-KRN-075 -->
- **WHEN** record уже содержит `security_impact: MEDIUM` от proposer, а новый `classify` без `--propose` по diff без floor для этого измерения
- **THEN** `security_impact` остаётся `MEDIUM` с `from: "record"`

#### Scenario: Без git и без --paths
<!-- id: SCN-KRN-076 -->
- **WHEN** проект не является git-репозиторием и `--paths` не задан
- **THEN** `errors[0].code` равен `USAGE`, record не изменён, код выхода 3

#### Scenario: Пустой diff
<!-- id: SCN-KRN-077 -->
- **WHEN** diff пуст и `--propose` не задан
- **THEN** `classification` записана без измерений и без profiles, `data.effective_policy.risk_level` равен `MEDIUM`

#### Scenario: Значение человека
<!-- id: SCN-KRN-105 -->
- **WHEN** `warrant classify add-search --set security_impact=HIGH --set profile=feature --by kat` при `roles.maintainer: ["kat"]`
- **THEN** record содержит `security_impact: { value: "HIGH", from: "human:kat" }` и profile `feature` с `from: "human:kat"`

#### Scenario: Ниже floor
<!-- id: SCN-KRN-106 -->
- **WHEN** floor даёт `blast_radius: SYSTEM`, а вызван `--set blast_radius=LOCAL --by kat` без `--ref`
- **THEN** `errors[0].code` равен `BELOW_FLOOR`, код 3, record не изменён

#### Scenario: --set без роли
<!-- id: SCN-KRN-107 -->
- **WHEN** `--set data_loss=LOW` без `--by`, или с `--by bob` вне `roles`
- **THEN** `errors[0].code` равен `USAGE` либо `ROLE_REQUIRED`, record не изменён

#### Scenario: Понижение ниже floor с approval
<!-- id: SCN-KRN-116 -->
- **WHEN** floor даёт `blast_radius: SYSTEM`, record `add-search` в `SPECIFIED`, вызван `--set blast_radius=LOCAL --by kat --ref https://github.com/o/r/pull/7#issuecomment-1` при `roles.maintainer: ["kat"]`
- **THEN** record содержит `blast_radius: { value: "LOCAL", from: "human:kat", ref: "https://github.com/o/r/pull/7#issuecomment-1" }`; повторный `classify` без `--set` сохраняет его, а `data.ignored[]` содержит `blast_radius` с причиной `approved-below-floor`

#### Scenario: Понижение после APPROVED
<!-- id: SCN-KRN-117 -->
- **WHEN** тот же вызов при record `add-search` в `APPROVED`
- **THEN** `errors[0].code` равен `STATE_INVALID`, код 3, record не изменён

#### Scenario: Своё состояние не делает Change factory
<!-- id: SCN-KRN-138 -->
- **WHEN** diff содержит только `src/search.py`, `.warrant/changes/add-search.json`, `.warrant/evidence/add-search/EVID-….json` и файл Run с `change: "add-search"`
- **THEN** `profiles` не содержит `factory-change`, floor по `.warrant/**` не применён; при добавлении `.warrant/local/areas.json` — `factory-change` и floor, как в SCN-KRN-073

### Requirement: Схема rule
<!-- id: REQ-KRN-029 -->

Схема `warrant://rule/1` SHALL описывать правило по путям ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md)):
`id` (kebab-case, равен имени файла), `paths[]` (непустой список glob), `text` (непустая строка), необязательный `enforced_by`
(id check или команды `validate`, `fmt --check`, `ids-valid`, `guard`). Правила SHALL лежать в `rules/` pack (перечислены в
`provides.rules`) или в `.warrant/local/rules/`.

#### Scenario: Правило с enforced_by
<!-- id: SCN-KRN-108 -->
- **WHEN** проверяется `{ "$schema": "warrant://rule/1", "id": "json-canonical", "paths": [".warrant/**/*.json"], "text": "…", "enforced_by": "fmt --check" }`
- **THEN** файл валиден

#### Scenario: Правило без путей
<!-- id: SCN-KRN-109 -->
- **WHEN** `paths` пуст или отсутствует
- **THEN** файл невалиден с указанием `/paths`

### Requirement: Команда link
<!-- id: REQ-KRN-030 -->

`warrant link <change> (--amends <target> | --supersedes <target>) [--remove]` SHALL добавить `target` в `amends[]` или
`supersedes[]` record `<change>` (без дубликатов, сохраняя порядок) либо, с `--remove`, удалить его оттуда
([ADR-0021](../../../../docs/adr/WARRANT-ADR-0021-archive-immutability.md) п. 4, 9). Команда SHALL принимать ровно один из флагов
`--amends`, `--supersedes` (иначе `USAGE`) и SHALL менять record только в `change_state` `PROPOSED` или `SPECIFIED`: в `APPROVED` и далее —
`STATE_INVALID`, код 3 (метаданные после approval меняются только новой ревизией approval); `ARCHIVED`, `ABANDONED` — `RECORD_FROZEN`, код 3.
Цель `--amends` SHALL быть существующим Change в `MERGED` или `ARCHIVED`, цель `--supersedes` — в `ABANDONED`, и SHALL NOT совпадать с
`<change>`; иначе `LINK_TARGET_INVALID`, код 3, record не изменён. Record SHALL записываться канонически; после записи `warrant validate`
(проверка (10) [REQ-KRN-021](#requirement-команда-validate)) SHALL проходить, а `warrant status <target>` — показывать `<change>` в
`amended_by[]` или `superseded_by[]`.

#### Scenario: Исправление архивного Change
<!-- id: SCN-KRN-118 -->
- **WHEN** `warrant link fix-search --amends add-search` при record `fix-search` в `PROPOSED` и record `add-search` в `ARCHIVED`
- **THEN** record `fix-search` содержит `amends: ["add-search"]`, код 0, повторный вызов не создаёт дубликата, `warrant status add-search` даёт `amended_by: ["fix-search"]`

#### Scenario: Цель не в допустимом состоянии
<!-- id: SCN-KRN-119 -->
- **WHEN** `warrant link fix-search --supersedes add-search` при record `add-search` в `ARCHIVED`
- **THEN** `errors[0].code` равен `LINK_TARGET_INVALID`, код 3, record не изменён

#### Scenario: После APPROVED
<!-- id: SCN-KRN-120 -->
- **WHEN** `warrant link fix-search --amends add-search` при record `fix-search` в `APPROVED`
- **THEN** `errors[0].code` равен `STATE_INVALID`, код 3; `--remove` в `SPECIFIED` удаляет цель из `amends[]`

### Requirement: Команда waive
<!-- id: REQ-KRN-031 -->

`warrant waive` SHALL создавать и менять waiver-файлы `.warrant/waivers/<WAV>.json` ([05 §7](../../../../docs/05-policy.md)); файлы
SHALL записываться канонически и проходить [REQ-KRN-019](#requirement-схема-waiver) и проверку (11) [REQ-KRN-021](#requirement-команда-validate).
(1) `warrant waive <change> <gate> --reason <text> --risk <LOW|MEDIUM|HIGH> --control <text>… --owner <human:login> --expires <YYYY-MM-DD>`
SHALL создать waiver в состоянии `PROPOSED` без `approved_by`, с `id` `WAV-<год UTC>-NNN`, где `NNN` — следующий номер после
максимального среди waivers `.warrant/waivers/` этого года; Change SHALL существовать и не быть заморожен (иначе `CHANGE_NOT_FOUND`
или `RECORD_FROZEN`), gate SHALL быть объявлен подключённым pack и иметь `waivable: true` (иначе `WAIVER_INVALID`), `--expires` SHALL
быть датой не раньше сегодняшней UTC (иначе `USAGE`); `targets[]` команда SHALL NOT записывать (поведение частичного waiver — фаза 5).
(2) `warrant waive --activate <WAV> --by <login>` SHALL перевести waiver из `PROPOSED` в `ACTIVE` и записать `approved_by: "human:<login>"`;
(3) `warrant waive --revoke <WAV> --by <login>` SHALL перевести waiver из `PROPOSED` или `ACTIVE` в `REVOKED`. Для (2) и (3) `login`
SHALL входить в `roles.maintainer` (иначе `ROLE_REQUIRED`, код 3), неизвестный `<WAV>` — `WAIVER_INVALID`, недопустимое исходное
состояние — `STATE_INVALID`, код 3; waiver в `EXPIRED` или `REVOKED` SHALL NOT меняться. Команда SHALL печатать waiver в `data.waiver`.
Агент MAY выполнять (1); активация — акт человека (05 §7), предел проверки `--by` — как у `transition` (заявление до `warrant ci`).

#### Scenario: Предложить waiver
<!-- id: SCN-KRN-121 -->
- **WHEN** `warrant waive add-search analyze-clean --reason "no analyze yet" --risk HIGH --control "maintainer review" --owner human:kat --expires 2026-12-31` при существующих `WAV-2026-001`, `WAV-2026-004`
- **THEN** создан `.warrant/waivers/WAV-2026-005.json` с `waiver_state: "PROPOSED"` без `approved_by`, `warrant validate` даёт `ok: true`, gate `analyze-clean` по-прежнему `BLOCKED`

#### Scenario: Активировать
<!-- id: SCN-KRN-122 -->
- **WHEN** `warrant waive --activate WAV-2026-005 --by kat` при `roles.maintainer: ["kat"]`
- **THEN** waiver в `ACTIVE` с `approved_by: "human:kat"`, `warrant gate add-search` даёт `analyze-clean: WAIVED`; с `--by bob` вне `roles.maintainer` — `ROLE_REQUIRED`, файл не изменён

#### Scenario: Невэйвабельный gate
<!-- id: SCN-KRN-123 -->
- **WHEN** `warrant waive add-search scope-valid …`
- **THEN** `errors[0].code` равен `WAIVER_INVALID`, код 3, файл не создан

#### Scenario: Отозвать
<!-- id: SCN-KRN-124 -->
- **WHEN** `warrant waive --revoke WAV-2026-005 --by kat` для `ACTIVE` waiver
- **THEN** waiver в `REVOKED`, gate `analyze-clean` снова `BLOCKED`; повторный `--activate` даёт `STATE_INVALID`

### Requirement: Команда validate --files
<!-- id: REQ-KRN-032 -->

`warrant validate --files <paths>` (пути через запятую, [ADR-0019](../../../../docs/adr/WARRANT-ADR-0019-post-edit-hints.md))
SHALL выполнить только проверки одного файла, применимые к пути, с теми же кодами ошибок, что полный `validate`: (a) JSON
`.warrant/**` и packs — схема и канонический вид; (b) Markdown `openspec/changes/**` — формат ID и AREA из реестра
(размещение ID под заголовком — сверка с `openspec show`, только полный `validate`); (c) stable ID изменён или удалён относительно `HEAD` — для `openspec/specs/**` и Change в состоянии
`APPROVED` и дальше; (d) висячие ссылки REQ / SCN в `tasks.md` и в файлах `paths.tests`; (e) строки, похожие на токены.
Проверки уровня проекта (lock, hash, drift сгенерированных файлов, сверка с `openspec`) SHALL NOT выполняться. Команда SHALL
NOT запускать дочерних процессов, кроме одного чтения `HEAD:<path>` через git для (c). `data{ checked[], skipped[] }`: путь без применимой
проверки, отсутствующий файл и путь вне проекта — в `skipped[]` с `reason` (`no-check`, `missing`, `outside`).

#### Scenario: Неканонический JSON
<!-- id: SCN-KRN-127 -->
- **WHEN** `warrant validate --files .warrant/local/areas.json` для файла с ключами не по порядку
- **THEN** `errors[]` содержит `NOT_CANONICAL` с `path` файла и `hint`, содержащим `warrant fmt`, код 1

#### Scenario: Изменённый stable ID
<!-- id: SCN-KRN-128 -->
- **WHEN** в рабочем дереве в `openspec/specs/search/spec.md` комментарий `REQ-SRC-001` заменён на `REQ-SRC-009`, и вызван `warrant validate --files openspec/specs/search/spec.md`
- **THEN** `errors[]` содержит `ID_IMMUTABLE` с `REQ-SRC-001`, а проверки lock и сгенерированных файлов не выполнялись

#### Scenario: Посторонний файл
<!-- id: SCN-KRN-129 -->
- **WHEN** `warrant validate --files docs/notes.md,../other/x.json`
- **THEN** `ok: true`, `data.skipped[]` содержит `docs/notes.md` с `reason: "no-check"` и `../other/x.json` с `reason: "outside"`

### Requirement: Файлы frontend и AGENTS.md
<!-- id: REQ-KRN-033 -->

`warrant sync` SHALL генерировать корневой `AGENTS.md`, если подключённые packs или `.warrant/local/rules/` содержат хотя бы
одно правило `rule/1` с `paths: ["**"]` ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 2, 5): первая строка —
`<!-- generated by warrant — do not edit -->`, затем текст таких правил в порядке id; файл больше 16 KiB — ошибка
`GENERATED_TOO_LARGE` с `hint`, ничего не записано. При `frontends ∋ "claude"` `sync` SHALL держать управляемое подмножество
([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 3): в `.claude/settings.json` — записи
`permissions.deny` на правку `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**`, `openspec/specs/**`,
`openspec/config.yaml`, `openspec/schemas/**` и на `git push origin main`, `gh pr merge`, `openspec archive`
([ADR-0014](../../../../docs/adr/WARRANT-ADR-0014-claude-code-enforcement.md) п. 1), и хуки с командой ровно
`warrant guard --frontend claude` — `PreToolUse` с matcher `Edit|Write|NotebookEdit|Bash` и `PostToolUse` с matcher
`Edit|Write|NotebookEdit`; при сгенерированном `AGENTS.md` — строку `@AGENTS.md` в `CLAUDE.md` (файла нет — создать); файл субагента
`.claude/agents/warrant-reviewer.md` целиком ([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md), ADR-0014 п. 3): frontmatter с `name: warrant-reviewer`,
`description`, `tools` без `Write`, `Edit` и `NotebookEdit` и хуком `PreToolUse` с matcher `Bash` и командой ровно
`warrant guard --frontend claude`, затем строка-маркер `<!-- generated by warrant — do not edit -->`, текст skill review pack'а
(skill `specification/adversarial-review` из lock) и порядок сдачи результата — envelope `warrant://skill-result/1` командой
`warrant run submit`. Во всех
случаях `sync` SHALL держать строку `.warrant/runs/current` в `.gitignore`. Чужие ключи, записи и строки этих файлов SHALL
сохраняться; `.claude/settings.json` пишется в каноническом JSON. `warrant init --frontend claude` SHALL записать
`frontends: ["claude"]` в новый `warrant.json`. `warrant validate` SHALL сверять `AGENTS.md` и `.claude/agents/warrant-reviewer.md` побайтно, а в `.claude/settings.json`,
`CLAUDE.md` и `.gitignore` — наличие своих записей в точном виде; расхождение — `GENERATED_DRIFT` с `path` (JSON Pointer для
`settings.json`) и `hint` `` run `warrant sync` ``.

#### Scenario: Управляемое подмножество settings.json
<!-- id: SCN-KRN-130 -->
- **WHEN** `warrant sync` при `frontends: ["claude"]` и `.claude/settings.json` с чужим хуком `PreToolUse` и ключом `env`
- **THEN** файл содержит свои записи deny и хуки `warrant guard --frontend claude`, чужой хук и `env` сохранены; повторный `sync` не меняет ни одного байта

#### Scenario: Снятый deny
<!-- id: SCN-KRN-131 -->
- **WHEN** из `.claude/settings.json` удалена запись deny на `.warrant/runs/**`, а чужие ключи изменены
- **THEN** `warrant validate` даёт одну ошибку `GENERATED_DRIFT` с путём `.claude/settings.json` и `hint` `` run `warrant sync` ``; правка чужих ключей ошибок не даёт

#### Scenario: AGENTS.md из общих правил
<!-- id: SCN-KRN-132 -->
- **WHEN** `.warrant/local/rules/` содержит правило с `paths: ["**"]` и правило с `paths: ["src/**"]`, `frontends: ["claude"]`
- **THEN** `AGENTS.md` начинается строкой-маркером и содержит текст только первого правила, `CLAUDE.md` содержит строку `@AGENTS.md`; без правил с `paths: ["**"]` `AGENTS.md` не создаётся

#### Scenario: Большой AGENTS.md
<!-- id: SCN-KRN-133 -->
- **WHEN** текст правил с `paths: ["**"]` даёт `AGENTS.md` больше 16 KiB
- **THEN** `errors[0].code` равен `GENERATED_TOO_LARGE` с `path` `AGENTS.md`, ни один файл не записан, код 3

#### Scenario: Проект без frontend
<!-- id: SCN-KRN-134 -->
- **WHEN** `warrant sync` в проекте без `frontends` и без правил с `paths: ["**"]`
- **THEN** `.claude/settings.json`, `.claude/agents/warrant-reviewer.md`, `CLAUDE.md` и `AGENTS.md` не создаются и не меняются, `.gitignore` содержит `.warrant/runs/current`

#### Scenario: Файл субагента review
<!-- id: SCN-KRN-139 -->
- **WHEN** `warrant sync` при `frontends: ["claude"]`
- **THEN** `.claude/agents/warrant-reviewer.md` начинается frontmatter с `name: warrant-reviewer`, `tools` не содержит `Write`, `Edit`, `NotebookEdit`, хук `PreToolUse` `Bash` вызывает `warrant guard --frontend claude`; тело содержит строку-маркер, текст skill `specification/adversarial-review` и `warrant run submit`; повторный `sync` не меняет ни одного байта

#### Scenario: Правленый файл субагента
<!-- id: SCN-KRN-140 -->
- **WHEN** в `.claude/agents/warrant-reviewer.md` изменена одна строка
- **THEN** `warrant validate` даёт `GENERATED_DRIFT` с путём файла и `hint` `` run `warrant sync` ``, код 3

### Requirement: Режим --dry-run меняющих команд
<!-- id: REQ-KRN-034 -->

`warrant transition`, `warrant archive`, `warrant waive`, `warrant run start` и `warrant run finish` с `--dry-run` SHALL
выполнить те же проверки и напечатать тот же JSON, что настоящий запуск, с `data.dry_run: true` и `data.would_write[]` (пути
файлов, которые были бы созданы или изменены), завершиться тем же кодом и SHALL NOT менять ни одного файла.
`archive --dry-run` SHALL выполнить `openspec validate --strict` и gates `MERGED->ARCHIVED`, но не `openspec archive`.

#### Scenario: Пробный переход
<!-- id: SCN-KRN-135 -->
- **WHEN** `warrant transition add-search SPECIFIED --dry-run` при gates `PASS`
- **THEN** `data.dry_run: true`, `data.would_write[]` содержит `.warrant/changes/add-search.json`, код 0, record и evidence не изменены

#### Scenario: Пробный переход с отказом
<!-- id: SCN-KRN-136 -->
- **WHEN** `warrant transition add-search SPECIFIED --dry-run` при gate `FAIL`
- **THEN** ошибка и код выхода те же, что у запуска без `--dry-run`

#### Scenario: Пробный archive
<!-- id: SCN-KRN-137 -->
- **WHEN** `warrant archive add-search --dry-run` при `change_state: MERGED`
- **THEN** `openspec archive` не вызван, каталог Change на месте, `data.would_write[]` содержит record и каталог `openspec/changes/archive/<дата>-add-search/`
