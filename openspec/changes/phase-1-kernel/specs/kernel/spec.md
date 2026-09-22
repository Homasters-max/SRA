# Spec Delta: kernel

## Purpose

Kernel WARRANT: JSON Schemas контрактов (`warrant://<name>/1`) и команды CLI фазы 1 —
`init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status`. Поведение, наблюдаемое через файлы и JSON-вывод.

## ADDED Requirements

### Requirement: Адресация и форма JSON Schema kernel
<!-- id: REQ-KRN-001 -->

CLI SHALL поставлять JSON Schema (draft 2020-12) для каждого `warrant://<name>/<major>` kernel. `$id` схемы
SHALL совпадать с этим URI. Каждое свойство SHALL иметь `description`. Объекты SHALL запрещать неизвестные ключи
(`additionalProperties: false`), кроме ключа `$comment`, который допустим в любом объекте. Файл SHALL
сопоставляться со схемой только по своему полю `$schema`.

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

### Requirement: Контракт JSON-вывода CLI
<!-- id: REQ-KRN-002 -->

Каждая команда SHALL уметь печатать в stdout ровно один JSON-объект `{ "command", "ok", "change"?, "data", "errors" }`.
JSON SHALL быть форматом по умолчанию, когда stdout не TTY, и SHALL включаться флагом `--json` всегда.
`errors[]` SHALL состоять из объектов `{ "code", "message", "path"? }`, где `code` — UPPER_SNAKE.
Диагностика, не входящая в контракт, SHALL идти в stderr.

#### Scenario: Успешный вызов без TTY
<!-- id: SCN-KRN-004 -->
- **WHEN** `warrant fmt --check` вызван с перенаправленным stdout и все файлы канонические
- **THEN** stdout содержит один объект с `"command": "fmt"`, `"ok": true`, `"errors": []`

#### Scenario: Ошибка в контракте
<!-- id: SCN-KRN-005 -->
- **WHEN** `warrant validate --json` находит невалидный файл
- **THEN** `"ok": false`, `errors[]` содержит запись с `code`, `message` и `path` файла, а stdout не содержит ничего кроме объекта

### Requirement: Коды выхода
<!-- id: REQ-KRN-003 -->

CLI SHALL завершаться кодом `0` при `ok: true`; `1` при verdict `FAIL` / `STOP` и при `fmt --check` с расхождениями;
`2` при `WAIT` / `ESCALATE`; `3` при ошибке конфигурации, невалидном файле, неизвестной команде или неверных аргументах.

#### Scenario: Неверные аргументы
<!-- id: SCN-KRN-006 -->
- **WHEN** вызвано `warrant id REQ` без AREA или `warrant nosuchcommand`
- **THEN** код выхода 3 и `errors[0].code` равен `USAGE`

#### Scenario: Ошибка конфигурации
<!-- id: SCN-KRN-007 -->
- **WHEN** `.warrant/warrant.json` отсутствует, а вызвана команда, которой он нужен (`validate`, `sync`, `resolve`, `status`, `id`)
- **THEN** код выхода 3 и `errors[0].code` равен `CONFIG_MISSING`

### Requirement: Схема config
<!-- id: REQ-KRN-004 -->

Схема `warrant://config/1` SHALL описывать `.warrant/warrant.json` ([08 §3](../../../../docs/08-packs.md)):
обязательные `kernel` (major.minor), `openspec` (диапазон `1.13.x`), `packs` (id kebab-case → `{ "version": semver-range, "params"? }`);
необязательные `paths` (`adr`, `glossary`, `tests`, `src`), `roles` (роль → список логинов), `identities.agents[]`
([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md)), `trusted_signers[]`.

#### Scenario: Пример из документации
<!-- id: SCN-KRN-008 -->
- **WHEN** проверяется пример `warrant.json` из 08 §3, дополненный `"$schema"`
- **THEN** файл валиден

#### Scenario: Pack без версии
<!-- id: SCN-KRN-009 -->
- **WHEN** `packs.core-sdd` не содержит `version` или `version` не semver-диапазон
- **THEN** файл невалиден с указанием `/packs/core-sdd/version`

### Requirement: Схема lock
<!-- id: REQ-KRN-005 -->

