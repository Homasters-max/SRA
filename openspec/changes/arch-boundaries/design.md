# Design: arch-boundaries

## Context

Вход — архитектурный аудит [2026-09-24](../../../docs/process/audits/2026-09-24.md) (снимок `2026-09-24.json`) и
решения grilling Q1–Q25 (docs/NEXT-SESSION.md, раздел «arch-boundaries»; Q23–Q25 — по A-10…A-12 и замеру ADR-0029); норма — [ADR-0030](../../../docs/adr/WARRANT-ADR-0030-module-boundaries.md).
Код на входе: 95 файлов `packages/cli/src`, 23 модуля (глубина 2), 84 ребра модулей, циклы `core/canon ↔ core/packs`
(runtime) и `core ↔ core/ports ↔ core/openspec` (только `import type`).

Сверх A-1…A-10 при подготовке spec найдено (ранги Q10 против текущих рёбер, инвентарь перечислений):

- **A-11** — `adapters/openspec-cli.ts → core/openspec/status.ts` (`parseOpenspecStatus`): разбор вывода `openspec`
  лежит в домене, как `parseNameStatus` у git (A-6); типы статусов артефактов нужны порту (`core/ports/openspec.ts`
  импортирует их из `core/openspec` — это и есть A-10).
- **A-12** — `adapters/check-runner.ts → core/check/interrupt.ts` (`onInterrupt`): обработка сигналов общая у адаптера и
  у замка `core/check/lock.ts`.
- **A-13** — перечисления вне владельца, кроме lifecycle: `commands/waive.ts:L50` `RISKS` (уровни риска; владелец —
  `core/resolve/types.ts`, там только тип), `commands/transition.ts:L109` `PASSING` (подмножество verdict'ов; владелец —
  `core/gates/types.ts`); полный список даст реестр группы 1.
- Импорты команда → команда вне конвейера: `classify → transition` (`approvalRoles`, `checkRef`, `FALLBACK_ROLE` — роли,
  A-7), `init → sync` (`runSync`), `gate`/`status → check` (`nextForwardTransition` — A-1).

## Goals / Non-Goals

**Goals:** ADR-0030 держится тестом; A-1…A-4, A-6, A-7, A-10, A-11, A-13, общий guard A-5 сняты; у фазы 4 есть сценарий
`core/transition`; поведение CLI байт в байт прежнее.

**Non-Goals:** типизированные читатели документов (A-5 целиком), A-8, A-9, A-12 — долг с исключениями храповика;
изменения поведения, схем, pack'ов, main specs.

## Decisions

### 1. `architecture.json` (ADR-0030 п. 1, 4, 6)

`packages/cli/test/unit/meta/architecture.json`, JSON с отступом 2, ключи по порядку ниже:

```json
{
  "root": "packages/cli/src",
  "modules": [
    { "id": "core", "path": "core", "direct": true, "rank": 0 },
    { "id": "core/fs", "path": "core/fs", "rank": 0 },
    { "id": "commands", "path": "commands", "layer": "commands" }
  ],
  "layers": {
    "commands": ["rank:*", "io", "version.ts"],
    "io": ["core"],
    "bin": ["commands", "adapters", "core/ports", "core", "io", "version.ts"],
    "adapters": ["core/ports", "core"]
  },
  "no_sibling_imports": { "commands": ["commands/context.ts"] },
  "helpers": [ { "name": "isPlainObject", "owner": "core/json.ts" } ],
  "enums": [ { "id": "change-state", "owner": "core/record/lifecycle.ts", "values": ["PROPOSED", "…", "ABANDONED"] } ],
  "exceptions": [ { "id": "A-4", "rule": "rank", "from": "core/canon/files.ts", "to": "core/packs/loader.ts" } ]
}
```

- **Модуль файла** — самый длинный совпавший `path`; `direct: true` — только файлы прямо в каталоге. Файл без модуля —
  ошибка (новый каталог требует строки). Модуль с `rank` — ядро; с `layer` — внешний слой со списком `layers`
  (`rank:*` — любой модуль с рангом).
- **Правила** (`rule` в исключениях): `module` (файл без модуля), `rank` (импорт модуля более высокого ранга или не из
  списка слоя), `cycle` (цикл модулей; исключение — по списку модулей цикла), `sibling` (команда → команда), `helper`
  (объявление помощника вне владельца: `from` — файл), `enum` (литерал перечисления вне владельца: `from` — файл,
  `enum` — id).
