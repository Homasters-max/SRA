# Spec Delta: enforcement

## MODIFIED Requirements

### Requirement: Схема run
<!-- id: REQ-ENF-001 -->

Схема `warrant://run/1` SHALL описывать файл Run `<state>/runs/<id>.json` (03 §4; `<state>` — как у evidence, REQ-VER-001):
обязательные `$schema`, `id` (`RUN-<ULID>`), `change`, `operation` (`specify` | `implement` | `review`), `write_scope[]` (glob;
непустой, кроме операции `review`, у которой он пуст), `scope[]` (glob сужения, может быть пустым), `branch`, `started_at`
(date-time), `run_state` (`QUEUED` | `RUNNING` | `SUCCEEDED` | `FAILED` | `CANCELLED`), `context_hash`, `effective_policy_hash`,
`guard_events[]`; `spec_tree` (hash дерева spec Change, [REQ-ENF-002](#requirement-команда-run-start)) — обязательный у операции
`review` и отсутствующий у остальных; необязательные `task`, `skill` (`namespace/name@version`), `model`, `finished_at`,
`evidence[]` (id EVID). Событие `guard_events[]` SHALL иметь `at`, `phase` (`pre` | `post`), `action` (`edit` | `shell` |
`other`), `paths[]` (пути проекта), `decision` (`allow` | `deny`), `findings[]` (коды находок), `rules_shown[]` (id правил
`rule/1`) и необязательные `reason`, `argv[]`. Ни схема, ни файл Run SHALL NOT содержать имени frontend. Файл Run SHALL
коммититься вместе с работой; указатель активного Run `<state>/runs/current` (одна строка — id Run) SHALL NOT коммититься.

#### Scenario: Run после start
<!-- id: SCN-ENF-001 -->
- **WHEN** проверяется файл Run с `run_state: "RUNNING"`, `operation: "implement"`, `write_scope: ["src/**", "tests/**"]`, `scope: []` и пустым `guard_events`
- **THEN** файл валиден по `warrant://run/1`

#### Scenario: Событие без решения
<!-- id: SCN-ENF-002 -->
- **WHEN** элемент `guard_events[]` не содержит `decision` или содержит `decision: "ask"`
- **THEN** `warrant validate` даёт `SCHEMA_VIOLATION` с JSON Pointer `/guard_events/0/decision`

#### Scenario: Имя frontend в Run
<!-- id: SCN-ENF-003 -->
- **WHEN** элемент `guard_events[]` содержит ключ `frontend`
- **THEN** файл невалиден: неизвестный ключ отклоняется с указанием JSON Pointer

#### Scenario: Run review
<!-- id: SCN-ENF-022 -->
- **WHEN** проверяется файл Run с `operation: "review"`, `write_scope: []` и `spec_tree: "sha256:…"`
- **THEN** файл валиден по `warrant://run/1`; тот же файл без `spec_tree` даёт `SCHEMA_VIOLATION`

#### Scenario: Пустой write_scope не у review
<!-- id: SCN-ENF-023 -->
- **WHEN** файл Run с `operation: "implement"` содержит `write_scope: []` или `spec_tree`
- **THEN** `warrant validate` даёт `SCHEMA_VIOLATION` с путём файла Run

### Requirement: Команда run start
<!-- id: REQ-ENF-002 -->

`warrant run start <change> --operation <op> [--scope <globs>] [--task <label>] [--dry-run]` SHALL создать Run в
`RUNNING` и записать его id в `<state>/runs/current`. `write_scope` SHALL определяться операцией: `specify` —
`openspec/changes/<change>/**`, допустимо при `change_state: PROPOSED`; `implement` — `<paths.src>/**`, `<paths.tests>/**` и
`openspec/changes/<change>/tasks.md`, допустимо при `IMPLEMENTING`; `review` — пустой, допустимо при `PROPOSED`
([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 3). Для `review` Run SHALL получать `spec_tree` —
hash набора пар «путь → blob» файлов `proposal.md` и `specs/**` каталога Change на HEAD (тот же набор, что сравнивает gate
`spec-approved`); если эти файлы в рабочем дереве отличаются от HEAD или не закоммичены — `SPEC_UNCOMMITTED` с `hint`
закоммитить spec. `--scope` (glob через запятую) SHALL только сужать: guard разрешает путь, лишь если он подходит и под
`write_scope`, и под `scope` (пустой `scope` — без сужения). Состояние Change не допускает операцию → `STATE_INVALID`;
`implement` без `paths.src` и `paths.tests` → `CONFIG_INVALID`; активный Run уже есть → `RUN_ACTIVE`; каждая из этих ошибок SHALL
нести `hint`, код выхода 3, ничего не записано. Вывод — Context Pack:
`data{ run, change, operation, write_scope[], scope[], rules[], items[], context_hash }`, где `rules[]` — правила `rule/1`,
хотя бы один файл проекта которых подходит под итоговый scope Run ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 6;
у `review` — пусто), `items[]` — существующие `proposal.md`, `specs/**`, `design.md`, `tasks.md` Change, `context_hash` — hash
содержимого `items` и `rules`. `--task` SHALL сохраняться в `task` без проверки.

#### Scenario: Спецификация в PROPOSED
<!-- id: SCN-ENF-004 -->
- **WHEN** `warrant run start add-search --operation specify` при `change_state: PROPOSED`
- **THEN** создан `<state>/runs/<RUN-id>.json` с `run_state: RUNNING` и `write_scope: ["openspec/changes/add-search/**"]`, `current` содержит этот id, `data.items[]` перечисляет `proposal.md`, код 0

#### Scenario: Реализация не в IMPLEMENTING
<!-- id: SCN-ENF-005 -->
- **WHEN** `warrant run start add-search --operation implement` при `change_state: PROPOSED`
- **THEN** `errors[0].code` равен `STATE_INVALID`, `errors[0].hint` называет переход `IMPLEMENTING`, файлов Run нет, код 3

#### Scenario: Второй Run
<!-- id: SCN-ENF-006 -->
- **WHEN** `warrant run start` вызван при существующем `current` с Run в `RUNNING`
- **THEN** `errors[0].code` равен `RUN_ACTIVE`, `errors[0].hint` содержит `warrant run finish`, прежний Run не изменён, код 3

#### Scenario: Сужение scope
<!-- id: SCN-ENF-007 -->
- **WHEN** `warrant run start add-search --operation implement --scope src/search/**` при `paths.src: "src"`
- **THEN** Run содержит `write_scope` операции и `scope: ["src/search/**"]`; правило `rule/1` с `paths: ["src/search/**"]` есть в `data.rules[]`, правило с `paths: ["docs/**"]` — нет

#### Scenario: Пробный запуск
<!-- id: SCN-ENF-008 -->
- **WHEN** `warrant run start add-search --operation specify --dry-run`
- **THEN** вывод совпадает с настоящим запуском, `data.dry_run: true`, `data.would_write[]` перечисляет файл Run и `current`, ни один файл не создан

#### Scenario: Review закоммиченной spec
<!-- id: SCN-ENF-024 -->
- **WHEN** `warrant run start add-search --operation review` при `change_state: PROPOSED` и закоммиченных `proposal.md` и `specs/**` Change
- **THEN** Run содержит `operation: "review"`, `write_scope: []` и `spec_tree`, `data.items[]` перечисляет артефакты Change, `data.rules[]` пуст, код 0

#### Scenario: Review незакоммиченной spec
<!-- id: SCN-ENF-025 -->
- **WHEN** `openspec/changes/add-search/specs/search/spec.md` изменён в рабочем дереве, и вызван `warrant run start add-search --operation review`
- **THEN** `errors[0].code` равен `SPEC_UNCOMMITTED`, `path` — этот файл, `hint` предлагает закоммитить spec; файлов Run нет, код 3

### Requirement: Команда guard
<!-- id: REQ-ENF-004 -->

`warrant guard` без `--frontend` SHALL читать из stdin нормализованное событие `{ phase: pre|post, action: edit|shell|other,
paths[], argv?, cwd }` ([ADR-0018](../../../../docs/adr/WARRANT-ADR-0018-frontend-adapters.md) п. 2) и печатать
`data{ decision: allow|deny, reason?, hints[] }`, код выхода 0 при любом решении. Пути события SHALL переводиться в пути проекта
от `cwd`; путь вне проекта и проект без `.warrant/warrant.json` SHALL давать `allow`. Решение `pre`:
- `edit` при активном Run — `deny` для пути вне `write_scope` или вне непустого `scope` (reason называет путь и scope), иначе
  `allow`; при активном Run `review` (пустой `write_scope`) — `deny` любой правки с reason «Run review только читает»;
- `edit` без активного Run — `deny` с hint `warrant run start <change> --operation …` для путей под `paths.src`, `paths.tests`,
  `openspec/changes/**` и policy-путями (`match.paths` профиля `factory-change`); иначе `allow` с той же подсказкой
  ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 7);
- `shell` при активном Run `review` — `allow`, только если каждая простая команда строки после shell-разбора начинается с
  `warrant run submit`, иначе `deny` с hint `warrant run submit`;
- `shell` в остальных случаях — `deny`, если простая команда строки после shell-разбора начинается с одного из
  `execution.guard_prefixes` check с `exclusive: true` или `local ≠ allowed` (по умолчанию — первые токены `run.command` до первого
  флага или плейсхолдера), с hint `warrant check <change> <id> [--paths …]`; иначе `allow`
  ([ADR-0017](../../../../docs/adr/WARRANT-ADR-0017-check-execution.md) п. 5);
- `other` — `allow`;
- внутренний сбой (невалидное событие, битый Run, неразрешимая policy) — `deny` с reason и hint `warrant validate`.

Решение `post` SHALL быть `allow`; `hints[]` — находки [`validate --files`](../kernel/spec.md) по путям события (не больше 10
строк + «и ещё N») и текст правил `rule/1`, чьи `paths` подходят под путь и чьих id ещё нет в `rules_shown` событий Run
([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 3); без активного Run вместо текста правил — hint
`warrant run start` `pre` для правки пути проекта (design I-165); сбой `post` SHALL давать `allow` без hints и сообщение
в stderr. При активном Run каждый вызов SHALL дописать событие в `guard_events[]` под замком Run; замок не взят за ~2 с —
`pre` даёт `deny` с reason `BUSY`, `post` теряет событие с сообщением в stderr.

#### Scenario: Правка вне write_scope
<!-- id: SCN-ENF-011 -->
- **WHEN** при активном Run `implement` с `paths.src: "src"` guard получает `{ phase: "pre", action: "edit", paths: ["docs/readme.md"] }`
- **THEN** `data.decision` равен `deny`, `reason` называет `docs/readme.md` и `write_scope`, в Run добавлено событие с `decision: "deny"`

#### Scenario: Правка кода без Run
<!-- id: SCN-ENF-012 -->
- **WHEN** без активного Run guard получает `pre` `edit` пути `src/app.py` при `paths.src: "src"`
- **THEN** `decision` равен `deny`, `hints[]` содержит `warrant run start`; для `docs/notes.md` — `allow` с той же подсказкой

#### Scenario: Прямой запуск тяжёлого check
<!-- id: SCN-ENF-013 -->
- **WHEN** check `tests` с `execution.exclusive: true` и `run.command: ["pytest", "-q"]`, а guard получает `pre` `shell` с `argv: ["bash", "-c", "cd src && pytest tests/"]`
- **THEN** `decision` равен `deny`, hint содержит `warrant check <change> tests`; событие несёт `argv`

#### Scenario: Подсказка после правки
<!-- id: SCN-ENF-014 -->
- **WHEN** при активном Run guard получает `post` `edit` файла `.warrant/local/areas.json` в неканоническом виде, а правило `json-canonical` с `paths: [".warrant/**/*.json"]` ещё не показано
- **THEN** `decision` равен `allow`, `hints[]` содержит находку `NOT_CANONICAL` с `warrant fmt` и текст правила; событие несёт `findings: ["NOT_CANONICAL"]` и `rules_shown: ["json-canonical"]`; при второй такой правке текст правила в `hints[]` не повторяется

#### Scenario: Сбой до действия
<!-- id: SCN-ENF-015 -->
- **WHEN** `current` указывает на файл Run, который не проходит `warrant://run/1`, а guard получает `pre` `edit`
- **THEN** `decision` равен `deny`, `reason` называет файл Run, hint содержит `warrant validate`, код выхода 0

#### Scenario: Проект не под WARRANT
<!-- id: SCN-ENF-016 -->
- **WHEN** guard вызван в каталоге без `.warrant/warrant.json`
- **THEN** `decision` равен `allow` для любой фазы и действия, событий не пишется

#### Scenario: Правка под review
<!-- id: SCN-ENF-026 -->
- **WHEN** при активном Run `review` guard получает `pre` `edit` пути `openspec/changes/add-search/proposal.md`
- **THEN** `decision` равен `deny`, `reason` говорит, что Run review только читает; в Run добавлено событие с `decision: "deny"`

#### Scenario: Shell под review
<!-- id: SCN-ENF-027 -->
- **WHEN** при активном Run `review` guard получает `pre` `shell` с `argv: ["bash", "-c", "warrant run submit --file result.json"]`, затем с `argv: ["bash", "-c", "cat x && warrant run submit"]`
- **THEN** первое — `allow`, второе — `deny` с hint `warrant run submit`

## ADDED Requirements

### Requirement: Схема skill-result
<!-- id: REQ-ENF-006 -->

Схема `warrant://skill-result/1` SHALL описывать envelope результата skill ([07 §4](../../../../docs/07-skills.md)): обязательные
`$schema`, `skill` (`namespace/name@version`), `run` (`RUN-<ULID>`), `run_state` (`SUCCEEDED` | `FAILED` | `CANCELLED`),
`findings[]`, `provenance{ started_at, finished_at }` (date-time) с необязательными `context_hash` и `model`; необязательные
`proposals[]`, `unknowns[]`, `assumptions[]`, `decisions_required[]`, `artifacts_to_update[]`, `recommended_operations[]`. Finding
SHALL иметь `id`, `marker` (`FACT` | `INFERENCE`), `severity` (`BLOCKER` | `MAJOR` | `MINOR` | `INFO`), `category`, `statement` и
необязательные `targets[]`, `recommendation`. Envelope SHALL NOT содержать `gate_verdict` и `evidence_status`: неизвестный ключ
верхнего уровня или finding отклоняется.

#### Scenario: Envelope review
<!-- id: SCN-ENF-028 -->
- **WHEN** проверяется envelope с `skill: "specification/adversarial-review@0.2.0"`, `run_state: "SUCCEEDED"`, одним finding `severity: "MAJOR"`, `marker: "INFERENCE"` и `provenance`
- **THEN** envelope валиден по `warrant://skill-result/1`

#### Scenario: Вердикт в envelope
<!-- id: SCN-ENF-029 -->
- **WHEN** envelope содержит `evidence_status: "PROVEN"` или finding без `marker`
- **THEN** envelope невалиден, ошибка называет JSON Pointer ключа

### Requirement: Команда run submit
<!-- id: REQ-ENF-007 -->

`warrant run submit [--file <path>] [--dry-run]` SHALL принять envelope `warrant://skill-result/1` из файла или, без `--file`, из
stdin для активного Run операции `review` ([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 10). Без
активного Run → `RUN_NOT_ACTIVE`; Run другой операции → `STATE_INVALID` с `hint` `warrant run finish`; envelope не проходит схему,
его `run` не равен id активного Run или `skill` не называет skill review pack'а с версией из диапазона pack →
`SKILL_RESULT_INVALID` с JSON Pointer; каждая ошибка SHALL нести `hint`, код выхода 3, ничего не записано. Иначе команда SHALL:
записать envelope в канонической форме в `<state>/runs/<RUN-id>.result.json` (коммитится вместе с Run); записать evidence
([REQ-VER-001](../verification/spec.md)) `kind: "review"`, `level: "L2"`, `produced_by{ type: "skill", id, version, run }`,
`attestation{ type: "none" }`, `limitations` `produced locally, unattested` и `same model family as author`,
`subject{ commit: HEAD, spec_revision, spec_tree }` со `spec_tree` из Run и без `base_commit`, `metrics` — число находок по каждой
`severity`, `artifacts[]` — файл envelope с `sha256`; `evidence_status` — `PROVEN`, если `run_state: SUCCEEDED` и нет находки
`BLOCKER`; `NOT_PROVEN`, если есть `BLOCKER`; `INCONCLUSIVE` при `FAILED` или `CANCELLED`
([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 4); завершить Run: `run_state` из envelope,
`finished_at`, id записи в `evidence[]`, `skill`, `model` из `provenance`, удалить `current`. Вывод —
`data{ run, change, evidence, evidence_status, findings{ BLOCKER, MAJOR, MINOR, INFO } }`, код 0 при любом `evidence_status`.

#### Scenario: Review без блокеров
<!-- id: SCN-ENF-030 -->
- **WHEN** при активном Run `review` Change `add-search` `warrant run submit` получает на stdin envelope `SUCCEEDED` с одним finding `MAJOR`
- **THEN** появляется запись `kind: "review"` с `evidence_status: "PROVEN"`, `subject.spec_tree` из Run, `metrics.MAJOR: 1` и `artifacts[0].uri` — `<state>/runs/<RUN-id>.result.json`; Run — `SUCCEEDED` с id записи в `evidence[]`, `current` удалён, код 0

#### Scenario: Блокер
<!-- id: SCN-ENF-031 -->
- **WHEN** envelope `SUCCEEDED` содержит finding `BLOCKER`
- **THEN** запись имеет `evidence_status: "NOT_PROVEN"`, `data.findings.BLOCKER` равен 1, код 0

#### Scenario: Review не завершился
<!-- id: SCN-ENF-032 -->
- **WHEN** envelope имеет `run_state: "FAILED"`
- **THEN** запись имеет `evidence_status: "INCONCLUSIVE"`, Run — `FAILED`

#### Scenario: Чужой Run
<!-- id: SCN-ENF-033 -->
- **WHEN** `run` envelope не равен id активного Run
- **THEN** `errors[0].code` равен `SKILL_RESULT_INVALID` с путём `/run`, записи evidence нет, Run в `RUNNING`, код 3

#### Scenario: Submit не review
<!-- id: SCN-ENF-034 -->
- **WHEN** `warrant run submit` при активном Run `implement`
- **THEN** `errors[0].code` равен `STATE_INVALID`, `hint` содержит `warrant run finish`, код 3

#### Scenario: Пробный submit
<!-- id: SCN-ENF-035 -->
- **WHEN** `warrant run submit --file result.json --dry-run` с валидным envelope
- **THEN** `data.dry_run: true`, `data.would_write[]` перечисляет файл envelope, запись evidence, manifest, файл Run и `current`; ни один файл не изменён
