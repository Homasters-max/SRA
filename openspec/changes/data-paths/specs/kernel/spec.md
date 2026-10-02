## ADDED Requirements

### Requirement: Пути данных проекта
<!-- id: REQ-KRN-037 -->

Схема `warrant://config/1` SHALL принимать необязательный ключ `paths.data` ([REQ-KRN-004](#requirement-схема-config)) — непустой
список каталогов проекта, элементы которого различны как строки, каждый — `relative_path`. Нормализация элемента — снимать ведущие
`./` и конечные `/`, пока они есть. Элемент, нормализация которого даёт пустую строку, `.`, `.warrant` или `openspec` или путь под
`.warrant/` или `openspec/` (регистр букв не различается), SHALL делать файл невалидным с указанием `/paths/data/<i>`: корень проекта,
состояние WARRANT и spec не данные проекта. Наличие и вид пути схема не проверяет; элемент, который называет файл, не делает кодом
ни одного пути. Каталоги `paths.data`, которые совпадают после нормализации друг с другом или с `paths.src` / `paths.tests`, дают
один корень.

Каждый каталог `paths.data` SHALL быть корнем кода наравне с `paths.src` и `paths.tests`: `write_scope` Run `implement`
([REQ-ENF-002](../enforcement/spec.md)), finding `FRONTEND_HOOKS_INACTIVE` ([REQ-VER-009](../verification/spec.md)). Это
исключение из текста [REQ-ENF-004](../enforcement/spec.md) и [REQ-VER-011](../verification/spec.md): каждое их упоминание
`paths.src` и `paths.tests` как кода проекта — классы путей guard и hint `deny` без активного Run, policy-путь вне кода,
правила путей видов `none`, `spec`, `archive` и impl-PR, условие пропуска проверки кода с записью в `data.skipped[]` — SHALL
читаться как `paths.src`, `paths.tests` и каталоги `paths.data`; проверка кода пропускается, только когда не задан ни один из
трёх ключей. `warrant ci` SHALL брать `paths.data`, как `paths.src` и `paths.tests`, из `warrant.json` базы требований
(`HEAD^1`, [ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md)).

Требования, где `paths.tests` значит именно тесты — ссылки на ID в файлах тестов ([REQ-KRN-021](#requirement-команда-validate),
[REQ-KRN-024](#requirement-команда-id)), покрытие SCN тестами ([REQ-VER-004](../verification/spec.md),
[REQ-VER-010](../verification/spec.md)), — каталогов `paths.data` SHALL NOT касаться. Без `paths.data` поведение CLI SHALL
оставаться прежним.

#### Scenario: Данные в Run implement и в guard
<!-- id: SCN-KRN-172 -->
- **WHEN** `warrant.json` задаёт `paths.src: "src"`, `paths.tests: "tests"` и `paths.data: ["std", "data/ref/"]`; без активного
  Run guard получает `pre` `edit` пути `std/std.json`; затем `warrant run start add-search --operation implement` при
  `change_state: IMPLEMENTING`; затем guard получает событие `pre` `edit` пути `std/std.json` и отдельное событие `pre` `edit`
  пути `docs/notes.md`
- **THEN** первое событие — `deny` с hint `warrant run start <change> --operation …`; `write_scope` Run равен `["src/**",
  "tests/**", "std/**", "data/ref/**", "openspec/changes/add-search/tasks.md", "openspec/changes/add-search/design.md",
  "openspec/changes/add-search/specs/**"]`; событие с `std/std.json` при Run — `allow`, с `docs/notes.md` — `deny`

#### Scenario: Только данные и правило путей ci
<!-- id: SCN-KRN-173 -->
- **WHEN** `warrant.json` базы задаёт только `paths.data: ["std"]`; `warrant run start add-search --operation implement` при
  `change_state: IMPLEMENTING`; затем `warrant ci` на PR без Change (вид `none`), который правит `std/std.json`; на spec-PR
  Change `add-search`, который правит `std/std.json`; на PR без Change, который убирает `paths.data` из `warrant.json` и правит
  `std/std.json`
- **THEN** `write_scope` Run равен `["std/**", "openspec/changes/add-search/tasks.md", "openspec/changes/add-search/design.md",
  "openspec/changes/add-search/specs/**"]`, без `CONFIG_INVALID`; у каждого из трёх `warrant ci` `errors[]` содержит
  `SCOPE_VIOLATION` с путём `std/std.json`, проверка кода не в `data.skipped[]`, код 1

#### Scenario: Недопустимые каталоги данных
<!-- id: SCN-KRN-174 -->
- **WHEN** `paths.data` равен `["std"]`, `[".warrant-data"]`, `["std/std.json"]`; `[]`, `["std", "std"]`; `["."]`, `["./"]`,
  `[".//"]`, `["./.warrant/data"]`, `[".warrant/"]`, `[".Warrant"]`, `["openspec"]`, `["OpenSpec/x"]` или `["../std"]`
- **THEN** первые три файла валидны; четвёртый и пятый невалидны с указанием `/paths/data`; остальные — с указанием `/paths/data/0`

## MODIFIED Requirements

### Requirement: Схема config
<!-- id: REQ-KRN-004 -->

Схема `warrant://config/1` SHALL описывать `.warrant/warrant.json` ([08 §3](../../../../docs/08-packs.md)):
обязательные `kernel` (major.minor), `openspec` (диапазон `1.13.x`), `packs` (id kebab-case → `{ "version": semver-range, "params"? }`);
необязательные `defaults` (`check_timeout_s` — положительное целое, [ADR-0017](../../../../docs/adr/WARRANT-ADR-0017-check-execution.md)),
`paths` (`adr`, `glossary`, `tests`, `src`, `data` — [REQ-KRN-037](#requirement-пути-данных-проекта)), `roles` (роль → список логинов), `identities.agents[]`
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
