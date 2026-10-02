## MODIFIED Requirements

### Requirement: Команда guard
<!-- id: REQ-ENF-004 -->

`warrant guard` без `--frontend` SHALL читать из stdin нормализованное событие `{ phase: pre|post, action: edit|shell|other,
paths[], argv?, cwd }` ([ADR-0018](../../../../docs/adr/WARRANT-ADR-0018-frontend-adapters.md) п. 2) и печатать
`data{ decision: allow|deny, reason?, hints[] }`, код выхода 0 при любом решении. Пути события SHALL переводиться в пути проекта
от `cwd`; проект и активный Run SHALL определяться по `cwd` события, а не по каталогу, в котором запущен процесс guard. Checkout под
WARRANT — каталог, в котором есть и `.warrant/warrant.json`, и `.git` (каталог или файл git worktree); каталог только с
`.warrant/warrant.json` (например, проект golden pack) — часть объемлющего проекта. Проект события — ближайший к `cwd`
checkout под WARRANT, включая сам `cwd`; если такого нет — каталог процесса guard. Относительный `cwd` берётся от каталога
процесса; подъём идёт по тексту пути, без `realpath`, и проходит каталоги, которых нет. Вход, который не разбирается как
событие, судится в каталоге процесса. Вызов, чей `cwd` лежит в другом checkout, судится состоянием того checkout'а (предел,
как INV-07). Путь другого checkout'а под WARRANT — того, что ближе всех к пути среди его предков и не является проектом
события, в том числе вложенного в каталог проекта (git worktree внутри него) или объемлющего проект, — путь вне проекта. При
активном Run, кроме `review` (ниже), правка такого пути SHALL давать `deny`: reason — путь лежит в другом checkout'е под
WARRANT, а Run судит только свой; hint — править из сессии того checkout'а или сначала `warrant run finish`; ни reason, ни
hint путь не называют. Путь вне проекта SHALL давать `allow`, кроме правки при активном Run `review`
(ниже), и SHALL NOT записываться в `guard_events[].paths`; событие `edit` без пути проекта SHALL решаться до загрузки policy —
policy, которая не грузится, его не запрещает ([ADR-0053](../../../../docs/adr/WARRANT-ADR-0053-guard-recovery.md) п. 2);
проект без `.warrant/warrant.json` SHALL давать `allow`. Если `warrant.json` задаёт `cli` ([REQ-KRN-004](../kernel/spec.md)),
простая команда, чьи первые слова — `node` и ровно значение `cli`, SHALL читаться в строгих формах ниже (Run `review` и
восстановление) как `warrant` с теми же остальными словами — так сгенерированный субагент сдаёт результат закреплённым CLI
([REQ-KRN-033](../kernel/spec.md)), — но только если каждый каталог, в котором строка может оказаться к этой команде (`cwd`
события и `cd` раньше в строке), после `realpath` — корень проекта: из другого каталога `node <cli>` исполняет другой файл.
`warrant.json`, которого нет или который не разбирается как JSON-объект, и `cli`, который не строка или не проходит шаблон
REQ-KRN-004, алиаса не дают; команда без алиаса судится как любая другая не `warrant`. При `cli`, который проходит шаблон,
команды `warrant` в hints Run `review` и режима восстановления SHALL называться в форме `node <cli>` с оговоркой «из корня
проекта». Решение
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
- `shell` при активном Run `review` — `allow`, только если каждая простая команда строки после shell-разбора — строгая форма
  `warrant run submit` (прежние правила: heredoc — данные, I-167) или команда без записи
  ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 5):
  - `warrant status [...]`, `warrant gate <change> [...]` (обе ничего не пишут), `warrant <слова> --help` или `-h`, где слова —
    только имена подкоманд (`warrant -- --help` — `deny`), `warrant run finish --state CANCELLED [--dry-run]`;
  - `git status | log | diff | show [...]`: подкоманда — первое слово после `git` (глобальные опции `-c`, `-C`, `--git-dir` и
    любые другие перед подкомандой — `deny`), ни один аргумент не начинается с `-o`, не равен префиксу `--output` длиной от
    `--ou` и не начинается с `--output=`, не равен префиксу `--ext-diff` длиной от `--ext` (`--oneline`, `--ours` разрешены;
    design I-207, I-210);
  - `cd <путь>` — ровно один путь, который не начинается с `-` и `~`, если путь после `realpath` лежит внутри проекта события от
    каждого каталога, в котором строка может оказаться к этому месту (`cd`, который не удался, оставляет прежний каталог:
    `cd a || cd ..` — `deny`); иначе `deny`: `run finish` и `run submit` без id Run действуют на Run того checkout, куда ведёт
    `cd` (design I-202, I-210).

  Строгая форма команды без записи: простые команды соединены только `&&`, `||`, `;` и переводом строки; перенаправление (в том
  числе `<<` без разделителя и `<<<`), конвейер `|`, `&`, подстановка `$(…)` или `` `…` ``, присваивание `VAR=…`, группы `( … )`
  и `{ …; }`, `!` — `deny`; слово, в котором после снятия кавычек есть `<`, `>`, `&`, `$`, `` ` ``, `(`, `)`, `{` или `}`, — `deny`
  (раскрытия `$VAR` и `{a,b}` собирают запрещённый аргумент); тело heredoc такой команды — данные: frontend и разбор `bash -c`
  отбрасывают его до решения, как у `warrant run submit` (I-167); строка только из `warrant run submit` сохраняет прежние
  соединители; `--state=CANCELLED` равен `--state CANCELLED` (design I-207, I-210). Иначе `deny` с hint, называющим
  `warrant run submit`, отмену `warrant run finish --state CANCELLED` и `warrant status`;
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
- внутренний сбой (невалидное событие, битый Run) — `deny` с reason и hint `warrant validate`;
- policy, которая не грузится (любая ошибка загрузки `warrant.json` и packs: `PACK_VERSION_RANGE`, `CONFIG_INVALID`,
  `PACK_NOT_FOUND` и другие), там, где решению выше нужна policy, — режим восстановления, а не `deny` на всё
  ([ADR-0053](../../../../docs/adr/WARRANT-ADR-0053-guard-recovery.md) п. 2). Правило Run `review` и `allow` внутри `write_scope`
  активного Run policy не нужна, и они не меняются; отказ вне `write_scope` активного Run (ему policy нужна для hints) решает
  этот режим. Fail-closed остаётся только для правки путей проекта:
  - `edit`, чьи пути проекта — только `.warrant/warrant.json` (закрепление), — `allow` с hint `warrant sync`, в том числе вне
    `write_scope` активного Run;
  - иной `edit` пути проекта — `deny`; reason этого режима, а при активном Run — ещё путь и `write_scope`;
  - `shell` — `allow`, только если каждая простая команда строки — команда восстановления `warrant sync [...]`,
    `warrant validate [...]`, `warrant status [...]`, `warrant --version` или `warrant -V`, либо команда без записи списка Run
    `review` (`warrant gate <change> [...]`, `warrant <слова> --help` или `-h`, `git status | log | diff | show` с теми же
    ограничениями, `cd` внутри проекта), и строка — в строгой форме команды без записи (выше); иначе `deny`. `warrant run submit`
    и `warrant run finish` в этот список не входят: восстановлению они не нужны, а пишут файлы Run;
  - ошибка режима — первая ошибка загрузки с кодом `PACK_VERSION_RANGE`, а без неё — первая ошибка загрузки; reason и hints
    `deny` SHALL строиться по ней. Reason: её код, путь и сообщение, версия CLI, версия каждого встроенного pack, диапазон
    каждого pack и `kernel` из `warrant.json`; `warrant.json`, который не читается, диапазонов и `kernel` не даёт. Путь вне
    проекта (`pack.json` встроенного pack) reason SHALL NOT называть — он попадает в `guard_events[]` коммитимого Run; вместо
    него — источник «pack <id>, bundled with CLI <версия>». Hints: `hint` ошибки режима, если он есть, — его команды тоже в
    форме `node <cli>` при `cli`, как выше; затем выход:
    - `PACK_VERSION_RANGE` встроенного pack, чья версия выше каждой версии диапазона (CLI новее закрепления), — pin-Change:
      поднять `packs.<id>.version` и `kernel` в `.warrant/warrant.json` до версий, которые несёт CLI, затем `warrant sync`;
    - `PACK_VERSION_RANGE` встроенного pack, чья версия ниже каждой версии диапазона, и `PACK_NOT_FOUND` с путём
      `.warrant/warrant.json#/packs/<id>` (CLI такого pack не несёт) — CLI старше закрепления, `warrant.json` не менять
      (у `PACK_NOT_FOUND` — разве что id pack написан неверно): без `cli` — поставить на машину CLI тега, который закрепил
      проект; при `cli` — обновить файл `cli` (`npm ci`, `npm run build`); это делает maintainer вне сессии агента;
    - прочая `PACK_VERSION_RANGE` — pack из `.warrant/local/` и версия, которая ни выше, ни ниже диапазона, — исправить
      `.warrant/warrant.json`: задать диапазон, который содержит версию pack (правка разрешена), затем `warrant validate`;
    - иная ошибка, чей путь — `.warrant/warrant.json` с фрагментом `#/…` или без него, — исправить этот файл (правка
      разрешена), затем `warrant validate`;
    - иная ошибка с другим путём, кроме `PACK_VERSION_RANGE`, — правку названного файла делает человек (maintainer) вне сессии
      агента, в Change `factory-change`;

    и перечень того, что guard разрешает, пока policy не грузится.