- **Перечисления** (стартовый реестр, группа 1 уточняет): `change-state` (7 вперёд + `ABANDONED`), `transition`
  (`<A>-><B>`), `verdict`, `controller-action`, `risk-level`, `id-prefix`. Значения каждого перечисления встречаются в
  `docs/02-vocabulary.md` или `docs/04-lifecycle.md` — тест сверяет (расхождение со словарём ловится тут же).
- **Помощники** (стартовый реестр): `isPlainObject`, `strings` → `core/json.ts`; `posix`, `reportPath`, `walkFiles` →
  `core/fs.ts`. Локальные одноимённые (`visit`, `add`, `err`) в реестр не входят.

### 2. Мета-тест (ADR-0030 п. 5)

`test/unit/meta/architecture.test.ts`, уровень `unit` (без процессов). Файлы `src` — обходом каталога; импорты —
`ts.preProcessFile(text, true, true).importedFiles` (относительные спецификаторы, `.js` → `.ts`, `index`); `import type`
считается. По одному `it` на правило: сообщение перечисляет нарушения `from → to (rule)`, которых нет в исключениях, и
исключения, которые ничего не прикрывают («stale exception A-N: …»). Литералы перечислений — обход AST
(`ArrayLiteralExpression` и `new Set([...])` со строковыми литералами: ≥ 2 значения одного перечисления вне владельца).
Объявления помощников — `FunctionDeclaration` и `const <имя> = (…) =>` верхнего уровня файла.

### 3. Храповик — стартовые исключения группы 1

Группа 1 пишет тест и заносит **все** нарушения на её коммите; каждое — с ID строки «Архитектурный долг». Ожидаемо:
`sibling` — 12 рёбер (A-2; `classify → transition` — A-7; `init → sync` — A-2); `rank` + `cycle` — A-4
(`canon/files → packs/loader`), A-10 (`ports/openspec → openspec/status`, type), A-6 (`adapters/git-cli → gates/diff`),
A-11, A-12; `helper` — 21 файл `isPlainObject`, 4 `strings`, 4 `posix` (A-5), `reportPath`/`walkFiles` (A-3);
`enum` — A-1 (`check.ts`, `gate.ts`, `ids/immutable.ts`), A-13. Нарушение без строки долга — стоп, вопрос maintainer'у
(новая строка A-N), не молчаливое исключение.

### 4. `core/fs`, `core/json` (группа 2; A-3, A-4, A-5)

`core/fs.ts`: `reportPath`, `walkFiles`, `readJson`, `posix`; `core/json.ts`: `isPlainObject`, `strings`. Все копии
удаляются, импорт — из владельца. `core/packs/loader.ts` оставляет загрузку; `weakenings` — в `core/packs/overrides.ts`.
Цикл `canon ↔ packs` исчезает (у `canon/files.ts` нет импорта `packs`).

### 5. Владелец lifecycle и перечислений (группа 3; A-1, A-13)

`core/record/lifecycle.ts`: `FORWARD_CHAIN`, `CHANGE_STATES`, `FORWARD_TRANSITIONS` (выводится из цепочки),
`nextForwardTransition`, `ABANDONABLE`, `FROZEN_STATES`, `IDS_FROZEN_FROM`, `transitionKind`. `commands/check.ts`
`FORWARD`, `commands/gate.ts` `FORWARD_TRANSITIONS`, `core/ids/immutable.ts` `IDS_FROZEN_FROM` удаляются.
A-13: `RISK_LEVELS` у `core/resolve/types.ts`, `PASSING_VERDICTS` у `core/gates/types.ts`, прочие по реестру.

### 6. `core/git`, `core/waivers`, `core/roles`, разбор в адаптерах (группа 4; A-6, A-7, A-10, A-11)

- `core/git/facts.ts` (R2): `readGitFacts`, `changedPaths`, `currentBranch`, `isAncestor`, `resolveCommit`,
  `mergeCommitOf`, `forkPointOf`, `mergedCommitFacts`, `contractTree`, тип `GitFacts`, `Availability`; в `core/gates/diff.ts`
  остаётся то, что относится к gate (или файл уходит целиком). `parseNameStatus` — в `adapters/git-cli.ts`.
- `core/openspec/status.ts`: типы `ArtifactStatus(es)` — в `core/ports/openspec.ts` (снимает A-10), `parseOpenspecStatus`
  — в `adapters/openspec-cli.ts` (A-11).
- `core/waivers/` (R2): чтение, статус, проверка waiver (`core/validate/waivers.ts`, `core/gates/waivers.ts`);
  `core/roles.ts` (R2): `roleMembers`, `approvalRoles`, `checkRef`, `FALLBACK_ROLE` (из `commands/transition.ts`).

