## MODIFIED Requirements

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

### Requirement: Команда validate
<!-- id: REQ-KRN-021 -->

`warrant validate` SHALL проверять и сообщать все находки за один вызов: (1) каждый `*.json` под `.warrant/**`
(кроме сырого вывода checks `.warrant/evidence/**/raw/**` — он не часть записи, [REQ-VER-001](../verification/spec.md), I-76)
и в подключённых packs имеет `$schema` и валиден; (2) `warrant.json` и lock согласованы — версии packs в диапазонах,
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

#### Scenario: check gate без такого check
<!-- id: SCN-KRN-156 -->
- **WHEN** `.warrant/local/gates/dev-passed.json` требует `{ "kind": "test-report", "status": "PROVEN", "check": "dev-check" }`, а check `dev-check` не загружен или его `produces` не содержит `test-report`
- **THEN** `errors[]` содержит `CONFIG_INVALID` с `path`, оканчивающимся на `#/requires_evidence/0/check`, код 3; с check `dev-check`, производящим `test-report`, — ошибки нет

#### Scenario: Агент в ролях
<!-- id: SCN-KRN-157 -->
- **WHEN** `warrant.json` содержит `roles.maintainer: ["kat", "warrant-agent[bot]"]` и `identities.agents: [{ "login": "warrant-agent[bot]", "kind": "bot" }]`
- **THEN** `errors[]` содержит `CONFIG_INVALID` с `path` `.warrant/warrant.json#/identities/agents/0/login`, код 3; без агента в `roles` — ошибки нет

## ADDED Requirements

### Requirement: Атомарная запись состояния
<!-- id: REQ-KRN-036 -->

CLI SHALL записывать каждый файл своего состояния — record `.warrant/changes/*.json`, записи evidence и `manifest.json`
(в том числе импорт `warrant ci fetch`), файлы Run и указатель `current`, результат review, waivers — атомарно: во временный файл
того же каталога (имя начинается с `.` и оканчивается `.tmp`), затем переименованием на место
([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 4). Запись, прерванная завершением процесса (исключение,
сигнал, `kill`), SHALL оставлять прежнее содержимое файла (или его отсутствие) целым; сбой ОС или питания без `fsync` этим
требованием не покрывается. Временный файл при ошибке записи или переименования SHALL удаляться. На Windows переименование,
отклонённое `EPERM`, `EBUSY` или `EACCES`, SHALL повторяться до 5 попыток с паузой 20 мс, затем — ошибка без частичного файла.
`warrant validate` SHALL NOT читать временные файлы как часть состояния.

#### Scenario: Сбой переименования
<!-- id: SCN-KRN-158 -->
- **WHEN** record `.warrant/changes/add-search.json` существует, и запись нового содержимого завершается сбоем переименования
- **THEN** файл record — прежнее содержимое байт в байт, временного файла в каталоге нет, команда завершается ошибкой; без сбоя — файл — новое содержимое, временного файла нет
