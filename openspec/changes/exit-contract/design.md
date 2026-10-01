# Design: exit-contract

## Context

База — `main` после ADR-0052 (CLI 0.9.0, pack `core-sdd` 0.4.0). Норма — [ADR-0052](../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 2. Аудит `2026-10-01-cycle-1b` (снимок `d777762`) свеж: после `0993a74` правок в `packages/cli/src` нет. Факты кода собраны 2026-10-01 на `85d5e0e`.

**Выбор кода выхода сейчас:**
- `EXIT` = `{OK:0, FAIL:1, WAIT:2, CONFIG:3}` (`core/errors.ts:118-123`). `WarrantError` по умолчанию даёт 3 (`:145`). Явный `exitCode` передают только `BUSY` (2) и `execute.ts:50` (3).
- Ссылок `EXIT.*` 67 в 27 файлах (`cs`).
- Коды складываются в пяти местах: `commands/verify.ts:60`, `commands/archive.ts:96`, `core/check/execute.ts:342`, `core/ci/judge.ts:152` (`Math.max`), `core/ci/impl.ts:127` (тернарий).
- Controller переводит действие в код функцией `exitCodeOf` (`core/controller/evaluate.ts:121-130`). Отказ `transition` поднимает 0 до 2 (`core/transition/outcome.ts:47-48`).

**Вывод:**
- `CommandResult.exitCode` (`io/output.ts:4-10`).
- `failure`, `failures(errors, exitCode, …)`, `resultFromThrown`: не `WarrantError` превращается в `INTERNAL`, код 3.
- `emitToProcess` пишет stdout, затем `process.exitCode`.
- Обработчиков `uncaughtException` и `unhandledRejection` нет. Исключение вне `try` в `bin/warrant.ts` — аварийный выход Node с кодом 1, без JSON.

**Один код ошибки — разные коды выхода:**

| Код ошибки | Где и сколько |
|---|---|
| `BUSY` | 2 — `check/execute.ts:195`, `run/store.ts:165`, `canon/format-json.ts:112`; 3 — `ci/fetch.ts:208`. У `fmt` `BUSY` нет: `fmt.ts:77` пишет `writeFileSync` |
| `NOT_CANONICAL` | 3 в `validate`, 1 в `validate --files` и `fmt --check` |
| `GENERATED_DRIFT`, `LOCK_MISMATCH` | 3 в `validate`, 1 в `sync --check` (`sync/apply.ts:88`) |
| прочие находки `validate --files` | 1 (`validate.ts:58`), а в полном `validate` — 3 |
| ошибки check в `warrant ci` | код ошибки check (`BUSY` — 2) перекрывает нарушения (`impl.ts:127`); spec обещает 3 |

**Форж** (`adapters/forge-gh.ts`):
- Каждый сбой — `FORGE_UNAVAILABLE`, код 3: auth, сеть, 5xx, лимит, неразборчивый ответ (`:42`, `:179`, `:193`, `:237`, `:242`), неверный `GITHUB_REPOSITORY` (`:218`) и `origin` не на GitHub (`:225`).
- HTTP 404 — `null` по тексту stderr `gh` (`:236`).

**Диапазон pack:**
- `acceptChangedLaw` (`core/ci/base.ts:64-73`) снимает `CONFIG_INVALID` по подстроке `does not satisfy the configured range`.
- Сообщение строит `loadPacks` (`core/packs/loader.ts:496-503`).
- Та же фраза есть в `packs/hash.ts:146` (`LOCK_MISMATCH`) и `openspec/version.ts:37`.

**Архитектура** (`architecture.json`):
- `core/errors.ts` — модуль `core` (rank 0, `direct`); `io` зависит только от `core`.
- `core/controller` — rank 3: `core/errors.ts` его не импортирует.

**Тесты:**
- Около 470 утверждений кода выхода.
- Строгих сравнений `errors` — 263, из них 241 — `toEqual([])`. `retryable` появится только у кодов класса сбоя.

## Goals / Non-Goals

**Goals:**
- Код выхода — функция одних данных: кодов `errors[]` и действия controller или вердикта команды. Места вызова кода не выбирают.
- Повторять можно только код 4.
- Тест держит правило «одна функция»: новое место не сможет снова выбрать код само.

**Non-Goals:** — proposal.

## Decisions

### 1. Решения

| # | Решение |
|---|---|
| D1 | `ERROR_CODES` становится картой «код → класс»: `rule` (1), `wait` (2), `config` (3), `retry` (4). Класс кода — его нынешний код выхода там, где он один; `TOPOLOGY_VIOLATION` в `ci fetch` (3) переходит в `rule` (1), как в `warrant ci`. `rule` — нарушения `warrant ci` (список REQ-KRN-003). `wait` — `GATES_NOT_PASSED`, `POLICY_CONFLICT`. `retry` — `BUSY`, `CHECK_TIMEOUT`, `FORGE_UNAVAILABLE`. Остальные — `config`. Новые коды: `FORGE_ACCESS` (`config`), `PACK_VERSION_RANGE` (`config`) |
| D2 | Одна функция `exitCodeFor(errors, outcome?)` в `core/errors.ts`. `outcome` — `CONTINUE` / `STOP` / `WAIT` / `ESCALATE` или `FAIL` (`analyze`). Тип действия объявлен в `core/errors.ts`: rank 0 не импортирует `controller`, а `controller` переиспользует тип. Приоритет `3 > 1 > 4 > 2 > 0`, пустые `errors` и `CONTINUE` дают 0. `exitCodeOf` из `controller` удаляется; отказ `transition` передаёт действие, а 0 → 2 даёт класс `wait` у `GATES_NOT_PASSED`. `Math.max` и тернарий пяти мест удаляются |
| D3 | Находки `validate`, `validate --files`, `fmt --check`, `sync --check` — код 3 (класс `config`). Код 1 остаётся только у вердиктов о предмете суждения: нарушения PR, `STOP`, находки `analyze`. Потребители `--check` (`warrant.yml`, `scripts/dev/check.js`) проверяют только «не 0» |
| D4 | `CommandResult` несёт `outcome?` вместо `exitCode`; код считает `io/output.ts` одной функцией D2 при построении результата. `failures(errors, data, change?, outcome?)`. `WarrantError` теряет `exitCode`: код — по классу её `code` |
| D5 | Ключ `retryable: true` добавляет построение envelope (`toEnvelope`) элементу `errors[]` с кодом класса `retry`. Это одно место для `cliError`, литералов и `toCliError`. Порядок ключей: `code`, `message`, `path`, `hint`, `retryable` |
| D6 | `warrant ci`, вид impl (review F-1, F-2). Gate `BLOCKED`, у которого хотя бы один элемент `requires_evidence` требует kind, производимый check перехода, завершившимся ошибкой, не даёт `GATE_NOT_PASSED`: verdict — в `data.gates`, причина — ошибка check в `errors[]`. Так код выбирают ошибки `errors[]` без исключения из REQ-KRN-003. Остальные `FAIL`/`BLOCKED` (`ATTESTATION_REQUIRED` по kind другого check) дают `GATE_NOT_PASSED` как прежде; `FAIL`-gate и `SCOPE_VIOLATION` старше сбоя (1 > 4). Gate, `BLOCKED` сразу по двум причинам, даёт 4, а после повтора — честный 1 |
| D7 | `adapters/forge-gh.ts` различает сбой `gh` по stderr и exit — граница внешнего инструмента, единственное место разбора чужого текста (review F-5, F-6, F-7, F-8). HTTP 404 → `null`, как сейчас; репозиторий, невидимый токену, GitHub отдаёт тем же 404, он остаётся «не найден». `FORGE_ACCESS` с `FORGE_HINT`: HTTP 401, HTTP 403 без признака лимита, «not logged in», `gh` не найден (spawn не удался). `FORGE_UNAVAILABLE` с `hint` «повторите»: всё остальное — сеть, таймаут, 5xx, 429 или 403 лимита, неразборчивый ответ (обрезанный, HTML прокси), сбой `gh run download`. Неизвестный сбой по умолчанию — 4: ошибка классификации даёт лишний повтор, но не ложный проход. Истёкший artifact форж помечает `expired` (`forge-gh.ts:98-102`), и он остаётся `EVIDENCE_NOT_VERIFIED` / `skipped[]`. Репозиторий (`GITHUB_REPOSITORY`, `origin`) вычисляется лениво, при первом обращении к форжу, как сейчас; неверный — `USAGE` с `REPOSITORY_HINT` |
| D8 | `loadPacks` пишет `PACK_VERSION_RANGE` (путь `pack.json`) вместо `CONFIG_INVALID` для версии вне диапазона `warrant.json` — во всех командах, загружающих packs (review F-13). `kernel` pack вне версии CLI остаётся `CONFIG_INVALID` (review U-1; R-45 `judge-law` судит его отдельно). `acceptChangedLaw` сверяет `code` и путь изменённого встроенного pack, текст `message` не читает. `packs/hash.ts:146` и `openspec/version.ts:37` своих кодов не меняют |
| D9 | `bin/warrant.ts` первым делом ставит `process.on("uncaughtException" | "unhandledRejection")` (review F-3, F-4; review 2 F-2). Обработчик: в режиме `guard` без `--frontend` — `deny` с reason и hint `warrant validate`, код 0 (REQ-ENF-004); в режиме `guard --frontend`| "unhandledRejection")` (review F-3, F-4). Обработчик: в режиме `guard --frontend` — причина в stderr, пустой stdout, код 2 (fail-closed, REQ-ENF-005); иначе, если результат ещё не выведен, — envelope `INTERNAL` (`command` — из argv, без него `warrant`), стек в stderr, код 3; если выведен — только stderr и код 3. Признак «выведен» ставит `emitToProcess`. Обработчик — экспортируемая функция `bin`, тест зовёт её напрямую (без тестового входа в CLI) |
| D10 | Правило держит meta-тест в `test/unit/meta/`: `EXIT.` и сложение кодов встречаются только в `core/errors.ts`, `io/output.ts` и `bin/warrant.ts` (help/version и протокол `guard --frontend`). Каждый член `ERROR_CODES` имеет класс (тип TS), unit-тест проверяет таблицу приоритета. SCN-KRN-162 — app-тест пяти вызовов |
| D11 | Версии:<br>• CLI `0.10.0` — корневой `package.json`; CHANGELOG `## 0.10.0` (D12);<br>• `.warrant/warrant.json` `kernel: "0.10"`;<br>• pack `core-sdd` 0.4.1, `kernel: ">=0.1 <0.11"` — иначе pack не грузится CLI 0.10;<br>• lock и golden — `warrant sync`, `scripts/golden-update.js`.<br>Тег `v0.10.0` — после archive-PR `code-floor` (ADR-0052 п. 1) |
| D12 | CHANGELOG `## 0.10.0`. «Вердикт»: судья не мягче и не строже, меняются только коды выхода. «Миграция для потребителя»:<br>• код 4 и `retryable` — повторять можно только 4; reusable `warrant.yml` и копия job LATTICE красятся и кодом 4;<br>• `BUSY` 2 → 4, `CHECK_TIMEOUT` и недоступный форж 3 → 4;<br>• `FORGE_ACCESS` вместо `FORGE_UNAVAILABLE` при отказе доступа;<br>• `USAGE` при неверном `GITHUB_REPOSITORY`;<br>• `PACK_VERSION_RANGE`;<br>• `fmt --check`, `sync --check`, `validate --files` 1 → 3;<br>• `INTERNAL` вместо аварийного кода 1;<br>• `kernel: "0.10"` и `warrant sync` (lock несёт `kernel`) — шаги навыка `warrant-upgrade` |