Схема `warrant://lock/1` SHALL описывать `.warrant/warrant.lock.json`: `kernel` и `openspec` (точные версии),
`packs` (id → `{ "version", "source", "hash" }`), `skills` (`namespace/name` → `{ "version", "path", "hash" }`),
`generated` (путь относительно корня проекта → `hash`). Все `hash` SHALL иметь вид `sha256:<64 hex>`.

#### Scenario: Lock, записанный sync
<!-- id: SCN-KRN-010 -->
- **WHEN** проверяется lock, записанный `warrant sync`
- **THEN** файл валиден

#### Scenario: Hash не sha256
<!-- id: SCN-KRN-011 -->
- **WHEN** `packs.core-sdd.hash` равен `"abc"`
- **THEN** файл невалиден с указанием `/packs/core-sdd/hash`

### Requirement: Схема pack
<!-- id: REQ-KRN-006 -->

Схема `warrant://pack/1` SHALL описывать `pack.json` ([08 §2](../../../../docs/08-packs.md)): `id`, `version` (semver),
`kernel` (semver-диапазон), `depends_on`, `provides` со списками относительных путей `profiles`, `overlays`, `gates`,
`checks`, `risk_floors`, `risk_levels`, `controller_rules`, `recipes`, `templates`, строками `openspec_schema`,
`openspec_rules`, списками `skills` (`namespace/name@range`) и `evidence_kinds`; `params_schema`.
Пути SHALL быть относительными без `..`.

#### Scenario: Манифест core-sdd
<!-- id: SCN-KRN-012 -->
- **WHEN** проверяется `packs/core-sdd/pack.json`
- **THEN** файл валиден

#### Scenario: Путь за пределами pack
<!-- id: SCN-KRN-013 -->
- **WHEN** `provides.gates` содержит `"../other/gate.json"`
- **THEN** файл невалиден с указанием `/provides/gates/0`

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
`run.command[]` (список строк, допустим плейсхолдер `{out}`), `produces[]` (evidence kinds), `parser`.
Уровень `L2` SHALL отклоняться: check не использует LLM.

#### Scenario: Пример pytest
<!-- id: SCN-KRN-020 -->
- **WHEN** проверяется пример check из 06 §2
- **THEN** файл валиден

#### Scenario: Check уровня L2
<!-- id: SCN-KRN-021 -->
- **WHEN** `level` равен `"L2"`
- **THEN** файл невалиден с указанием `/level`

### Requirement: Схема change-record
<!-- id: REQ-KRN-011 -->

Схема `warrant://change-record/1` SHALL описывать `.warrant/changes/<change>.json` ([04 §9](../../../../docs/04-lifecycle.md)):
`change` (kebab-case, равен имени файла), `change_state` из [02 §2](../../../../docs/02-vocabulary.md), необязательный `classification`
(`profiles[]`, `risk` — измерение → `{ "value", "from" }` где `from` соответствует `floor`, `proposer:<id>` или `human:<login>`;
`risk_level`), `transitions[]` (`to`, `at` (RFC 3339), `by`, `effective_policy_hash`?, `gates`?, `evidence`?, `ref`? (URL)),
`unknowns[]` (`id` `UNK-AREA-NNN`, `text`, `blocking`, `resolution`?), `assumptions[]` (`id` `ASM-AREA-NNN`, `text`).

#### Scenario: Пример из документации
<!-- id: SCN-KRN-022 -->
- **WHEN** проверяется пример record из 04 §9 с `by` вида `cli:local` и `ref` в виде URL форджа
- **THEN** файл валиден

#### Scenario: Значение risk без источника
<!-- id: SCN-KRN-023 -->
- **WHEN** `classification.risk.data_loss` равен строке `"NONE"` вместо объекта с `from`
- **THEN** файл невалиден с указанием `/classification/risk/data_loss`

### Requirement: Схема evidence
<!-- id: REQ-KRN-012 -->

Схема `warrant://evidence/1` SHALL описывать запись evidence ([06a §2](../../../../docs/06a-evidence.md)): `id` (`EVID-<ULID>`),
`claim{ "text", "targets"[] }`, `kind`, `level`, `evidence_status`, `subject{ "commit", "spec_revision", "dataset_snapshot" }`,
`produced_by{ "type" ∈ check | skill | human, "id", "version", "run" }`, `attestation{ "type", "ref"? }`, `context_hash`,
`effective_policy_hash`, `created_at`, `artifacts[{ "uri", "sha256" }]`, `limitations[]`.