### 7. `core/transition` (группа 5; A-2)

`core/transition/evaluate.ts` (R4): `evaluate(ctx, change, { transition, checks, base, paths, env })` →
`{ loaded, record, policy, run, evaluation }` или отказ конфликта policy; внутри — шаги `verify`/`archive` (§ отчёта A-2).
`resolveRecord`, `conflictDecision`, `decisionFields`, `evaluationFindings`, `projectFacts`, `artifactStatuses`,
`recordVerdicts` — в `core/transition/`; `executeChecks`, `checksForTransition` — в `core/check/`; `storeRecord`,
`manifestVersions` — в `core/evidence/`. `forwardEntry`, `gatesNotPassed(Result)` — в `core/transition/`. Команды:
`verify`, `archive`, `gate`, `status`, `transition` зовут `evaluate` или его шаги; `init` зовёт применение sync из
`core/sync` (выносится из `runSync`). После группы исключений `sibling` нет.

### 8. Поведение не меняется (Q17)

Существующие тесты `app`/`contract`/`e2e` и golden — без правок, кроме путей импорта (и имён, если функция переехала в
модуль-владелец). Правка ожидаемого значения — остановка и строка I-N. Новые тесты: `architecture.test.ts` (плюс
самопроверка: временное нарушение каждого правила роняет тест — в I-N записать, как проверено) и `app`-тест
`core/transition/evaluate` через `ctx` (конфликт policy, успешный переход, отказ gate). Перенос символа — по списку
`cs impact <символ>` (граф не видит вызовов через порты, ADR-0029): каждое место учтено или отмечено.

### 9. Процесс

- impl-PR — ветка `worktree/arch-boundaries`, worktree `D:\project\SRA-arch-boundaries-impl`; первым коммитом
  `transition APPROVED --ref <spec-PR> --by Homasters-max` + `IMPLEMENTING`, группы 1–6 по коммиту, последним — `VERIFYING`.
- Группы — по одному субагенту ([coordinator.md](../../../docs/process/coordinator.md)); после группы — `/group-done`, затем
  `/group-stats`: **группы 1–3 — замер ADR-0029 п. 8** (сравнение с базой `test-levels` `[A]`); решение о `PreToolUse deny` —
  после этого замера, отдельным process-PR (не внутри change).
- Снимок архитектуры после группы 5: `node scripts/dev/arch-snapshot.js --against docs/process/audits/2026-09-24.json` —
  разница в §10 (ожидается: циклов runtime 0, рёбер `commands → commands` нет, `entry_share` transition/verify/archive < 0,15).

### 10. Снимок до и после

| Метрика | До (`2026-09-24.json`) | После группы 5 (`arch-snapshot.js --against`, рабочее дерево группы 5 на `b93d1be`) |
|---|---|---|
| Циклы модулей (всего / runtime) | 2 / 1 | 0 / 0 |
| Рёбра `commands → commands` (импорты) | 26 | 14 — все на `commands/context.ts` (из 26 «до» 14 тоже на него); команда → команда: 12 → 0 |
| `entry_share` transition / verify / archive | 0,17 / 0,15 / 0,15 | 0,05 / 0,17 / 0,04 по снимку; срезы `runVerify` (12 символов), `runArchive` (54), `runGate` (9) обрезаны: граф `cs` теряет вызов `evaluate` (одноимённая локальная функция в `test/unit/gates/verdict.test.ts`, I-147). С временным переименованием её в рабочей копии (откат, тест не менялся): 0,05 / 0,01 / 0,01 (`runGate` 0,01; символов 196 / 190 / 199) |
| `dups` ≥ 3 файлов | 8 (`isPlainObject` ×22) | 5 (`visit` ×5, `err` ×4, `add`, `constructor`, `run` ×3) |
| fan-in `core/packs/loader.ts` | 21 | 15 (`src` 11, тесты 4) |
| Исключений храповика (группа 1 → группа 6) | группа 1: 65 — `rank` 5, `cycle` 2, `sibling` 12, `helper` 32, `enum` 14; группа 2: 31 — `rank` 4, `cycle` 1, `sibling` 12, `helper` 0, `enum` 14; группа 3: 15 — `rank` 4, `cycle` 1, `sibling` 10, `helper` 0, `enum` 0; группа 4: 10 — `rank` 1, `cycle` 0, `sibling` 9, `helper` 0, `enum` 0; группа 5: 1 — `rank` 1 (A-12), `cycle` 0, `sibling` 0, `helper` 0, `enum` 0; группа 6: 1 — `rank` A-12 = открытые A-N с правилом: A-8 (`findChangeDir` в `core/init`) правил не нарушает — рёбра `core/ids → core/init` (R1 → R1), `core/status → core/init` (R3 → R1), `core/transition → core/init` (R4 → R1) и `commands → core/init` разрешены `rank`/слоем, цикла нет (`core/init` импортирует только `core`, `core/packs`), A-9 (последовательность проверок `validate`) ни одним правилом теста не проверяется, остаток A-5 — вне реестра `helper` | |

