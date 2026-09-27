## ADDED Requirements

### Requirement: Команда unknown
<!-- id: REQ-KRN-035 -->

`warrant unknown add <change> --area <AREA> --text <вопрос> [--blocking] [--dry-run]` SHALL добавить в `unknowns[]` record
`{ id, text, blocking }`: `id` — `UNK-<AREA>-NNN` по правилу [REQ-KRN-024](#requirement-команда-id) (`AREA_UNKNOWN` с `hint`),
`blocking` — `true` только с `--blocking` ([02 §1](../../../../docs/02-vocabulary.md)).
`warrant unknown resolve <change> <UNK> --as decision|fact|assumption --text <ответ> [--ref <url>] [--dry-run]` SHALL записать
в элемент `resolution` (текст ответа), `resolved_as` и `ref`. Ошибки — код 3, record не изменён, каждая с `hint`:
- `--as decision` без `--ref` — `USAGE`; `hint` называет ref — URL комментария maintainer'а в PR
  (`…/pull/<N>#issuecomment-<id>` или `…/pull/<N>#pullrequestreview-<id>`); `--ref` не http(s) URL или `--as` вне трёх
  значений — `USAGE`;
- `<UNK>` нет в record — `UNKNOWN_NOT_FOUND`, `hint` перечисляет открытые UNKNOWN Change;
- элемент уже закрыт — `UNKNOWN_RESOLVED`;
- `change_state` не из `PROPOSED`, `SPECIFIED`, `APPROVED`, `IMPLEMENTING`, `VERIFYING` — `STATE_INVALID` (`RECORD_FROZEN` для
  `ARCHIVED` и `ABANDONED`).
Обе команды SHALL NOT писать переход и SHALL записывать record только документом, который проходит `warrant://change-record/1`.
Вывод — `data{ change, unknown, open_blocking[] }`: записанный элемент и id открытых blocking UNKNOWN Change после записи;
`--dry-run` — по [REQ-KRN-034](#requirement-режим---dry-run-меняющих-команд).

#### Scenario: Blocking UNKNOWN
<!-- id: SCN-KRN-148 -->
- **WHEN** `warrant unknown add add-search --area SRC --text "Что делать при часах, идущих назад?" --blocking` при `change_state: PROPOSED` и максимуме `UNK-SRC-003`
- **THEN** record содержит `{ "id": "UNK-SRC-004", "text": "Что делать при часах, идущих назад?", "blocking": true }`, `data.open_blocking` равен `["UNK-SRC-004"]`, переходов не добавлено, код 0; `warrant status add-search` при gates перехода без `FAIL` даёт `controller_action: WAIT`, `next: clarify`

#### Scenario: Решение maintainer'а
<!-- id: SCN-KRN-149 -->
- **WHEN** `warrant unknown resolve add-search UNK-SRC-004 --as decision --text "Часы назад — метка сдвигается" --ref https://github.com/o/r/pull/7#issuecomment-11`
- **THEN** элемент содержит `resolution`, `resolved_as: "decision"` и `ref`, `data.open_blocking` пуст, код 0

#### Scenario: Решение без ref
<!-- id: SCN-KRN-150 -->
- **WHEN** `warrant unknown resolve add-search UNK-SRC-004 --as decision --text "…"` без `--ref`
- **THEN** `errors[0].code` равен `USAGE`, `hint` содержит `#issuecomment-`, record не изменён, код 3; с `--as fact` без `--ref` — элемент закрыт, код 0

#### Scenario: Нет такого UNKNOWN или он закрыт
<!-- id: SCN-KRN-151 -->
- **WHEN** `warrant unknown resolve add-search UNK-SRC-009 --as fact --text "…"`, а в record есть только открытый `UNK-SRC-004`; затем тот же вызов для уже закрытого `UNK-SRC-004`
- **THEN** первый — `UNKNOWN_NOT_FOUND` с `hint`, содержащим `UNK-SRC-004`; второй — `UNKNOWN_RESOLVED`; record не изменён, код 3

#### Scenario: UNKNOWN после merge
<!-- id: SCN-KRN-152 -->
- **WHEN** `warrant unknown add add-search --area SRC --text "…"` при `change_state: MERGED`
- **THEN** `errors[0].code` равен `STATE_INVALID`, record не изменён, код 3

#### Scenario: Пробная запись UNKNOWN
<!-- id: SCN-KRN-153 -->
- **WHEN** `warrant unknown add add-search --area SRC --text "…" --dry-run`
- **THEN** `data.dry_run: true`, `data.unknown.id` — id, который выдал бы настоящий запуск, `data.would_write[]` содержит `.warrant/changes/add-search.json`, record не изменён, код 0

## MODIFIED Requirements

### Requirement: Схема change-record
<!-- id: REQ-KRN-011 -->

Схема `warrant://change-record/1` SHALL описывать `.warrant/changes/<change>.json` ([04 §9](../../../../docs/04-lifecycle.md)):
`change` (kebab-case, равен имени файла), `change_state` из [02 §2](../../../../docs/02-vocabulary.md), необязательный `classification`
(`profiles[]`, `risk` — измерение → `{ "value", "from", "ref"? }` где `from` соответствует `floor`, `proposer:<id>` или `human:<login>`,
а `ref` (URL) допустим только при `from: human:<login>` и фиксирует approval понижения ниже floor ([REQ-KRN-028](#requirement-команда-classify));
`risk_level`), `transitions[]` (`to`, `at` (RFC 3339), `by`, `effective_policy_hash`?, `gates`?, `evidence`?, `ref`? (URL)),
`unknowns[]` (`id` `UNK-AREA-NNN`, `text`, `blocking`, `resolution`? — текст ответа, `resolved_as`? — `decision`, `fact` или
`assumption`, `ref`? — URL; `resolved_as` и `ref` допустимы только вместе с `resolution`, [REQ-KRN-035](#requirement-команда-unknown)), `assumptions[]` (`id` `ASM-AREA-NNN`, `text`),
необязательные `amends[]` и `supersedes[]` (kebab-case имена Changes, [ADR-0021](../../../../docs/adr/WARRANT-ADR-0021-archive-immutability.md)).

#### Scenario: Пример из документации
<!-- id: SCN-KRN-022 -->
- **WHEN** проверяется пример record из 04 §9 с `by` вида `cli:local` и `ref` в виде URL форджа
- **THEN** файл валиден

#### Scenario: Значение risk без источника
<!-- id: SCN-KRN-023 -->
- **WHEN** `classification.risk.data_loss` равен строке `"NONE"` вместо объекта с `from`
- **THEN** файл невалиден с указанием `/classification/risk/data_loss`

#### Scenario: Связи между Changes
<!-- id: SCN-KRN-091 -->
- **WHEN** record содержит `"amends": ["add-search"]` и `"supersedes": []`
- **THEN** файл валиден; `"amends": ["Add Search"]` — невалиден с указанием `/amends/0`

#### Scenario: ref у значения risk
<!-- id: SCN-KRN-110 -->
- **WHEN** `classification.risk.blast_radius` равен `{ "value": "LOCAL", "from": "human:kat", "ref": "https://github.com/o/r/pull/7#issuecomment-1" }`
- **THEN** файл валиден; тот же `ref` при `from: "floor:core-sdd:2"` — невалиден с указанием `/classification/risk/blast_radius`

#### Scenario: Закрытый UNKNOWN
<!-- id: SCN-KRN-143 -->
- **WHEN** элемент `unknowns[]` равен `{ "id": "UNK-SRC-001", "text": "Можно ли переписывать историю?", "blocking": true, "resolution": "Нет", "resolved_as": "decision", "ref": "https://github.com/o/r/pull/7#issuecomment-1" }`
- **THEN** файл валиден; тот же элемент с `resolved_as: "guess"` или с `ref` без `resolution` — невалиден с указанием `/unknowns/0`

### Requirement: Команда id
<!-- id: REQ-KRN-024 -->

`warrant id <PREFIX> <AREA>` для `REQ`, `SCN`, `TASK`, `UNK`, `ASM` SHALL выдать `PREFIX-AREA-NNN`, где `NNN` =
максимум по `openspec/specs/**`, `openspec/changes/**` (включая archive) и `unknowns[]` / `assumptions[]` records
`.warrant/changes/*.json` + 1, три цифры с ведущими нулями; AREA SHALL быть в `.warrant/local/areas.json`, иначе
`AREA_UNKNOWN`, код 3, с `hint`: объявленные AREA и то, что новую AREA объявляет человек правкой
`.warrant/local/areas.json` — policy-пути, который не пишет ни одна операция Run ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 6). `warrant id EVID` и `warrant id RUN` SHALL выдать `PREFIX-<ULID>`.
`warrant id WAV` SHALL выдать `WAV-<год>-NNN`. `warrant id renumber <old> <new> --change <name>` SHALL переписать
все вхождения `<old>` внутри `openspec/changes/<name>/**` и `paths.tests`, отказывая кодом 3, если `<new>` уже
существует где-либо в проекте или record Change в состоянии `MERGED` / `ARCHIVED` ([ADR-0012](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)).

#### Scenario: Следующий номер с учётом archive
<!-- id: SCN-KRN-056 -->
- **WHEN** в `openspec/specs/` максимум `REQ-KRN-007`, а в `openspec/changes/archive/` есть `REQ-KRN-012`
- **THEN** `warrant id REQ KRN` возвращает `REQ-KRN-013`

#### Scenario: Неизвестная AREA
<!-- id: SCN-KRN-057 -->
- **WHEN** `warrant id REQ ZZZ` и `ZZZ` не в реестре
- **THEN** `errors[0].code` равен `AREA_UNKNOWN`, код выхода 3; `errors[0].hint` перечисляет объявленные AREA и называет `.warrant/local/areas.json`

#### Scenario: Сквозной ID
<!-- id: SCN-KRN-058 -->
- **WHEN** `warrant id EVID` вызван дважды подряд
- **THEN** оба ID соответствуют `EVID-[0-9A-HJKMNP-TV-Z]{26}` и различаются

#### Scenario: Перенумерация
<!-- id: SCN-KRN-059 -->
- **WHEN** `warrant id renumber REQ-KRN-007 REQ-KRN-013 --change add-search` при record в `SPECIFIED`
- **THEN** все вхождения внутри каталога Change заменены, файлы вне каталога не тронуты, `data.rewritten[]` перечисляет файлы

#### Scenario: Перенумерация после MERGED
<!-- id: SCN-KRN-060 -->
- **WHEN** record Change в состоянии `MERGED`
- **THEN** `renumber` отказывает с `ID_IMMUTABLE`, код выхода 3, файлы не изменены

#### Scenario: Номер UNKNOWN с учётом records
<!-- id: SCN-KRN-144 -->
- **WHEN** в `openspec/**` максимум `UNK-SRC-002`, а `unknowns[]` record `.warrant/changes/add-search.json` содержит `UNK-SRC-004`
- **THEN** `warrant id UNK SRC` возвращает `UNK-SRC-005`

### Requirement: Команда classify
<!-- id: REQ-KRN-028 -->

`warrant classify <change>` SHALL вычислить `classification` Change из детерминированных источников и записать её в
`.warrant/changes/<change>.json`: (1) список изменённых путей — `git diff --name-only <base>...HEAD` с `--base` (по умолчанию `main`)
или `--paths <file>` (по строке на путь; без git); если у ветки базы есть upstream (`<base>@{upstream}`) и в нём есть коммиты,
которых нет в базе, — `BASE_BEHIND_UPSTREAM`, код 3, record не изменён, `hint` называет `--base <upstream>` (diff устаревшей базы
захватил бы чужие коммиты, а повторный `classify` запись не ослабит); (2) floor rules (`warrant://risk-floor/1`) всех подключённых packs — минимальное
значение измерения по совпавшим путям; (3) `match.paths` profiles — предлагаемые profiles; собственное состояние Change (record, каталог evidence, файлы Run этого Change и их
`.result.json` — [REQ-VER-004](../verification/spec.md)) SHALL NOT участвовать в сверке с `match.paths` и floor rules; (4) `--propose <json>` — profiles и значения
измерений от proposer'а; значение вне порядка измерения [05 §4](../../../../docs/05-policy.md) или profile, не объявленный
подключёнными packs, SHALL давать `USAGE`, код 3, record не изменён, `hint` перечисляет допустимые значения; (5) `--set <dim>=<value>` и `--set profile=<id>` (повторяемые) — значения человека, требуют `--by <login>`,
где `login` входит хотя бы в одну роль `roles` `warrant.json` (иначе `ROLE_REQUIRED`, код 3), и записываются с `from: human:<login>`.
Итог измерения = максимум по порядку значений [05 §4](../../../../docs/05-policy.md) из floor, proposer и human; каждое значение
SHALL нести `from` (`floor:<pack>:<rule-index>`, `proposer`, `human:<login>`, ранее записанное — `record`). `--set` ниже floor без
`--ref` SHALL отказывать с `BELOW_FLOOR`, код 3, record не изменён. Понижение ниже floor ([04 §8](../../../../docs/04-lifecycle.md)) SHALL
выполняться только как `--set <dim>=<value> --by <login> --ref <url>` (http(s) URL approval), где `login` входит в роль из `approvals[]`
перехода `SPECIFIED->APPROVED` effective policy (без `approvals[]` — `maintainer`; иначе `ROLE_REQUIRED`), и только при `change_state`
`PROPOSED` или `SPECIFIED` (иначе `STATE_INVALID`, код 3); значение записывается как `{ value, from: "human:<login>", ref }`, и
последующие `classify` SHALL сохранять его, пока нет нового `--set` этого измерения: floor по этому измерению попадает в `data.ignored[]`
с причиной `approved-below-floor`. `ref` не верифицируется до `warrant ci` (фаза 4). Повторный `classify` SHALL NOT понижать ранее
записанное значение измерения и SHALL NOT удалять ранее записанный profile. `risk_level` SHALL NOT записываться: его вычисляет resolver. Record SHALL записываться только документом, который проходит
`warrant://change-record/1`.
Измерения без значения SHALL остаться отсутствующими (resolver трактует их как `UNKNOWN`). Команда SHALL печатать итоговую
`classification` и `effective_policy` из `resolve` в `data`.

#### Scenario: Floor по путям
<!-- id: SCN-KRN-073 -->
- **WHEN** diff содержит `.warrant/local/areas.json`, а pack `core-sdd` задаёт floor `{".warrant/**": {blast_radius: SYSTEM}}`
- **THEN** record получает `risk.blast_radius = {value: "SYSTEM", from: "floor:core-sdd:2"}` и `profiles` содержит `factory-change`

#### Scenario: Proposer не понижает floor
<!-- id: SCN-KRN-074 -->
- **WHEN** floor даёт `blast_radius: SYSTEM`, а `--propose` содержит `blast_radius: LOCAL`
- **THEN** записано `SYSTEM` с `from: "floor:…"`, `data.ignored[]` содержит `blast_radius` с причиной `below-floor`

#### Scenario: Повторный запуск монотонен
<!-- id: SCN-KRN-075 -->
- **WHEN** record уже содержит `security_impact: MEDIUM` от proposer, а новый `classify` без `--propose` по diff без floor для этого измерения
- **THEN** `security_impact` остаётся `MEDIUM` с `from: "record"`

#### Scenario: Без git и без --paths
<!-- id: SCN-KRN-076 -->
- **WHEN** проект не является git-репозиторием и `--paths` не задан
- **THEN** `errors[0].code` равен `USAGE`, record не изменён, код выхода 3

#### Scenario: Пустой diff
<!-- id: SCN-KRN-077 -->
- **WHEN** diff пуст и `--propose` не задан
- **THEN** `classification` записана без измерений и без profiles, `data.effective_policy.risk_level` равен `MEDIUM`

#### Scenario: Значение человека
<!-- id: SCN-KRN-105 -->
- **WHEN** `warrant classify add-search --set security_impact=HIGH --set profile=feature --by kat` при `roles.maintainer: ["kat"]`
- **THEN** record содержит `security_impact: { value: "HIGH", from: "human:kat" }` и profile `feature` с `from: "human:kat"`

#### Scenario: Ниже floor
<!-- id: SCN-KRN-106 -->
- **WHEN** floor даёт `blast_radius: SYSTEM`, а вызван `--set blast_radius=LOCAL --by kat` без `--ref`
- **THEN** `errors[0].code` равен `BELOW_FLOOR`, код 3, record не изменён

#### Scenario: --set без роли
<!-- id: SCN-KRN-107 -->
- **WHEN** `--set data_loss=LOW` без `--by`, или с `--by bob` вне `roles`
- **THEN** `errors[0].code` равен `USAGE` либо `ROLE_REQUIRED`, record не изменён

#### Scenario: Понижение ниже floor с approval
<!-- id: SCN-KRN-116 -->
- **WHEN** floor даёт `blast_radius: SYSTEM`, record `add-search` в `SPECIFIED`, вызван `--set blast_radius=LOCAL --by kat --ref https://github.com/o/r/pull/7#issuecomment-1` при `roles.maintainer: ["kat"]`
- **THEN** record содержит `blast_radius: { value: "LOCAL", from: "human:kat", ref: "https://github.com/o/r/pull/7#issuecomment-1" }`; повторный `classify` без `--set` сохраняет его, а `data.ignored[]` содержит `blast_radius` с причиной `approved-below-floor`

#### Scenario: Понижение после APPROVED
<!-- id: SCN-KRN-117 -->
- **WHEN** тот же вызов при record `add-search` в `APPROVED`
- **THEN** `errors[0].code` равен `STATE_INVALID`, код 3, record не изменён

#### Scenario: Своё состояние не делает Change factory
<!-- id: SCN-KRN-138 -->
- **WHEN** diff содержит только `src/search.py`, `.warrant/changes/add-search.json`, `.warrant/evidence/add-search/EVID-….json` и файл Run с `change: "add-search"`
- **THEN** `profiles` не содержит `factory-change`, floor по `.warrant/**` не применён; при добавлении `.warrant/local/areas.json` — `factory-change` и floor, как в SCN-KRN-073

#### Scenario: Proposer вне перечисления
<!-- id: SCN-KRN-145 -->
- **WHEN** `warrant classify add-search --propose '{"risk":{"compatibility":"NONE"}}'`, а порядок `compatibility` не содержит `NONE`
- **THEN** `errors[0].code` равен `USAGE`, `hint` перечисляет допустимые значения `compatibility`, record не изменён, код 3

#### Scenario: База позади upstream
<!-- id: SCN-KRN-146 -->
- **WHEN** `warrant classify add-search` без `--base`, а `origin/main` — upstream `main` — содержит коммит, которого нет в `main`
- **THEN** `errors[0].code` равен `BASE_BEHIND_UPSTREAM`, `hint` содержит `--base origin/main`, record не изменён, код 3; с `--base origin/main` — classification записана, код 0

### Requirement: Режим --dry-run меняющих команд
<!-- id: REQ-KRN-034 -->

`warrant transition`, `warrant archive`, `warrant waive`, `warrant run start`, `warrant run finish`, `warrant unknown add` и
`warrant unknown resolve` с `--dry-run` SHALL
выполнить те же проверки и напечатать тот же JSON, что настоящий запуск, с `data.dry_run: true` и `data.would_write[]` (пути
файлов, которые были бы созданы или изменены), завершиться тем же кодом и SHALL NOT менять ни одного файла.
`archive --dry-run` SHALL выполнить `openspec validate --strict` и gates `MERGED->ARCHIVED`, но не `openspec archive`; каталог
архива в `would_write[]` SHALL называться по тому же правилу, что его создаёт `openspec archive`: локальная дата процесса
`YYYY-MM-DD` и имя Change.

#### Scenario: Пробный переход
<!-- id: SCN-KRN-135 -->
- **WHEN** `warrant transition add-search SPECIFIED --dry-run` при gates `PASS`
- **THEN** `data.dry_run: true`, `data.would_write[]` содержит `.warrant/changes/add-search.json`, код 0, record и evidence не изменены

#### Scenario: Пробный переход с отказом
<!-- id: SCN-KRN-136 -->
- **WHEN** `warrant transition add-search SPECIFIED --dry-run` при gate `FAIL`
- **THEN** ошибка и код выхода те же, что у запуска без `--dry-run`

#### Scenario: Пробный archive
<!-- id: SCN-KRN-137 -->
- **WHEN** `warrant archive add-search --dry-run` при `change_state: MERGED`
- **THEN** `openspec archive` не вызван, каталог Change на месте, `data.would_write[]` содержит record и каталог `openspec/changes/archive/<дата>-add-search/`, где `<дата>` — локальная дата процесса

#### Scenario: Пробный archive на границе суток
<!-- id: SCN-KRN-147 -->
- **WHEN** `warrant archive add-search --dry-run` в процессе с часовым поясом UTC+3 в момент `2026-09-26T22:54:00Z`
- **THEN** `data.would_write[]` содержит `openspec/changes/archive/2026-09-27-add-search/` — тот же каталог, что создаёт настоящий прогон в этот момент
