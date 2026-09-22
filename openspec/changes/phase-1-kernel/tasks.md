# Tasks: phase-1-kernel

Ссылки — на [specs/kernel/spec.md](specs/kernel/spec.md) (REQ-KRN-NNN) и [design.md](design.md) (D-N).
Порядок: каркас → schemas → `validate` → `fmt` → `init` → `id` → `sync` → `resolve --explain` → `status` → критерий выхода.
Тесты пишутся первыми для schemas (группа 2) и resolver (группа 8).

## 1. Каркас monorepo (D-1, D-8)

- [x] 1.1 Создать ветку `feature/phase-1-kernel`; корневой `package.json` (единственный пакет: deps, `bin.warrant`, `prepare`, `files`; без workspaces — D-1), `.gitignore` для `node_modules/`, `dist/`; проверить `npm install` без ошибок
- [x] 1.2 `packages/cli/`: каталог кода (deps `commander`, `ajv`, `ajv-formats`, `canonicalize`, `semver`, `ulid`, `cross-spawn`; dev `typescript`, `vitest`, `yaml` — в корневом `package.json`), `tsconfig.json` strict, скрипты `build`, `test`, `typecheck` в корне; проверить `npm run build` даёт `packages/cli/dist/`
- [x] 1.3 `src/core/errors.ts` — каталог кодов из D-8; `src/io/output.ts` — envelope `{command, ok, change?, data, errors}` и коды выхода (REQ-KRN-002, REQ-KRN-003); unit-тест: envelope печатается одним объектом, `USAGE` → код 3
- [x] 1.4 `src/bin/warrant.ts` на commander с командами-заглушками `init validate fmt id sync resolve status`; e2e-тест: `warrant nosuchcommand` → код 3 и `errors[0].code = USAGE` (SCN-KRN-006); `warrant validate` без `.warrant/` → `CONFIG_MISSING`, код 3 (SCN-KRN-007)
- [x] 1.5 Проверить установку через git: `npm i -g <путь к репозиторию>` даёт рабочий `warrant --version`; зафиксировать команду в README

## 2. JSON Schemas kernel — тесты первыми (D-2, REQ-KRN-001, REQ-KRN-004…020)

- [x] 2.1 `src/core/schemas/registry.ts` + загрузчик Ajv 2020 strict с `ajv-formats` и helper, добавляющий `$comment` в каждый объект; тест: все файлы `schemas/*.schema.json` компилируются, `warrant://common/1` не document-schema (SCN-KRN-001…003)
- [x] 2.2 Fixtures `test/fixtures/schemas/<name>/{valid-*.json, invalid-*.json}` для каждой схемы REQ-KRN-004…020: валидные — примеры из документов 04–08 и ADR; невалидные — по одному на каждый сценарий отклонения; тест-раннер, который для каждого invalid-файла проверяет JSON Pointer ошибки — **тесты красные до 2.3–2.6**
- [x] 2.3 `common.1.schema.json`: enums 02 §2, измерения и значения risk 05 §4, паттерны (`kebab_id`, `semver`, `semver_range`, `sha256`, `ulid_id`, `spec_id`, `transition`, `relative_path`), `policy_body`; затем `config`, `lock`, `areas`, `pack` — тесты 2.2 для них зелёные (SCN-KRN-008…013, 040–041, 010–011)
- [x] 2.4 `profile`, `overlay`, `gate`, `check` — тесты зелёные (SCN-KRN-014…021); `gate.waivable` обязателен (SCN-KRN-019); `check.level` без `L2` (SCN-KRN-021)
- [x] 2.5 `change-record`, `evidence`, `evidence-manifest`, `controller-rules` — тесты зелёные (SCN-KRN-022…029); ULID-паттерн отклоняет `EVID-000921` (SCN-KRN-025)
- [x] 2.6 `risk-floor`, `risk-levels`, `openspec-rules`, `openspec-schema`, `waiver` — тесты зелёные (SCN-KRN-030…039)
- [x] 2.7 `src/core/schemas/semantic.ts`: правила после структурной проверки — `openspec-schema.artifacts[].requires` ⊆ объявленных id (`ARTIFACT_UNKNOWN`, SCN-KRN-037), `change-record.change` = имя файла; unit-тесты на оба
- [x] 2.8 Проверить `description` у каждого свойства всех схем автоматическим тестом (обход схемы: каждое `properties.*` имеет непустой `description`)