Исключение runner'а `warrant guard` без `--frontend` до решения (например, сбой чтения stdin) SHALL давать решение внутреннего
сбоя по фазе события, как исключение, которое не перехватил никто ([REQ-KRN-003](../kernel/spec.md)): `pre` или фаза неизвестна
— `deny` с hint `warrant validate`, `post` — `allow` без hints; сообщение — в stderr, код 0, а не `INTERNAL` с кодом 3.
Исключение после выведенного решения — только сообщение в stderr, код 0, второго ответа нет.

Решение `post` SHALL быть `allow`; `hints[]` — находки [`validate --files`](../kernel/spec.md) по путям события (не больше 10
строк + «и ещё N») и текст правил `rule/1`, чьи `paths` подходят под путь и чьих id ещё нет в `rules_shown` событий Run
([ADR-0022](../../../../docs/adr/WARRANT-ADR-0022-path-rules.md) п. 3); без активного Run вместо текста правил — hint
`warrant run start` `pre` для правки пути проекта (design I-165); правка `.warrant/warrant.json` SHALL давать hint
`warrant sync` (форма `node <cli>`, как выше) — без Run вместо `warrant run start`, при Run рядом с находками и правилами; сбой `post` SHALL давать `allow` без hints и сообщение
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
- **WHEN** guard вызван в каталоге без `.warrant/warrant.json`, и у `cwd` события и его предков нет checkout'а под WARRANT,
  или вход не разбирается как событие
