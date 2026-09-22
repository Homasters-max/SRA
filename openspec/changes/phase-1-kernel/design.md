# Design: phase-1-kernel

## Context

Мотивация — [proposal.md](proposal.md) · Why. Требования — [specs/kernel/spec.md](specs/kernel/spec.md) (REQ-KRN-001…027).
Ограничения, заданные ADR и не обсуждаемые здесь: TypeScript на Node, monorepo, bin `warrant`, `npm i -g <git-tag>`
([ADR-0013](../../../docs/adr/WARRANT-ADR-0013-mvp-refinement.md)); JSON + `$schema` `warrant://<name>/<major>`, `warrant fmt`
([ADR-0006](../../../docs/adr/WARRANT-ADR-0006-json-conventions.md)); контракт генерации OpenSpec-файлов
([ADR-0015](../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md)); формат ID ([ADR-0012](../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)).

Среда: OpenSpec 1.13.1 требует Node ≥ 20.19; в проекте Node 22. OpenSpec сам написан на commander + zod + yaml (ESM).

## Goals / Non-Goals

**Goals (design-уровень):**
- Каждая команда — тонкая обёртка над чистыми модулями (`schemas`, `canon`, `resolve`, `ids`, `sync`), которые
  тестируются без файловой системы и без `openspec` на PATH.
- Один способ получить hash, один способ упорядочить ключи, один emitter YAML — переиспользуются `fmt`, `sync`, `validate`, `resolve`.
- Порядок реализации совпадает с порядком зависимостей схем, чтобы `validate` был рабочим уже после первой группы задач.

**Non-Goals:**
- Человекочитаемый (не JSON) формат вывода: в фазе 1 TTY и не-TTY печатают один и тот же JSON envelope.
- Наполнение pack `core-sdd` policy (profiles, gates, checks, controller) — фаза 2; здесь только минимум для `sync` и `validate`.
- Git-операции (ветки, worktree, base-сравнение ID) — фаза 3 (`ci`, `ids-valid`).

## Decisions

### 1. Layout monorepo и установка через git-tag

```text
package.json                  единственный npm-пакет: deps, "bin": {"warrant": "packages/cli/dist/bin/warrant.js"}, "prepare": build, "files"
packages/cli/                 каталог кода CLI (не workspace и не пакет), TypeScript ESM, tsc → dist/
  schemas/                    JSON Schema kernel: <name>.<major>.schema.json + common.1.schema.json
  src/                        bin/, commands/, core/{schemas,canon,ids,resolve,sync,packs,openspec,secrets}, io/
  test/                       vitest: unit, golden/resolve/<case>/{input.json,expected.json}, e2e (temp dirs)
packs/core-sdd/               pack.json, openspec/{schema.json,rules.json,templates/*.md}, risk/{levels,floors}.json
```

`npm i -g <git-url>#<tag>` устанавливает **корневой** пакет, поэтому `bin`, `prepare`, зависимости и `files` объявлены в корне;
`prepare` запускает `tsc -p packages/cli/tsconfig.json`. `files` перечисляет `packages/cli/{package.json,dist,schemas}` и `packs`,
иначе `.gitignore` исключил бы `dist/` из tarball. Bundled packs находятся по пути `<корень установленного пакета>/packs`,
вычисляемому от `import.meta.url` CLI (пять уровней вверх от `dist/core/packs/`), а не от cwd. Это же закрывает `UNK-KRN-003`:
источники packs — bundled + `.warrant/local/`. Версия CLI — `version` корневого `package.json` (`src/version.ts`).

**Alternatives considered:** npm workspaces (`packages/*`) — отвергнуто после проверки (задача 1.5): npm отвечает
`Workspaces not supported for global packages`, глобальная установка корня невозможна, а установка `packages/cli` даёт лишь
symlink на локальный чекаут без `packs/`. `packages/cli` как самостоятельный пакет с копией `packs/` — отвергнуто: две копии pack в репозитории.

### 2. JSON Schema: draft 2020-12, Ajv, общий `common`