### 2. Альтернативы

- **`Math.max` с кодом 4.** Отвергнуто: 4 перекрыл бы 3, и вызов с поломанной конфигурацией просил бы повтор.
- **Приоритет `2 > 4`.** Отвергнуто: ожидание `verify-incomplete`, вычисленное на gates, ставших `BLOCKED` из-за сбоя check, спрятало бы повторяемый сбой. `CHECK_TIMEOUT` давал бы 4 в `check` и 2 в `verify` — нарушение «один сбой — один код».
- **Расхождения `--check` — класс `rule` (1).** Тогда `validate` с одной находкой `LOCK_MISMATCH` («lock не JSON») давал бы 1. Отвергнуто: граница «правило / конфигурация» прошла бы внутри одного кода. Цена D3 — две лишние delta (REQ-KRN-022, REQ-KRN-025).
- **Код выхода по команде** (как сейчас, с таблицей в документе). Отвергнуто — это A-42: один сбой даёт разные коды, место вызова снова выбирает код.
- **`retryable` на уровне envelope.** Отвергнуто: ADR-0052 п. 2 задаёт признак у элемента `errors[]`, а повторяемость — свойство ошибки.
- **Отдельный код выхода для отказа доступа к форжу.** Отвергнуто: ADR-0052 фиксирует 0…4, а отказ доступа — конфигурация (3).
- **Подвид ошибки диапазона полем элемента.** Отвергнуто: поле расширило бы контракт `errors[]` ради одного случая, а свой код уже различим.
- **Тонкий вход `bin` с динамическим импортом остального CLI** — ловил бы и ошибку загрузки модулей. Отвергнуто: меняет структуру `bin` ради сломанной установки, которую ловит канарейка.

