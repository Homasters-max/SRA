# Spec Delta: enforcement

## Purpose

Принуждение во время работы агента: попытка агента — Run с `write_scope`, решение `warrant guard` до и после каждого действия
агента и адаптеры, переводящие родные хуки frontend в нормализованное событие guard и обратно.

## ADDED Requirements

### Requirement: Схема run
<!-- id: REQ-ENF-001 -->

Схема `warrant://run/1` SHALL описывать файл Run `<state>/runs/<id>.json` (03 §4; `<state>` — как у evidence, REQ-VER-001):
обязательные `$schema`, `id` (`RUN-<ULID>`), `change`, `operation` (`specify` | `implement`), `write_scope[]` (glob,
непустой), `scope[]` (glob сужения, может быть пустым), `branch`, `started_at` (date-time), `run_state` (`QUEUED` | `RUNNING` |
`SUCCEEDED` | `FAILED` | `CANCELLED`), `context_hash`, `effective_policy_hash`, `guard_events[]`; необязательные `task`, `skill`
(`namespace/name@version`), `model`, `finished_at`, `evidence[]` (id EVID). Событие `guard_events[]` SHALL иметь `at`, `phase`
(`pre` | `post`), `action` (`edit` | `shell` | `other`), `paths[]` (пути проекта), `decision` (`allow` | `deny`), `findings[]`
(коды находок), `rules_shown[]` (id правил `rule/1`) и необязательные `reason`, `argv[]`. Ни схема, ни файл Run SHALL NOT
содержать имени frontend. Файл Run SHALL коммититься вместе с работой; указатель активного Run `<state>/runs/current` (одна
строка — id Run) SHALL NOT коммититься.

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

### Requirement: Команда run start
<!-- id: REQ-ENF-002 -->

`warrant run start <change> --operation <op> [--scope <globs>] [--task <label>] [--dry-run]` SHALL создать Run в
`RUNNING` и записать его id в `<state>/runs/current`. `write_scope` SHALL определяться операцией: `specify` —
`openspec/changes/<change>/**`, допустимо при `change_state: PROPOSED`; `implement` — `<paths.src>/**`, `<paths.tests>/**` и
`openspec/changes/<change>/tasks.md`, допустимо при `IMPLEMENTING`. `--scope` (glob через запятую) SHALL только сужать: guard
разрешает путь, лишь если он подходит и под `write_scope`, и под `scope` (пустой `scope` — без сужения). Состояние Change не
допускает операцию → `STATE_INVALID`; `implement` без `paths.src` и `paths.tests` → `CONFIG_INVALID`; активный Run уже есть →
`RUN_ACTIVE`; каждая из этих ошибок SHALL нести `hint`, код выхода 3, ничего не записано. Вывод — Context Pack:
`data{ run, change, operation, write_scope[], scope[], rules[], items[], context_hash }`, где `rules[]` — правила `rule/1`,
хотя бы один файл проекта которых подходит под итоговый scope Run ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 6),
`items[]` — существующие `proposal.md`, `specs/**`, `design.md`, `tasks.md` Change, `context_hash` — hash содержимого `items` и
`rules`. `--task` SHALL сохраняться в `task` без проверки.

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

### Requirement: Команда run finish
<!-- id: REQ-ENF-003 -->

`warrant run finish [--state SUCCEEDED|FAILED|CANCELLED] [--dry-run]` SHALL записать активному Run `run_state` (по умолчанию
`SUCCEEDED`) и `finished_at` и удалить `<state>/runs/current`. Без активного Run SHALL давать `RUN_NOT_ACTIVE` с `hint`
`warrant run start`, код 3. Run не в `RUNNING` SHALL NOT считаться активным, даже если `current` на него указывает.

#### Scenario: Закрытие Run
<!-- id: SCN-ENF-009 -->
- **WHEN** `warrant run finish --state FAILED` при активном Run
- **THEN** Run имеет `run_state: FAILED` и `finished_at`, `current` удалён, повторный `warrant run start` проходит

#### Scenario: Нет активного Run
<!-- id: SCN-ENF-010 -->
- **WHEN** `warrant run finish` без `current`
- **THEN** `errors[0].code` равен `RUN_NOT_ACTIVE`, `errors[0].hint` содержит `warrant run start`, код 3

### Requirement: Команда guard
<!-- id: REQ-ENF-004 -->