- Файлы `packages/cli/schemas/<name>.<major>.schema.json`, `$id: "warrant://<name>/<major>"`. Реестр document-schemas
  зашит в `core/schemas/registry.ts`: только они допустимы в поле `$schema` файла (REQ-KRN-001).
- `common.1.schema.json` (`$id: warrant://common/1`) хранит `$defs`: enums из [02 §2](../../../docs/02-vocabulary.md) (`change_state`,
  `evidence_status`, `gate_verdict`, `controller_action`, `waiver_state`), измерения risk и их значения из [05 §4](../../../docs/05-policy.md),
  паттерны (`kebab_id`, `semver`, `semver_range`, `sha256`, `ulid_id`, `spec_id`, `transition`, `relative_path`), и `policy_body`
  (общие поля profile и overlay). `common` — не document-schema: `"$schema": "warrant://common/1"` в файле → `SCHEMA_UNKNOWN`.
- Валидатор — Ajv 2020 в strict-режиме + `ajv-formats` (`date`, `date-time`, `uri`). Все схемы компилируются один раз при старте
  (17 небольших файлов; измеримо дешевле, чем ленивая загрузка с кэшем).
- `additionalProperties: false` везде; `$comment` разрешён добавлением `"$comment": {"type": "string"}` в каждый объект
  через общий helper при загрузке схем, а не руками в каждом файле — иначе неизбежно забудется.
- Проверки, не выразимые в JSON Schema (`requires` ссылается на объявленный artifact — SCN-KRN-037; `change` равен имени файла),
  живут в `core/schemas/semantic.ts` как именованные правила, выполняемые после структурной проверки.

Порядок написания схем (зависимости): `common` → `config` → `lock` → `areas` → `pack` → `profile` → `overlay` → `gate` →
`check` → `change-record` → `evidence` → `evidence-manifest` → `controller-rules` → `risk-floor` → `risk-levels` →
`openspec-rules` → `openspec-schema` → `waiver`.

**Alternatives considered:** zod-схемы в коде с генерацией JSON Schema — отвергнуто: JSON Schema — контракт для LLM и
редакторов (ADR-0006), он должен быть первичным артефактом, а не производным.

### 3. Каноническая форма и hash — один модуль `core/canon`

- `orderKeys(value, schema)`: `$schema`, затем `$comment`, затем ключи в порядке `properties` схемы (рекурсивно по `$ref`/`$defs`),
  затем остальные по алфавиту; объекты-словари (`patternProperties` / `additionalProperties`) — по алфавиту ключей.
  Файл без известной схемы — только алфавит + warning в stderr.
- `formatJson(value)`: JSON.stringify с отступом 2, LF, завершающий `\n`, UTF-8 без BOM. Это единственная функция записи JSON в CLI.
- `canonicalHash(value)`: RFC 8785 (пакет `canonicalize`) → SHA-256 → `sha256:<hex>`. Используется для lock, `effective_policy.hash`,
  hash сгенерированных файлов (для них — hash байтов файла, не JSON).

### 4. Детерминированный YAML — собственный emitter (ADR-0015 п. 3)

`core/openspec/yaml-emit.ts` поддерживает ровно то, что нужно двум файлам: маппинги, списки строк, скаляры (string / int / bool),
literal block `|` для многострочных строк. Правила кавычек: двойные кавычки, если строка пуста, содержит `: `, ` #`, начинается
с пробела, `-`, `?`, `[`, `{`, `*`, `&`, `!`, `%`, `@`, `` ` ``, `'`, `"` или выглядит как число / bool / null.
Тест: сгенерированные файлы читаются `yaml.parse` (dev-dependency) в тот же объект, что и вход, и `openspec schema validate` проходит.
Пакет `yaml` в runtime не используется: чтение `config.yaml` в `validate` не нужно — сравнение побайтное.

**Alternatives considered:** `yaml.stringify` — отвергнуто: порядок и стиль кавычек зависят от версии библиотеки, а `validate`
сравнивает байты.

