## MODIFIED Requirements

### Requirement: Схема waiver
<!-- id: REQ-KRN-019 -->

Схема `warrant://waiver/1` SHALL описывать waiver ([05 §7](../../../../docs/05-policy.md)): `id` (`WAV-<ULID>` — ULID в верхнем регистре Crockford base32, как у `EVID` и `RUN`; прежняя форма `WAV-<year>-NNN`
остаётся валидной — [ADR-0056](../../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 2; иная — находка схемы с путём `/id`), `change`, `gate`, `reason`,
`risk`, `compensating_controls[]`, обязательные `owner`, `expires_at` (дата), `waiver_state` из [02 §2](../../../../docs/02-vocabulary.md),
`approved_by` (вид `human:<login>`) — обязателен во всех состояниях, кроме `PROPOSED` (предложенный waiver ещё не одобрен, 05 §7),
необязательный `targets[]` (object[]; форму задаёт pack gate, D-13).

#### Scenario: Пример waiver
<!-- id: SCN-KRN-038 -->
- **WHEN** проверяется пример из 05 §7
- **THEN** файл валиден

#### Scenario: Без срока
<!-- id: SCN-KRN-039 -->
- **WHEN** `expires_at` отсутствует
- **THEN** файл невалиден с указанием отсутствующего поля

#### Scenario: Частичный waiver
<!-- id: SCN-KRN-093 -->
- **WHEN** waiver содержит `targets` из примера 05 §7 «Частичный waiver»
- **THEN** файл валиден kernel-схемой; `targets: ["x"]` — невалиден с указанием `/targets/0`

#### Scenario: Предложенный waiver без approved_by
<!-- id: SCN-KRN-111 -->
- **WHEN** waiver в `waiver_state: "PROPOSED"` не содержит `approved_by`
- **THEN** файл валиден; тот же waiver в `ACTIVE` — невалиден с указанием отсутствующего `approved_by`

#### Scenario: Две формы id waiver
<!-- id: SCN-KRN-169 -->
- **WHEN** `warrant validate` при waivers с `id` `WAV-01M3YC8FP9SYPK438EKXFQS4TX`, `WAV-2026-004`, `WAV-2026-04`,
  `WAV-01m3yc8fp9sypk438ekxfqs4tx` и `WAV-01M3YC8FP9SYPK438EKXFQS4TI`
- **THEN** первые два валидны; три последних — находки схемы с путём `#/id` своего файла, код 3

### Requirement: Команда id
<!-- id: REQ-KRN-024 -->

`warrant id <PREFIX> <AREA>` для `REQ`, `SCN`, `TASK`, `UNK`, `ASM` SHALL выдать `PREFIX-AREA-NNN`, где `NNN` =
максимум по `openspec/specs/**`, `openspec/changes/**` (включая archive) и `unknowns[]` / `assumptions[]` records
`.warrant/changes/*.json` + 1, три цифры с ведущими нулями; AREA SHALL быть в `.warrant/local/areas.json`, иначе
`AREA_UNKNOWN`, код 3, с `hint`: объявленные AREA и то, что новую AREA объявляет человек правкой
`.warrant/local/areas.json` — policy-пути, который не пишет ни одна операция Run ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 6). `warrant id EVID` и `warrant id RUN` SHALL выдать `PREFIX-<ULID>`.
`warrant id WAV` SHALL выдать `WAV-<ULID>` ([ADR-0056](../../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 2) с
`data{ id, prefix: "WAV", year }` — поле `year` (год UTC вызова) остаётся ради совместимости вывода 0.10.0; id не выводится из
содержимого `.warrant/waivers/` и не координируется между ветками, как `EVID` и `RUN` ([ADR-0012](../../../../docs/adr/WARRANT-ADR-0012-id-allocation.md) п. 2). `warrant id renumber <old> <new> --change <name>` SHALL переписать
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

#### Scenario: id WAV
<!-- id: SCN-KRN-170 -->
- **WHEN** `warrant id WAV` вызван дважды подряд при существующем `.warrant/waivers/WAV-2026-004.json`
- **THEN** оба `data.id` соответствуют `WAV-[0-9A-HJKMNP-TV-Z]{26}` и различаются, `data.prefix` равен `WAV`, `data.year` — текущий год UTC, ни один файл
  не изменён

### Requirement: Команда waive
<!-- id: REQ-KRN-031 -->

`warrant waive` SHALL создавать и менять waiver-файлы `.warrant/waivers/<WAV>.json` ([05 §7](../../../../docs/05-policy.md)); файлы
SHALL записываться канонически и проходить [REQ-KRN-019](#requirement-схема-waiver) и проверку (11) [REQ-KRN-021](#requirement-команда-validate).
(1) `warrant waive <change> <gate> --reason <text> --risk <LOW|MEDIUM|HIGH> --control <text>… --owner <human:login> --expires <YYYY-MM-DD>`
SHALL создать waiver в состоянии `PROPOSED` без `approved_by`, с `id` `WAV-<ULID>` — новым на каждый вызов и не выводимым из
содержимого `.warrant/waivers/` ([ADR-0056](../../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 2), так что waivers двух веток от одной базы
не сталкиваются ни id, ни именем файла; существующий файл с тем же именем SHALL NOT перезаписываться (`INTERNAL`, код 3, файлы
не изменены); Change SHALL существовать и не быть заморожен (иначе `CHANGE_NOT_FOUND`
или `RECORD_FROZEN`), gate SHALL быть объявлен подключённым pack и иметь `waivable: true` (иначе `WAIVER_INVALID`), `--expires` SHALL
быть датой не раньше сегодняшней UTC (иначе `USAGE`); `targets[]` команда SHALL NOT записывать (поведение частичного waiver — фаза 5).
(2) `warrant waive --activate <WAV> --by <login>` SHALL перевести waiver из `PROPOSED` в `ACTIVE` и записать `approved_by: "human:<login>"`;
(3) `warrant waive --revoke <WAV> --by <login>` SHALL перевести waiver из `PROPOSED` или `ACTIVE` в `REVOKED`. Для (2) и (3) `login`
SHALL входить в `roles.maintainer` (иначе `ROLE_REQUIRED`, код 3), `<WAV>` — в любой из двух форм `waiver/1`, без нормализации регистра; неизвестный или иной формы `<WAV>` — `WAIVER_INVALID`, недопустимое исходное
состояние — `STATE_INVALID`, код 3; waiver в `EXPIRED` или `REVOKED` SHALL NOT меняться. Команда SHALL печатать waiver в `data.waiver`.
Агент MAY выполнять (1); активация — акт человека (05 §7), предел проверки `--by` — как у `transition` (заявление до `warrant ci`).

#### Scenario: Предложить waiver
<!-- id: SCN-KRN-121 -->
- **WHEN** `warrant waive add-search analyze-clean --reason "no analyze yet" --risk HIGH --control "maintainer review" --owner human:kat --expires 2026-12-31` при существующих `WAV-2026-001`, `WAV-2026-004`
- **THEN** создан `.warrant/waivers/<id>.json`, где `id` соответствует `WAV-[0-9A-HJKMNP-TV-Z]{26}`, с `waiver_state: "PROPOSED"` без `approved_by`, `warrant validate` даёт `ok: true`, gate `analyze-clean` по-прежнему `BLOCKED`

#### Scenario: Активировать
<!-- id: SCN-KRN-122 -->
- **WHEN** `warrant waive --activate WAV-2026-005 --by kat` для `PROPOSED` waiver прежней формы id при `roles.maintainer: ["kat"]`
- **THEN** waiver в `ACTIVE` с `approved_by: "human:kat"`, `warrant gate add-search` даёт `analyze-clean: WAIVED`; с `--by bob` вне `roles.maintainer` — `ROLE_REQUIRED`, файл не изменён

#### Scenario: Невэйвабельный gate
<!-- id: SCN-KRN-123 -->
- **WHEN** `warrant waive add-search scope-valid …`
- **THEN** `errors[0].code` равен `WAIVER_INVALID`, код 3, файл не создан

#### Scenario: Отозвать
<!-- id: SCN-KRN-124 -->
- **WHEN** `warrant waive --revoke WAV-2026-005 --by kat` для `ACTIVE` waiver
- **THEN** waiver в `REVOKED`, gate `analyze-clean` снова `BLOCKED`; повторный `--activate` даёт `STATE_INVALID`

#### Scenario: Waivers параллельных веток
<!-- id: SCN-KRN-168 -->
- **WHEN** две копии одного проекта с `WAV-2026-004` вызывают `warrant waive` для разных Change, затем файлы `.warrant/waivers/`
  обеих копий сведены в одну
- **THEN** имена двух новых файлов различны, оба id соответствуют `WAV-[0-9A-HJKMNP-TV-Z]{26}`; `warrant validate` сведённого проекта без находок,
  `WAV-2026-004` валиден

#### Scenario: Жизнь waiver новой формы
<!-- id: SCN-KRN-171 -->
- **WHEN** waiver, созданный `warrant waive`, переводится `warrant waive --activate <id> --by kat`, затем `--revoke <id> --by kat`;
  `--activate` с тем же id в нижнем регистре
- **THEN** первый — `ACTIVE` с `approved_by: "human:kat"`, gate засчитывает его так же, как waiver прежней формы; второй —
  `REVOKED`; третий — `WAIVER_INVALID`, код 3, файл не изменён