`warrant guard` без `--frontend` SHALL читать из stdin нормализованное событие `{ phase: pre|post, action: edit|shell|other,
paths[], argv?, cwd }` ([ADR-0018](../../../../docs/adr/WARRANT-ADR-0018-frontend-adapters.md) п. 2) и печатать
`data{ decision: allow|deny, reason?, hints[] }`, код выхода 0 при любом решении. Пути события SHALL переводиться в пути проекта
от `cwd`; путь вне проекта и проект без `.warrant/warrant.json` SHALL давать `allow`. Решение `pre`:
- `edit` при активном Run — `deny` для пути вне `write_scope` или вне непустого `scope` (reason называет путь и scope), иначе
  `allow`;
- `edit` без активного Run — `deny` с hint `warrant run start <change> --operation …` для путей под `paths.src`, `paths.tests`,
  `openspec/changes/**` и policy-путями (`match.paths` профиля `factory-change`); иначе `allow` с той же подсказкой
  ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 7);
- `shell` — `deny`, если простая команда строки после shell-разбора начинается с одного из `execution.guard_prefixes` check с
  `exclusive: true` или `local ≠ allowed` (по умолчанию — первые токены `run.command` до первого флага или плейсхолдера), с hint
  `warrant check <change> <id> [--paths …]`; иначе `allow` ([ADR-0017](../../../../docs/adr/WARRANT-ADR-0017-check-execution.md) п. 5);
- `other` — `allow`;
- внутренний сбой (невалидное событие, битый Run, неразрешимая policy) — `deny` с reason и hint `warrant validate`.

Решение `post` SHALL быть `allow`; `hints[]` — находки [`validate --files`](../kernel/spec.md) по путям события (не больше 10
строк + «и ещё N») и текст правил `rule/1`, чьи `paths` подходят под путь и чьих id ещё нет в `rules_shown` событий Run
([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 3); сбой `post` SHALL давать `allow` без hints и сообщение
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

### Requirement: Адаптер claude
<!-- id: REQ-ENF-005 -->

`warrant guard --frontend claude` SHALL читать из stdin родной вход хука Claude Code (`hook_event_name` `PreToolUse` |
`PostToolUse`, `tool_name`, `tool_input`, `cwd`), переводить его в нормализованное событие — `Edit`, `Write` (`file_path`) и
`NotebookEdit` (`notebook_path`) → `edit`, `Bash` (`command`) → `shell`, иначе `other` — и печатать родной ответ: `deny` →
`hookSpecificOutput.permissionDecision: "deny"` с `permissionDecisionReason` из reason и hints; `allow` — без
`permissionDecision` (решает обычный механизм разрешений Claude Code), hints — в `hookSpecificOutput.additionalContext`.
Код выхода SHALL быть 0; вход, который нельзя разобрать, SHALL давать код 2 и причину в stderr (Claude Code отменяет действие
`PreToolUse`). Имя frontend SHALL встречаться только в адаптере, генераторе `sync` и значении `--frontend`
([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 2); неизвестное значение `--frontend` — `USAGE`, код 3.

#### Scenario: Отказ Edit
<!-- id: SCN-ENF-017 -->
- **WHEN** записанный вход `PreToolUse` с `tool_name: "Edit"` и `file_path` вне `write_scope` активного Run подан в `warrant guard --frontend claude`
- **THEN** stdout — JSON с `hookSpecificOutput.permissionDecision: "deny"` и причиной, называющей путь; код 0

#### Scenario: Подсказка после NotebookEdit
<!-- id: SCN-ENF-018 -->
- **WHEN** записанный вход `PostToolUse` с `tool_name: "NotebookEdit"` и `notebook_path` файла под правилом `rule/1`, ещё не показанным в Run
- **THEN** `hookSpecificOutput.additionalContext` содержит текст правила, `permissionDecision` отсутствует

#### Scenario: Разрешение не обходит механизм Claude Code
<!-- id: SCN-ENF-019 -->
- **WHEN** записанный вход `PreToolUse` `Write` пути внутри `write_scope`
- **THEN** ответ не содержит `permissionDecision: "allow"`

#### Scenario: Нейтральность Run
<!-- id: SCN-ENF-020 -->
- **WHEN** после событий через `--frontend claude` читается файл Run
- **THEN** файл не содержит строки `claude`, а те же события в нормализованной форме дают те же решения

#### Scenario: Неразборчивый вход
<!-- id: SCN-ENF-021 -->
- **WHEN** в `warrant guard --frontend claude` подан не-JSON
- **THEN** код выхода 2, stderr называет причину, stdout пуст