- **THEN** `decision` равен `allow` для любой фазы и действия, событий не пишется

#### Scenario: Правка под review
<!-- id: SCN-ENF-026 -->
- **WHEN** при активном Run `review` guard получает `pre` `edit` пути `openspec/changes/add-search/proposal.md`
- **THEN** `decision` равен `deny`, `reason` говорит, что Run review только читает; в Run добавлено событие с `decision: "deny"`

#### Scenario: Shell под review
<!-- id: SCN-ENF-027 -->
- **WHEN** при активном Run `review` guard получает `pre` `shell` с `argv: ["bash", "-c", "warrant run submit --file result.json"]`, затем с `argv: ["bash", "-c", "cat x && warrant run submit"]`
- **THEN** первое — `allow`, второе — `deny` с hint, называющим `warrant run submit` и `warrant run finish --state CANCELLED`

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

#### Scenario: Чтение и отмена под review
<!-- id: SCN-ENF-044 -->
- **WHEN** при активном Run `review` guard получает `pre` `shell` с `argv: ["bash", "-c", "warrant status add-search"]`, затем `["bash", "-c", "git diff main -- openspec && warrant gate add-search"]`, затем `["bash", "-c", "warrant run finish --state CANCELLED"]`; затем `["bash", "-c", "git diff --outp=x.patch"]`, `["bash", "-c", "git -c diff.external=x diff"]`, `["bash", "-c", "warrant status > s.txt"]`, `["bash", "-c", "git log | head"]`, `["bash", "-c", "warrant run finish"]` и `["bash", "-c", "cd ../other && warrant run finish --state CANCELLED"]` (`../other` вне проекта); `["bash", "-c", "git log --oneline"]`
- **THEN** первые три и последняя — `allow`; остальные шесть — `deny` с hint, называющим `warrant run finish --state CANCELLED`

