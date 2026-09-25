# Spec Delta: kernel

## MODIFIED Requirements

### Requirement: Контракт JSON-вывода CLI
<!-- id: REQ-KRN-002 -->

Каждая команда SHALL уметь печатать в stdout ровно один JSON-объект `{ "command", "ok", "change"?, "data", "errors" }`.
JSON SHALL быть форматом по умолчанию, когда stdout не TTY, и SHALL включаться флагом `--json` всегда.
`errors[]` SHALL состоять из объектов `{ "code", "message", "path"?, "hint"? }`, где `code` — UPPER_SNAKE, `message` — что не
так, `hint` — команда или действие, которое исправляет ошибку ([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 8).
Текст исправления SHALL NOT повторяться в `message`, если он есть в `hint`. Ошибки команд `run`, `guard` и новые коды фазы 4
SHALL нести `hint`.
Диагностика, не входящая в контракт, SHALL идти в stderr.

#### Scenario: Успешный вызов без TTY
<!-- id: SCN-KRN-004 -->
- **WHEN** `warrant fmt --check` вызван с перенаправленным stdout и все файлы канонические
- **THEN** stdout содержит один объект с `"command": "fmt"`, `"ok": true`, `"errors": []`

#### Scenario: Ошибка в контракте
<!-- id: SCN-KRN-005 -->
- **WHEN** `warrant validate --json` находит невалидный файл
- **THEN** `"ok": false`, `errors[]` содержит запись с `code`, `message` и `path` файла, а stdout не содержит ничего кроме объекта

#### Scenario: Подсказка отдельно от сообщения
<!-- id: SCN-KRN-125 -->
- **WHEN** `warrant validate` в проекте без `.warrant/warrant.lock.json`
- **THEN** `errors[]` содержит `LOCK_MISMATCH` с `message` о пропавшем lock без слов `run`, и `hint` равен `` run `warrant sync` ``

### Requirement: Схема config
<!-- id: REQ-KRN-004 -->

Схема `warrant://config/1` SHALL описывать `.warrant/warrant.json` ([08 §3](../../../../docs/08-packs.md)):
обязательные `kernel` (major.minor), `openspec` (диапазон `1.13.x`), `packs` (id kebab-case → `{ "version": semver-range, "params"? }`);
необязательные `defaults` (`check_timeout_s` — положительное целое, [ADR-0017](../../../../docs/adr/WARRANT-ADR-0017-check-execution.md)),
`paths` (`adr`, `glossary`, `tests`, `src`), `roles` (роль → список логинов), `identities.agents[]`
([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md)), `trusted_signers[]`,
`frontends[]` — уникальные имена frontend, для которых `warrant sync` генерирует файлы (в фазе 4 — только `claude`,
[ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 1).

#### Scenario: Пример из документации
<!-- id: SCN-KRN-008 -->
- **WHEN** проверяется пример `warrant.json` из 08 §3, дополненный `"$schema"`
- **THEN** файл валиден

#### Scenario: Pack без версии
<!-- id: SCN-KRN-009 -->
- **WHEN** `packs.core-sdd` не содержит `version` или `version` не semver-диапазон
- **THEN** файл невалиден с указанием `/packs/core-sdd/version`

#### Scenario: Timeout по умолчанию
<!-- id: SCN-KRN-086 -->
- **WHEN** `defaults.check_timeout_s` равен `0` или строке
- **THEN** файл невалиден с указанием `/defaults/check_timeout_s`; при отсутствии `defaults` файл валиден

#### Scenario: Frontend
<!-- id: SCN-KRN-126 -->
- **WHEN** `frontends` равен `["claude"]`, `["codex"]` или `["claude", "claude"]`
- **THEN** первый файл валиден, второй и третий невалидны с указанием `/frontends`

## ADDED Requirements

### Requirement: Команда validate --files
<!-- id: REQ-KRN-032 -->

`warrant validate --files <paths>` (пути через запятую, [ADR-0019](../../../../docs/adr/WARRANT-ADR-0019-post-edit-hints.md))
SHALL выполнить только проверки одного файла, применимые к пути, с теми же кодами ошибок, что полный `validate`: (a) JSON
`.warrant/**` и packs — схема и канонический вид; (b) Markdown `openspec/changes/**` — формат ID, размещение под заголовком,
AREA из реестра; (c) stable ID изменён или удалён относительно `HEAD` — для `openspec/specs/**` и Change в состоянии
`APPROVED` и дальше; (d) висячие ссылки REQ / SCN в `tasks.md` и в файлах `paths.tests`; (e) строки, похожие на токены.
Проверки уровня проекта (lock, hash, drift сгенерированных файлов, сверка с `openspec`) SHALL NOT выполняться. Команда SHALL
NOT запускать дочерних процессов, кроме `git show HEAD:<path>` для (c). `data{ checked[], skipped[] }`: путь без применимой
проверки, отсутствующий файл и путь вне проекта — в `skipped[]` с `reason` (`no-check`, `missing`, `outside`).

#### Scenario: Неканонический JSON
<!-- id: SCN-KRN-127 -->
- **WHEN** `warrant validate --files .warrant/local/areas.json` для файла с ключами не по порядку
- **THEN** `errors[]` содержит `NOT_CANONICAL` с `path` файла и `hint`, содержащим `warrant fmt`, код 1

#### Scenario: Изменённый stable ID
<!-- id: SCN-KRN-128 -->
- **WHEN** в рабочем дереве в `openspec/specs/search/spec.md` комментарий `REQ-SRC-001` заменён на `REQ-SRC-009`, и вызван `warrant validate --files openspec/specs/search/spec.md`
- **THEN** `errors[]` содержит `ID_IMMUTABLE` с `REQ-SRC-001`, а проверки lock и сгенерированных файлов не выполнялись

#### Scenario: Посторонний файл
<!-- id: SCN-KRN-129 -->
- **WHEN** `warrant validate --files docs/notes.md,../other/x.json`
- **THEN** `ok: true`, `data.skipped[]` содержит `docs/notes.md` с `reason: "no-check"` и `../other/x.json` с `reason: "outside"`

### Requirement: Файлы frontend и AGENTS.md
<!-- id: REQ-KRN-033 -->

`warrant sync` SHALL генерировать корневой `AGENTS.md`, если подключённые packs или `.warrant/local/rules/` содержат хотя бы
одно правило `rule/1` с `paths: ["**"]` ([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 2, 5): первая строка —
`<!-- generated by warrant — do not edit -->`, затем текст таких правил в порядке id; файл больше 16 KiB — ошибка
`GENERATED_TOO_LARGE` с `hint`, ничего не записано. При `frontends ∋ "claude"` `sync` SHALL держать управляемое подмножество
([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 3): в `.claude/settings.json` — записи
`permissions.deny` на правку `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**`, `openspec/specs/**`,
`openspec/config.yaml`, `openspec/schemas/**` и на `git push origin main`, `gh pr merge`, `openspec archive`
([ADR-0014](../../../../docs/adr/WARRANT-ADR-0014-claude-code-enforcement.md) п. 1), и хуки с командой ровно
`warrant guard --frontend claude` — `PreToolUse` с matcher `Edit|Write|NotebookEdit|Bash` и `PostToolUse` с matcher
`Edit|Write|NotebookEdit`; при сгенерированном `AGENTS.md` — строку `@AGENTS.md` в `CLAUDE.md` (файла нет — создать). Во всех
случаях `sync` SHALL держать строку `.warrant/runs/current` в `.gitignore`. Чужие ключи, записи и строки этих файлов SHALL
сохраняться; `.claude/settings.json` пишется в каноническом JSON. `warrant init --frontend claude` SHALL записать
`frontends: ["claude"]` в новый `warrant.json`. `warrant validate` SHALL сверять `AGENTS.md` побайтно, а в `.claude/settings.json`,
`CLAUDE.md` и `.gitignore` — наличие своих записей в точном виде; расхождение — `GENERATED_DRIFT` с `path` (JSON Pointer для
`settings.json`) и `hint` `` run `warrant sync` ``.

#### Scenario: Управляемое подмножество settings.json
<!-- id: SCN-KRN-130 -->
- **WHEN** `warrant sync` при `frontends: ["claude"]` и `.claude/settings.json` с чужим хуком `PreToolUse` и ключом `env`
- **THEN** файл содержит свои записи deny и хуки `warrant guard --frontend claude`, чужой хук и `env` сохранены; повторный `sync` не меняет ни одного байта

#### Scenario: Снятый deny
<!-- id: SCN-KRN-131 -->
- **WHEN** из `.claude/settings.json` удалена запись deny на `.warrant/runs/**`, а чужие ключи изменены
- **THEN** `warrant validate` даёт одну ошибку `GENERATED_DRIFT` с путём `.claude/settings.json` и `hint` `` run `warrant sync` ``; правка чужих ключей ошибок не даёт

#### Scenario: AGENTS.md из общих правил
<!-- id: SCN-KRN-132 -->
- **WHEN** `.warrant/local/rules/` содержит правило с `paths: ["**"]` и правило с `paths: ["src/**"]`, `frontends: ["claude"]`
- **THEN** `AGENTS.md` начинается строкой-маркером и содержит текст только первого правила, `CLAUDE.md` содержит строку `@AGENTS.md`; без правил с `paths: ["**"]` `AGENTS.md` не создаётся

#### Scenario: Большой AGENTS.md
<!-- id: SCN-KRN-133 -->
- **WHEN** текст правил с `paths: ["**"]` даёт `AGENTS.md` больше 16 KiB
- **THEN** `errors[0].code` равен `GENERATED_TOO_LARGE` с `path` `AGENTS.md`, ни один файл не записан, код 3

#### Scenario: Проект без frontend
<!-- id: SCN-KRN-134 -->
- **WHEN** `warrant sync` в проекте без `frontends` и без правил с `paths: ["**"]`
- **THEN** `.claude/settings.json`, `CLAUDE.md` и `AGENTS.md` не создаются и не меняются, `.gitignore` содержит `.warrant/runs/current`

### Requirement: Режим --dry-run меняющих команд
<!-- id: REQ-KRN-034 -->

`warrant transition`, `warrant archive`, `warrant waive`, `warrant run start` и `warrant run finish` с `--dry-run` SHALL
выполнить те же проверки и напечатать тот же JSON, что настоящий запуск, с `data.dry_run: true` и `data.would_write[]` (пути
файлов, которые были бы созданы или изменены), завершиться тем же кодом и SHALL NOT менять ни одного файла.
`archive --dry-run` SHALL выполнить `openspec validate --strict` и gates `MERGED->ARCHIVED`, но не `openspec archive`.

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
- **THEN** `openspec archive` не вызван, каталог Change на месте, `data.would_write[]` содержит record и каталог `openspec/changes/archive/<дата>-add-search/`
