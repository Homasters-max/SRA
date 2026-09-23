# Spec Delta: kernel

## ADDED Requirements

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

## MODIFIED Requirements

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
([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md)), `trusted_signers[]`.

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
(`profiles[]`, `risk` — измерение → `{ "value", "from" }` где `from` соответствует `floor`, `proposer:<id>` или `human:<login>`;
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

### Requirement: Схема waiver
<!-- id: REQ-KRN-019 -->

Схема `warrant://waiver/1` SHALL описывать waiver ([05 §7](../../../../docs/05-policy.md)): `id` (`WAV-<year>-NNN`), `change`, `gate`, `reason`,
`risk`, `compensating_controls[]`, обязательные `owner`, `approved_by` (вид `human:<login>`), `expires_at` (дата),
`waiver_state` из [02 §2](../../../../docs/02-vocabulary.md), необязательный `targets[]` (object[]; форму задаёт pack gate, D-13).

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
(10) каждая цель `amends[]` — существующий Change в `MERGED` или `ARCHIVED`, каждая цель `supersedes[]` — в `ABANDONED` (иначе `LINK_TARGET_INVALID`);
(11) каждый waiver `.warrant/waivers/*.json` ссылается на существующие Change и gate, gate имеет `waivable: true`, `approved_by`
входит в `roles` `warrant.json` (иначе `WAIVER_INVALID`); `ACTIVE` waiver с `expires_at` в прошлом даёт предупреждение `WAIVER_EXPIRED` в
stderr, не ошибку;
(12) записи `.warrant/evidence/<change>/*.json` и `manifest.json` валидны схемами, `metrics` и `targets[]` — формами pack
([REQ-KRN-001](#requirement-адресация-и-форма-json-schema-kernel)), `kind` каждой записи объявлен подключённым pack, а `manifest.evidence[]` перечисляет ровно записи каталога.
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
значение измерения по совпавшим путям; (3) `match.paths` profiles — предлагаемые profiles; (4) `--propose <json>` — profiles и значения
измерений от proposer'а; (5) `--set <dim>=<value>` и `--set profile=<id>` (повторяемые) — значения человека, требуют `--by <login>`,
где `login` входит хотя бы в одну роль `roles` `warrant.json` (иначе `ROLE_REQUIRED`, код 3), и записываются с `from: human:<login>`.
Итог измерения = максимум по порядку значений [05 §4](../../../../docs/05-policy.md) из floor, proposer и human; каждое значение
SHALL нести `from` (`floor:<pack>:<rule-index>`, `proposer`, `human:<login>`, ранее записанное — `record`). `--set` ниже floor SHALL
отказывать с `BELOW_FLOOR`, код 3, record не изменён (понижение — вне этого требования). Повторный `classify` SHALL NOT понижать ранее
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
- **WHEN** floor даёт `blast_radius: SYSTEM`, а вызван `--set blast_radius=LOCAL --by kat`
- **THEN** `errors[0].code` равен `BELOW_FLOOR`, код 3, record не изменён

#### Scenario: --set без роли
<!-- id: SCN-KRN-107 -->
- **WHEN** `--set data_loss=LOW` без `--by`, или с `--by bob` вне `roles`
- **THEN** `errors[0].code` равен `USAGE` либо `ROLE_REQUIRED`, record не изменён