## Risks / Trade-offs

- **Большой перенос в группе 5** — много файлов команд сразу. Смягчение: шаги сценария сначала переезжают без смены
  сигнатур (группа 4 и первая половина 5), потом команды переводятся по одной; golden ловит расхождение вывода.
- **Реестр перечислений даёт ложные срабатывания** на законных подмножествах вне владельца. Ответ ADR-0030: подмножество —
  у владельца; если это неудобно в конкретном месте — вопрос maintainer'у, не исключение без A-N.
- **Имя владельца lifecycle** (`core/record/lifecycle.ts`) — R1; если `core/ids` (R1) и `core/status` (R3) импортируют его —
  ранги позволяют.
- **Храповик разрастается** — нет: исключения только с A-N, ненужное роняет тест.

## Решения по ходу реализации

Нумерация с I-140 (`/decision`).

| # | Решение | Где |
|---|---|---|
| I-140 | Самопроверка `architecture.test.ts` (1.3): временные правки, прогон `--project unit`, откат копиями файлов (итог: `git status` без изменений `src`). Нарушение на каждое правило: `module` — новый `src/core/tmpmod/x.ts`; `rank` — многострочный `import type { … } from "../status/stale.js"` в `core/record/read.ts` (R1 → R3); `cycle` — `import type` из `core/controller/inputs.js` в `core/gates/types.ts` (цикл `core/controller ↔ core/gates` одного ранга, без нарушения `rank`); `sibling` — `export { runStub } from "./stub.js"` в `commands/fmt.ts`; `helper` — `const walkFiles = () => []` в `core/secrets.ts`; `enum` — `new Set(["PASS", "FAIL"])` в `core/ctx.ts`; храповик — лишнее исключение `rank` A-4 (`core/canon/hash.ts → core/packs/loader.ts`) и исключение с ID `A-99`. Упали все шесть `it` правил и `it` исключений с ожидаемыми строками («stale exception A-4 …», «A-99: not a row …»); тест процессов не порождает (уровень `unit`) | `test/unit/meta/architecture.test.ts`, задача 1.3 |
| I-141 | Реестры `architecture.json` (1.2): у перечисления поле `doc` — документ словаря, где тест ищет каждое значение (`` `V` ``; переход `A->B` — как `A → B`): `change-state`, `verdict`, `controller-action`, `id-prefix` — 02, `transition` — 04, `risk-level` — **05** (`LOW`/`HIGH` нет ни в 02, ни в 04; уровни — таблица «Risk overlays» 05) — отклонение от §1 «02 или 04». Владельцы: `change-state`, `transition` — `core/record/lifecycle.ts` (§1, файла ещё нет — все копии исключения A-1); `verdict` — `core/gates/types.ts`; `controller-action` — `core/controller/evaluate.ts` (тип `ControllerAction`); `risk-level` — `core/resolve/types.ts`; `id-prefix` — `core/ids/scan.ts` (`SPEC_LEVEL_PREFIXES`; `allocate.ts` импортирует `scan.ts`, обратный владелец дал бы цикл файлов), `ULID_PREFIXES` в `allocate.ts` — исключение A-13. Список перечислений — ровно ADR-0030 п. 4; `evidence_status` (`COUNTING_STATUSES` в `core/gates/l0/evidence-complete.ts`) и `waiver_state` (`MOVES` в `commands/waive.ts`) не внесены — решение maintainer'а. Помощники — ровно §1; `readJson` (копии в `core/packs/loader.ts`, `core/sync/plan.ts`) вносит группа 2 вместе с `core/fs.ts` | `test/unit/meta/architecture.json`, задача 1.2 |
| I-142 | Семантика теста (1.3, 1.4): `path` модуля — каталог или файл (`version.ts`; так же ляжет `core/fs.ts` группы 2), модуль файла — самый длинный совпавший `path`; импорты — `ts.preProcessFile` с `.js` → `.ts`, `<spec>.ts`, `<spec>/index.ts`, относительный импорт мимо файлов `src` (кроме `.json`) — падение; цикл — сильно связная компонента ≥ 2 модулей, исключение `cycle` — `modules` в любом порядке; поля исключений `helper` — `helper` (имя), `enum` — `enum` (id); ID исключения обязан быть строкой `\| A-N \|` таблицы «Архитектурный долг» NEXT-SESSION. Рёбра `sibling` `gate → check` и `status → check` (только `nextForwardTransition`) — A-1, а не A-2 (design Context; уйдут с группой 3). Bump 0.4.2 (1.1) — ещё `package-lock.json`, `.warrant/warrant.lock.json` и `warrant.lock.json` трёх golden-фикстур (как в `8f590dc`); `packages/cli/package.json` версии не содержит | `test/unit/meta/architecture.test.ts`, `package.json`, задачи 1.1, 1.3, 1.4 |
| I-143 | A-1 расширен подмножествами состояний lifecycle вне владельца — решение maintainer'а: `APPROVABLE_STATES` (`commands/classify.ts`), `LINKABLE_STATES` (`commands/link.ts`), `REF_REQUIRED` (`commands/transition.ts`), `IMMUTABLE_STATES` (`core/ids/renumber.ts`), `amends` (`core/validate/links.ts`) — исключения `enum` `change-state` с A-1 (итого 65); строка A-1 в NEXT-SESSION дополнена; группа 3 (§5) переносит их к владельцу `core/record/lifecycle.ts` вместе с цепочкой | `test/unit/meta/architecture.json`, `docs/NEXT-SESSION.md`, задача 1.4 |
| I-144 | Группа 2 (2.1, 2.2): модули `core/fs` и `core/json` — строки-файлы (`path` `core/fs.ts`, `core/json.ts`, R0, как `version.ts` в I-142); владелец `readJson` — копия `core/packs/loader.ts` (`cannot read file: …` / `invalid JSON: …`); копия `core/sync/plan.ts` пишет одно сообщение `cannot read <path>: …` и на нечитаемый, и на битый JSON — замена изменила бы `errors[].message` `sync`/`validate`, поэтому она осталась локальной под именем `readJsonCombinedError` (отклонение от §4 «все копии удаляются»). Остальные копии сверены: 21 `isPlainObject`, 4 `strings`, 4 `posix`, `reportPath`, `walkFiles` — тела совпадают с владельцем; у 4 копий `isPlainObject` другой тип guard'а (`value is JsonObject` в `canon/order-keys.ts`, `schemas/loader.ts`, `schemas/semantic.ts`, `value is YamlObject` в `openspec/yaml-emit.ts`) — владелец даёт `Record<string, unknown>`, typecheck зелёный без приведений. `asStringArray` (`loader.ts`, тело `strings`) заменён на `strings` (нужен и `loader.ts`, и `overrides.ts`); функции с телом `strings` под другими именами (`stringArray` и тело `providedList` в `sync/plan.ts`, `stringsOf` в `commands/link.ts`, `stringList` в `sync/rules.ts`, `targetsOf` в `validate/links.ts`) не тронуты — вне реестра, тест их не ловит (кандидаты A-5). Копии в тестах (`isPlainObject` в `test/unit/schemas/descriptions.test.ts`, `posix` в `architecture.test.ts`, `readJson` в 6 тестах) оставлены: правило `helper` — только `src`, тесты правятся лишь в путях импорта (`secrets.test.ts`, `packs/loader.test.ts`). `cs deps --level 2` относит `core/fs.ts`, `core/json.ts` к модулю `core` (каталог), тест — к своим модулям; цикла `canon ↔ packs` нет в обоих. Исключений храповика 65 → 31: сняты `helper` 32 (A-5 ×30, A-3 ×2), `rank` A-4, `cycle` A-4 | `core/fs.ts`, `core/json.ts`, `core/packs/overrides.ts`, `core/sync/plan.ts`, `test/unit/meta/architecture.json`, задачи 2.1, 2.2 |
| I-145 | Группа 3 (3.1, 3.2): `core/record/lifecycle.ts` — из `core/record/write.ts` переехали `FORWARD_CHAIN`, `CHANGE_STATES`, `ChangeState`, `BACKWARD_TRANSITIONS`, `ABANDONABLE`, `FROZEN_STATES`, `isChangeState`, `isFrozen`, `transitionKind`, `TransitionKind` (сверх списка §5 — `BACKWARD_TRANSITIONS`, `isFrozen` нужны `transitionKind`, `isChangeState` — `commands/transition.ts`); из `commands/check.ts` — `nextForwardTransition`, из `core/ids/immutable.ts` — `IDS_FROZEN_FROM`; `FORWARD_TRANSITIONS` выводится из цепочки (`commands/gate.ts` — единственный потребитель). В `write.ts` осталась запись (`assertNotFrozen` импортирует `isFrozen`). Подмножества I-143 — константы владельца по смыслу: `BELOW_FLOOR_APPROVABLE_STATES` (`APPROVABLE_STATES` в `classify.ts`), `LINKABLE_STATES`, `REF_REQUIRED_STATES` (`REF_REQUIRED` в `transition.ts`), `RENUMBER_FROZEN_STATES` (`IMMUTABLE_STATES` в `ids/renumber.ts`; переименовано, чтобы не путать с `IDS_FROZEN_FROM`), `AMENDS_TARGET_STATES` (`TARGET_STATES.amends` в `validate/links.ts`; `supersedes: ["ABANDONED"]` — одно значение, остался на месте). Сверка копий: `FORWARD` (`check.ts`) = `FORWARD_CHAIN` (`write.ts`) — те же значения и порядок; `FORWARD_TRANSITIONS` из цепочки — те же 6 значений в том же порядке (сообщение `USAGE` `--transition … is not one of: …` прежнее), тип — `readonly string[]` вместо кортежа литералов (приведение в `gate.ts` снято). Совпадающие по значениям подмножества разного смысла (`PROPOSED`/`SPECIFIED` у classify и link; `MERGED`/`ARCHIVED` у renumber и amends) — отдельные константы; `Set` остался `Set`, массив — массивом, порядок прежний (`MERGED or ARCHIVED` в сообщении check (10)); изменяемые `string[]` стали `readonly ChangeState[]` / `readonly RiskLevel[]` с `as readonly string[]` у `.includes` (как `ABANDONABLE` в `transitionKind`). A-13: `PASSING` → `PASSING_VERDICTS`, `NOT_CONTINUABLE` → `NOT_CONTINUABLE_VERDICTS` (тип `ReadonlySet<unknown>` сохранён: `gate_verdict` — `Verdict | null`) в `core/gates/types.ts` — импорт `core/controller → core/gates` стал runtime (был `import type`; ранг R3 оба, цикла нет); `RISKS` → `RISK_LEVELS` в `core/resolve/types.ts` (`waive.ts` импортирует из `types.ts`; порядок `LOW, MEDIUM, HIGH` в сообщении `--risk` прежний); `ULID_PREFIXES` → `core/ids/scan.ts` (`isUlidPrefix` остался в `allocate.ts`). Тесты — только путь импорта в `test/unit/record/write.test.ts`. Исключений храповика 31 → 15: сняты `enum` 14 (A-1 ×10, A-13 ×4), `sibling` A-1 ×2 (`gate`/`status` → `check` ради `nextForwardTransition`) | `core/record/lifecycle.ts`, `core/record/write.ts`, `core/gates/types.ts`, `core/resolve/types.ts`, `core/ids/scan.ts`, `test/unit/meta/architecture.json`, задачи 3.1, 3.2 |
| I-146 | Группа 4 (4.1–4.3). **4.1:** `core/gates/diff.ts` ушёл в `core/git/facts.ts` целиком (`git mv`): всё в нём — git-факты, к gate не относится ничего; сверх списка §6 переехали `BASE_BRANCH` (его зовёт и gate `branch-isolated`), `GitCtx`, `relativeToProject`, `projectPrefix`, `parentsOf`, `notMergedHeadReason` (зовёт `transition`) и реэкспорт `BlobTree`/`DiffEntry`/`DiffStatus`; `core/gates/types.ts` реэкспортирует `Availability`, `BlobTree`, `DiffEntry` из `core/git` (R3 → R2). `parseNameStatus` → `adapters/git-cli.ts` (экспорт — для unit-теста). **4.2:** `ARTIFACT_STATUSES`, `ArtifactStatus`, `ArtifactStatuses`, `OpenspecStatusResult` → `core/ports/openspec.ts` (константа рядом с выводимым из неё типом); `parseOpenspecStatus`, `isArtifactStatus` → `adapters/openspec-cli.ts` (бросает `OPENSPEC_FAILED` как раньше, `status` адаптера ловит — ответ порта прежний); `core/openspec/status.ts` удалён. **Фейки:** `FakeGit`/`FakeOpenSpec` разбор не зовут (`FakeOpenSpec` брал из `core/openspec/status.ts` только типы) — поменялся лишь путь импорта типов на `core/ports/openspec.ts`, импорта `src/adapters` в фейках нет. Unit-тесты разбора (`unit/gates/scope.test.ts`, `unit/openspec/status.test.ts`) импортируют `parseNameStatus`/`parseOpenspecStatus` из `src/adapters/*`: импорт модуля адаптера процесса не порождает (`forbid-spawn` подменяет `cross-spawn`/`node:child_process`, вызова нет), уровень тестов прежний. **4.3:** `core/waivers/` — `read.ts` (`WAIVERS_DIR`, `readWaivers`), `status.ts` (`waiverStatus` и типы из `core/gates/waivers.ts`; `approverLogin` из `core/gates/prefilter.ts` — иначе `core/waivers` (R2) импортировал бы `core/gates` (R3)), `check.ts` (`checkWaivers`, `WaiverCheck` — проверка (11) `validate`); `core/validate/waivers.ts`, `core/gates/waivers.ts` удалены. `isWaiverInForce`, `activeWaiverIds` остались в `prefilter.ts`: строят `activeWaivers` контекста pre-filter по `WaiverInput` (вход движка gates). `core/roles.ts`: `roleMembers`, `approvalRoles`, `checkRef`, `FALLBACK_ROLE` и `WAIVER_ROLE` (из `commands/waive.ts`); `classify` импортирует их из `core/roles`, не из `transition`. `approvalRoles` принимает структурный `ApprovalsOf` (`approvals: { role, at }[]`) вместо `EffectivePolicy`: `cs deps --level 2` относит `core/roles.ts` к модулю `core` (как `core/fs.ts`, I-144), и `import type` из `core/resolve` дал бы в графе `cs` цикл `core ↔ core/resolve` (тест его не видит — там `core/roles` свой модуль); `EffectivePolicy` подходит структурно, вызовы прежние. **Итог:** модули `core/git`, `core/waivers` (каталоги), `core/roles` (`core/roles.ts`), R2. Исключений храповика 15 → 10: сняты `rank` A-6, A-11, A-10, `cycle` A-10, `sibling` A-7; A-12 не тронут (Q24). `cs deps packages/cli/src --level 2 --cycles` — 0 циклов. Срезы `arch-snapshot.js --entries runTransition,runStatus` (без `--out`, файл не писался): `runTransition` — `core/validate` 0 символов (было 3), `runStatus` — 4 (`rulesSummary`, `backLinks`, `sort`, `targetsOf`: правила и ссылки, не waivers; было 6). Тела функций перенесены без правок; тесты — только пути импорта (`contract/gates/diff-prefix`, `unit/gates/scope`, `unit/openspec/status`, `app/helpers/fakes/openspec`). `scripts/dev/bench/code-search.json` (эталон бенчмарка ADR-0028) ссылается на старые пути — не тронут | `core/git/facts.ts`, `core/waivers/`, `core/roles.ts`, `core/ports/openspec.ts`, `adapters/git-cli.ts`, `adapters/openspec-cli.ts`, `test/unit/meta/architecture.json`, задачи 4.1, 4.2, 4.3 |
| I-147 | Группа 5 (5.1–5.4). **5.1 — раскладка:** `core/transition/facts.ts` (`idFindings`, `artifactStatuses`, `ProjectFacts`, `projectFacts`, `contractTrees`), `policy.ts` (`transitionOf`, `Resolved`, `resolveRecord`, `conflictDecision`, `checkedIds` — стал экспортом), `gates.ts` (`gateDefinitions`, `policyPaths`, `Evaluation`, `EvaluateParams`, `evaluateTransition`, `decisionFields`, `recordVerdicts`, `evaluationFindings`, `gateData`), `outcome.ts` (`RECORDED_BY`, `gatesNotPassed`, `evidenceOf`, `forwardEntry`); `core/check/execute.ts` (`checksForTransition`, `executeChecks`, `ChecksRun`, `ChecksParams` и их помощники `effectiveCheck`, `runOne`, `notConfigured`, `DEFAULT_TIMEOUT_S`); `core/evidence/write.ts` (`storeRecord`, `StoreParams`, `manifestVersions`, `manifestOpenspecVersion`, `readLock`) — новый файл, а не `store.ts`, чтобы `store.ts` остался без импортов. Сверх списка §7 — то, что зовут перенесённые функции или ≥ 2 команды. Тела без правок, сигнатуры прежние, **кроме** `gatesNotPassedResult`: он строил `CommandResult` через `failures` из `io/output`, а `core/transition` (R4) → `io` — нарушение `rank`; вместо него `gatesNotPassedRefusal(evaluation, failed) → { error, exitCode }`, `archive` и `transition` оборачивают в `failures(...)` сами (те же `errors[]`, код, `data`). **5.2 — `core/transition/evaluate.ts`:** `prepare(ctx, change, opts)` — `loadPacks` → запись (`opts.record` или `readChangeRecord`) → `transitionOf` → `resolveRecord` → `checkedIds(opts.gates)` → `--paths` (USAGE на пустой), отказ `Refusal`: `{ conflict: false, errors }` (exit 3) или `{ conflict: true, error, transition, decision }` (exit 2); `judgeGates(ctx, change, prepared, git, run)` — `projectFacts` → `artifactStatuses` → `evaluateTransition` (`only`; `checkFailures` только при `run`) → `recordVerdicts`; `evaluate(ctx, change, { transition, checks, base, paths, env, record?, gates? })` = `prepare` → `readGitFacts(base)` → `executeChecks(opts.checks(loaded, policy, transition))`, если `checks` задан → `judgeGates` → `{ ok, loaded, record, policy, run, evaluation }` (перегрузка: с `checks` — `run: ChecksRun`). **Различия команд — опциями, не сведением:** `gate` — без checks (`checkFailures` не ставится, а не `[]`), `gates: ids`, `--base`; `verify` — `checks: checksForTransition`, `--paths`, `--base`; `archive` — запись и проверки состояния/каталога до pack'ов (`record`), переход `MERGED->ARCHIVED` (через `transitionOf` проходит как есть), `checks: archiveChecks` (+ `openspec-validate`, сортировка; в `commands/archive.ts`), base по умолчанию; затем свои `gatesNotPassed` → отказ / `openspec archive` / `forwardEntry`; `transition` — `prepare` (с `record`), свои git-факты (`MERGED`: `mergedCommit` + `mergedCommitFacts`, иначе `readGitFacts`) и `human-approval` до gates, потом `judgeGates(…, undefined)`; `status` — шаги без записи (свой `resolveForProject`, общие факты на все Changes, artifacts с предупреждениями), не менялся. `data` отказа конфликта собирает команда, как раньше (`verify`/`archive` — с `checks: []`). Порядок вызовов портов прежний (git-факты → checks → `projectFacts` → `artifactStatuses`). **init/sync:** `core/sync/apply.ts` — `applySync(ctx, check) → SyncOutcome { ok, data, errors, exitCode }` (с `driftCode`, `payload`); `runSync` = `requireConfigPath` + `applySync` + `CommandResult`; `init` зовёт `requireConfigPath` + `applySync(ctx, false)`, как делал `runSync`. **Имена и граф `cs`:** `judge` → `judgeGates`, помощники sync — `syncFailed`/`syncDone`: одноимённые `judge` (`scripts/dev/graft-metrics-lib.js`) и `refused` (`test/unit/dev/cs.test.ts`) сделали бы вызовы из другого файла невидимыми графу. `evaluate` (имя из ADR-0030 п. 3) совпадает с локальной функцией `test/unit/gates/verdict.test.ts:L100` — граф теряет вызовы `evaluate` из `gate`/`verify`/`archive`, срезы `arch-snapshot` этих входов обрезаны (§10, цифры с временным переименованием в рабочей копии); тест не переименован (существующие тесты — только пути импорта). **5.3:** `test/app/transition/evaluate.test.ts` — конфликт (fixture-pack'и `policy` + `policy-conflict` через `WARRANT_PACKS_DIR`, как `status.test.ts`; у fixture нет правил контроллера — проектное `.warrant/local/controller/rules.json` с правилом `policy-conflict` core-sdd → `ESCALATE`), успех с checks и вердиктами в manifest, отказ gate (`GATES_NOT_PASSED`, exit 2), оценка без checks. Существующие тесты не менялись. Исключений храповика 10 → 1: сняты `sibling` A-2 ×9; A-12 не тронут (Q24) | `core/transition/`, `core/check/execute.ts`, `core/evidence/write.ts`, `core/sync/apply.ts`, `commands/{gate,verify,archive,transition,status,check,sync,init}.ts`, `test/unit/meta/architecture.json`, `test/app/transition/evaluate.test.ts`, задачи 5.1–5.4 |