#### Scenario: Запись с ULID
<!-- id: SCN-KRN-024 -->
- **WHEN** проверяется пример из 06a §2 с `id` вида `EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3` и `attestation.ref` в виде URL
- **THEN** файл валиден

#### Scenario: Счётчик вместо ULID
<!-- id: SCN-KRN-025 -->
- **WHEN** `id` равен `"EVID-000921"`
- **THEN** файл невалиден с указанием `/id` ([ADR-0012](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md))

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
`risk`, `compensating_controls[]`, обязательные `owner`, `approved_by` (вид `human:<login>`), `expires_at` (дата),
`waiver_state` из [02 §2](../../../../docs/02-vocabulary.md).

#### Scenario: Пример waiver
<!-- id: SCN-KRN-038 -->
- **WHEN** проверяется пример из 05 §7
- **THEN** файл валиден

#### Scenario: Без срока
<!-- id: SCN-KRN-039 -->
- **WHEN** `expires_at` отсутствует
- **THEN** файл невалиден с указанием отсутствующего поля

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
и в подключённых packs имеет `$schema` и валиден; (2) `warrant.json` и lock согласованы — версии packs в диапазонах,
hash каждого pack, skill и сгенерированного файла совпадает с содержимым; (3) объекты с одним `id` не объявлены
в двух packs, а override в `.warrant/local/` несёт `"overrides": "<pack>:<id>"` ([08 §4](../../../../docs/08-packs.md));
(4) `openspec/config.yaml` и `openspec/schemas/<schema>/**` побайтно равны результату генерации, `openspec schema validate`
проходит, ключи `rules` входят в artifacts schema ([ADR-0015](../../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md));
(5) stable ID в `openspec/specs/**` и `openspec/changes/**` (по `openspec show --json`) имеют верный формат, стоят
непосредственно под заголовком с непустым телом ([ADR-0012 §7](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)), уникальны и используют AREA из реестра;
(6) в `.warrant/**` и `.claude/**` нет строк, похожих на токены ([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md));
(7) все JSON-файлы `.warrant/**` канонические ([REQ-KRN-022](#requirement-команда-fmt)).
Любая находка SHALL давать `ok: false` и код выхода 3. Флаг `--no-generated` SHALL пропускать проверку (4)
и сверку hash файлов `openspec/**` из lock в проверке (2), SHALL быть отмечен в `data.skipped[]`; он нужен репозиторию WARRANT,
пока `config.yaml` ведётся вручную (ADR-0015 п. 7), и удаляется в фазе 2.

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
слить `openspec/rules.json` packs и проекта по [ADR-0015 п. 2](../../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md), записать `openspec/config.yaml`,
`openspec/schemas/<schema>/schema.yaml` и `templates/**` детерминированно ([ADR-0015 п. 3](../../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md)),
обновить копии схем в `.warrant/schemas/` и записать `warrant.lock.json` с hash каждого pack, skill и сгенерированного файла.
Повторный `sync` без изменений входов SHALL NOT менять ни одного байта. `--check` SHALL только сообщать расхождения (код 1).

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

### Requirement: Команда resolve
<!-- id: REQ-KRN-026 -->

`warrant resolve <change> [--explain] [--classification <file>]` SHALL вычислить effective policy как чистую функцию
от classification (из record или из файла), overlays packs и `.warrant/local/` в порядке
`default → project → profile(s) → risk → waiver` по правилам [05 §5](../../../../docs/05-policy.md): объединение множеств, запрет ослабления,
`forbidden` абсолютен, конфликт `required` ∧ `forbidden` → `POLICY_CONFLICT`. Результат SHALL содержать `hash`
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

### Requirement: Команда status
<!-- id: REQ-KRN-027 -->

`warrant status [change]` SHALL вернуть для каждого Change (одного или всех в `.warrant/changes/`): `change_state`,
`classification`, `effective_policy.hash` и `sources`, artifacts OpenSpec (`openspec status --json`: `done` / `ready` /
`blocked` / `skipped`), и `stale[]` — расхождения record с производными сигналами ([04 §9](../../../../docs/04-lifecycle.md)):
каталог Change отсутствует и не в archive; каталог в archive, а состояние не `ARCHIVED`. Verdicts gates и
`next` не входят в фазу 1 и SHALL отсутствовать в выводе, а не быть пустыми.

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
