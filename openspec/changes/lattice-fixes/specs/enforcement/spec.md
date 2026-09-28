## MODIFIED Requirements

### Requirement: Команда guard
<!-- id: REQ-ENF-004 -->

`warrant guard` без `--frontend` SHALL читать из stdin нормализованное событие `{ phase: pre|post, action: edit|shell|other,
paths[], argv?, cwd }` ([ADR-0018](../../../../docs/adr/WARRANT-ADR-0018-frontend-adapters.md) п. 2) и печатать
`data{ decision: allow|deny, reason?, hints[] }`, код выхода 0 при любом решении. Пути события SHALL переводиться в пути проекта
от `cwd`; проект и активный Run SHALL определяться по `cwd` события — вызов, чей `cwd` лежит в другом checkout, судится
состоянием того checkout'а (предел, как INV-07); путь вне проекта SHALL давать `allow`, кроме правки при активном Run `review`
(ниже), и SHALL NOT записываться в `guard_events[].paths`; проект без `.warrant/warrant.json` SHALL давать `allow`. Решение
`pre`:
- `edit` при активном Run — `deny` для пути вне `write_scope` или вне непустого `scope` (reason называет путь и scope; hint —
  править внутри `write_scope`, а для других путей `warrant run finish`, затем `warrant run start` с операцией, которая их пишет),
  иначе `allow`; при активном Run `review` (пустой `write_scope`) — `deny` правки любого пути проекта с reason «Run review только
  читает» и правки пути вне проекта, который не лежит во временном каталоге ОС (`os.tmpdir()` процесса guard), с reason, что
  review пишет только файл envelope во временный каталог (путь вне проекта reason SHALL NOT называть — он попадает в
  `guard_events[]`), и hint с абсолютным путём этого каталога и `warrant run submit --file <файл в нём>`; временный каталог
  внутри проекта — `deny` с reason, что envelope в нём не записать; правка внутри временного каталога вне проекта — `allow`;
  принадлежность каталогу SHALL проверяться после разрешения ссылок и коротких имён (realpath каталога и ближайшего
  существующего предка пути; design I-198)
  ([ADR-0042](../../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) п. 4);
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
  ([ADR-0017](../../../../docs/adr/WARRANT-ADR-0017-check-execution.md) п. 5). Префикс по умолчанию, который вышел одним словом из
  списка интерпретаторов `node`, `deno`, `bun`, `python`, `python3`, `ruby`, SHALL дополняться флагами режима — словами
  `run.command`, которые начинаются с `-` и не содержат `=` и `{` (значение флага через пробел в них не входит); простая
  команда совпадает с таким префиксом, если её первое
  слово — этот интерпретатор и среди остальных слов есть каждый флаг режима, в любом порядке; без флагов режима — префикс из
  одного слова, как прежде; явные `guard_prefixes` сверяются строгим префиксом
  ([ADR-0042](../../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) п. 3);
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

#### Scenario: Флаги режима интерпретатора
<!-- id: SCN-ENF-040 -->
- **WHEN** check `tests-passed` с `execution.exclusive: true` без `guard_prefixes` и `run.command: ["node", "--experimental-strip-types", "--test", "--test-reporter=junit", "--test-reporter-destination={out}/junit.xml", "test/**/*.test.ts"]`, guard получает `pre` `shell` с `argv: ["bash", "-c", "node -e 1 && node --version && node scripts/build.js"]`, затем с `argv: ["bash", "-c", "node --test --experimental-strip-types test/a.test.ts"]`
- **THEN** первое — `allow`, второе — `deny` с hint `warrant check <change> tests-passed`; с `guard_prefixes: [["node", "--test"]]` первая строка — тоже `allow`, а `node --experimental-strip-types --test x` — `allow` (строгий префикс)

#### Scenario: Envelope во временном каталоге
<!-- id: SCN-ENF-041 -->
- **WHEN** при активном Run `review` guard получает `pre` `edit` пути `<os.tmpdir()>/review-envelope.json`, затем пути вне проекта и вне временного каталога, затем `openspec/changes/add-search/proposal.md`
- **THEN** первое — `allow`, второе и третье — `deny`; hint второго содержит абсолютный путь временного каталога и `warrant run submit --file`; в Run три события, у первых двух `paths` пуст

### Requirement: Команда run submit
<!-- id: REQ-ENF-007 -->

`warrant run submit [--file <path>] [--dry-run]` SHALL принять envelope `warrant://skill-result/1` из файла или, без `--file`, из
stdin для активного Run операции `review` ([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 10). Без
активного Run → `RUN_NOT_ACTIVE`; Run другой операции → `STATE_INVALID` с `hint` `warrant run finish`; envelope не проходит схему,
его `run` не равен id активного Run или `skill` не называет skill review pack'а с версией из диапазона pack →
`SKILL_RESULT_INVALID` с JSON Pointer и `data.received{ bytes, root, keys[] }` — длина полученного текста в байтах UTF-8 (после
снятия BOM), тип корня JSON (`object`, `array`, `string`, `number`, `boolean`, `null` или `not-json`) и ключи верхнего уровня
объекта в порядке code units (иначе пусто), без значений ([ADR-0042](../../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) п. 4);
относительный `--file` SHALL разрешаться от корня проекта, файл, который не читается (нет, каталог, нет прав), — `USAGE` с `path`
и `hint` без `data.received`; пустой или пробельный файл и такой же stdin — `USAGE`; `data.received` SHALL нести каждый
`SKILL_RESULT_INVALID`, в том числе несовпадение `run` и `skill` (design I-199);
каждая ошибка SHALL нести `hint`, код выхода 3, ничего не записано. Иначе команда SHALL:
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

#### Scenario: Что получено
<!-- id: SCN-ENF-042 -->
- **WHEN** `warrant run submit` получает на stdin `{"$schema":"warrant://skill-result/1","run":"RUN-…","findings":[]}`, затем текст `not json`
- **THEN** оба — `SKILL_RESULT_INVALID`, код 3; первое — `data.received` с `root: "object"`, `keys: ["$schema", "findings", "run"]` и `bytes` — длиной входа в UTF-8; второе — `root: "not-json"`, `keys: []`; значения полей envelope в выводе не повторяются; `--file` на несуществующий путь — `USAGE` с `path`, без `data.received`; `--file` на файл из пробелов — `USAGE`; envelope с чужим `run` (SCN-ENF-033) — `data.received` с `root: "object"`
