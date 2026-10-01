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
`errors[]` SHALL состоять из объектов `{ "code", "message", "path"?, "hint"?, "retryable"? }`, где `code` — UPPER_SNAKE, `message` — что не
так, `hint` — команда или действие, которое исправляет ошибку ([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 8),
`retryable` — `true` у кода класса сбоя инфраструктуры ([REQ-KRN-003](#requirement-коды-выхода)); у остальных кодов ключа
`retryable` SHALL NOT быть ([ADR-0052](../../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 2).
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

Каждый код ошибки (`errors[].code`) SHALL иметь один класс во всех командах, и класс задаёт его код выхода:
- `1` — предмет суждения нарушает правило: нарушения PR `warrant ci` (`TOPOLOGY_VIOLATION`, `RECORD_MISMATCH`,
  `REF_NOT_VERIFIED`, `SCOPE_VIOLATION`, `GATE_NOT_PASSED`, `CHANGE_NOT_VERIFYING`, `EVIDENCE_NOT_VERIFIED`, `SPECS_NOT_ARCHIVED`);
- `2` — переход ждёт действия: `GATES_NOT_PASSED`, `POLICY_CONFLICT`;
- `4` — сбой инфраструктуры, повтор которого может пройти: `BUSY`, `CHECK_TIMEOUT`, `FORGE_UNAVAILABLE`; элемент `errors[]` с
  таким кодом SHALL нести `retryable: true` ([REQ-KRN-002](#requirement-контракт-json-вывода-cli));
- `3` — все остальные коды: конфигурация, невалидный файл и файл, расходящийся с каноном или генерацией, неизвестная команда,
  неверные аргументы, отказ доступа к форжу, сбой `git` или `openspec`, внутренняя ошибка `INTERNAL`.
Действие controller и вердикт команды дают: `CONTINUE` — `0`, `STOP` и находки `analyze` — `1`, `WAIT` и `ESCALATE` — `2`. Действие
controller входит в код выхода `gate`, `verify`, `transition` и `archive` (отказ перехода); остальные команды (`status`, `resolve`,
`classify`, `check`, `run`) выводят его в `data` без влияния на код — их код задают только `errors[]`.
Код выхода SHALL быть старшим из кодов элементов `errors[]` и кода действия по приоритету `3` > `1` > `4` > `2` > `0`: ошибка,
которую повтор не исправит, старше повторяемой, а повторяемая — старше ожидания, вычисленного на неполных из-за сбоя данных;
`ok: true` — код `0` (исключение — сбой после вывода, ниже). Код `4` и `retryable: true` SHALL NOT появляться у ошибок классов кодов
1, 2 и 3.
Исключение, не перехваченное командой, SHALL давать JSON-объект с `errors[0].code` `INTERNAL` и код `3` (стек — в stderr), а не
аварийный выход среды исполнения; `command` объекта — имя вызванной команды, без него — `warrant`. Если JSON-объект команды уже
выведен, второй SHALL NOT печататься: стек — в stderr, код `3`. Ошибка загрузки модулей CLI до начала работы его входной точки
(повреждённая установка) этим требованием не покрывается. `warrant guard` — вне этой таблицы: решение, в том числе `deny` при
внутреннем сбое (`BUSY`, битый Run, непредвиденное исключение), — код `0` ([REQ-ENF-004](../enforcement/spec.md)); у
`--frontend` — коды протокола frontend, исключение — код `2` ([REQ-ENF-005](../enforcement/spec.md)); ошибки разбора аргументов
(`USAGE`) — по таблице.
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

#### Scenario: Повторяемый сбой
<!-- id: SCN-KRN-160 -->
- **WHEN** `warrant check add-search` с check `exclusive: true` при занятом `<git-common-dir>/warrant/check.lock`; или `warrant ci fetch 9` при занятом lock Change
- **THEN** в обоих случаях код выхода 4, `errors[0].code` равен `BUSY` с `retryable: true`; у `CONFIG_MISSING` из SCN-KRN-007 ключа `retryable` нет

#### Scenario: Приоритет кодов
<!-- id: SCN-KRN-161 -->
- **WHEN** `warrant verify add-search`, где check `tests-passed` прерван по `CHECK_TIMEOUT`, а controller дал `WAIT`; затем то же при ещё одном check перехода без `run.command`
- **THEN** в первом случае код выхода 4, во втором — 3 (`CHECK_NOT_CONFIGURED` старше `CHECK_TIMEOUT`)

#### Scenario: Один код ошибки во всех командах
<!-- id: SCN-KRN-162 -->
- **WHEN** единственная ошибка вызова — `NOT_CANONICAL` в `warrant fmt --check`, `warrant validate` и `warrant validate --files`; или `GENERATED_DRIFT` в `warrant sync --check` и `warrant validate`
- **THEN** код выхода во всех пяти вызовах 3

#### Scenario: Непредвиденное исключение
<!-- id: SCN-KRN-163 -->
- **WHEN** команда завершается исключением, которое она не перехватила
- **THEN** stdout — один JSON-объект с `ok: false` и `errors[0].code` `INTERNAL`, стек — в stderr, код выхода 3; исключение после того, как объект команды выведен, — второго объекта нет, стек в stderr, код 3

### Requirement: Схема config
<!-- id: REQ-KRN-004 -->

Схема `warrant://config/1` SHALL описывать `.warrant/warrant.json` ([08 §3](../../../../docs/08-packs.md)):
обязательные `kernel` (major.minor), `openspec` (диапазон `1.13.x`), `packs` (id kebab-case → `{ "version": semver-range, "params"? }`);
необязательные `defaults` (`check_timeout_s` — положительное целое, [ADR-0017](../../../../docs/adr/WARRANT-ADR-0017-check-execution.md)),
`paths` (`adr`, `glossary`, `tests`, `src`), `roles` (роль → список логинов), `identities.agents[]`
([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md)), `trusted_signers[]`,
`frontends[]` — уникальные имена frontend, для которых `warrant sync` генерирует файлы (в фазе 4 — только `claude`,
[ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 1),
`cli` — файл входа CLI, который закрепил проект, путём от корня проекта: сегменты из ASCII-букв, цифр и `. _ @ + -`, разделённые
`/`, ни один сегмент не пуст, не начинается с `-` и не равен `.` или `..`, путь не начинается с `/` и оканчивается на `.js`,
`.mjs` или `.cjs`; его исполняют сгенерированные хуки и
субагент вместо `warrant` из PATH (REQ-KRN-033, [ADR-0053](../../../../docs/adr/WARRANT-ADR-0053-guard-recovery.md) п. 3).
Наличие файла схема не проверяет.

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

#### Scenario: Закреплённый CLI
<!-- id: SCN-KRN-165 -->
- **WHEN** `cli` равен `"packages/cli/dist/bin/warrant.js"`, `"/usr/bin/warrant.js"`, `"../x/warrant.js"`, `"bin/warrant"` или `"a b/warrant.js"`
- **THEN** первый файл валиден, остальные невалидны с указанием `/cli`

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
`applies_when.changed_paths[]`, `requires_evidence[{ "kind", "status", "check"? }]` со `status` из `evidence_status` и
необязательным `check` — id check, чьи записи только и засчитываются требованию
([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 6),
`waivable` (boolean), `accepts_attestation[]` ⊆ `ci`, `human-review`, `signature`, `none`.

#### Scenario: Пример tests-passed
<!-- id: SCN-KRN-018 -->
- **WHEN** проверяется пример gate из 06 §3
- **THEN** файл валиден

#### Scenario: Waivable не указан
<!-- id: SCN-KRN-019 -->
- **WHEN** в gate отсутствует `waivable`
- **THEN** файл невалиден: значение по умолчанию не подразумевается (INV-10)

#### Scenario: Требование с check
<!-- id: SCN-KRN-159 -->
- **WHEN** gate содержит `requires_evidence: [{ "kind": "test-report", "status": "PROVEN", "check": "dev-check" }]`, затем `check: "Dev Check"`
- **THEN** первый файл валиден; второй невалиден: `check` — kebab-case id

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
`unknowns[]` (`id` `UNK-AREA-NNN`, `text`, `blocking`, `resolution`? — текст ответа, `resolved_as`? — `decision`, `fact` или
`assumption`, `ref`? — URL; `resolved_as` и `ref` допустимы только вместе с `resolution`, [REQ-KRN-035](#requirement-команда-unknown)), `assumptions[]` (`id` `ASM-AREA-NNN`, `text`),
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

#### Scenario: Закрытый UNKNOWN
<!-- id: SCN-KRN-143 -->
- **WHEN** элемент `unknowns[]` равен `{ "id": "UNK-SRC-001", "text": "Можно ли переписывать историю?", "blocking": true, "resolution": "Нет", "resolved_as": "decision", "ref": "https://github.com/o/r/pull/7#issuecomment-1" }`
- **THEN** файл валиден; тот же элемент с `resolved_as: "guess"` или с `ref` без `resolution` — невалиден с указанием `/unknowns/0`

### Requirement: Схема evidence
<!-- id: REQ-KRN-012 -->

Схема `warrant://evidence/1` SHALL описывать запись evidence ([06a §2](../../../../docs/06a-evidence.md)): `id` (`EVID-<ULID>`),
`claim{ "text", "targets"[] }`, `kind`, `level`, `evidence_status`, `subject{ "commit", "base_commit"?, "spec_revision", "spec_tree"?,
"tree"?, "dataset_snapshot" }`, `produced_by{ "type" ∈ check | skill | human, "id", "version", "run" }`, `attestation{ "type", "ref"? }`, `context_hash`,
`effective_policy_hash`, `created_at`, `artifacts[{ "uri", "sha256" }]`, `limitations[]`, необязательный `metrics` (object; форму задаёт
pack для kind, [REQ-KRN-001](#requirement-адресация-и-форма-json-schema-kernel), [ADR-0016](../../../../docs/adr/WARRANT-ADR-0016-mutation-diff-scope.md)).
`subject.spec_tree` — hash дерева spec Change ([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 3);
`subject.tree` — id объекта дерева git результата merge, на котором сделана запись, 40 или 64 шестнадцатеричных символа в нижнем
регистре ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 2). Оба поля необязательны, но запись SHALL NOT
нести оба сразу: у них разные правила пред-фильтра. Схема остаётся `major = 1`.

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

#### Scenario: Дерево merge в subject
<!-- id: SCN-KRN-141 -->
- **WHEN** запись содержит `subject.tree` из 40 шестнадцатеричных символов в нижнем регистре
- **THEN** файл валиден; `subject.tree: "HEAD^{tree}"` — невалиден с указанием `/subject/tree`; запись с `subject.tree` и `subject.spec_tree` одновременно — невалидна с указанием `/subject`

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
и в подключённых packs имеет `$schema` и валиден; (2) `warrant.json` и lock согласованы — версии packs в диапазонах (версия подключённого pack вне диапазона `warrant.json` —
`PACK_VERSION_RANGE` с путём его `pack.json`, сообщением с версией pack и диапазоном — у встроенного pack ещё и с версией
CLI, который его несёт, — и `hint`: у встроенного pack, чья версия выше каждой версии диапазона, — поднять `packs.<id>.version`
и `kernel` в `warrant.json`, затем `warrant sync`; ниже каждой — `warrant.json` не менять, поставить CLI, который закрепил проект;
иначе (pack из `.warrant/local/`, версия ни выше, ни ниже) — задать диапазон, который содержит версию pack, затем `warrant sync`
([ADR-0053](../../../../docs/adr/WARRANT-ADR-0053-guard-recovery.md) п. 2); свой код, а не `CONFIG_INVALID`, отличает эту ошибку от прочих ошибок загрузки, и
тот же код SHALL давать любая команда, загружающая packs; pack, чей `kernel` не включает версию kernel CLI, — по-прежнему
`CONFIG_INVALID`),
hash каждого pack, skill и сгенерированного файла совпадает с содержимым, а pack, присутствующий в lock, но отсутствующий в
`warrant.json`, даёт `LOCK_MISMATCH` (B3); (3) объекты с одним `id` не объявлены
в двух packs, а override в `.warrant/local/` несёт `"overrides": "<pack>:<id>"` ([08 §4](../../../../docs/08-packs.md)) и не ослабляет
переопределяемый объект: не сужает `match` overlay, не удаляет элементы `extends` profile, не убирает gates, artifacts, evidence,
approvals и `forbidden`, не снимает и не меняет `check` элемента `requires_evidence` gate; каталог `.warrant/local/<id>/` с `pack.json`, чей `id` не подключён в `warrant.json`, SHALL давать `CONFIG_INVALID`,
а его файлы SHALL NOT попадать в project-слой; `check` элемента `requires_evidence` gate называет загруженный check, чей `produces`
(с учётом override) содержит `kind` элемента (иначе `CONFIG_INVALID` с `path` `…#/requires_evidence/<i>/check`,
[ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 6);
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
archive (иначе `ID_DANGLING` с путём, строкой и ID; [ADR-0019](../../../../docs/adr/WARRANT-ADR-0019-post-edit-hints.md) п. 1d);
(14) ни один логин `identities.agents[].login` `warrant.json` не входит ни в одну роль `roles` (иначе `CONFIG_INVALID` с `path`
`.warrant/warrant.json#/identities/agents/<i>/login`; [ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md) п. 4,
[ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 3).
Любая находка SHALL давать `ok: false` и код выхода 3 ([REQ-KRN-003](#requirement-коды-выхода)). Флага `--no-generated` SHALL NOT быть: `config.yaml` генерируется целиком
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

#### Scenario: check gate без такого check
<!-- id: SCN-KRN-156 -->
- **WHEN** `.warrant/local/gates/dev-passed.json` требует `{ "kind": "test-report", "status": "PROVEN", "check": "dev-check" }`, а check `dev-check` не загружен или его `produces` не содержит `test-report`
- **THEN** `errors[]` содержит `CONFIG_INVALID` с `path`, оканчивающимся на `#/requires_evidence/0/check`, код 3; с check `dev-check`, производящим `test-report`, — ошибки нет

#### Scenario: Агент в ролях
<!-- id: SCN-KRN-157 -->
- **WHEN** `warrant.json` содержит `roles.maintainer: ["kat", "warrant-agent[bot]"]` и `identities.agents: [{ "login": "warrant-agent[bot]", "kind": "bot" }]`
- **THEN** `errors[]` содержит `CONFIG_INVALID` с `path` `.warrant/warrant.json#/identities/agents/0/login`, код 3; без агента в `roles` — ошибки нет

#### Scenario: Версия pack вне диапазона
<!-- id: SCN-KRN-164 -->
- **WHEN** `warrant.json` задаёт `packs.core-sdd.version: "^0.3.0"`, а подключённый pack `core-sdd` имеет версию `0.4.0`
- **THEN** `errors[]` содержит `PACK_VERSION_RANGE` с путём `pack.json` pack'а `core-sdd`, без `retryable`, код 3; `CONFIG_INVALID` об этом pack нет

#### Scenario: Версии в находке диапазона
<!-- id: SCN-KRN-167 -->
- **WHEN** `warrant.json` задаёт `packs.core-sdd.version: "^0.3.4"`, а встроенный pack `core-sdd` CLI имеет версию `0.4.1`
- **THEN** `errors[]` содержит `PACK_VERSION_RANGE`, чей `message` называет `0.4.1`, `^0.3.4` и версию CLI, а `hint` — `packs.core-sdd.version`, `kernel` и `warrant sync`, код 3; при `^0.5.0` `hint` называет CLI, который закрепил проект, и не советует менять `packs.core-sdd.version`

### Requirement: Команда fmt
<!-- id: REQ-KRN-022 -->

`warrant fmt [paths...]` SHALL приводить JSON-файлы `.warrant/**` (по умолчанию) или указанные пути к каноническому
виду: `$schema` первым, затем ключи в порядке `properties` схемы, остальные — по алфавиту; отступ 2 пробела;
LF; завершающий перевод строки; UTF-8 без BOM. `--check` SHALL не менять файлы и при расхождении давать `NOT_CANONICAL` с путём
каждого неканонического файла, код 3 ([REQ-KRN-003](#requirement-коды-выхода)).
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
- **THEN** файл не изменён, `data.changed` содержит его путь, `errors[]` — `NOT_CANONICAL` с этим путём, код выхода 3

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
максимум по `openspec/specs/**`, `openspec/changes/**` (включая archive) и `unknowns[]` / `assumptions[]` records
`.warrant/changes/*.json` + 1, три цифры с ведущими нулями; AREA SHALL быть в `.warrant/local/areas.json`, иначе
`AREA_UNKNOWN`, код 3, с `hint`: объявленные AREA и то, что новую AREA объявляет человек правкой
`.warrant/local/areas.json` — policy-пути, который не пишет ни одна операция Run ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 6). `warrant id EVID` и `warrant id RUN` SHALL выдать `PREFIX-<ULID>`.
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
- **THEN** `errors[0].code` равен `AREA_UNKNOWN`, код выхода 3; `errors[0].hint` перечисляет объявленные AREA и называет `.warrant/local/areas.json`

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

#### Scenario: Номер UNKNOWN с учётом records
<!-- id: SCN-KRN-144 -->
- **WHEN** в `openspec/**` максимум `UNK-SRC-002`, а `unknowns[]` record `.warrant/changes/add-search.json` содержит `UNK-SRC-004`
- **THEN** `warrant id UNK SRC` возвращает `UNK-SRC-005`

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
сообщать расхождения: `GENERATED_DRIFT` или `LOCK_MISMATCH` с путём файла, код 3 ([REQ-KRN-003](#requirement-коды-выхода)).

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
или `--paths <file>` (по строке на путь; без git); если у ветки базы есть upstream (`<base>@{upstream}`) и в нём есть коммиты,
которых нет в базе, — `BASE_BEHIND_UPSTREAM`, код 3, record не изменён, `hint` называет `--base <upstream>` (diff устаревшей базы
захватил бы чужие коммиты, а повторный `classify` запись не ослабит); upstream не задан, не разрешается (его ветки нет) или git
не сравнил базу с ним — проверка пропускается без отказа; (2) floor rules (`warrant://risk-floor/1`) всех подключённых packs — минимальное
значение измерения по совпавшим путям; (3) `match.paths` profiles — предлагаемые profiles; собственное состояние Change (record, каталог evidence, файлы Run этого Change и их
`.result.json` — [REQ-VER-004](../verification/spec.md)) SHALL NOT участвовать в сверке с `match.paths` и floor rules; (4) `--propose <json>` — profiles и значения
измерений от proposer'а; значение вне порядка измерения [05 §4](../../../../docs/05-policy.md) или profile, не объявленный
подключёнными packs, SHALL давать `USAGE`, код 3, record не изменён, `hint` перечисляет допустимые значения; (5) `--set <dim>=<value>` и `--set profile=<id>` (повторяемые) — значения человека, требуют `--by <login>`,
где `login` входит хотя бы в одну роль `roles` `warrant.json` (иначе `ROLE_REQUIRED`, код 3), и записываются с `from: human:<login>`.
Итог измерения = максимум по порядку значений [05 §4](../../../../docs/05-policy.md) из floor, proposer и human; каждое значение
SHALL нести `from` (`floor:<pack>:<rule-index>`, `proposer`, `human:<login>`, ранее записанное — `record`). `--set` ниже floor без
`--ref` SHALL отказывать с `BELOW_FLOOR`, код 3, record не изменён. Понижение ниже floor ([04 §8](../../../../docs/04-lifecycle.md)) SHALL
выполняться только как `--set <dim>=<value> --by <login> --ref <url>` (http(s) URL approval), где `login` входит в роль из `approvals[]`
перехода `SPECIFIED->APPROVED` effective policy (без `approvals[]` — `maintainer`; иначе `ROLE_REQUIRED`), и только при `change_state`
`PROPOSED` или `SPECIFIED` (иначе `STATE_INVALID`, код 3); значение записывается как `{ value, from: "human:<login>", ref }`, и
последующие `classify` SHALL сохранять его, пока нет нового `--set` этого измерения: floor по этому измерению попадает в `data.ignored[]`
с причиной `approved-below-floor`. `ref` не верифицируется до `warrant ci` (фаза 4). Повторный `classify` SHALL NOT понижать ранее
записанное значение измерения и SHALL NOT удалять ранее записанный profile. `risk_level` SHALL NOT записываться: его вычисляет resolver. Record SHALL записываться только документом, который проходит
`warrant://change-record/1`.
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

#### Scenario: Proposer вне перечисления
<!-- id: SCN-KRN-145 -->
- **WHEN** `warrant classify add-search --propose '{"risk":{"compatibility":"NONE"}}'`, а порядок `compatibility` не содержит `NONE`
- **THEN** `errors[0].code` равен `USAGE`, `hint` перечисляет допустимые значения `compatibility`, record не изменён, код 3

#### Scenario: База позади upstream
<!-- id: SCN-KRN-146 -->
- **WHEN** `warrant classify add-search` без `--base`, а `origin/main` — upstream `main` — содержит коммит, которого нет в `main`
- **THEN** `errors[0].code` равен `BASE_BEHIND_UPSTREAM`, `hint` содержит `--base origin/main`, record не изменён, код 3; с `--base origin/main` — classification записана, код 0; upstream `main` задан, но ветки `origin/main` нет — classification записана, код 0

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
проверки, отсутствующий файл и путь вне проекта — в `skipped[]` с `reason` (`no-check`, `missing`, `outside`). Код выхода — как у
полного `validate`: любая находка — 3 ([REQ-KRN-003](#requirement-коды-выхода)).

#### Scenario: Неканонический JSON
<!-- id: SCN-KRN-127 -->
- **WHEN** `warrant validate --files .warrant/local/areas.json` для файла с ключами не по порядку
- **THEN** `errors[]` содержит `NOT_CANONICAL` с `path` файла и `hint`, содержащим `warrant fmt`, код 3

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
([ADR-0014](../../../../docs/adr/WARRANT-ADR-0014-claude-code-enforcement.md) п. 1), и хуки с командой guard —
`PreToolUse` с matcher `Edit|Write|NotebookEdit|Bash` и `PostToolUse` с matcher `Edit|Write|NotebookEdit`. Команда guard — ровно
`warrant guard --frontend claude`, а при `cli` в `warrant.json` ([REQ-KRN-004](#requirement-схема-config)) — ровно
`node "${CLAUDE_PROJECT_DIR:-.}/<cli>" guard --frontend claude`: хук исполняет CLI, который закрепил проект, а не первый `warrant` в
PATH ([ADR-0053](../../../../docs/adr/WARRANT-ADR-0053-guard-recovery.md) п. 3); путь берётся от переменной Claude Code
`CLAUDE_PROJECT_DIR`, а без неё — от каталога, где исполняется хук. Своим `sync` SHALL считать хук с командой любой из двух форм
(при любом `cli`) и заменять его текущей формой. Если при `frontends ∋ "claude"` и `cli` по пути `cli` нет обычного
файла (нет пути, каталог, битая ссылка), `sync` и `sync --check` SHALL давать в `data.findings[]` находку
`{ code: "CLI_NOT_FOUND", path, hint }` с путём `cli` и `hint` собрать или установить закреплённый CLI; код выхода находка не
меняет (у `--check` его определяет только расхождение файлов): хук без файла guard не исполняет (Claude Code не блокирует
действие при таком сбое хука), но CI, где зависимости проекта не установлены, этим не краснеет; без `frontends ∋ "claude"`
находки нет; файл субагента
`.claude/agents/warrant-reviewer.md` целиком ([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md), ADR-0014 п. 3): frontmatter с `name: warrant-reviewer`,
`description`, `tools` с `Write` и без `Edit` и `NotebookEdit` и хуком `PreToolUse` с matcher `Bash|Write` и командой guard,
затем строка-маркер `<!-- generated by warrant — do not edit -->`, текст skill review pack'а
(skill `specification/adversarial-review` из lock) и порядок сдачи результата: envelope `warrant://skill-result/1` — файлом
`<RUN-id>.envelope.json` в scratchpad-каталоге сессии Claude Code (он лежит во временном каталоге ОС; нет scratchpad — прямо во
временном каталоге ОС; правку проекта guard под Run `review` отклоняет), `warrant run submit --file <путь> --dry-run`, затем та же
команда без `--dry-run` — из корня проекта с активным Run, без `cd` (design I-197, I-198); при `cli` в командах, которые исполняет
субагент, — `warrant run submit` раздела сдачи — вместо `warrant` SHALL стоять `node <cli>`, форма, которую guard читает как
`warrant` ([REQ-ENF-004](../enforcement/spec.md)), а раздел SHALL называть команду своего хука и говорить, что команды `warrant`
в тексте skill выше субагент исполняет в той же форме `node <cli>`; текст skill из lock, `description`, имя схемы
`warrant://skill-result/1` и команда вызывающего `warrant run start` в шаге Context Pack не меняются; раздел сдачи SHALL прямо говорить, что запись одного файла envelope во
временный каталог — часть сдачи, а не правка, которую запрещает текст skill (запрет skill касается файлов проекта); каждый пример
envelope в тексте SHALL проходить схему `skill-result/1` ([ADR-0042](../../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) п. 4). Если ни один подключённый pack не даёт skill `specification/adversarial-review`, файл субагента SHALL NOT
генерироваться, а вывод `sync` SHALL содержать в `data.findings[]` находку `{ code: "REVIEWER_SKILL_MISSING", path, hint }` с путём файла
субагента и `hint` подключить pack с этим skill; код выхода — 0: проект без review-skill законен, gate `adversarial-review` у него
закрывается waiver'ом (BL-40). Прежний файл субагента со строкой-маркером `sync` при этом SHALL удалить, файл без маркера SHALL NOT
трогать; `validate` без review-skill файл субагента SHALL NOT сверять, а `sync --check` сообщает находку, но код выхода определяет
только расхождение файлов. `sync` и `init --frontend claude`, которые создали, изменили или удалили `.claude/agents/**`,
`.claude/settings.json` или `AGENTS.md` (design I-200), SHALL давать в `data.findings[]` находку `{ code: "FRONTEND_RESTART_REQUIRED", path, hint }` на каждый
такой файл с `hint` перезапустить сессию Claude Code (агенты и hooks читаются при её старте); код выхода — 0, без изменений файлов
находки нет ([ADR-0042](../../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) п. 5). Во всех
случаях `sync` SHALL держать строку `.warrant/runs/current` в `.gitignore`. Чужие ключи, записи и строки этих файлов SHALL
сохраняться; `.claude/settings.json` пишется в каноническом JSON. `sync` и `init` SHALL NOT создавать, менять и удалять `CLAUDE.md`, в том числе строку `@AGENTS.md`, записанную прежними версиями; `warrant validate` и `sync --check` SHALL NOT сверять `CLAUDE.md` (design `no-claude-md` D1). `warrant init --frontend claude` SHALL записать
`frontends: ["claude"]` в новый `warrant.json`. `warrant validate` SHALL сверять `AGENTS.md` и `.claude/agents/warrant-reviewer.md` побайтно, а в `.claude/settings.json`
и `.gitignore` — наличие своих записей в точном виде; расхождение — `GENERATED_DRIFT` с `path` (JSON Pointer для
`settings.json`) и `hint` `` run `warrant sync` ``.

#### Scenario: Управляемое подмножество settings.json
<!-- id: SCN-KRN-130 -->
- **WHEN** `warrant sync` при `frontends: ["claude"]` без `cli` и `.claude/settings.json` с чужим хуком `PreToolUse` и ключом `env`
- **THEN** файл содержит свои записи deny и хуки `warrant guard --frontend claude`, чужой хук и `env` сохранены; повторный `sync` не меняет ни одного байта

#### Scenario: Снятый deny
<!-- id: SCN-KRN-131 -->
- **WHEN** из `.claude/settings.json` удалена запись deny на `.warrant/runs/**`, а чужие ключи изменены
- **THEN** `warrant validate` даёт одну ошибку `GENERATED_DRIFT` с путём `.claude/settings.json` и `hint` `` run `warrant sync` ``; правка чужих ключей ошибок не даёт

#### Scenario: AGENTS.md из общих правил
<!-- id: SCN-KRN-132 -->
- **WHEN** `.warrant/local/rules/` содержит правило с `paths: ["**"]` и правило с `paths: ["src/**"]`, `frontends: ["claude"]`, `CLAUDE.md` нет
- **THEN** `AGENTS.md` начинается строкой-маркером и содержит текст только первого правила, `CLAUDE.md` не создан; без правил с `paths: ["**"]` `AGENTS.md` не создаётся

#### Scenario: CLAUDE.md вне сверки
<!-- id: SCN-KRN-155 -->
- **WHEN** `warrant sync` при `frontends: ["claude"]` и правиле с `paths: ["**"]` в `.warrant/local/rules/`, затем `CLAUDE.md` удалён — и отдельно: `CLAUDE.md` с текстом без строки `@AGENTS.md` до `sync`
- **THEN** `warrant validate` не даёт `GENERATED_DRIFT` по `CLAUDE.md`, `warrant sync --check` — код 0; удалённый `CLAUDE.md` не создан, существующий `CLAUDE.md` после `sync` совпадает с прежним байт в байт

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
- **WHEN** `warrant sync` при `frontends: ["claude"]` без `cli`
- **THEN** `.claude/agents/warrant-reviewer.md` начинается frontmatter с `name: warrant-reviewer`, `tools` содержит `Write` и не содержит `Edit`, `NotebookEdit`, хук `PreToolUse` `Bash|Write` вызывает `warrant guard --frontend claude`; тело содержит строку-маркер, текст skill `specification/adversarial-review`, `warrant run submit --file` и `--dry-run` и оговорку, что файл envelope во временном каталоге — часть сдачи, а каждый пример envelope из тела проходит схему `warrant://skill-result/1`; повторный `sync` не меняет ни одного байта

#### Scenario: Правленый файл субагента
<!-- id: SCN-KRN-140 -->
- **WHEN** в `.claude/agents/warrant-reviewer.md` изменена одна строка
- **THEN** `warrant validate` даёт `GENERATED_DRIFT` с путём файла и `hint` `` run `warrant sync` ``, код 3

#### Scenario: Нет skill review
<!-- id: SCN-KRN-142 -->
- **WHEN** `warrant sync` при `frontends: ["claude"]` в проекте, чьи packs не дают skill `specification/adversarial-review`
- **THEN** `.claude/agents/warrant-reviewer.md` не создан, `data.findings[]` содержит `REVIEWER_SKILL_MISSING` с `path` `.claude/agents/warrant-reviewer.md` и `hint`, `.claude/settings.json` сгенерирован, код 0; `warrant validate` не даёт `GENERATED_DRIFT` по файлу субагента; прежний сгенерированный файл субагента удалён

#### Scenario: Перезапуск сессии
<!-- id: SCN-KRN-154 -->
- **WHEN** `warrant init --frontend claude` в новом проекте, где `.warrant/local/rules/` содержит правило с `paths: ["**"]`, затем повторный `warrant sync` без изменений, затем `sync` после удаления строки из `.claude/agents/warrant-reviewer.md`
- **THEN** вывод `init` содержит `FRONTEND_RESTART_REQUIRED` для `.claude/settings.json`, `.claude/agents/warrant-reviewer.md` и `AGENTS.md` с `hint` о перезапуске сессии Claude Code и ни одной находки с путём `CLAUDE.md`, код 0; повторный `sync` находки не даёт; последний `sync` даёт её только для файла субагента

#### Scenario: Хук закреплённого CLI
<!-- id: SCN-KRN-166 -->
- **WHEN** `warrant sync` при `frontends: ["claude"]` и `cli: "tools/warrant.js"`, а `.claude/settings.json` несёт прежние группы хуков `warrant guard --frontend claude`; затем `cli` удалён и `sync` повторён
- **THEN** после первого `sync` хуки `PreToolUse` и `PostToolUse` в `settings.json` и хук субагента — ровно `node "${CLAUDE_PROJECT_DIR:-.}/tools/warrant.js" guard --frontend claude`, групп с `warrant guard --frontend claude` нет; раздел «Сдача результата» субагента содержит `node tools/warrant.js run submit --file`, не содержит `warrant run submit` и говорит, что команды `warrant` в тексте skill исполняются как `node tools/warrant.js`; `data.findings[]` содержит `FRONTEND_RESTART_REQUIRED` для обоих файлов и `CLI_NOT_FOUND` с `path` `tools/warrant.js` (файла нет), код 0; после второго — снова `warrant guard --frontend claude` и `warrant run submit` в разделе сдачи, `CLI_NOT_FOUND` нет

### Requirement: Режим --dry-run меняющих команд
<!-- id: REQ-KRN-034 -->

`warrant transition`, `warrant archive`, `warrant waive`, `warrant run start`, `warrant run finish`, `warrant unknown add` и
`warrant unknown resolve` с `--dry-run` SHALL
выполнить те же проверки и напечатать тот же JSON, что настоящий запуск, с `data.dry_run: true` и `data.would_write[]` (пути
файлов, которые были бы созданы или изменены), завершиться тем же кодом и SHALL NOT менять ни одного файла.
`archive --dry-run` SHALL выполнить `openspec validate --strict` и gates `MERGED->ARCHIVED`, но не `openspec archive`; каталог
архива в `would_write[]` SHALL называться по тому же правилу, что его создаёт `openspec archive`: локальная дата процесса
`YYYY-MM-DD` и имя Change.

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
- **THEN** `openspec archive` не вызван, каталог Change на месте, `data.would_write[]` содержит record и каталог `openspec/changes/archive/<дата>-add-search/`, где `<дата>` — локальная дата процесса

#### Scenario: Пробный archive на границе суток
<!-- id: SCN-KRN-147 -->
- **WHEN** `warrant archive add-search --dry-run` в процессе с часовым поясом UTC+3 в момент `2026-09-26T22:54:00Z`
- **THEN** `data.would_write[]` содержит `openspec/changes/archive/2026-09-27-add-search/` — тот же каталог, что создаёт настоящий прогон в этот момент

### Requirement: Команда unknown
<!-- id: REQ-KRN-035 -->

`warrant unknown add <change> --area <AREA> --text <вопрос> [--blocking] [--dry-run]` SHALL добавить в `unknowns[]` record
`{ id, text, blocking }`: `id` — `UNK-<AREA>-NNN` по правилу [REQ-KRN-024](#requirement-команда-id) (`AREA_UNKNOWN` с `hint`),
`blocking` — `true` только с `--blocking` ([02 §1](../../../../docs/02-vocabulary.md)).
`warrant unknown resolve <change> <UNK> --as decision|fact|assumption --text <ответ> [--ref <url>] [--replace] [--dry-run]` SHALL записать
в элемент `resolution` (текст ответа), `resolved_as` и `ref`. Элемент закрыт, если его `resolution` непуст. Blocking UNKNOWN
закрывается только решением maintainer'а — `--as decision` с `--ref` на комментарий, текст которого содержит id UNKNOWN
([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 2, 3); `fact` и `assumption` закрывают только не-blocking UNKNOWN, `--as assumption` элемент `assumptions[]`
не добавляет. У `--ref` команда проверяет только форму (http(s) URL); автора, текст и PR комментария проверяет `warrant ci`
([REQ-VER-013](../verification/spec.md)). Обе команды допустимы только при `change_state` `PROPOSED` или `SPECIFIED`: вопрос, возникший в реализации, —
строка `I-N` в `design.md` с решением maintainer'а. Ошибки — код 3, record не изменён, каждая с `hint`:
- `--as decision` без `--ref`, `--as fact` или `assumption` у blocking UNKNOWN — `USAGE`; `hint` называет ref — URL
  комментария maintainer'а в PR (`…/pull/<N>#issuecomment-<id>` или `…/pull/<N>#pullrequestreview-<id>`), в тексте которого
  стоит id UNKNOWN; `--ref` не http(s) URL, `--as` вне трёх значений, пустой или пробельный `--text` — `USAGE`;
- record Change нет — `CHANGE_NOT_FOUND`;
- `<UNK>` нет в record — `UNKNOWN_NOT_FOUND`, `hint` перечисляет открытые UNKNOWN Change;
- элемент уже закрыт, а `--replace` не задан — `UNKNOWN_RESOLVED`, `hint` называет `--replace`: он переписывает ответ,
  `resolved_as` и `ref` закрытого элемента (например, ref на новый комментарий maintainer'а);
- `change_state` не `PROPOSED` и не `SPECIFIED` — `STATE_INVALID`, `hint` называет строку `I-N` в `design.md`
  (`RECORD_FROZEN` для `ARCHIVED` и `ABANDONED`).
Обе команды SHALL NOT писать переход и SHALL записывать record только документом, который проходит `warrant://change-record/1`.
Вывод — `data{ change, unknown, open_blocking[] }`: записанный элемент и id открытых blocking UNKNOWN Change после записи;
`--dry-run` — по [REQ-KRN-034](#requirement-режим---dry-run-меняющих-команд).

#### Scenario: Blocking UNKNOWN
<!-- id: SCN-KRN-148 -->
- **WHEN** `warrant unknown add add-search --area SRC --text "Что делать при часах, идущих назад?" --blocking` при `change_state: PROPOSED` и максимуме `UNK-SRC-003`
- **THEN** record содержит `{ "id": "UNK-SRC-004", "text": "Что делать при часах, идущих назад?", "blocking": true }`, `data.open_blocking` равен `["UNK-SRC-004"]`, переходов не добавлено, код 0; `warrant status add-search` при gates перехода без `FAIL` даёт `controller_action: WAIT`, `next: clarify`

#### Scenario: Решение maintainer'а
<!-- id: SCN-KRN-149 -->
- **WHEN** `warrant unknown resolve add-search UNK-SRC-004 --as decision --text "Часы назад — метка сдвигается" --ref https://github.com/o/r/pull/7#issuecomment-11`
- **THEN** элемент содержит `resolution`, `resolved_as: "decision"` и `ref`, `data.open_blocking` пуст, код 0

#### Scenario: Blocking без решения
<!-- id: SCN-KRN-150 -->
- **WHEN** `warrant unknown resolve add-search UNK-SRC-004 --as decision --text "…"` без `--ref`; затем `--as fact --text "…"` для того же blocking `UNK-SRC-004`
- **THEN** оба — `errors[0].code` равен `USAGE`, `hint` содержит `#issuecomment-` и `UNK-SRC-004`, record не изменён, код 3; `--as fact` без `--ref` для не-blocking `UNK-SRC-005` — элемент закрыт, `assumptions[]` не изменён, код 0

#### Scenario: Нет такого UNKNOWN, он закрыт или ответ пуст
<!-- id: SCN-KRN-151 -->
- **WHEN** `warrant unknown resolve add-search UNK-SRC-009 --as fact --text "…"`, а в record есть только не-blocking `UNK-SRC-005`; тот же вызов для уже закрытого `UNK-SRC-005`; вызов с `--text "  "`; вызов для Change без record
- **THEN** `UNKNOWN_NOT_FOUND` с `hint`, содержащим `UNK-SRC-005`; `UNKNOWN_RESOLVED` с `hint`, содержащим `--replace`; `USAGE`; `CHANGE_NOT_FOUND`; record не изменён, код 3; с `--replace` закрытый `UNK-SRC-005` получает новый `resolution`, код 0

#### Scenario: UNKNOWN после approval
<!-- id: SCN-KRN-152 -->
- **WHEN** `warrant unknown add add-search --area SRC --text "…"` при `change_state: APPROVED`
- **THEN** `errors[0].code` равен `STATE_INVALID`, `hint` называет строку `I-N` в `design.md`, record не изменён, код 3

#### Scenario: Пробная запись UNKNOWN
<!-- id: SCN-KRN-153 -->
- **WHEN** `warrant unknown add add-search --area SRC --text "…" --dry-run`
- **THEN** `data.dry_run: true`, `data.unknown.id` — id, который выдал бы настоящий запуск, `data.would_write[]` содержит `.warrant/changes/add-search.json`, record не изменён, код 0

### Requirement: Атомарная запись состояния
<!-- id: REQ-KRN-036 -->

CLI SHALL записывать каждый файл своего состояния — record `.warrant/changes/*.json`, записи evidence и `manifest.json`
(в том числе импорт `warrant ci fetch`), файлы Run и указатель `current`, результат review, waivers — атомарно: во временный файл
того же каталога (имя начинается с `.` и оканчивается `.tmp`), затем переименованием на место
([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 4). Запись, прерванная завершением процесса (исключение,
сигнал, `kill`), SHALL оставлять прежнее содержимое файла (или его отсутствие) целым; сбой ОС или питания без `fsync` этим
требованием не покрывается. Временный файл при ошибке записи или переименования SHALL удаляться. На Windows переименование,
отклонённое `EPERM`, `EBUSY` или `EACCES`, SHALL выполняться не больше 5 раз всего с паузой 20 мс, затем — `BUSY`, код 4, `retryable: true`, с `hint`
«файл держит другой процесс: повторите», без частичного файла (design I-206). Запись из нескольких файлов SHALL идти в порядке
«записи evidence → `manifest.json` → record или Run»; `manifest.json` пересобирается из каталога при каждой записи evidence, поэтому
запись вне `manifest.evidence[]` после обрыва восстанавливает следующая запись evidence Change (например, `warrant verify`), и
находка `warrant validate` об этом ([REQ-KRN-021](#requirement-команда-validate) п. 12) SHALL называть это в `hint` (design I-203).
`warrant validate` SHALL NOT читать временные файлы как часть состояния.

#### Scenario: Сбой переименования
<!-- id: SCN-KRN-158 -->
- **WHEN** record `.warrant/changes/add-search.json` существует, и запись нового содержимого завершается сбоем переименования
- **THEN** файл record — прежнее содержимое байт в байт, временного файла в каталоге нет; сбой `EBUSY` на всех 5 попытках — `BUSY`, код 4, `retryable: true`, иной сбой — ошибка записи; без сбоя — файл — новое содержимое, временного файла нет
