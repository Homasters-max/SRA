# Архитектурный аудит `packages/cli/src` — 2026-09-25, после `core-seams`

Метод — навык [architecture-audit](../../../.claude/skills/architecture-audit/SKILL.md). Базовый коммит — `3f7fe5f` (`main`, CLI 0.4.3, `core-seams` закрыт). Снимок — [2026-09-25-core-seams.json](2026-09-25-core-seams.json), разница — с [2026-09-25.json](2026-09-25.json) (`2824f34`): между ними только Change `core-seams` (37 файлов `src`, план §5 [прошлого отчёта](2026-09-25.md)). Аудит — вход spec-PR Change 4a (`docs/handoff/phase-4.md`). Второй аудит того же дня — имя с темой; `hygiene.js` берёт последним `<дата>-<тема>.json`.

## 1. Область и заявленная архитектура

111 файлов `.ts` в `src`, 424 импорта, 26 модулей (глубина 2), 114 рёбер модулей. Тесты — облегчённо (§3.1, A-21).

Норма: [ADR-0025](../../adr/WARRANT-ADR-0025-test-levels.md), [ADR-0030](../../adr/WARRANT-ADR-0030-module-boundaries.md) (ранги, слои, реестры помощников и перечислений, храповик в `test/unit/meta/architecture.json`), [ADR-0035](../../adr/WARRANT-ADR-0035-ratchet-external-packages.md) (реестр внешних пакетов, помощники тестов). Держится тестами `architecture.test.ts` — не перепроверялось (§4). Ближайшая работа — Change 4a ([ADR-0034](../../adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6): `guard`, `run`, `validate --files`, `sync` → `.claude/settings.json` и `AGENTS.md`, `hint`.

## 2. Карта

### Разница со снимком 2026-09-25

- Новые файлы-модули ранга 0: `core/config.ts` (A-15), `core/glob.ts` (A-16); `core/git/paths.ts`, `core/openspec/changes.ts` (A-8), `core/waivers/status.ts` пополнился `countingWaiverIds` (A-14).
- Ушли рёбра `core/ids → core/init`, `core/ids → core/packs`, `core/status → core/init`, `core/transition → core/init` (`findChangeDir` переехал в `core/openspec`); `commands → core/init` 4 → 1.
- `cs dups`: `err` ×4 ушёл (A-17).
- **`+ cycle core ↔ core/schemas` — ложный.** `cs deps --level 2` считает `core/config.ts` частью `core`; `core/config.ts → core/schemas/semantic.ts → core/json.ts` — три разных модуля ранга 0 в `architecture.json`, цикла нет (держится `architecture.test.ts`). Это I-146, проявившийся в разнице снимков (§3.3).
- Срезы `runVerify`, `runGate`, `runArchive` посчитаны полностью (205–215 символов, `evaluate` в `recovered`): улучшение 3 прошлого аудита сделано.

### Модули (снимок)

| Модуль | Файлов | Ca | Ce | I | cohesion | Замечание |
|---|---|---|---|---|---|---|
| `commands` | 17 | 1 | 23 | 0,96 | 0,08 | слой приложения |
| `core` (errors, ctx, fs, json, roles, secrets, config, glob) | 8 | 22 | 2 | 0,08 | 0,58 | стабильный лист; `→ core/schemas` — от `config.ts` |
| `core/transition` | 5 | 1 | 14 | 0,93 | 0,11 | use case, ранг 4 |
| `core/gates` | 13 | 3 | 5 | 0,63 | 0,55 | |
| `core/packs` | 4 | 10 | 4 | 0,29 | 0,23 | `loader.ts` 590 строк (было 621) |
| `core/sync` | 3 | 1 | 6 | 0,86 | 0,10 | `plan.ts` 474 строки, `planSync` 164 — 4a добавляет цели (§3.4) |
| `core/git` | 2 | 4 | 3 | 0,43 | 0,14 | |
| `core/openspec` | 3 | 6 | 2 | 0,25 | 0 | |
| `core/validate` | 4 | 1 | 5 | 0,83 | 0 | набор независимых проверок — норма |

Остальные — в снимке. Fan-out ≥ 15 — `bin/warrant.ts` (точка сборки) и `core/check/execute.ts`, как прежде.

### Вертикальные срезы

| Сценарий | Символов | Модулей | В `commands/` | Порты | Было |
|---|---|---|---|---|---|
| `runArchive` | 215 | 17 | 1 % | 13 методов | 198* / 18* |
| `runTransition` | 210 | 17 | 4 % | 15 методов | 196 / 18 |
| `runVerify` | 206 | 17 | 1 % | 12 | 189* / 18* |
| `runGate` | 205 | 17 | 1 % | 12 | 188* / 18* |
| `runValidate` | 158 | 12 | 1 % | 6 | 158 / 13 |
| `runStatus` | 136 | 17 | 2 % | 3 | 118 / 17 |
| `runCheck` | 130 | 12 | 2 % | 6 | 116 / 12 |
| `runClassify` | 123 | 10 | **7 %** | 2 | 95 / 9, 11 % |

`*` — досчитано вручную в прошлом аудите. Рост символов — новые помощники-владельцы (`toProjectPaths`, `pathMatcher`, `cliError`, доступ `WarrantConfig`) в стволе; доля `runClassify` упала: `changedFromGit` ушёл в `core/git`.

## 3. Находки

### 3.1 Новые

| A-N | Проблема | Локация | Тип | Приоритет | Гипотеза | Исправление (цена) |
|---|---|---|---|---|---|---|
| A-20 | «Абсолютный путь → путь проекта или вне проекта» — владелец `reportPath` и 4 локальные копии с разной семантикой; отрезание git-префикса — копия мимо `toProjectPaths` | `core/fs.ts:L18-L22` `reportPath`; `core/evidence/store.ts:L44-L47` `projectUri`; `core/sync/plan.ts:L273-L277` `inside`; `core/check/execute.ts:L128-L129`; `commands/resolve.ts:L34`; `core/ids/immutable.ts:L160-L174` (префикс) | cohesion (размазанный инвариант) | **P1** | Владелец не отвечает на вопрос: `reportPath` всегда возвращает строку (абсолютную вне проекта), «вне» выразить нельзя — каждая группа фазы 3 писала своё (`2355975`, `3384921`); A-16 искал только форму `prefix.length + 1` | `projectPath(root, absolute): string \| undefined` в `core/fs.ts`, в реестр помощников; `reportPath`, `projectUri`, `inside`, `execute`, `resolve` — через него; `immutable.ts` — через `toProjectPaths` (S). До `guard` |
| A-21 | Помощники тестов: `validate(p)` ×5 и `validateErrors(p)` ×5 — одно тело `invoke(() => runValidate(p.ctx))`, `codes` ×2 | `test/app/commands/{init,sync,validate,validate-ids-head,validate-verification}.test.ts` (`validate`), `{check,gate,link,transition,waive}.test.ts` (`validateErrors`); `cs dups --in packages/cli/test` | аномалия (копипаст, тесты) | P2 | Нет помощника команд уровня `app` рядом с `invoke.ts`; реестр `test_helpers` (ADR-0035) держит только `write` и `git` | Помощник в `test/app/helpers/`, строки `test_helpers` (S) — в группе реестра проверок `validate` (A-9) |
| A-22 | NUL-байты в исходнике: git считает файл двоичным, diff в PR не виден, `grep` файл пропускает | `core/schemas/loader.ts:L229` (`dedupeErrors`, ключ дедупликации) | аномалия (форма исходника) | P2 | Литеральный NUL в шаблонной строке с фазы 1 (`46c8013`); проверки текста исходников нет | Экранирование в строке и мета-тест «файлы `src` / `test` без NUL» (S), первой группой 4a |

### P1 и P2 — доказательства

**A-20.** `grep "path.relative("` по `src` — 9 мест; 5 из них решают «лежит ли файл в проекте»:

| Место | Корень проекта (`rel === ""`) | Другой диск (`isAbsolute(rel)`) | Вне проекта |
|---|---|---|---|
| `reportPath` | `""` | учтён | абсолютный путь |
| `projectUri` | вне | учтён | `file://` URI |
| `inside` (`sync/plan.ts`) | вне | учтён | `undefined` |
| `check/execute.ts:L128` | `""` | учтён | абсолютный путь |
| `commands/resolve.ts:L34` | `""` | не проверяется (результат совпал: `relative` вернул абсолютный путь) | абсолютный путь |

Общая ошибка всех копий — `startsWith("..")`: каталог `..cache` внутри проекта считается внешним. `immutable.ts` режет `${project}/` сам, хотя `toProjectPaths` — владелец (I-100, A-16); храповик копию не ловит — это не именованный помощник. 4a: `guard` получает путь события (абсолютный или от `cwd`) и сверяет путь проекта с `write_scope`, `rules[].paths`, `guard_prefixes` — без владельца это шестая копия на пути решения `deny`.

**A-21.** `cs dups --in packages/cli/test`: `validate` ×6 (5 — одно тело, `helpers/synced.ts#validate` — e2e через `runCli`, другое), `validateErrors` ×5, `codes` ×3. 4a добавляет `validate --files`, `FRONTEND_HOOKS_INACTIVE`, сверку `.claude/settings.json` и `AGENTS.md` — каждая новая сцена `app` получит свою копию.

**A-22.** `git diff --stat 2824f34 3f7fe5f`: `core/schemas/loader.ts | Bin 9070 -> 9481 bytes` — правка группы 1 `core-seams` (`createAjv`) прошла ревью impl-PR без видимого diff; `git grep -I` находит 110 из 111 файлов `src`. 4a добавляет схемы `run/1` рядом (`core/schemas/`).

### 3.2 Открытые A-N — перепроверка

| A-N | Было | Сейчас |
|---|---|---|
| A-5 | 83 обращения `json["…"]` в 19 файлах | 88 в 21: `core/config.ts` 6 (владелец конфига), `core/waivers/status.ts` 2; `verdict.ts` 12 → 10, `prefilter.ts` 2 → 1. Не в фазе 4 (ADR-0034 п. 6) |
| A-9 | 13 проверок вручную, `commands/validate.ts:L121-L216` | без изменений; P2, 4a первой группой |
| A-12 | исключение `rank` в храповике | без изменений; 4a — с портом `guard` |
| A-19 | копии проверки диапазона версии | без изменений |

Закрытые A-8, A-14…A-18 не вернулись: `config["` в `src` — 0 вне `core/config.ts`, `dot: true` — только `core/glob.ts`, `isWaiverInForce` / `activeWaiverIds` — нет, `err` — нет, `git` в тестах — только `helpers/git.ts` и методы классов контракта. Закрытые ранее A-1…A-4, A-6, A-7, A-10, A-11, A-13 держит храповик.

### 3.3 Инструмент

- **Ложный цикл в снимке (I-146).** `arch-snapshot.js` группирует модули по глубине пути, `architecture.json` — по своему списку (файлы `core/*.ts` — отдельные модули). После `core-seams` у `core/config.ts` появилось ребро в `core/schemas`, и разница снимков показала `+ cycle core ↔ core/schemas`. Исправление — снимок берёт модули из `architecture.json` (строка I-146 обновлена).
- `cs dups` отмечает одноимённые разные функции (`configDocument` в `core/init/scaffold.ts` — `warrant.json`, в `core/sync/plan.ts` — `openspec/config.yaml`) — не копии; риск только для графа (`hazard`).
- Инструмент сессии аудита превратил экранирование NUL в команде в настоящий байт при записи `backlog.md` — поймано проверкой; к A-22: мета-тест защитит и документы, если распространить на `docs/`.

### 3.4 Наблюдения для spec 4a (не находки)

- **`sync` и управляемое подмножество.** `PlannedFile` — «точные байты файла», `validate` (`checkGenerated`, `commands/validate.ts:L62-L119`) судит расхождение побайтно по тому же плану — один владелец, это правильно. `.claude/settings.json` по ADR-0034 п. 3 сверяется по наличию своих записей, не побайтно: у плана нужен второй вид цели («подмножество JSON»), иначе `sync` и `validate` получат две копии «какие записи наши». Рекомендация: цель плана с `own(current) → записи` в `core/sync`, `validate` сравнивает через план.
- **Перечисления фазы 4 — в реестр при рождении**: статус Run (`QUEUED`, `RUNNING`, `SUCCEEDED`, `FAILED`, `CANCELLED`), capabilities (`WRITE_CODE`, …), решение guard; статус evidence (`PROVEN`, `NOT_PROVEN`, `INCONCLUSIVE`, `NOT_APPLICABLE`) сегодня — тип-объединение с одним владельцем (`core/evidence/record.ts:L15`), в реестр — до producers 4b.
- **`hint`.** 132 `new WarrantError(` и ~22 литерала `{ code: "…" }` в `src`; ADR-0034 п. 8 называл сигнатуру `cliError(code, message, {path?, hint?})`, `core-seams` ввёл без `hint` — поле появится в 4a вместе с `errors[].hint`. Часть подсказок сейчас в тексте сообщения (`changedFromGit`: «pass --paths …», `check/execute.ts:L111`) — spec решает, выносить ли их в `hint`.
- `core/packs/loader.ts` — 590 строк, одна обязанность (прошлый §3.4); правила `rule/1` в локальном слое (BL-20) — при росте `loadLocalLayer` выделить `core/packs/local.ts`.

## 4. Что держится

- Циклов модулей и файлов нет по модулям `architecture.json` (ложный цикл снимка — §3.3).
- Ранги, слои, соседние импорты `commands/`, реестры помощников, перечислений, внешних пакетов и помощников тестов — `architecture.test.ts`; исключение одно — A-12. Мета-тесты `unit/meta/` — 72 зелёных.
- Процессы только в `adapters/` (ADR-0025).
- Улучшения прошлого аудита сделаны: реестр внешних пакетов, `test_helpers`, `arch-snapshot --in` (срезы с `evaluate`), `audit-stale` в `hygiene.js` (он и вызвал этот аудит).

## 5. План

- **4a, первая группа** (вместе с реестром проверок `validate`, A-9): A-22 (экранирование + мета-тест), A-21 (помощник `validate` уровня `app`).
- **4a, до `guard`**: A-20 — `projectPath` в `core/fs.ts`; перевод пути события `guard` — через него и `toProjectPaths`.
- **Инструменты**: I-146 — модули снимка из `architecture.json` (по следующему ложному сигналу или process-PR).

## 6. Воспроизведение

```bash
node scripts/dev/cs.js map
node scripts/dev/arch-snapshot.js --out docs/process/audits/2026-09-25-core-seams.json --against docs/process/audits/2026-09-25.json
node scripts/dev/cs.js deps packages/cli/src --level 2 --cycles --runtime
node scripts/dev/cs.js dups --in packages/cli/src
node scripts/dev/cs.js impact toProjectPaths
grep -rn "path.relative(" packages/cli/src
git grep -c 'json\["' 3f7fe5f -- packages/cli/src
git diff --stat 2824f34 3f7fe5f -- packages/cli/src
node scripts/dev/cs.js deps packages/cli/test --level 2
node scripts/dev/cs.js dups --in packages/cli/test
git log --format= --name-only -- packages/cli/src | sort | uniq -c | sort -rn
```
