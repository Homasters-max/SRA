## MODIFIED Requirements

### Requirement: Команда run start
<!-- id: REQ-ENF-002 -->

`warrant run start <change> --operation <op> [--scope <globs>] [--task <label>] [--dry-run]` SHALL создать Run в
`RUNNING` и записать его id в `<state>/runs/current`. `write_scope` SHALL определяться операцией: `specify` —
`openspec/changes/<change>/**`, допустимо при `change_state: PROPOSED`; `implement` — `<paths.src>/**`, `<paths.tests>/**`, `<каталог>/**`
каждого каталога `paths.data` по порядку списка ([REQ-KRN-037](../kernel/spec.md); корень, повторённый после нормализации, — один раз),
`openspec/changes/<change>/tasks.md`, `openspec/changes/<change>/design.md` и `openspec/changes/<change>/specs/**`, допустимо при
`IMPLEMENTING` (`proposal.md` не входит; правку `specs/**` после `APPROVED` судит gate `spec-approved`, расхождение снимает waiver
maintainer'а — [ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 4); `review` — пустой, допустимо при `PROPOSED`
([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 3). Для `review` Run SHALL получать `spec_tree` —
hash набора пар «путь → blob» файлов `proposal.md` и `specs/**` каталога Change на HEAD (тот же набор, что сравнивает gate
`spec-approved`); если эти файлы в рабочем дереве отличаются от HEAD или не закоммичены — `SPEC_UNCOMMITTED` с `hint`
закоммитить spec. `--scope` (glob через запятую) SHALL только сужать: guard разрешает путь, лишь если он подходит и под
`write_scope`, и под `scope` (пустой `scope` — без сужения). Состояние Change не допускает операцию → `STATE_INVALID`;
`implement` без `paths.src`, `paths.tests` и `paths.data` → `CONFIG_INVALID`; активный Run уже есть → `RUN_ACTIVE`; каждая из этих ошибок SHALL
нести `hint`, код выхода 3, ничего не записано. Для `specify` и `implement` файлы внутри `write_scope`, которые отличаются от HEAD
в индексе или рабочем дереве (в том числе удалённые) или не отслеживаются git и не игнорируются (`.gitignore`), SHALL давать
находку `{ code: "UNCOMMITTED_IN_SCOPE", paths[], hint }` (`paths` — пути проекта в порядке code units) в
`data.findings[]` — граница результата Run — коммит ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 5); Run
стартует, код выхода от находки не меняется; без git находки нет. Вывод — Context Pack:
`data{ run, change, operation, write_scope[], scope[], rules[], items[], context_hash, findings[] }`, где `rules[]` — правила `rule/1`,
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

#### Scenario: Незакоммиченное в scope
<!-- id: SCN-ENF-045 -->
- **WHEN** `warrant run start add-search --operation implement` при `change_state: IMPLEMENTING`, а `src/search.py` изменён в рабочем дереве и `tests/test_new.py` не отслеживается git; `docs/notes.md` вне `write_scope` тоже изменён
- **THEN** Run создан, код 0; `data.findings[]` содержит `{ code: "UNCOMMITTED_IN_SCOPE" }` с `paths` `["src/search.py", "tests/test_new.py"]` и `hint` закоммитить или убрать чужую работу; при чистом дереве `data.findings` пуст