### 3. Порядок

Версии — первой группой: без них `versions:check` красный на любой правке `src`. Затем классы и функция (D1, D2, D4, D5), перевод команд (D3), судья и форж (D6–D8), падение (D9), meta-тест (D10), доки. impl-PR сливает maintainer: пути CLI — класс приёмки (ADR-0051 п. 2).

### 4. Риски

- **Потребитель ждёт 2 у `BUSY`.** Скрипт, повторявший по коду 2, перестанет повторять → миграция в CHANGELOG. LATTICE копирует job — его сессия по навыку `warrant-upgrade`.
- **Классификация вывода `gh` по тексту** (D7). Новая версия `gh` может сменить формат: отказ доступа станет 4, и CI повторит зря. Ложного прохода нет — любой из кодов ненулевой. Contract-тест форжа фиксирует строки нынешнего `gh`.
- **Ошибка загрузки модулей** (битая установка) по-прежнему даёт аварийный выход Node с кодом 1. Канарейка ловит это красным «Install warrant».
- **Приоритет `4 > 2` прячет ожидание.** Открытый blocking UNKNOWN (`WAIT`) при одновременном сбое check даёт 4, а после повтора — 2. Повтор не вредит: следующий код честный.
- **Токен без доступа к репозиторию** получает HTTP 404 (D7): в archive-PR ошибка настройки CI выглядит нарушением PR (`EVIDENCE_NOT_VERIFIED`, `REF_NOT_VERIFIED`, код 1), а не `FORGE_ACCESS`. Принято: GitHub не отличает «нет объекта» от «не видно»; `message` называет объект, `hint` — проверить токен (review 2, F-10).
- **`warrant guard`** (review 2, F-2): решение, в том числе `deny` при сбое и непредвиденном исключении, — код 0 по REQ-ENF-004; обработчик D9 в режиме `guard` без `--frontend` печатает `deny`, а не `INTERNAL`.
- **Около 30 тестов меняют ожидаемый код.** Список — в задачах групп 3–5. Строгие сравнения `errors` с `[]` не затронуты.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-235 | D4 «`outcome?` вместо `exitCode`» — уточнение: `CommandResult` несёт `outcome?` и поле `exitCode`, которое ставят только построители `io/output.ts` (`success`, `failure`, `failures`) значением `exitCodeFor(errors, outcome)`; место вызова кода не передаёт. Поле остаётся: около 470 утверждений тестов читают `result.exitCode`, а код выхода — свойство результата, которое `emit` и `emitToProcess` выводят без повторного вычисления. `retryable` добавляет только `toEnvelope`: в `CommandResult.errors` ключа нет | `io/output.ts`, задача 2.2 |