## 3. Команда validate (D-2, D-5, D-7, D-8, REQ-KRN-021)

- [x] 3.1 `src/core/packs/loader.ts`: чтение `warrant.json`, поиск packs bundled + `.warrant/local/`, проверка `kernel`-диапазона и `depends_on`, топологическая сортировка, загрузка `provides.*`; unit-тесты на fixture-packs: порядок загрузки, `PACK_NOT_FOUND`, `DUPLICATE_OBJECT_ID` (SCN-KRN-044), override с `overrides` принимается, ослабляющий override → `OVERRIDE_WEAKENS`
- [x] 3.2 Проверка (1): все `*.json` под `.warrant/**` и в packs — `$schema` + Ajv + semantic; e2e на fixture-проекте с одним невалидным файлом → `SCHEMA_VIOLATION` с путём, код 3 (SCN-KRN-005)
- [x] 3.3 Проверка (2): lock ↔ config — версии в диапазонах, hash packs / skills / generated совпадают (`LOCK_MISMATCH`); тест с изменённым файлом pack после lock
- [x] 3.4 `src/core/secrets.ts` с паттернами D-8; проверка (6) по `.warrant/**` и `.claude/**`; тест: `ghp_` + 36 символов → `SECRET_LIKE`, в `errors[]` нет самой строки (SCN-KRN-048)
- [x] 3.5 `src/core/ids/scan.ts` (сканер комментариев по D-5) и проверка (5) через `openspec show --json`: формат, размещение, уникальность, AREA в реестре; тесты: ID над заголовком → `ID_PLACEMENT` (SCN-KRN-046), неизвестная AREA → `AREA_UNKNOWN` (SCN-KRN-047), дубликат → `ID_DUPLICATE`; e2e-тест пропускается без `openspec` на PATH
- [x] 3.6 Проверка (4): побайтное сравнение `openspec/config.yaml` и `openspec/schemas/<schema>/**` с результатом генерации (`GENERATED_DRIFT`, SCN-KRN-045), вызов `openspec schema validate --json` (`OPENSPEC_SCHEMA_INVALID`), ключи `rules` ⊆ artifacts (`RULES_ARTIFACT_UNKNOWN`); флаг `--no-generated` (D-Migration); зависит от 7.x — реализуется как вызов `sync --check` и закрывается после группы 7
- [x] 3.7 e2e: `warrant validate` на `packs/core-sdd/` из корня monorepo → `ok: true` (SCN-KRN-043); все находки собираются за один вызов, а не до первой ошибки

## 4. Команда fmt (D-3, REQ-KRN-022)

- [x] 4.1 `src/core/canon/{order-keys,format-json,hash}.ts`; unit-тесты: `$schema` первым, порядок по `properties` схемы с разыменованием `#/$defs` и `warrant://common/1`, словари по алфавиту, файл без схемы — алфавит; `canonicalHash` стабилен для переставленных ключей
- [x] 4.2 Команда `fmt [paths...]` и `--check`; e2e: канонический файл не меняет байты и `data.changed = []` (SCN-KRN-049); переставленные ключи в `warrant.json` приводятся (SCN-KRN-050); `--check` → код 1 и путь в `data.changed` (SCN-KRN-051); файл без `$schema` → warning в stderr, stdout только envelope (SCN-KRN-004)
- [x] 4.3 Проверка (7) в `validate`: неканонический файл → `NOT_CANONICAL`; тест