#### Scenario: Правка при policy, которая не грузится
<!-- id: SCN-ENF-048 -->
- **WHEN** `warrant.json` закрепил `core-sdd` `^0.3.4` и `kernel` `0.8`, CLI несёт `core-sdd` 0.4.1, активного Run нет, а guard получает `pre` `edit` пути `src/app.ts` при `paths.src: "src"`, затем `.warrant/warrant.json`, затем путь вне проекта
- **THEN** первое — `deny`: `reason` содержит `PACK_VERSION_RANGE`, версию CLI, `0.4.1`, `^0.3.4` и `0.8`, называет `pack core-sdd, bundled with CLI` и не содержит пути вне проекта, `hints[]` называет `.warrant/warrant.json` и `warrant sync`; второе — `allow` с hint `warrant sync`; третье — `allow`

#### Scenario: Shell при policy, которая не грузится
<!-- id: SCN-ENF-049 -->
- **WHEN** policy не грузится, как в SCN-ENF-048, а guard получает `pre` `shell` с `argv: ["bash", "-c", "git log --oneline"]`, затем `["bash", "-c", "warrant sync && warrant validate"]`, `["bash", "-c", "warrant --version"]`, `["bash", "-c", "warrant status add-search"]`, затем `["bash", "-c", "npm test"]`, `["bash", "-c", "git log | head"]`, `["bash", "-c", "warrant sync > out.txt"]`
- **THEN** первые четыре — `allow`; последние три — `deny`, `reason` называет версию CLI, `0.4.1` и `^0.3.4`, `hints[]` перечисляет разрешённые команды

#### Scenario: Policy, которая не грузится, при активном Run
<!-- id: SCN-ENF-050 -->
- **WHEN** policy не грузится, активен Run `implement` с `write_scope` `src/**`, а guard получает `pre` `edit` пути `src/app.ts`, затем `docs/notes.md`, затем `.warrant/warrant.json`, затем `post` `edit` пути `.warrant/warrant.json`, затем `pre` `shell` с `argv: ["bash", "-c", "pytest -q"]`
- **THEN** первое и третье — `allow`, второе и пятое — `deny` с `reason` о policy, которая не грузится (второе называет ещё `docs/notes.md` и `write_scope`); четвёртое — `allow` с hint `warrant sync`; в Run пять событий

#### Scenario: Закреплённый CLI в строгой форме
<!-- id: SCN-ENF-051 -->
- **WHEN** `warrant.json` задаёт `cli: "tools/warrant.js"`; при активном Run `review` guard получает `pre` `shell` с `argv: ["bash", "-c", "node tools/warrant.js run submit --file r.json"]`, затем `["bash", "-c", "node other.js run submit --file r.json"]`; без Run при policy, которая не грузится из-за `PACK_VERSION_RANGE` (как в SCN-ENF-048), — `["bash", "-c", "node tools/warrant.js sync"]`, затем `["bash", "-c", "cd docs && node tools/warrant.js sync"]` (`docs` — каталог проекта), затем `pre` `edit` пути `src/app.ts`
- **THEN** первое и третье — `allow`, второе и четвёртое — `deny`; `hints[]` второго называют `node tools/warrant.js run submit`, `hints[]` последнего, в том числе `hint` ошибки загрузчика, — `node tools/warrant.js sync` и «из корня проекта» и не называют `warrant sync` без `node tools/warrant.js`

