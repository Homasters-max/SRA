## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Команда classify
<!-- id: REQ-KRN-028 -->

`warrant classify <change>` SHALL вычислить `classification` Change из детерминированных источников и записать её в
`.warrant/changes/<change>.json`: (1) список изменённых путей — `git diff --name-only <base>...HEAD` с `--base` (по умолчанию `main`)
или `--paths <file>` (по строке на путь; без git); (2) floor rules (`warrant://risk-floor/1`) всех подключённых packs — минимальное
значение измерения по совпавшим путям; (3) `match.paths` profiles — предлагаемые profiles; (4) `--propose <json>` — profiles и значения
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