## 5. Команда init (REQ-KRN-023)

- [x] 5.1 `warrant init`: `warrant.json` (`kernel` из версии CLI, `openspec` из `openspec --version`, `packs.core-sdd`), `local/areas.json`, `local/openspec/rules.json`, каталоги с `.gitkeep`, копии схем в `.warrant/schemas/<name>.<major>.schema.json`, затем `sync`; `data.created[]`; e2e во временном каталоге с `openspec init --tools none`: после `init` → `warrant validate` `ok: true` (SCN-KRN-042, SCN-KRN-052)
- [x] 5.2 Повторный `init` без `--force` → `ALREADY_INITIALIZED`, файлы не тронуты; с `--force` — перезапись; тесты (SCN-KRN-053)
- [x] 5.3 `warrant init change <name>`: проверка имени по `.warrant/changes/` и `openspec/changes/archive/*-<name>` **до** вызова `openspec new change --schema <из config.yaml> --json`; record `PROPOSED` с одной transition `by: cli:local`, без `classification`; тесты: успех (SCN-KRN-054), имя из archive → `CHANGE_NAME_TAKEN` и `openspec` не вызывался (SCN-KRN-055)

## 6. Команда id (D-5, REQ-KRN-024)

- [x] 6.1 `warrant id <PREFIX> <AREA>` для `REQ SCN TASK UNK ASM`: max по сканеру (specs + changes + archive + records) + 1, три цифры; AREA из реестра; тесты: учёт archive (SCN-KRN-056), `AREA_UNKNOWN` (SCN-KRN-057), переход через 999 → ошибка `ID_FORMAT`
- [x] 6.2 `warrant id EVID | RUN` → ULID, `warrant id WAV` → `WAV-<год>-NNN` по `.warrant/waivers/`; тест: два `EVID` подряд различны и матчат Crockford (SCN-KRN-058)
- [x] 6.3 `warrant id renumber <old> <new> --change <name>`: отказ, если `<new>` существует (`ID_TAKEN`) или record в `MERGED` / `ARCHIVED` (`ID_IMMUTABLE`, SCN-KRN-060); замена по границам слова в `openspec/changes/<name>/**` и `paths.tests`; `data.rewritten[]`; тест: файлы вне каталога не тронуты (SCN-KRN-059)

## 7. Команда sync (D-4, D-7, D-9, REQ-KRN-025)

- [x] 7.1 Pack `core-sdd` минимум: `pack.json`, `openspec/schema.json` (граф `warrant-sdd`, `instruction` = текст `spec-driven` + правила WARRANT по ADR-0015 п. 4), `openspec/rules.json`, `openspec/templates/{proposal,spec,design,tasks}.md`, `risk/levels.json`, `risk/floors.json`; `warrant validate` на pack зелёный (задача 3.7 остаётся зелёной)
- [x] 7.2 `src/core/openspec/yaml-emit.ts`; unit-тесты: round-trip через `yaml.parse` на config с многострочным `context`, строках с `:` и `#`, пустой строке, числе в строке; первая строка — маркер (SCN-KRN-063)
- [x] 7.3 Слияние `rules.json` pack + project (ADR-0015 п. 2): конкатенация `context`, объединение списков с сохранением порядка и удалением точных дублей; unit-тест SCN-KRN-062
- [x] 7.4 Команда `sync`: loader → merge → emit `config.yaml`, `schema.yaml`, копии templates → копии схем в `.warrant/schemas/` → lock с hash каждого pack, skill, generated; запись только при изменении байтов; `--check` → код 1; e2e: идемпотентность (`data.changed = []`, git чист — SCN-KRN-061), `PACK_NOT_FOUND` без записи (SCN-KRN-064), `openspec schema validate warrant-sdd --json` → `valid: true` (SCN-KRN-063)
- [x] 7.5 Проверка версии `openspec --version` против `warrant.json.openspec` до любого вызова (`OPENSPEC_VERSION`); тест с подменённым PATH-скриптом, печатающим другую версию
- [x] 7.6 Закрыть задачу 3.6: `validate` проверка (4) через `sync --check`; e2e с отредактированным `config.yaml` → `GENERATED_DRIFT` (SCN-KRN-045)