### 5. Стабильные ID — `core/ids`

- Нумерация (`warrant id`): сканирование `openspec/specs/**/*.md`, `openspec/changes/**/*.md` (включая `archive/`) регулярным
  выражением `<!--\s*id:\s*(REQ|SCN|TASK|UNK|ASM)-([A-Z]{2,5})-(\d{3})\s*-->` плюс `.warrant/changes/*.json` (`unknowns[]`, `assumptions[]`).
  Это не парсер Markdown: формат комментария принадлежит WARRANT.
- Размещение (`validate`, SCN-KRN-046): для активных Changes и specs — `openspec show <item> --json`; ID признан размещённым верно,
  если первая строка `requirement.text` / `scenario.rawText` — комментарий ID и далее есть непустой текст. Комментарий, попавший
  в текст не первой строкой или отсутствующий в `show`, но найденный сканером, → `ID_PLACEMENT`. Archive проверяется только на
  формат и уникальность.
- ULID — пакет `ulid` (монотонный генератор внутри процесса, SCN-KRN-058).
- `renumber`: замена по границам слова во всех текстовых файлах `openspec/changes/<name>/**` и `paths.tests`; список файлов — в `data.rewritten`.

### 6. Resolver — чистая функция `resolve(input) → EffectivePolicy | PolicyConflict`

```text
input = { classification?, layers: { default[], project[], profiles[], risk[] }, sources }
```

- Слои собирает loader (`core/packs`), не resolver: `default` — overlays packs с пустым `match`; `project` — overlays `.warrant/local/`
  с пустым `match`; `profiles` — profiles из `classification.profiles` с раскрытием `extends` (глубина-первый, без циклов);
  `risk` — overlays, чей `match` совпал с classification (каждый ключ `match` — подмножество значений; `profiles` в `match` — пересечение).
  `waiver`-слой в фазе 1 отсутствует: waivers влияют на verdict gate (фаза 3), не на состав policy.
- `risk_level`: из `classification.risk_level`, если есть; иначе вычисляется по `risk/levels.json` pack'а из значений измерений,
  любое `UNKNOWN` → не ниже `MEDIUM`; без classification → `MEDIUM` (SCN-KRN-068). Floor rules по diff — `classify`, фаза 2.
- Слияние строго по [05 §5](../../../docs/05-policy.md): объединение множеств; `recommended` минус `required`; `forbidden` — объединение;
  `approvals` — объединение по паре `(role, at)`. Скалярных полей в схемах фазы 1 нет — ветка «более строгое значение» не реализуется.
- Конфликт: `artifacts.required ∩ artifacts.forbidden ≠ ∅` → `POLICY_CONFLICT` с перечнем элементов и источников; команда печатает
  `data.controller_action: ESCALATE`, код 2.
- Ослабление структурно невозможно (только объединение); единственный путь — override в `.warrant/local/` с `"overrides"`, и его
  проверяет `validate`: у override каждое множество `required` / `gates.*` / `forbidden` ⊇ исходного, иначе `OVERRIDE_WEAKENS`.
- Результат: `{ hash, sources[], risk_level, artifacts, gates, capabilities, approvals, evidence, explain[] }`; `hash` считается по
  результату без `explain` и `sources`; `sources` в формате [05 §6](../../../docs/05-policy.md), для `.warrant/local` — `project:.warrant/local@sha256:<hash содержимого>`
  (git-sha из примера 05 §6 требует git и делает результат зависимым от незакоммиченных правок).
- Golden cases (`test/golden/resolve/`): `no-classification`, `feature-medium`, `feature-high-adds-review`, `two-profiles-union`,
  `extends-chain`, `policy-conflict`, `local-override-strengthens`. Каждый — `input.json` + `expected.json`; сравнение без `hash`;
  отдельный тест — стабильность `hash` между запусками. Fixture-packs лежат в `test/fixtures/packs/`, потому что profiles `core-sdd` — фаза 2.

### 7. `sync` и loader packs

