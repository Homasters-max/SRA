## MODIFIED Requirements

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
Действие controller и вердикт команды дают: `CONTINUE` — `0`, `STOP` и находки `analyze` — `1`, `WAIT` и `ESCALATE` — `2`.
Код выхода SHALL быть старшим из кодов элементов `errors[]` и кода действия по приоритету `3` > `1` > `4` > `2` > `0`: ошибка,
которую повтор не исправит, старше повторяемой, а повторяемая — старше ожидания, вычисленного на неполных из-за сбоя данных;
`ok: true` — код `0`. Код `4` и `retryable: true` SHALL NOT появляться у ошибок классов кодов 1, 2 и 3.
Исключение, не перехваченное командой, SHALL давать JSON-объект с `errors[0].code` `INTERNAL` и код `3` (стек — в stderr), а не
аварийный выход среды исполнения; `command` объекта — имя вызванной команды, без него — `warrant`. Если JSON-объект команды уже
выведен, второй SHALL NOT печататься: стек — в stderr, код `3`. Ошибка загрузки модулей CLI до начала работы его входной точки
(повреждённая установка) этим требованием не покрывается. Коды `warrant guard --frontend` — ответ протоколу frontend
([REQ-ENF-005](../enforcement/spec.md)), а не коды этой таблицы; его исключение — код `2` по REQ-ENF-005.
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
- **THEN** в обоих случаях код выхода 4, `errors[0]` — `{ "code": "BUSY", "message", "hint", "retryable": true }`; у `CONFIG_MISSING` из SCN-KRN-007 ключа `retryable` нет

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

### Requirement: Команда validate
<!-- id: REQ-KRN-021 -->

`warrant validate` SHALL проверять и сообщать все находки за один вызов: (1) каждый `*.json` под `.warrant/**`
(кроме сырого вывода checks `.warrant/evidence/**/raw/**` — он не часть записи, [REQ-VER-001](../verification/spec.md), I-76)
и в подключённых packs имеет `$schema` и валиден; (2) `warrant.json` и lock согласованы — версии packs в диапазонах (версия подключённого pack вне диапазона `warrant.json` —
`PACK_VERSION_RANGE` с путём его `pack.json`; свой код, а не `CONFIG_INVALID`, отличает эту ошибку от прочих ошибок загрузки, и
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
