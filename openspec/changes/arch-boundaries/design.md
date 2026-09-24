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

**Goals:** ADR-0030 держится тестом; A-1…A-4, A-6, A-7, A-11, A-13, общий guard A-5 сняты; у фазы 4 есть сценарий
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

| Метрика | До (`2026-09-24.json`) | После группы 5 |
|---|---|---|
| Циклы модулей (всего / runtime) | 2 / 1 | |
| Рёбра `commands → commands` (импорты) | 26 | |
| `entry_share` transition / verify / archive | 0,17 / 0,15 / 0,15 | |
| `dups` ≥ 3 файлов | 8 (`isPlainObject` ×22) | |
| fan-in `core/packs/loader.ts` | 21 | |
| Исключений храповика (группа 1 → группа 6) | — | |

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