## 8. Команда resolve — golden первыми (D-6, REQ-KRN-026)

- [x] 8.1 Fixture-packs `test/fixtures/packs/` (base overlay, profiles `feature`/`chore` с `extends`, overlays `risk-medium`/`risk-high`, конфликтующая пара) и golden cases `test/golden/resolve/<case>/{input.json,expected.json}` из D-6; тест-раннер сравнивает результат без `hash` — **красный до 8.2–8.4**
- [x] 8.2 `src/core/resolve/layers.ts`: сбор слоёв `default → project → profiles (extends, без циклов) → risk (match)`; unit-тесты на `match` по `risk_level`, измерению и `profiles`
- [x] 8.3 `src/core/resolve/risk-level.ts`: `risk_level` из record или по `risk/levels.json`, `UNKNOWN` → не ниже `MEDIUM`, без classification → `MEDIUM`; unit-тесты (SCN-KRN-068)
- [x] 8.4 `src/core/resolve/merge.ts`: объединение по 05 §5, `recommended` − `required`, `approvals` по `(role, at)`, `POLICY_CONFLICT` с источниками, `explain[]`, `sources[]`, `hash` без `explain`/`sources`; golden зелёные (SCN-KRN-066, 067, 069); тест стабильности `hash` (SCN-KRN-065)
- [x] 8.5 Команда `resolve <change> [--explain] [--classification <file>]`: чтение record, `CHANGE_NOT_FOUND`, конфликт → `data.controller_action: ESCALATE`, код 2; e2e на fixture-проекте

## 9. Команда status (REQ-KRN-027)

- [ ] 9.1 `src/core/openspec/status.ts`: обёртка над `openspec status --change <c> --json` → `{artifact: done|ready|blocked|skipped}`; тест на сохранённом JSON-ответе OpenSpec
- [ ] 9.2 `warrant status [change]`: record (`change_state`, `classification`), `effective_policy.{hash,sources}` через resolver, artifacts, `stale[]` (каталог отсутствует и не в archive → `CHANGE_DIR_MISSING`; в archive при состоянии ≠ `ARCHIVED` → `ARCHIVED_WITHOUT_TRANSITION`); без ключей `verdicts` / `next`; e2e: свежий Change (SCN-KRN-070), archive без транзиции (SCN-KRN-071), неизвестный → `CHANGE_NOT_FOUND` код 3 (SCN-KRN-072)
- [ ] 9.3 `warrant status` без аргумента — все records из `.warrant/changes/`; тест с двумя records

## 10. Критерий выхода и dogfooding

- [ ] 10.1 Sample-проект во временном каталоге: `openspec init --tools none` → `warrant init` → `warrant init change demo` → `warrant validate` `ok: true`, `warrant status demo` `stale: []`; закрепить как e2e-тест `exit-criterion.test.ts` (пропуск без `openspec`)
- [ ] 10.2 На этом репозитории: `warrant validate --no-generated` и `warrant fmt --check` проходят (`.warrant/local/areas.json`, ID `REQ-KRN-*`/`SCN-KRN-*` этого Change через `openspec show --json`); добавить `.warrant/warrant.json` и lock через `warrant init` без перезаписи `openspec/config.yaml`
- [ ] 10.3 README корня: установка через git-tag, команды фазы 1, ссылка на docs; `docs/NEXT-SESSION.md` — состояние после фазы 1 и вход в фазу 2
- [ ] 10.4 `openspec validate phase-1-kernel --strict` зелёный, все задачи отмечены; PR из `feature/phase-1-kernel` в `main`