#### Scenario: CLI старше закрепления
<!-- id: SCN-ENF-054 -->
- **WHEN** `warrant.json` закрепил `core-sdd` `^0.5.0`, CLI несёт `core-sdd` 0.4.1, активного Run нет, а guard получает `pre` `edit` пути `src/app.ts` при `paths.src: "src"`
- **THEN** `deny`: `reason` называет `0.4.1` и `^0.5.0`, `hints[]` называет установку CLI тега, который закрепил проект, и не советует менять `packs.core-sdd.version`; при `packs.core-xyz` (pack, которого CLI не несёт) — `PACK_NOT_FOUND`, тот же выход; при `cli` — обновить файл `cli`, а не CLI тега

#### Scenario: Локальный pack вне диапазона
<!-- id: SCN-ENF-055 -->
- **WHEN** `warrant.json` подключает pack `team` из `.warrant/local/team/` версии `1.0.0` с диапазоном `^2.0.0`, а guard получает `pre` `edit` пути `src/app.ts` при `paths.src: "src"`
- **THEN** `deny`: `hints[]` советует исправить диапазон в `.warrant/warrant.json` и не называет ни pin-Change, ни CLI тега, ни Change `factory-change`

#### Scenario: Исключение runner'а guard
<!-- id: SCN-ENF-052 -->
- **WHEN** чтение stdin в `warrant guard` без `--frontend` завершается исключением
- **THEN** stdout — envelope `guard` с `data.decision: "deny"` и hint `warrant validate`, stderr называет причину, код выхода 0

#### Scenario: Хук из другого каталога
<!-- id: SCN-ENF-056 -->
- **WHEN** каталог процесса guard — проект без активного Run или каталог не под WARRANT, а событие несёт `cwd` другого
  checkout'а под WARRANT (или его подкаталога), где Run `RUNNING`, и абсолютный путь в этом checkout'е; так же через
  `warrant guard --frontend claude`
- **THEN** `pre` правки вне `write_scope` этого Run — `deny`, внутри — `allow`; события записаны в `guard_events[]` Run
  того checkout'а, в каталоге процесса Run и событий нет; `post` правки внутри `write_scope` не даёт hint `warrant run start`

#### Scenario: cwd вне checkout'ов
<!-- id: SCN-ENF-057 -->
- **WHEN** у `cwd` события и его предков нет checkout'а под WARRANT, а каталог процесса guard — проект с Run `RUNNING`
- **THEN** событие судится в каталоге процесса: правка его пути, заданного абсолютно, вне `write_scope` — `deny`, событие
  записано в его Run; путь, заданный от такого `cwd` относительно, лежит вне проекта — `allow`

#### Scenario: Путь другого checkout'а
<!-- id: SCN-ENF-058 -->
- **WHEN** событие с `cwd` git worktree'а, где Run `implement` `RUNNING`, правит путь основного checkout'а, объемлющего этот
  worktree; событие с `cwd` основного checkout'а, где Run `implement` `RUNNING`, правит путь git worktree'а
  `.claude/worktrees/<имя>/…`; то же без активного Run; под активным Run `review` основного checkout'а — строка
  `cd .claude/worktrees/<имя> && git status`
- **THEN** при Run `implement` обе правки — `deny`, reason и hint пути не называют, события записаны в Run проекта события без
  этих путей; без Run — `allow` без hints, событий нет; строка с `cd` под Run `review` — `deny`

#### Scenario: Каталог только с warrant.json
<!-- id: SCN-ENF-059 -->
- **WHEN** `cwd` события — каталог проекта с `.warrant/warrant.json` без `.git` (`packs/core-sdd/golden/feature`), у
  проекта Run `implement` `RUNNING`, а событие правит абсолютный путь проекта вне `write_scope`