- `core/packs/loader.ts`: читает `warrant.json`, находит каждый pack в bundled (`<root>/packs/<id>`) или `.warrant/local/`,
  проверяет `kernel`-диапазон и `depends_on`, топологически сортирует, загружает все `provides.*` файлы. Дубликат `id` объекта в двух packs
  → `DUPLICATE_OBJECT_ID`; в `.warrant/local/` объект с `overrides` заменяет исходный после проверки усиления.
- `sync` = loader → merge `openspec/rules.json` (ADR-0015 п. 2) → emit → запись только при изменении байтов (SCN-KRN-061) →
  копии схем в `.warrant/schemas/` → lock. `--check` — тот же путь без записи; расхождения → код 1.
- `openspec` вызывается через `cross-spawn` из PATH; версия сверяется с `warrant.json.openspec` до любого вызова (`OPENSPEC_VERSION`).

### 8. CLI-каркас и envelope

- `commander` (как у OpenSpec). Каждая команда возвращает `{ ok, data, errors, exitCode }`; единый `io/output.ts` печатает envelope
  и завершает процесс. Исключения из core → `errors[]` с `code`; необработанные — `INTERNAL` и код 3.
- Каталог кодов ошибок (`core/errors.ts`), фаза 1: `USAGE`, `CONFIG_MISSING`, `CONFIG_INVALID`, `SCHEMA_UNKNOWN`, `SCHEMA_VIOLATION`,
  `ARTIFACT_UNKNOWN`, `DUPLICATE_OBJECT_ID`, `OVERRIDE_INVALID`, `OVERRIDE_WEAKENS`, `LOCK_MISMATCH`, `GENERATED_DRIFT`,
  `OPENSPEC_SCHEMA_INVALID`, `RULES_ARTIFACT_UNKNOWN`, `ID_FORMAT`, `ID_PLACEMENT`, `ID_DUPLICATE`, `ID_TAKEN`, `ID_IMMUTABLE`,
  `AREA_UNKNOWN`, `SECRET_LIKE`, `NOT_CANONICAL`, `ALREADY_INITIALIZED`, `CHANGE_NAME_TAKEN`, `CHANGE_NOT_FOUND`,
  `PACK_NOT_FOUND`, `POLICY_CONFLICT`, `OPENSPEC_VERSION`, `OPENSPEC_FAILED`, `INTERNAL`.
- Secret-паттерны (`core/secrets.ts`): `ghp_[A-Za-z0-9]{36}`, `gh[ousr]_[A-Za-z0-9]{36}`, `github_pat_[A-Za-z0-9_]{22,}`,
  `sk-[A-Za-z0-9_-]{20,}`, `AKIA[0-9A-Z]{16}`, `eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`.
  В `errors[]` — путь и имя паттерна, никогда — совпавшая строка.

### 9. Pack `core-sdd` в фазе 1

Только то, что нужно `sync` и `validate`: `pack.json` (`version 0.1.0`, `kernel ">=0.1 <0.2"`), `openspec/schema.json`
(граф `warrant-sdd` по ADR-0015 п. 4, `instruction` — текст `spec-driven` + правила WARRANT), `openspec/rules.json`,
`openspec/templates/{proposal,spec,design,tasks}.md`, `risk/levels.json`, `risk/floors.json`. Profiles, overlays risk, gates,
checks, controller — фаза 2 добавляет файлы и строки в `provides`, схемы не меняются.

### 10. Тесты и порядок работы

- vitest. Тесты первыми для схем (fixture на каждый сценарий REQ-KRN-004…020: пример из документа + невалидный вариант) и для
  resolver (golden). Команды — e2e через собранный `dist/bin/warrant.js` во временном каталоге; тесты, которым нужен `openspec`,
  помечены и пропускаются, если его нет на PATH (в CI он устанавливается).
- Ветка `feature/phase-1-kernel`; коммит на группу задач; `warrant validate` и `warrant fmt --check` на самом репозитории —
  последняя задача и критерий выхода вместе с sample-проектом.

