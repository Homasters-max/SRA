## ADDED Requirements

### Requirement: Пути данных проекта
<!-- id: REQ-KRN-037 -->

Схема `warrant://config/1` SHALL принимать необязательный ключ `paths.data` — непустой список каталогов проекта без повторов,
каждый — `relative_path` (дополнение к ключам `paths` [REQ-KRN-004](#requirement-схема-config): `adr`, `glossary`, `tests`, `src`).
Элемент, который после снятия ведущих `./` и конечных `/` равен `.`, `.warrant` или `openspec` или лежит под ними, SHALL делать файл
невалидным с указанием `/paths/data/<i>`: корень проекта, состояние WARRANT и spec не данные проекта.

Каждый каталог `paths.data` SHALL быть корнем кода наравне с `paths.src` и `paths.tests` везде, где спецификация называет код
проекта путями `paths.src` и `paths.tests`:

- `write_scope` Run `implement` ([REQ-ENF-002](../enforcement/spec.md)) содержит `<каталог>/**` каждого каталога `paths.data`;
  `implement` без `paths.src`, `paths.tests` и `paths.data` — `CONFIG_INVALID`;
- классы путей guard ([REQ-ENF-004](../enforcement/spec.md)): путь под каталогом `paths.data` без активного Run — `deny` с hint
  `warrant run start <change> --operation …`, при активном Run — как путь под `paths.src`;
- finding `FRONTEND_HOOKS_INACTIVE` ([REQ-VER-009](../verification/spec.md)) считает и пути diff под каталогами `paths.data`;
- правило путей `warrant ci` ([REQ-VER-011](../verification/spec.md)): путь под каталогом `paths.data` меняется только в impl-PR
  Change, как код; без `paths.src`, `paths.tests` и `paths.data` проверка кода пропускается с причиной в `data.skipped[]`.

Требования, где `paths.tests` значит именно тесты — ссылки на ID в файлах тестов ([REQ-KRN-021](#requirement-команда-validate),
[REQ-KRN-024](#requirement-команда-id)), покрытие SCN тестами ([REQ-VER-004](../verification/spec.md),
[REQ-VER-010](../verification/spec.md)), — каталогов `paths.data` SHALL NOT касаться. Без `paths.data` поведение CLI SHALL
оставаться прежним.

#### Scenario: Данные в Run implement и в guard
<!-- id: SCN-KRN-172 -->
- **WHEN** `warrant.json` задаёт `paths.src: "src"` и `paths.data: ["std"]`; без активного Run guard получает `pre` `edit` пути
  `std/std.json`; затем `warrant run start add-search --operation implement` при `change_state: IMPLEMENTING`, и guard получает
  `pre` `edit` путей `std/std.json` и `docs/notes.md`
- **THEN** первое событие — `deny` с hint `warrant run start <change> --operation …`; `write_scope` Run — `src/**`, `std/**`,
  `openspec/changes/add-search/tasks.md`, `design.md`, `specs/**`; после старта `std/std.json` — `allow`, `docs/notes.md` — `deny`

#### Scenario: Только данные и правило путей ci
<!-- id: SCN-KRN-173 -->
- **WHEN** `warrant.json` задаёт только `paths.data: ["std"]`; `warrant run start add-search --operation implement` при
  `change_state: IMPLEMENTING`; затем `warrant ci` на PR без Change (вид none), который правит `std/std.json`
- **THEN** `write_scope` Run — `std/**` и файлы Change, без `CONFIG_INVALID`; `warrant ci` — `SCOPE_VIOLATION` с путём
  `std/std.json`, код 1

#### Scenario: Недопустимые каталоги данных
<!-- id: SCN-KRN-174 -->
- **WHEN** `paths.data` равен `["std"]`, `[]`, `["std", "std"]`, `["."]`, `["./.warrant/data"]`, `["openspec"]` или `["../std"]`
- **THEN** первый файл валиден; второй и третий невалидны с указанием `/paths/data`, остальные — с указанием `/paths/data/0`
