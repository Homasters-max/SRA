# Design: core-seams

## Context

Вход — аудит [2026-09-25](../../../docs/process/audits/2026-09-25.md) (§3, план §5), решения grilling нарезки фазы 4
N1–N17 ([ADR-0034](../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, 8), норма храповика —
[ADR-0030](../../../docs/adr/WARRANT-ADR-0030-module-boundaries.md) и
[ADR-0035](../../../docs/adr/WARRANT-ADR-0035-ratchet-external-packages.md). Код на входе — `main` `5a72d24`
(CLI 0.4.2); исключения храповика — 5: `rank` A-12, `helper` `err` ×4 (A-17).

Сверка аудита с кодом при подготовке spec:

- **A-15, A-16, A-14, A-17, A-8, A-18** — места совпадают с §3 отчёта; `config["packs"]` в `core/packs/hash.ts`
  читается дважды (`configuredRange` и `checkLock`), итого 8 чтений вне `loadConfig`.
- **Внешние импорты `src`** (кандидаты реестра ADR-0035 п. 1): `picomatch` — 3 файла (A-16); `ajv` / `ajv-formats` — 2
  файла: `core/validate/evidence.ts` повторяет диалект `core/schemas/loader.ts` (`strict`, `allErrors`,
  `allowUnionTypes`, форматы `date`, `date-time`, `uri`) — копия того же вида, что A-16; `canonicalize`
  (`core/canon/hash.ts`), `ulid` (`core/ids/allocate.ts`) — по одному владельцу; `semver` — 4 файла, в трёх копия
  «`range !== "*"` и `satisfies(…, { includePrerelease: true })`», в `loader.ts` — с `coerce`; `commander` (`bin`),
  `cross-spawn` (`adapters`) — вне критерия ADR-0035 п. 1.
- **Решение maintainer'а (2026-09-25):** `ajv`, `ajv-formats` — в реестр с исправлением копии в этом Change; `semver` в
  реестр не входит — новая строка долга **A-19**.
- **BL-26** — `scn-coverage.js --main` на `5a72d24`: 164/199, без теста с тегом 35 (SCN-SDD-001, 008, 019, 021;
  SCN-KRN-008, 009, 011, 012, 014–018, 020–027, 029–036, 038–041, 081, 083).
- **Помощники тестов:** `git` — 9 файлов (`contract/gates/diff-prefix`, e2e `archive`, `check`, `classify`,
  `exit-criterion`, `gate`, `transition`, `verify`, `versions`) с тремя вариантами `-c` (identity; `core.autocrlf=false`;
  ничего) и двумя типами результата (`void`, `string`); `write` — 10 копий, из них 4 пишут объект через
  `JSON.stringify(…, null, 2)` (`e2e/id`, `unit/ids/allocate`, `unit/ids/renumber`, `unit/resolve/golden`), остальные —
  как `helpers/synced.ts#write` (`canonicalText`) или только строку.

## Goals / Non-Goals

**Goals:** исключения храповика A-17 сняты, новых нет, кроме A-12; A-8, A-14…A-18 закрыты; ADR-0035 держится тестом;
у `guard` фазы 4 готовы швы — `WarrantConfig`, `pathMatcher`, `toProjectPaths`, `countingWaiverIds`, `cliError`,
`test/helpers/git.ts`; поведение CLI байт в байт прежнее.

**Non-Goals:** `hint` в ошибках и `--dry-run` (4a); A-5 целиком, A-9, A-12, A-19; изменения поведения, схем, pack'ов,
main specs.

## Decisions

### 1. Храповик ADR-0035 — `architecture.json` и мета-тест

Новые секции `architecture.json` (после `helpers`, до `enums`):

```json
{
  "packages": [
    { "name": "picomatch", "owner": "core/glob.ts" },
    { "name": "ajv", "owner": "core/schemas/loader.ts" },
    { "name": "ajv-formats", "owner": "core/schemas/loader.ts" },
    { "name": "canonicalize", "owner": "core/canon/hash.ts" },
    { "name": "ulid", "owner": "core/ids/allocate.ts" }
  ],
  "test_helpers": {
    "root": "packages/cli/test",
    "helpers": [
      { "name": "write", "owner": "helpers/synced.ts" },
      { "name": "git", "owner": "helpers/git.ts" }
    ]
  }
}
```

- **Правило `package`**: импорт пакета реестра — спецификатор `<name>` или `<name>/…` (`ajv/dist/2020.js`), `import`
  и `import type` — в файле `src` вне владельца. Исключение: `{ "id", "rule": "package", "from", "package" }`.
- **Правило `test-helper`**: объявление верхнего уровня (`FunctionDeclaration`, `const <имя> = (…) =>` — как `helper`
  ADR-0030) с именем из `test_helpers` в файле `packages/cli/test/**/*.ts` вне владельца. Исключение:
  `{ "id", "rule": "test-helper", "from", "helper" }`, `from` — от `test_helpers.root`. Локальные переменные внутри
  `it` (`const git = new FakeGit(…)` в `unit/fakes/git.test.ts`) — не объявления верхнего уровня.
- Храповик ADR-0030 п. 6 — для обоих правил: лишнее исключение роняет тест.
- Реестр `helpers`: `err` → `cliError` (владелец `core/errors.ts`), с §5 — `pathMatcher` → `core/glob.ts`,
  `toProjectPaths` → `core/git/paths.ts`, `countingWaiverIds` → `core/waivers/status.ts`, `findChangeDir` →
  `core/openspec/changes.ts`.
- Модули: `{ "id": "core/config", "path": "core/config.ts", "rank": 0 }`, `{ "id": "core/glob", "path":
  "core/glob.ts", "rank": 0 }` — строки-файлы, как `core/fs` (I-144): иначе `core/config.ts` попал бы в модуль `core`
  (`direct`), а `core ↔ core/schemas` дал бы цикл.
- Перечисление `waiver-state` (§4): владелец `core/waivers/status.ts`, `doc` — `docs/02-vocabulary.md`, значения
  `PROPOSED`, `ACTIVE`, `EXPIRED`, `REVOKED`. Строки реестров `helpers` и `enums` добавляет группа, которая создаёт
  владельца, вместе с переносом — без промежуточных исключений.
- Самопроверка (как I-140): временное нарушение каждого нового правила роняет тест; способ — строкой I-N.

Группа 1 вводит правила и исключения на все нарушения своего коммита, каждое — с A-N из backlog: `package`
`picomatch` ×3 — A-16; `test-helper` `git` ×9, `write` ×10 — A-18. Копию диалекта Ajv (§7) группа 1 исправляет сама:
у неё нет строки долга, а правка — одна функция. Нарушение без строки долга — стоп, вопрос maintainer'у.

### 2. `WarrantConfig` (A-15)

`core/config.ts` (R0; импортирует `core`, `core/fs`, `core/json`, `core/schemas`): `CONFIG_REL`, `loadConfig`
(переезжает из `core/packs/loader.ts` без изменения сообщений и путей ошибок) и тип:

```ts
export interface PackEntry {
  readonly id: string;
  /** `packs[id].version`, `*` when absent. */
  readonly range: string;
}

export interface WarrantConfig {
  readonly kernel: string;
  /** Accepted OpenSpec range (`openspec`, required by `config/1`). */
  readonly openspec: string;
  /** Enabled packs sorted by id, without `$comment`. */
  readonly packs: readonly PackEntry[];
  readonly defaults: { readonly checkTimeoutS: number | undefined };
  readonly paths: { readonly adr?: string; readonly glossary?: string; readonly tests?: string; readonly src?: string };
  /** Role → logins, without `$comment`. */
  readonly roles: ReadonlyMap<string, readonly string[]>;
}
```

- `loadConfig(root): WarrantConfig` — схема `config/1`, затем сборка значения; `LoadResult.config` — `WarrantConfig`.
  `identities`, `trusted_signers`, `packs[id].params` сейчас никто не читает — в интерфейс не входят (добавит первый
  читатель).
- Доступ `testFiles(root, config)` — один разбор `paths.tests` (вариант `dangling.ts`: файл или каталог, сегменты по
  `/`); `renumber.ts` получает `WarrantConfig` от вызывающего и не перечитывает конфиг — отступление от поведения
  `renumber` на пути `paths.tests`-файл (раньше — только каталог) — строкой I-N; конфиг `renumber` уже требует
  вызывающий, ошибка чтения больше не глотается — строкой I-N.
- Места: `packRequests` → `config.packs`; `hash.ts` `configuredRange` и `checkLock` → `config.packs`;
  `openspec/version.ts` → `config.openspec`; `roles.ts` `roleMembers(config, only?)` → `config.roles`;
  `check/execute.ts` → `config.defaults.checkTimeoutS`; `dangling.ts`, `renumber.ts` → `testFiles`.
- Unit-тест `test/unit/config/config.test.ts`: свойства `config/1` верхнего уровня ↔ поля `WarrantConfig` (явный список
  «не читается»: `$schema`, `identities`, `trusted_signers`) — новое свойство схемы без решения роняет тест; сборка на
  примере 08 §3.

### 3. Пути проекта и glob (A-16)

- `core/glob.ts` (R0): `pathMatcher(patterns: readonly string[]): (path: string) => boolean` —
  `picomatch([...patterns], { dot: true })`; `dot: true` — инвариант 05 §4 (`.warrant/**`). `classify/index.ts`
  `anyMatch`, `gates/l0/scope-valid.ts`, `gates/verdict.ts` `globToMatcher` — через него.
- `core/git/paths.ts` (модуль `core/git`, R2): `toProjectPaths(prefix: string, lines: readonly string[]): string[]` —
  `prefix === ""` → строки как есть, иначе только `<prefix>/…` без префикса (I-100). `relativeToProject` в
  `core/git/facts.ts` и `changedFromGit` — через него; `changedFromGit(ctx, base)` переезжает из `commands/classify.ts`
  в `core/git/paths.ts` (ошибки `USAGE` и сообщения прежние).

### 4. Предикат «waiver в силе» (A-14)

- `core/waivers/status.ts`: `countingWaiverIds(waivers: readonly WaiverInput[], definitions: ReadonlyMap<string,
  Record<string, unknown>>, ctx: WaiverContext): Set<string>` — id waivers, для которых `waiverStatus(…).counts`
  (gate — `definitions.get(waiver.gate)`). `evaluateGates` (`verdict.ts:L208-L213`) и `ensureApproval`
  (`commands/transition.ts`) — через него; `ensureApproval` берёт `gateDefinitions(loaded)` и `roleMembers(config)`, как
  `core/transition/gates.ts`. `isWaiverInForce`, `activeWaiverIds` удаляются из `core/gates/prefilter.ts`.
- Отступление: `ensureApproval` строже (approver, `waivable`, `targets`) — наблюдаемой разницы нет, записи
  `human-approval` не несут `metrics.waivers` (аудит §3.1) — строкой I-N.
- Машина состояний waiver (`MOVES` в `commands/waive.ts`) — в `core/waivers/status.ts` (`WAIVER_MOVES`); реестр
  `enums` получает `waiver-state` (§1). Сообщения `waive --activate` / `--revoke` прежние.

### 5. Фабрика ошибки и `findChangeDir` (A-17, A-8)

- `core/errors.ts`: `cliError(code: ErrorCode, message: string, options: { path?: string } = {}): CliError` — без
  `path`, если он не задан (форма `loader.ts` / `layers.ts`). Четыре копии `err` удаляются; вызовы с обязательным
  `path` (`hash.ts`, `sync/plan.ts`) передают его явно. Объект опций — чтобы 4a добавила `hint` без правки вызовов;
  поле `hint` и `errors[].hint` — 4a с delta specs (ADR-0034 п. 8). 32 литерала `{ code, … }` не трогаются.
- `findChangeDir`, `ChangeDirLocation` — `core/openspec/changes.ts` (R1); импортёры (`commands/{archive,status,
  transition}.ts`, `core/ids/immutable.ts`, `core/transition/facts.ts`, `core/init/scaffold.ts`) — из него. Рёбер
  `ids → init`, `status → init`, `transition → init` ради него не остаётся.

### 6. Помощники тестов (A-18)

- `test/helpers/git.ts`: `git(cwd: string, ...args: string[]): string` — `spawnSync("git", ["-c",
  "user.name=warrant-test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false", ...args])`, ошибка —
  `Error` с командой и stderr, результат — stdout. Уровни `contract` / `e2e` (процессы разрешены, ADR-0025); unit и
  app его не импортируют.
- 9 копий `git` удаляются; вызовы `git(...args)` без `cwd` (`exit-criterion`) — `git(root, ...args)`. Одинаковые
  `-c` меняют окружение тестов, где их не было: identity раньше бралась из `git config` фикстуры или машины,
  `autocrlf` — из машины; если тест зависел от прежнего — остановка и строка I-N.
- 10 копий `write` удаляются, импорт — из `helpers/synced.ts`. Копии с `JSON.stringify(…, null, 2)` для объектов
  (`e2e/id`, `unit/ids/{allocate,renumber}`, `unit/resolve/golden`) получают канонический текст: если тест зависит от
  байтов файла (например, неканонический JSON как вход), вызов переписывается на строку (`write(root, rel,
  JSON.stringify(…))`) — ожидаемые значения не меняются.

### 7. Диалект Ajv (реестр `ajv`)

`core/schemas/loader.ts` экспортирует `createAjv(): AjvLike` — `Ajv2020` с `strict`, `allErrors`, `allowUnionTypes` и
форматами `date`, `date-time`, `uri`; `validate/evidence.ts` `compileMetricsForms` зовёт его (новый экземпляр на
форму — как сейчас). Импорты `ajv`, `ajv-formats` остаются только в `loader.ts`.

### 8. Теги SCN (BL-26)

По каждому из 35 сценариев (Context) — тест, который его проверяет:

- **держит тест без тега** (пример из документа валиден — `unit/schemas`, golden pack, e2e) → id в имени `it` или в
  комментарии над ним, форма `(SCN-XXX-NNN)` как в существующих тестах;
- **держит шаг CI или dogfooding, не тест** (например, SCN-SDD-001 «`validate` в корне репозитория») → тест, если он
  дёшев (S) и не дублирует CI; иначе — остаток;
- **не держит ничего** → тест уровня по ADR-0025.

Остаток — строка BL-26 сужается до списка с причиной (решение maintainer'а — строкой I-N). Цель — 199/199.

### 9. Поведение не меняется

Существующие тесты `app` / `contract` / `e2e` и golden — без правок ожидаемых значений; правка — пути импорта, имена
перенесённых функций, удаление копий помощников, теги SCN. Правка ожидаемого значения — остановка и строка I-N. Перенос
символа — по `cs impact <символ>`. Новые тесты: `unit/config/config.test.ts`, самопроверка правил храповика, тесты
BL-26.

### 10. Процесс

- impl-PR — ветка `worktree/core-seams`, worktree `D:\project\SRA-core-seams-impl`; первым коммитом `transition
  APPROVED --ref <spec-PR> --by Homasters-max` + `IMPLEMENTING`, группы по коммиту, последним — `VERIFYING`.
- Порядок групп (tasks.md): 1 — bump, храповик ADR-0035 со стартовыми исключениями, диалект Ajv; 2 — A-15; 3 — A-16;
  4 — A-14; 5 — A-17 + A-8; 6 — A-18; 7 — BL-26; 8 — выход. Группы 3, 5, 6 снимают свои исключения; к группе 8
  исключения — только A-12.
- Группы — по одному субагенту (навык `change-coordinate`), после группы — `group-done`, `group-stats`.
- Аудит перед spec-PR не нужен: снимок 2026-09-25 свежий (`hygiene.js` — нет `audit-stale`).

## Risks / Trade-offs

- **`WarrantConfig` меняет тип `LoadResult.config`** — правка всех читателей сразу. Смягчение: их 8 + `roleMembers`
  (5 вызовов), typecheck ловит каждое место; сообщения ошибок конфига не меняются (переезд без правок тела).
- **Единые `-c` в помощнике `git`** меняют окружение e2e, где их не было. Смягчение: identity и `autocrlf=false` уже
  нужны половине копий; расхождение — остановка, а не подгонка ожиданий.
- **Канонический `write` в unit-тестах `ids`** меняет байты входных файлов. Смягчение: тесты сканируют id, а не байты;
  зависимость от байтов — строка вызова, не новая копия помощника.
- **Реестр пакетов растёт медленно** — по ADR-0035 п. 1 кандидаты даёт аудит; `semver` — долг A-19, а не исключение
  без правила.

## Решения по ходу реализации

Нумерация с I-148 (`/decision`).

| # | Решение | Где |
|---|---|---|
| I-148 | Группа 1 (1.1–1.3). **Владелец, которого ещё нет** (`core/glob.ts` — группа 3, `helpers/git.ts` — группа 6): реестр его допускает, тест существование файла не проверяет — импорт пакета или объявление помощника в любом другом файле всё равно нарушение, известные — исключения A-16 / A-18; well-formed проверяет только форму: имена в `packages` и `test_helpers.helpers` уникальны, владелец — относительный путь `.ts` без `..`, владелец пакета лежит в модуле (`core/glob.ts` — модуль `core`, `direct`), `test_helpers.root` — `packages/cli/test`. **Ключи правил:** `package` — `<from> :: <пакет>`, одно нарушение на пару файл–пакет, как бы ни импортировался (`ajv/dist/2020.js` — пакет `ajv`; `ajv-formats` пакетом `ajv` не считается); `test-helper` — `<from> :: <имя>`, `from` — от `test_helpers.root`, объявления — тот же разбор верхнего уровня, что `helper` (общая функция `declarationViolations`). Импорты — `ts.preProcessFile`, как у `rank`. **Диалект Ajv (§7):** `createAjv()` возвращает `AjvLike` с `addSchema`, `getSchema`, `compile` (объединение двух прежних интерфейсов); тип `ValidateFunction` `evidence.ts` берёт реэкспортом из `loader.ts` — иначе `import type` из `ajv` остался бы исключением `package`. **Bump 0.4.3 (1.1)** — как I-142: `package.json`, `package-lock.json` (2 строки), `.warrant/warrant.lock.json` и `warrant.lock.json` трёх golden-фикстур (`kernel`) | `test/unit/meta/architecture.{json,test.ts}`, `core/schemas/loader.ts`, `core/validate/evidence.ts`, задачи 1.1–1.3 |
| I-149 | Самопроверка правил ADR-0035 (1.2, 1.4). **Постоянная:** `describe` «the rules of ADR-0035 catch what they name» — `check` на синтетических `architecture.json` и исходниках: `import type` и `export … from "pm/lib/…"` вне владельца — нарушения, владелец и пакет с длинным именем (`pmx`) — нет; `function git` и `const git = () =>` верхнего уровня — нарушения, `const git` внутри `it` — нет; исключение покрывает нарушение, лишнее исключение — `stale exception`. **Временная (как I-140, откат копиями, итог — `git status` без лишних файлов):** `import type { PicomatchOptions } from "picomatch"` в `core/roles.ts` → «core/roles.ts :: picomatch (package: owner core/glob.ts)»; `export const write = () => {}` в `test/helpers/cli.ts` → «helpers/cli.ts :: write (test-helper: owner helpers/synced.ts)»; лишние исключения `package` A-16 (`core/ids/scan.ts` `ulid`) и `test-helper` A-18 (`e2e/id.test.ts` `git`) → «stale exception …»; исключение `A-99` → «A-99: not a row of docs/backlog.md»; прежний `core/validate/evidence.ts` → нарушения `ajv`, `ajv-formats`. Тест процессов не порождает (уровень `unit`). **Исключения храповика 5 → 27:** `rank` A-12 ×1, `helper` A-17 ×4 (без изменений); `package` A-16 ×3 (`picomatch`: `classify/index.ts`, `gates/l0/scope-valid.ts`, `gates/verdict.ts`); `test-helper` A-18 ×19 (`git` ×9, `write` ×10 — ровно файлы design Context); `package` на `ajv` / `ajv-formats` нет | `test/unit/meta/architecture.{json,test.ts}`, задачи 1.2, 1.4 |
| I-150 | Группа 2 (2.1–2.3). **`core/config.ts`** — модуль-строка `core/config` (R0, после `core/schemas`); экспорт — `CONFIG_REL`, `loadConfig`, `WarrantConfig`, `PackEntry`, `testFiles`, сборка значения — внутренняя `toWarrantConfig` (не экспорт: читатель получает конфиг только через `loadConfig`); `CONFIG_REL` уходит из `core/packs/loader.ts` (других импортёров не было), `commands/init.ts` держит свою POSIX-константу — не тронута. `configuredRange` в `hash.ts` и `openspec/version.ts` удалены: диапазон — `PackEntry.range` / `config.openspec`; B3 `checkLock` сверяет с множеством id `config.packs` вместо `id in packs` (имя вроде `constructor` в lock больше не считается включённым — для валидных id разницы нет). **Отступления `renumber`:** (1) `paths.tests`-файл теперь переписывается (раньше — только каталог), разбор — `testFiles` (вариант `dangling.ts`); (2) `renumber(root, config, old, new, change)` — конфиг загружает `runId` (`commands/id.ts`) через `loadConfig` только в ветке `renumber`, после проверок `USAGE`: непригодный `warrant.json` — теперь `CONFIG_INVALID` до `ID_FORMAT` / `CHANGE_NOT_FOUND`, а не тихо «без корня тестов». **Тесты:** `unit/ids/renumber.test.ts` передаёт `loadConfig(root)`, `unit/{controller/controller,resolve/layers}.test.ts` — литерал `WarrantConfig` вместо `config: {}` (способ построения входа, ожидания прежние). **Самопроверка 2.3:** временное свойство `guard_prefixes` в `config.1.schema.json` роняет «every top-level property of config/1 …», откат — `git checkout` | `core/config.ts`, `core/packs/{loader,hash,types}.ts`, `core/openspec/version.ts`, `core/roles.ts`, `core/check/execute.ts`, `core/validate/dangling.ts`, `core/ids/renumber.ts`, `core/sync/apply.ts`, `commands/id.ts`, `test/unit/config/config.test.ts`, `test/unit/meta/architecture.json`, задачи 2.1–2.3 |
| I-151 | Группа 3 (3.1–3.2). **Опции `picomatch` сверены:** во всех трёх местах — только `{ dot: true }`; `classify/index.ts` `anyMatch` и `gates/l0/scope-valid.ts` передавали массив, `gates/verdict.ts` — строку: `globToMatcher(pattern)` на каждый шаблон `applies_when.changed_paths` и `matchers.some(…)`. Там `globToMatcher` удалён, вместо него один `pathMatcher(patterns)` — `picomatch` на массиве есть «хотя бы один шаблон совпал» с теми же опциями, поведение прежнее. **`core/git/paths.ts`:** `toProjectPaths("", lines)` возвращает копию (`readonly` на входе), не тот же массив — вызывающие его не меняют; `changedFromGit(ctx: Pick<Ctx, "git" \| "root">, base)` — `root` нужен сообщению `USAGE`, тело и сообщения прежние; `relativeToProject` — `inside(p) = toProjectPaths(prefix, [p])[0]`. **Проверка 3.2:** `cs grep 'prefix.length + 1' --fixed` в `packages/cli/src` — одно место (`core/git/paths.ts`); вне `src` ещё два — `test/app/helpers/project-builder.ts` `absoluteOf` (обратный перевод путь проекта → путь репозитория в фейке) и `scripts/dev/cs-lib.js` `moduleOf` (инструмент разработки) — вне реестра `helpers` (он про `src`), не тронуты | `core/glob.ts`, `core/git/paths.ts`, `core/git/facts.ts`, `core/classify/index.ts`, `core/gates/l0/scope-valid.ts`, `core/gates/verdict.ts`, `commands/classify.ts`, `test/unit/meta/architecture.json`, задачи 3.1–3.2 |
| I-152 | Группа 4 (4.1–4.2). **`countingWaiverIds`** — цикл `evaluateGates` перенесён без изменения логики (gate — `definitions.get(waiver.gate)`, id — только строка). **Отступление `ensureApproval`:** повторное использование `human-approval` считает waivers тем же предикатом, что gate engine — `gateDefinitions(loaded)` и `approvers: roleMembers(loaded.config)`, как `core/transition/gates.ts`; это строже прежнего `activeWaiverIds` (только `waiver_state` и срок): waiver с `approved_by` вне `roles`, на gate без `waivable: true` или с `targets[]` больше не держит запись. Наблюдаемой разницы нет — записи `human-approval` не несут `metrics.waivers` (аудит §3.1); тесты `transition` без правок. `gateDefinitions(loaded)` в `ensureApproval` вычисляется один раз (раньше — только для `level`). **`WaiverInput`** переехал из `core/gates/types.ts` (R3) в `core/waivers/read.ts` (R2) и стал типом результата `readWaivers` (был анонимный тип той же формы): иначе `core/waivers/status.ts` импортировал бы `core/gates` — нарушение ранга; импортёры — `core/gates/{types,l0/types}.ts`, `test/unit/gates/verdict.test.ts` (путь импорта), реэкспорта нет — один владелец. **`WAIVER_MOVES`** и тип `WaiverMove` — в `status.ts`, `changeState(mode: WaiverMove, …)`; тексты `--activate` / `--revoke` прежние. Литерал `waiver-state` вне владельца в `src` был один — `MOVES`; переносов по образцу I-145 не понадобилось | `core/waivers/{status,read}.ts`, `core/gates/{verdict,prefilter,types,l0/types}.ts`, `commands/{transition,waive}.ts`, `test/unit/gates/verdict.test.ts`, `test/unit/meta/architecture.json`, задачи 4.1–4.2 |
| I-153 | Группа 5 (5.1–5.2). **`cliError`** — `core/errors.ts`, сигнатура §5 (`options: { path?: string } = {}`); 44 вызова `err` в четырёх файлах переписаны механически (callee → `cliError`, третий аргумент `p` → `{ path: p }`, длинные строки перенесены), объекты прежние: в `hash.ts` / `sync/plan.ts` путь — `string` всегда, ключ `path` есть, как у прежней копии; в `loader.ts` путь — `string`. **`layers.ts`:** `expandProfiles.visit` получал `from: string \| undefined` (корень — без пути); при `exactOptionalPropertyTypes` `{ path: from }` не проходит в `{ path?: string }`, поэтому `visit` несёт сам объект опций `at: { path?: string }` — корень `{}`, родитель `{ path: object.path }`; тип опций `cliError` не расширялся до `string \| undefined`. Реестр `helpers`: `err` → `cliError`, исключения `helper` A-17 ×4 сняты. **`findChangeDir`:** `core/openspec/changes.ts` — `findChangeDir`, `ChangeDirLocation`, `ARCHIVE_DATE_RE` (нужен только ему); импортёров семь, не шесть: к `commands/{archive,status,transition}.ts`, `core/ids/immutable.ts`, `core/transition/facts.ts`, `core/init/scaffold.ts` (`changeNameConflict`) — `core/status/stale.ts` (`import type { ChangeDirLocation }`): именно он давал ребро `core/status → core/init`; тестов, импортирующих символы, нет. `cs deps --level 2`: рёбер `core/ids → core/init`, `core/status → core/init`, `core/transition → core/init` нет; `commands → core/init` остаётся 1 — `commands/init.ts` (сама команда `init`); новое ребро `core/init → core/openspec` (оба R1, храповик зелёный) | `core/errors.ts`, `core/packs/{hash,loader}.ts`, `core/resolve/layers.ts`, `core/sync/plan.ts`, `core/openspec/changes.ts`, `core/init/scaffold.ts`, `core/status/stale.ts`, `core/ids/immutable.ts`, `core/transition/facts.ts`, `commands/{archive,status,transition}.ts`, `test/unit/meta/architecture.json`, задачи 5.1–5.2 |
| I-154 | Группа 6 (6.1–6.2). **`test/helpers/git.ts`** — `git(cwd, ...args): string` по §6 (identity + `core.autocrlf=false`, ошибка «`git <args> failed: <stderr>`», результат — stdout без `trim`); импортёры — 9 файлов `contract` / `e2e`, unit и app его не импортируют. **Особенности копий, которые помощник меняет, — тесты от них не зависят:** `e2e/check` возвращал `stdout.trim()` — результат нигде не читается; `e2e/versions` писал ошибку без `failed` — текст только при сбое, ожиданий на него нет; `exit-criterion` звал `git(...args)` с замыканием на `root` — теперь `git(root, ...args)` (23 вызова); identity: `classify` ставил `user.name test` через `git config` — `-c` его перекрывает, автор коммита тестом не читается; вызовы `git config user.*` фикстур оставлены (избыточны, но это вход теста, не копия). `core.autocrlf=false` там, где его не было (`archive`, `classify`, `gate`, `transition`, `verify`, `versions`): на машине с `core.autocrlf=true` (Windows) contract и e2e зелёные. **`write` из `helpers/synced.ts`, 4 копии с `JSON.stringify(…, null, 2)` → канонический текст, ни один тест не зависит от байтов JSON-входа, строк вызова не понадобилось:** `e2e/id` — CLI читает `warrant.json`, `areas.json`, запись Change разбором, байты проверяются только у `tasks.md` (строка); `unit/ids/allocate` — `allocate*` / `highestNumber` сканируют id разбором и по имени файла; `unit/ids/renumber` — запись Change проверяется `toContain('"UNK-KRN-011"')` и списком `rewritten`, байты — только у строковых файлов; `unit/resolve/golden` — `loadPacks` разбирает JSON, хэши источников нормализуются (`sha256:<hash>`), `policy.hash` сравнивается только между двумя одинаково построенными проектами. **Типы golden:** `GoldenInput.local` — `Record<string, object>` вместо `Record<string, unknown>` (значения во всех `input.json` — объекты), иначе `json` не проходит в `string \| object`. Импорт `helpers/synced.ts` в unit-тестах процессов не запускает (на уровне импорта — только `import`, чтение `pack.json` в `cli.ts`; `child_process` уровня `unit` подменён `forbid-spawn.ts`, unit зелёные). Исключения `test-helper` A-18 ×19 сняты — в `exceptions` только A-12 | `test/helpers/git.ts`, `test/contract/gates/diff-prefix.test.ts`, `test/e2e/{archive,check,classify,exit-criterion,fmt,gate,id,resolve,status,transition,verify,versions}.test.ts`, `test/unit/ids/{allocate,renumber,scan}.test.ts`, `test/unit/resolve/golden.test.ts`, `test/unit/meta/architecture.json`, задачи 6.1–6.2 |
| I-155 | Задача 7.1 — **остаток BL-26 (решение maintainer'а 2026-09-25).** Группа 7 дала `scn-coverage.js --main` 195/199; четыре сценария держат CI и dogfooding, а не тест: **SCN-SDD-001** — CI-шаг `warrant validate (repository)` и `group-done`; THEN частично устарел (в lock один hash на pack, а не hash каждого файла `provides`); **SCN-SDD-008** — dogfooding ветки `phase-2-core-sdd`; сценарий устарел (Change в архиве, ветки нет), похожее держит SCN-KRN-073; **SCN-SDD-019** — job `evidence` (`warrant verify`); **SCN-KRN-083** — `sync --check` в `group-done` и CI, механизм слияния держит SCN-KRN-062. BL-26 сужается до этих четырёх: SDD-001 и SDD-008 — переписать при следующей правке spec `core-sdd` (фаза 5, вместе с BL-25); SDD-019 и KRN-083 — законный остаток за CI (снимается продуктовым check `scn-covered` BL-25 или признаётся держателем CI). Цель 199/199 design §8 не достигнута — 195/199 с этим остатком | `docs/backlog.md` (BL-26), задача 7.1 |