## Risks / Trade-offs

- [Ajv strict-режим отвергает конструкции, привычные по draft-07] → схемы пишутся сразу под 2020-12, тест компиляции всех схем — первая задача.
- [Собственный YAML emitter не покроет будущий ввод (unicode, спецсимволы в `context`)] → правило кавычек консервативное, round-trip тест через `yaml.parse`; emitter расширяется по failure mode.
- [`openspec show --json` не покрывает archive] → archive проверяется сканером только на формат и уникальность; полная проверка размещения — только для активных Changes и specs, что достаточно: archive неизменяем.
- [Порядок ключей по схеме зависит от `$ref`-разыменования] → `orderKeys` разыменовывает только локальные `#/$defs` и `warrant://common/1`; внешних ссылок нет.
- [Sample-проект для критерия выхода требует `openspec` на PATH] → e2e-тесты сообщают пропуск явно; критерий выхода проверяется вручную и в CI.

## Migration Plan

Новый код; миграции нет. Откат — удаление ветки. В этом репозитории `openspec/config.yaml` остаётся ручным до фазы 2 (ADR-0015 п. 7),
поэтому `warrant validate` на самом репозитории в фазе 1 запускается с флагом `--no-generated` (пропуск проверки 4 из REQ-KRN-021);
флаг документируется как временный и удаляется в фазе 2.

## Решения по ходу реализации

Зафиксированы при apply групп 1–3 (2026-09-22); нормативные документы не затронуты, ADR не требуется.

| # | Решение | Где |
|---|---|---|
| I-1 | Один npm-пакет в корне, без workspaces (см. D-1, Alternatives) | `package.json`, `packages/cli/package.json` |
| I-2 | Зависимость `semver` для диапазонов версий packs и `kernel`; ручной парсер диапазонов не пишется | `core/packs/loader.ts` |
| I-3 | Проверка размещения ID (5) — только `REQ`/`SCN` в `openspec/specs/**` и `openspec/changes/<c>/specs/**`: `TASK`/`UNK`/`ASM` не попадают в `openspec show --json`, для них — формат, AREA, уникальность | `core/ids/scan.ts` |
| I-4 | `.warrant/schemas/**` исключены из проверки (1): это копии JSON Schema с `$schema` draft 2020-12; целостность — по hash в lock (`sync`) | `commands/validate.ts` |
| I-5 | Отсутствие `warrant.lock.json` при наличии `warrant.json` → `LOCK_MISMATCH` с подсказкой `warrant sync`, не `CONFIG_MISSING` | `core/packs/hash.ts` |
| I-6 | Пока проверки (4) и (7) не реализованы (задачи 3.6, 4.3), `validate` всегда кладёт `generated` и `canonical` в `data.skipped` и предупреждает в stderr — вывод не притворяется полным | `commands/validate.ts` |
| I-7 | Hash pack для lock = `canonicalHash({ files: { "<posix path>": "sha256:<bytes>" } })` по всем файлам pack; `sync` обязан использовать ту же функцию `packContentHash` | `core/packs/hash.ts` |
| I-8 | `.warrant/local/`: каждый `*.json` проверяется схемой; объектами policy (pack `local`) становятся только документы `profile`/`overlay`/`gate`/`check`, классифицируемые по `$schema`, без соглашения о каталогах; pack по `warrant.json` также ищется в `.warrant/local/<id>/pack.json` | `core/packs/loader.ts` |
| I-9 | Объекты без `id` (`risk-floor`, `risk-levels`) получают id = имя файла без расширения; override `accepts_attestation` может только сужать список | `core/packs/loader.ts` |
| I-10 | Задача 7.1 (минимум `packs/core-sdd`) и hash из 4.1 выполнены в группе 3: без них не проверить SCN-KRN-043 и lock | `packs/core-sdd/`, `core/canon/hash.ts` |

## Open Questions

- Имя scope для будущей публикации (`@warrant/cli` занято или нет) — не влияет на фазу 1: пакет `private`.