- **THEN** проект события — объемлющий checkout: `deny`, событие записано в его Run

### Requirement: Адаптер claude
<!-- id: REQ-ENF-005 -->

`warrant guard --frontend claude` SHALL читать из stdin родной вход хука Claude Code (`hook_event_name` `PreToolUse` |
`PostToolUse`, `tool_name`, `tool_input`, `cwd`), переводить его в нормализованное событие — `Edit`, `Write` (`file_path`) и
`NotebookEdit` (`notebook_path`) → `edit`, `Bash` (`command`) → `shell`, иначе `other` — и печатать родной ответ: `deny` →
`hookSpecificOutput.permissionDecision: "deny"` с `permissionDecisionReason` из reason и hints; `allow` — без
`permissionDecision` (решает обычный механизм разрешений Claude Code), hints `PostToolUse` — в
`hookSpecificOutput.additionalContext`; `allow` `PreToolUse` — пустой stdout (`additionalContext` `PreToolUse` доходит до
модели только после результата инструмента — зонд Claude Code 2.1.263, design I-165). При policy, которая не грузится,
адаптер SHALL отвечать по режиму восстановления REQ-ENF-004: разрешённое — пустой stdout, отказ — `permissionDecision: "deny"`,
чей `permissionDecisionReason` несёт reason с версиями и все hints, включая шаги pin-Change
([ADR-0053](../../../../docs/adr/WARRANT-ADR-0053-guard-recovery.md) п. 2).
Проект — по `cwd` родного входа, как в REQ-ENF-004. Код выхода SHALL быть 0; вход, который нельзя разобрать, SHALL давать
код 2 и причину в stderr (Claude Code отменяет действие `PreToolUse`), а если каталог процесса guard не под WARRANT — пустой
stdout и код 0, как событие проекта не под WARRANT (SCN-ENF-016). Коды этого адаптера — ответ протоколу хуков Claude Code, а не коды [REQ-KRN-003](../kernel/spec.md): код 2 здесь
не `WAIT`, и таблица классов ошибок его не меняет ([ADR-0052](../../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 2). Исключение,
не перехваченное адаптером, SHALL давать код 2, причину в stderr и пустой stdout — как неразборчивый вход (fail-closed: Claude Code
отменяет действие), а не `INTERNAL` с кодом 3, который Claude Code считает неблокирующей ошибкой; исключение после выведенного
ответа — тоже код 2, причина в stderr, второго ответа нет. Имя frontend SHALL встречаться только в адаптере, генераторе `sync` и значении `--frontend`
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
- **WHEN** в `warrant guard --frontend claude` в каталоге проекта под WARRANT подан не-JSON; тот же вход — в каталоге не под WARRANT
- **THEN** первый — код выхода 2, stderr называет причину, stdout пуст; второй — stdout пуст, код 0

#### Scenario: Исключение адаптера
<!-- id: SCN-ENF-046 -->
- **WHEN** обработка разобранного входа `PreToolUse` в `warrant guard --frontend claude` завершается исключением, которое адаптер не перехватил
- **THEN** код выхода 2, stderr называет причину, stdout пуст (нет `INTERNAL`); исключение после выведенного ответа — код 2, stdout содержит только первый ответ

#### Scenario: Восстановление через адаптер
<!-- id: SCN-ENF-053 -->
- **WHEN** policy не грузится, как в SCN-ENF-048, а в `warrant guard --frontend claude` поданы записанные входы `PreToolUse` `Bash` с `command: "git status"`, `Write` с `file_path` `.warrant/warrant.json`, `Edit` с `file_path` `src/app.ts`, затем `PostToolUse` `Write` с `file_path` `.warrant/warrant.json`
- **THEN** первые два — пустой stdout, код 0; третий — `permissionDecision: "deny"`, `permissionDecisionReason` содержит версию CLI, `^0.3.4` и `warrant sync`, код 0; четвёртый — `hookSpecificOutput.additionalContext` содержит `warrant sync` и не содержит `warrant run start`, `permissionDecision` нет
