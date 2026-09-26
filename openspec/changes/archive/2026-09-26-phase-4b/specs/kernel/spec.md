# Spec Delta: kernel

## MODIFIED Requirements

### Requirement: Команда classify
<!-- id: REQ-KRN-028 -->

`warrant classify <change>` SHALL вычислить `classification` Change из детерминированных источников и записать её в
`.warrant/changes/<change>.json`: (1) список изменённых путей — `git diff --name-only <base>...HEAD` с `--base` (по умолчанию `main`)
или `--paths <file>` (по строке на путь; без git); (2) floor rules (`warrant://risk-floor/1`) всех подключённых packs — минимальное
значение измерения по совпавшим путям; (3) `match.paths` profiles — предлагаемые profiles; собственное состояние Change (record, каталог evidence, файлы Run этого Change и их
`.result.json` — [REQ-VER-004](../verification/spec.md)) SHALL NOT участвовать в сверке с `match.paths` и floor rules; (4) `--propose <json>` — profiles и значения
измерений от proposer'а; (5) `--set <dim>=<value>` и `--set profile=<id>` (повторяемые) — значения человека, требуют `--by <login>`,
где `login` входит хотя бы в одну роль `roles` `warrant.json` (иначе `ROLE_REQUIRED`, код 3), и записываются с `from: human:<login>`.
Итог измерения = максимум по порядку значений [05 §4](../../../../docs/05-policy.md) из floor, proposer и human; каждое значение
SHALL нести `from` (`floor:<pack>:<rule-index>`, `proposer`, `human:<login>`, ранее записанное — `record`). `--set` ниже floor без
`--ref` SHALL отказывать с `BELOW_FLOOR`, код 3, record не изменён. Понижение ниже floor ([04 §8](../../../../docs/04-lifecycle.md)) SHALL
выполняться только как `--set <dim>=<value> --by <login> --ref <url>` (http(s) URL approval), где `login` входит в роль из `approvals[]`
перехода `SPECIFIED->APPROVED` effective policy (без `approvals[]` — `maintainer`; иначе `ROLE_REQUIRED`), и только при `change_state`
`PROPOSED` или `SPECIFIED` (иначе `STATE_INVALID`, код 3); значение записывается как `{ value, from: "human:<login>", ref }`, и
последующие `classify` SHALL сохранять его, пока нет нового `--set` этого измерения: floor по этому измерению попадает в `data.ignored[]`
с причиной `approved-below-floor`. `ref` не верифицируется до `warrant ci` (фаза 4). Повторный `classify` SHALL NOT понижать ранее
записанное значение измерения и SHALL NOT удалять ранее записанный profile. `risk_level` SHALL NOT записываться: его вычисляет resolver.
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
`Edit|Write|NotebookEdit`; при сгенерированном `AGENTS.md` — строку `@AGENTS.md` в `CLAUDE.md` (файла нет — создать); файл субагента
`.claude/agents/warrant-reviewer.md` целиком ([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md), ADR-0014 п. 3): frontmatter с `name: warrant-reviewer`,
`description`, `tools` без `Write`, `Edit` и `NotebookEdit` и хуком `PreToolUse` с matcher `Bash` и командой ровно
`warrant guard --frontend claude`, затем строка-маркер `<!-- generated by warrant — do not edit -->`, текст skill review pack'а
(skill `specification/adversarial-review` из lock) и порядок сдачи результата — envelope `warrant://skill-result/1` командой
`warrant run submit`. Во всех
случаях `sync` SHALL держать строку `.warrant/runs/current` в `.gitignore`. Чужие ключи, записи и строки этих файлов SHALL
сохраняться; `.claude/settings.json` пишется в каноническом JSON. `warrant init --frontend claude` SHALL записать
`frontends: ["claude"]` в новый `warrant.json`. `warrant validate` SHALL сверять `AGENTS.md` и `.claude/agents/warrant-reviewer.md` побайтно, а в `.claude/settings.json`,
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
- **THEN** `.claude/settings.json`, `.claude/agents/warrant-reviewer.md`, `CLAUDE.md` и `AGENTS.md` не создаются и не меняются, `.gitignore` содержит `.warrant/runs/current`

#### Scenario: Файл субагента review
<!-- id: SCN-KRN-139 -->
- **WHEN** `warrant sync` при `frontends: ["claude"]`
- **THEN** `.claude/agents/warrant-reviewer.md` начинается frontmatter с `name: warrant-reviewer`, `tools` не содержит `Write`, `Edit`, `NotebookEdit`, хук `PreToolUse` `Bash` вызывает `warrant guard --frontend claude`; тело содержит строку-маркер, текст skill `specification/adversarial-review` и `warrant run submit`; повторный `sync` не меняет ни одного байта

#### Scenario: Правленый файл субагента
<!-- id: SCN-KRN-140 -->
- **WHEN** в `.claude/agents/warrant-reviewer.md` изменена одна строка
- **THEN** `warrant validate` даёт `GENERATED_DRIFT` с путём файла и `hint` `` run `warrant sync` ``, код 3
