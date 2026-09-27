## MODIFIED Requirements

### Requirement: Команда run start
<!-- id: REQ-ENF-002 -->

`warrant run start <change> --operation <op> [--scope <globs>] [--task <label>] [--dry-run]` SHALL создать Run в
`RUNNING` и записать его id в `<state>/runs/current`. `write_scope` SHALL определяться операцией: `specify` —
`openspec/changes/<change>/**`, допустимо при `change_state: PROPOSED`; `implement` — `<paths.src>/**`, `<paths.tests>/**`,
`openspec/changes/<change>/tasks.md`, `openspec/changes/<change>/design.md` и `openspec/changes/<change>/specs/**`, допустимо при
`IMPLEMENTING` (`proposal.md` не входит; правку `specs/**` после `APPROVED` судит gate `spec-approved`, расхождение снимает waiver
maintainer'а — [ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 4); `review` — пустой, допустимо при `PROPOSED`
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

#### Scenario: Реализация уточняет spec
<!-- id: SCN-ENF-036 -->
- **WHEN** `warrant run start add-search --operation implement` при `change_state: IMPLEMENTING`, `paths.src: "src"` и `paths.tests: "tests"`
- **THEN** `write_scope` равен `["src/**", "tests/**", "openspec/changes/add-search/tasks.md", "openspec/changes/add-search/design.md", "openspec/changes/add-search/specs/**"]`; guard при этом Run даёт `allow` правке `openspec/changes/add-search/specs/search/spec.md` и `deny` правке `openspec/changes/add-search/proposal.md`

### Requirement: Команда guard
<!-- id: REQ-ENF-004 -->

`warrant guard` без `--frontend` SHALL читать из stdin нормализованное событие `{ phase: pre|post, action: edit|shell|other,
paths[], argv?, cwd }` ([ADR-0018](../../../../docs/adr/WARRANT-ADR-0018-frontend-adapters.md) п. 2) и печатать
`data{ decision: allow|deny, reason?, hints[] }`, код выхода 0 при любом решении. Пути события SHALL переводиться в пути проекта
от `cwd`; путь вне проекта и проект без `.warrant/warrant.json` SHALL давать `allow`. Решение `pre`:
- `edit` при активном Run — `deny` для пути вне `write_scope` или вне непустого `scope` (reason называет путь и scope; hint —
  править внутри `write_scope`, а для других путей `warrant run finish`, затем `warrant run start` с операцией, которая их пишет),
  иначе `allow`; при активном Run `review` (пустой `write_scope`) — `deny` любой правки с reason «Run review только читает»;
- `edit` без активного Run — `deny` с hint `warrant run start <change> --operation …` для путей под `paths.src`, `paths.tests`,
  `openspec/changes/**` и policy-путями (`match.paths` профиля `factory-change`); иначе `allow` с той же подсказкой
  ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 7);
- состояние, которое пишет CLI, — records `.warrant/changes/**`, evidence `<state>/evidence/**`, Runs `<state>/runs/**` и waivers
  `.warrant/waivers/**` — в `deny` обоих случаев выше SHALL получать вместо `warrant run start` и `warrant run finish` hint: файлы
  пишут команды CLI (`warrant transition`, `warrant unknown`, `warrant check`, `warrant waive`, `warrant run`), правка руками не нужна;
- остальной policy-путь, который не лежит под `paths.src`, `paths.tests` и `openspec/changes/**` (его не пишет ни одна операция
  Run: например `.warrant/local/**`, `.github/workflows/**`), в `deny` обоих случаев выше SHALL получать вместо `warrant run start`
  и `warrant run finish` hint: правку делает человек (maintainer) вне сессии агента, в Change `factory-change`
  ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 7); остальные пути (например `docs/**`) — прежние подсказки;
- `shell` при активном Run `review` — `allow`, только если каждая простая команда строки после shell-разбора начинается с
  `warrant run submit`, иначе `deny` с hint `warrant run submit`;
- `shell` в остальных случаях — `deny`, если простая команда строки после shell-разбора начинается с одного из
  `execution.guard_prefixes` check с `exclusive: true` или `local ≠ allowed` (по умолчанию — первые токены `run.command` до первого
  флага или плейсхолдера; пара `-m <модуль>` сразу после первого токена — часть префикса: `python -m pytest`, а не `python`), с hint `warrant check <change> <id> [--paths …]`; иначе `allow`
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

#### Scenario: Префикс команды модуля
<!-- id: SCN-ENF-037 -->
- **WHEN** check `tests-passed` с `execution.exclusive: true` и `run.command: ["python", "-m", "pytest", "--junitxml={out}"]`, guard получает `pre` `shell` с `argv: ["bash", "-c", "python - <<'EOF'"]`, затем с `argv: ["bash", "-c", "python -m pytest tests/"]`
- **THEN** первое — `allow`, второе — `deny` с hint `warrant check <change> tests-passed`

#### Scenario: Путь без операции записи
<!-- id: SCN-ENF-038 -->
- **WHEN** без активного Run guard получает `pre` `edit` пути `.warrant/local/areas.json`; при активном Run `implement` — `pre` `edit` пути `.github/workflows/ci.yml`, затем `docs/notes.md`
- **THEN** первые два — `deny`, `hints[]` называет правку человеком в Change `factory-change` и не содержит `warrant run start` и `warrant run finish`; `docs/notes.md` — `deny` с прежним hint `warrant run finish`

#### Scenario: Состояние, которое пишет CLI
<!-- id: SCN-ENF-039 -->
- **WHEN** без активного Run guard получает `pre` `edit` пути `.warrant/changes/add-search.json`; при активном Run `implement` — `pre` `edit` пути `.warrant/waivers/WAV-2026-001.json`
- **THEN** оба — `deny`, `hints[]` называет `warrant transition`, `warrant unknown` и `warrant waive` и не содержит `factory-change`, `warrant run start` и `warrant run finish`
