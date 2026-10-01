# Design: guard-recovery

## Context

База — `main` `7517c82`: CLI 0.10.0 не выпущен, pack `core-sdd` 0.4.1, `kernel` 0.10. Норма — [ADR-0053](../../../docs/adr/WARRANT-ADR-0053-guard-recovery.md) п. 2–5 и [ADR-0055](../../../docs/adr/WARRANT-ADR-0055-release-for-lattice.md): этот Change закрывает 0.10.0. Факты кода собраны 2026-10-01 на `7517c82`; пути — от `packages/cli/src`.

**guard сейчас** (`core/guard/guard.ts`, `core/guard/decide.ts`):
- `decide` → `pre` → `decidePre`. Всё, что бросает `decidePre`, ловит `failedClosed`: `deny` с reason `guard failed: …` и hint `warrant validate`.
- `loadPolicy` бросает первую ошибку `loadPacks` как `WarrantError` с сообщением «the policy does not load: …». Версий в нём нет.
- Policy нужна трём веткам `decidePre`:
  - `edit` без Run — `editWithoutRun(loadPolicy(...))`. policy грузится раньше, чем смотрятся пути, поэтому событие только с путями вне проекта тоже даёт `deny`. В этом и дефект «запись в `D:/tmp` запрещена»;
  - `edit` с Run не `review` — `editWithRun(run, files, () => classes(loadPolicy(...)))`. Классы путей нужны только для hints отказа вне `write_scope`; `allow` внутри `write_scope` policy не грузит;
  - `shell` без Run `review` — `shellAnswer(argv, guardedChecks(loadPolicy(...)))`. Любой Bash даёт `deny`.
- Ветки Run `review` (`reviewEditAnswer`, `reviewShellAnswer`) policy не грузят. Строгая форма команды без записи — `isReading` (`warrant status|gate|--help`, `git status|log|diff|show`, `cd` внутри проекта), соединители `READING_JOINS`, запрет `UNSAFE_WORD_RE`. Её можно переиспользовать.
- `projectFiles` отбрасывает пути вне проекта и корень. `activeRun` бросает при битом `current` — это остаётся `deny` на всё (F9).

**R-46** (`bin/warrant.ts`, action `guard` без `--frontend`). `run("guard", runner)` ловит исключение runner'а через `resultFromThrown` и даёт `INTERNAL` с кодом 3. Для исключений, которые не перехватил никто, верное решение уже даёт `runGuardCrash(input, thrown)` (`commands/guard.ts`, `bin/crash.ts`). Тест на уровне `bin` требует процесса. Сбой чтения stdin в e2e не воспроизвести.

**Сообщение загрузки** (`core/packs/loader.ts:497-503`). Сейчас `PACK_VERSION_RANGE`: «pack core-sdd version 0.4.1 does not satisfy the configured range "^0.3.4"», hint «set packs.core-sdd.version … then run `warrant sync`». Версии CLI в нём нет. `warrant ci` различает эту ошибку по коду и пути (design `exit-contract` D8), а не по тексту.

**Генератор `claude`** (`core/sync/claude.ts`):
- `GUARD_COMMAND = "warrant guard --frontend claude"` — константа.
- Своя группа хуков опознаётся точным равенством команды (`isGuardHook`). `own` и `merge` сверяют группу по `canonicalHash`.
- `reviewerAgent(skill)` пишет хук frontmatter `command: "${GUARD_COMMAND}"` и раздел «Сдача результата» с `warrant run submit`.
- `plan.ts:364-367` зовёт `reviewerAgent` только при `frontends ∋ "claude"`.

**SRA.**
- В `warrant.json` нет `frontends`, поэтому guard основной сессии выключен (ADR-0034 п. 4).
- `.claude/agents/warrant-reviewer.md` закоммичен и равен выводу генератора для `warrant.json` SRA с `frontends: ["claude"]`. Это держит мета-тест `test/unit/meta/reviewer-agent.test.ts`, а белый список хуков frontmatter — `dev-hooks.test.ts`.
- Навыки SRA уже исполняют dev-CLI явно: `W=node packages/cli/dist/bin/warrant.js`. От PATH зависят только хук субагента и его `warrant run submit`. Навык `change-spec-pr` шаг 3 поэтому требует `warrant` в PATH (`npm link`).
- Свои хуки разработки `.claude/settings.json` SRA пишет как `node "${CLAUDE_PROJECT_DIR}/scripts/dev/….js"`. Эта форма работает на этой машине (Windows, Git Bash) — её исполнил хук `SessionStart` этой сессии.

**LATTICE** (потребитель):
- `.claude/settings.json` — хуки `warrant guard --frontend claude` из `sync`;
- `warrant.json` — `kernel` `0.8`, `core-sdd` `^0.3.4`;
- Node-проект (`package.json`, `node_modules`).

## Goals / Non-Goals

**Goals:**
- Пока policy не грузится, путь восстановления открыт:
  - событие вне проекта;
  - правка `.warrant/warrant.json`;
  - `warrant sync|validate|status|--version`;
  - команды без записи.
- Правка остальных путей проекта при этом — `deny`.
- Отказ называет версии CLI, встроенных packs, диапазоны и `kernel`, а также шаги pin-Change.
- Хук и субагент исполняют CLI, который закрепил проект. SRA — свой dev-CLI, независимо от PATH.
- R-46: исключение runner'а `guard` даёт `deny` с кодом 0.

**Non-Goals:** WS-26 (шум guard); битый Run, `BUSY`, невалидное событие; переадресация `warrant` (D3); установка CLI командой; `cli` в `warrant init`.

## Decisions

### 1. Решения

**D1. Режим восстановления — там, где решению нужна policy** (REQ-ENF-004).
- `loadPolicy` бросает новый тип `PolicyNotLoaded` (`core/guard/guard.ts`). Он несёт первую ошибку загрузки и сведения для reason (D2).
- `decidePre` ловит его отдельно от `failedClosed`. Порядок решения:
  1. ветки Run `review` — без изменений;
  2. `edit` без пути проекта (`files` пуст) — `allow` до загрузки policy;
  3. прежние ветки. Если policy понадобилась и не загрузилась, ответ даёт `recoveryAnswer(event, files, failure, cli)` (`decide.ts`, чистая функция).
- `recoveryAnswer` решает так:
  - `edit`, все `files` которого равны `.warrant/warrant.json`, — `allow` с hint `warrant sync`;
  - иной `edit` — `deny`;
  - `shell` — `allow`, если каждая простая команда — `isReading` или `isRecovery`, соединители — `READING_JOINS`, без `UNSAFE_WORD_RE`. Иначе `deny`.
- `isRecovery` — `warrant sync [...]`, `warrant validate [...]`, `warrant status [...]` (он уже в `isReading`), `warrant --version`, `warrant -V`. `--help` и `-h` уже даёт `isReading`. `warrant run submit` и `run finish` (в том числе отмена) в режим не входят: восстановлению они не нужны, а пишут файлы Run.
- `allow` внутри `write_scope` активного Run остаётся без policy, как сейчас. Отказ вне `write_scope` при незагружаемой policy тоже уходит в `recoveryAnswer`: правка только `.warrant/warrant.json` проходит и при Run.
- Отказ вне `write_scope` в режиме несёт reason режима и ещё путь и `write_scope`, как прежний отказ `editWithRun`.
- `post` правки `.warrant/warrant.json` даёт hint `warrant sync`: без Run — вместо `RUN_START_HINT`, при Run — рядом с находками и правилами. После правки закрепления следующий шаг — `sync`. Hint `pre` при `allow` до модели не доходит (I-165), поэтому нужен hint `post`.
- Событие записывается в `guard_events[]` как прежде. Замок и `BUSY` не меняются.

**D2. Reason и hints режима** (REQ-ENF-004, ADR-0053 п. 2).
- Ошибка режима — первая `PACK_VERSION_RANGE` среди ошибок загрузки, без неё — первая ошибка. Reason и hints строятся по одной ошибке и не расходятся.
- Reason: `the policy does not load (<CODE> <path>: <message>): CLI <CLI_VERSION> carries <id> <version>[, …]; warrant.json pins <id> <range>[, …], kernel <kernel>`.
- Источники:
  - версии встроенных packs — новая функция `bundledPackVersions()` в `core/packs/loader.ts`, `pack.json` каталога bundled;
  - диапазоны и `kernel` — терпимое чтение `warrant.json` (сырой JSON, без `loadConfig`, который бросает на невалидной схеме). Файл не читается — части `pins` нет.
- Hints по порядку:
  1. `hint` ошибки режима, если он есть;
  2. выход:
     - `PACK_VERSION_RANGE` встроенного pack (source `bundled`), версия выше диапазона (`semver.gtr`, через `core/version-range.ts` — единственного владельца `semver`, A-19), — `PIN_UP_HINT`: поднять `packs.<id>.version` и `kernel` до версий CLI, затем `warrant sync`;
     - встроенный pack ниже диапазона (`semver.ltr`) и `PACK_NOT_FOUND` с путём `.warrant/warrant.json#/packs/<id>` — `CLI_OLDER_HINT`: `warrant.json` не менять. Без `cli` — CLI тега на машину, при `cli` — обновить файл `cli` (`npm ci`, `npm run build`): хук уже исполняет его, совет «исполнить `cli`» был бы круговым. Делает maintainer вне сессии. Совет «поднять до версий CLI» вёл бы к откату закрепления, а «исправить `warrant.json`» при `PACK_NOT_FOUND` — к удалению pack;
     - иная ошибка с путём `.warrant/warrant.json` (с фрагментом `#/…` или без) — исправить его (правка разрешена), затем `warrant validate`. Сюда же — pack из `.warrant/local/` вне диапазона и версия ни выше, ни ниже (`^0.3.0 || ^0.5.0` при 0.4.1): направление о версиях CLI для них неверно;
     - иная ошибка с другим путём (битый `.warrant/local/**`) — `HUMAN_ONLY_HINT`: правку делает maintainer в Change `factory-change`; pin-Change туда не ведёт;
  3. `RECOVERY_HINT` — что guard разрешает, пока policy не грузится.
- Тот же выбор по направлению — в `hint` `PACK_VERSION_RANGE` загрузчика (delta REQ-KRN-021).
- При `cli`, который проходит шаблон, команды в hints режима и Run `review` (`SUBMIT_HINT`, hint временного каталога) пишутся как `node <cli> …` с оговоркой «из корня проекта»: алиас действует только оттуда (D4). Агент, который выполнит hint буквально, не уйдёт в PATH. Константы hints становятся функциями от формы команды.
- Адаптер `claude` склеивает reason и hints в `permissionDecisionReason` — как сейчас (REQ-ENF-005).
- Сообщение `PACK_VERSION_RANGE` встроенного pack называет и CLI: «pack core-sdd 0.4.1 bundled with CLI 0.10.0 does not satisfy the configured range "^0.3.4"». Hint добавляет `kernel`. Код и путь не меняются: на них держится D8 `exit-contract`. Это та же находка `validate` и `post`-hints — «находка» ADR-0053 п. 2; норма — delta REQ-KRN-021, SCN-KRN-167.

**D3. Закреплённый CLI — поле `cli` и генератор, без переадресации** (REQ-KRN-004, REQ-KRN-033).
- `cli` — путь к файлу входа CLI от корня проекта. Значения:
  - SRA — `packages/cli/dist/bin/warrant.js`;
  - Node-потребитель — `node_modules/warrant/packages/cli/dist/bin/warrant.js` после `npm i -D <tgz тега>`.
- Шаблон схемы не пропускает пробел, кавычки, `$`, `..`, абсолютный путь. Поэтому команда собирается без экранирования: `node "${CLAUDE_PROJECT_DIR:-.}/<cli>" guard --frontend claude`.
- `${CLAUDE_PROJECT_DIR:-.}` — потому что `cwd` хука не обязан быть корнем, а переменная Claude Code может не дойти до хука. Зонд 2026-10-01, Claude Code 2.1.283, `claude -p` во временном проекте:
  - хук `settings.json` получает `CLAUDE_PROJECT_DIR` — корень проекта;
  - форма `${CLAUDE_PROJECT_DIR:-.}` раскрывается в него же, а без переменной (`env -u`, Git Bash) — в `.`;
  - хук frontmatter субагента в `claude -p` не исполнился ни в одной форме, в том числе с абсолютным путём. Это не зависит от формы команды. Прежний зонд I-168 был интерактивным; повтор — задача 4.3.
- По пути `cli` нет обычного файла (`statSync().isFile()` после ссылок: нет пути, каталог, битая ссылка) при `frontends ∋ "claude"` — `sync` и `sync --check` дают находку `CLI_NOT_FOUND`, как `REVIEWER_SKILL_MISSING`: код выхода она не меняет. Без `frontends` хуков нет, и находки нет (SRA). `validate` файл не проверяет: в CI потребителя зависимости проекта могут быть не установлены.
- Без `cli` байты сгенерированных файлов не меняются: у потребителя без поля дрейфа нет.
- Во frontmatter субагента команда с `cli` пишется в одинарных кавычках YAML (в ней есть `"`), без `cli` — прежняя строка в двойных кавычках.
- `isGuardHook` признаёт своими обе формы: точную строку `warrant guard --frontend claude` и `^node "\$\{CLAUDE_PROJECT_DIR:-\.\}/<шаблон cli>" guard --frontend claude$`. `merge` заменяет любую из них текущей, `own` сверяет текущую по hash. Смена или удаление `cli` — штатный `sync`, а не ручная правка.
- Тело субагента при `cli` сдаёт результат командой `node <cli> run submit --file …` — относительный путь из корня проекта. Агент сдаёт из корня без `cd` (I-197). guard читает эту форму как `warrant` (D4).
- Текст skill из lock не меняется: его hash записан в lock, и он содержит `warrant run submit` (`sra/skills/specification/adversarial-review/SKILL.md`). Раздел сдачи говорит, что команды `warrant` в тексте skill исполняются в форме `node <cli>`.
- Заменяется только то, что исполняет субагент: строки `warrant run submit` раздела сдачи и упоминание команды хука. `description`, имя схемы `warrant://skill-result/1` и `warrant run start` в шаге 1 (команда вызывающего) остаются.
- В SRA хук берёт `CLAUDE_PROJECT_DIR`, то есть checkout, где начата сессия (обычно основной, `main`). `run submit` берёт dev-CLI worktree. Оба — dev-CLI, PATH не участвует.

**D4. guard читает `node <cli>` как `warrant`** (REQ-ENF-004).
- `cli` guard берёт терпимым чтением `warrant.json`, тем же, что D2. Файла нет, он не разбирается как JSON-объект, `cli` не строка или не проходит шаблон схемы — алиаса нет, команда судится как не `warrant` (fail-closed).
- Нормализация `[node, <cli>, ...rest] → [warrant, ...rest]` применяется к простым командам до `isSubmit`, `isCancel`, `isReading`, `isRecovery`, только в ветках Run `review` и режима восстановления.
- `shellAnswer` (префиксы checks) не меняется: `node <cli>` не префикс check.
- Сравнение точное, по строке поля: `./tools/warrant.js` при `cli: "tools/warrant.js"` — `deny` (fail-closed).
- Алиас действует, только если каждый каталог, где строка может оказаться к команде (`dirs` из `isCdInside`, `cwd` события), после `realpath` — корень проекта: из подкаталога `node <cli>` исполнил бы другой файл. Множество `dirs` уже ведётся для `cd` (I-202).

**D5. SRA переходит на `cli`.**
- `.warrant/warrant.json` получает `"cli": "packages/cli/dist/bin/warrant.js"`.
- `.claude/agents/warrant-reviewer.md` перегенерирован командой из шапки `reviewer-agent.test.ts`. Белый список `dev-hooks.test.ts` — новая команда.
- Навык `change-spec-pr` шаг 3: вместо «`warrant` на PATH, иначе `npm link`» — `npm run build` в основном checkout и в worktree.
- После merge машину можно перевести на CLI из тега (ADR-0053 п. 4). Это делает maintainer, в «Не забыть» передачи.

**D6. R-46 — runner `guard` ловит своё исключение.**
- `commands/guard.ts` получает `runGuardRead(ctx, read)`: `read` — функция чтения stdin. Исключение `read` или `runGuard` даёт `runGuardCrash(input, thrown)`, `input` — текст, если чтение успело. Причина — в `ctx.warn`.
- Action `guard` в `bin/warrant.ts` зовёт его с `readStdin`; `crash.guardInput` по-прежнему заполняется.
- Тест — уровень `app`, `read`, который бросает (SCN-ENF-052): процесс не нужен.

**D7. Документы.**
- 08 §3 — поле `cli` в примере и строка о нём.
- `docs/process/rules.md` «Настройка машины» — CLI потребителя из тега:
  ```bash
  npm pack github:Homasters-max/SRA#v<тег>
  npm i -g ./warrant-<версия>.tgz
  ```
  Первую команду — вне checkout. `npm link` — только для разработки WARRANT; SRA исполняет dev-CLI через `cli`.
- Навык `warrant-upgrade` (`~/.claude/skills/`, вне репозитория):
  - подъём minor pack (caret `^0.3` не пускает `0.4`);
  - порядок «сначала `warrant.json` (диапазон, `kernel`), `warrant sync`, затем CLI»;
  - CLI на машине ставит maintainer вне сессии агента (`rules.md` «Настройка машины»): режим восстановления не пускает `npm pack` и `npm i`, а глобальная установка — настройка машины, не правка проекта. Агент отдаёт команду maintainer'у одной строкой;
  - поле `cli` для Node-проекта — только когда CLI машины не ниже 0.10 (схема старше 0.10 не знает поля);
  - запасной выход — режим восстановления guard (CLI ≥ 0.10).
- CHANGELOG `## 0.10.0`:
  - «Вердикт» — без изменений: guard не судья;
  - «Миграция для потребителя» — CLI из тега на машине, порядок перехода, `cli` и команда хука после `warrant sync`, перезапуск сессии Claude Code.
- `docs/backlog.md` — R-46 закрыт.

### 2. Альтернативы

- **Переадресация `warrant` из PATH на закреплённый CLI.** CLI при старте читает `cli` и запускает его. Отвергнута:
  - хук всё равно зависит от того, что в PATH стоит CLI ≥ 0.10;
  - лишний процесс на каждую команду;
  - защита от петли;
  - сбой передачи stdin и сигналов.
  Навыкам SRA переадресация не нужна: они уже исполняют `W`.
- **`npx --no-install warrant` в хуке.** Отвергнута: только Node-проекты, запуск 0,5–1 с на каждый хук (Windows), запасной поиск в PATH.
- **Относительный `node <cli>` в хуке без `CLAUDE_PROJECT_DIR`.** Отвергнут: `cwd` хука не обязан быть корнем.
- **Абсолютный путь в `cli`.** Отвергнут: файл коммитится, путь машинный.
- **В режиме восстановления разрешать любой shell.** Отвергнуто ADR-0053 п. 2: только «shell без правки проекта». guard не может знать, что правит произвольная команда. Строгая форма Run `review` уже проверена.
- **Отдельный код ошибки «policy не грузится».** Не нужен: reason несёт код первой ошибки загрузки, решение guard — не envelope ошибки.
- **Разрешать правку `.warrant/local/**`, когда виновата локальная policy.** Отвергнуто: этот путь пишет человек в Change `factory-change` (BL-56) и при загружаемой policy.

### 3. Порядок

1. Поле `cli`: схема, `config.ts`, SCN-KRN-165.
2. guard: `PolicyNotLoaded`, `bundledPackVersions`, `recoveryAnswer`, алиас `node <cli>`, сообщение `PACK_VERSION_RANGE`; SCN-ENF-048…051.
3. Адаптер и R-46: SCN-ENF-052, SCN-ENF-053.
4. Генератор: команда хука и тела субагента, опознание своих хуков, `CLI_NOT_FOUND`; SCN-KRN-166. Повтор зонда хука frontmatter — интерактивно.
5. SRA: `cli`, перегенерация агента, мета-тесты, навык `change-spec-pr`.
6. Документы: 08 §3, `rules.md`, CHANGELOG, backlog; навык `warrant-upgrade`.

### 4. Риски

- **Файла `cli` нет** (worktree без `npm run build`, `node_modules` без пакета). `node` падает с кодом 1, Claude Code считает это неблокирующей ошибкой, и действие проходит без guard (fail-open). Так же сейчас ведёт себя хук без `warrant` в PATH (код 127). `run submit` агента при этом падает видимо — шаг 5 «Сдачи результата» его останавливает. Контроль — находка `CLI_NOT_FOUND` у `sync` (D3) и шаг `npm run build` в `git-start`.
- **Хук frontmatter субагента в `claude -p` не исполнился** (зонд D3) ни в одной форме. Форма `${CLAUDE_PROJECT_DIR:-.}` работает и без переменной, поэтому форма команды от этого не зависит. Исполняется ли хук frontmatter интерактивно в 2.1.283 — повтор зонда I-168 (задача 4.3); не исполняется — это дефект и без этого Change, строка backlog.
- **CLI старше 0.10** режима восстановления не знает и отвергает `warrant.json` с `cli` (`additionalProperties: false`): с ним запирание прежнее. Исправление действует с CLI 0.10; LATTICE переходит на `v0.10.0` с CLI из тега (ADR-0055 п. 1). CHANGELOG и `warrant-upgrade`: `cli` — после перехода машины на ≥ 0.10.
- **Агент правит `.warrant/warrant.json`, пока policy не грузится**, — весь файл, включая `cli` и `frontends`, — и может ослабить закрепление: убрать pack, сменить диапазон. Контроль:
  - правка видна в diff PR;
  - путь — policy-путь `factory-change`; у SRA и LATTICE с 0.9.0 — профиль приёмки человеком и CODEOWNERS;
  - после правки policy грузится и guard судит обычными правилами.
- **Алиас `node <cli>`** расширяет строгую форму Run `review` ровно на одно слово из `warrant.json`. Вне режима восстановления `cli` правится только как policy-путь. В режиме агент может направить `cli` на любой существующий `.js` проекта и исполнить его строкой `node <файл> sync …`. Это не шире обычного режима: при загружаемой policy shell не ограничен ничем, кроме префиксов checks. Под Run `review` правка `warrant.json` запрещена. Правка видна в diff PR.
- **Хук SRA исполняет dev-CLI основного checkout, а не worktree.** Это так же, как `npm link` сейчас. Расхождение — только между merge и `npm run build` в основном checkout.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
| I-247 | Review spec раунда 1 (NOT_PROVEN, BLOCKER 1, MAJOR 5, MINOR 7, INFO 1, RUN-01M3VSWJFXVH8A3KJ605MH69TA) закрыт правкой spec до раунда 2: F-1 — SCN-KRN-166 сужен до раздела сдачи, раздел говорит о командах skill (D3); F-2 — находка `CLI_NOT_FOUND`, предел fail-open в REQ-KRN-033; F-3 — форма `${CLAUDE_PROJECT_DIR:-.}` по зонду (D3); F-4 — что не даёт алиаса (D4); F-5 — delta REQ-KRN-021, SCN-KRN-167; F-6 (D-1) — CLI машины ставит maintainer вне сессии (D7); F-7 — риск CLI старше 0.10; F-8 — `-h`, `run submit` и `run finish` вне режима; F-9 — pin-Change только при `PACK_VERSION_RANGE` (D2); F-10 — hints в форме `node <cli>`; F-11 — «без `cli`» в SCN-KRN-130, 139; F-12 — шаблон `cli`; F-13 — исключение после решения; F-14 — риск правки `warrant.json` | `specs/**`, `design.md`, `tasks.md` |
| I-248 | Review spec раунда 2 (PROVEN, MAJOR 3, MINOR 6, INFO 1, RUN-01M3VTP1J2H8B9C58P2PAYBMNX) закрыт правкой spec и раундом 3, а не waiver на `spec-approved` в impl-PR (прецедент I-243): F-1 — proposal об отказе вне `write_scope` (D1); F-2 — выход по направлению расхождения, SCN-ENF-054, hint REQ-KRN-021 (D2); F-3 — алиас только из корня проекта, SCN-ENF-051 (D4); F-4 — hints Run `review` в форме `node <cli>`; F-5 — hint `post` правки `warrant.json`, SCN-ENF-053; F-6 — одна ошибка режима; F-7 — исполнитель правки чужого файла; F-8 — что заменяется в теле субагента (D3); F-9 — границы `CLI_NOT_FOUND`; F-10 — риск `cli` в режиме | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
| I-249 | Review spec раунда 3 (PROVEN, MAJOR 2, MINOR 4, INFO 1, RUN-01M3VV7J7MRYXZ93SRXYGDR788) закрыт правкой spec и раундом 4 — последним: оставшиеся MAJOR идут строками backlog и исправлением в impl-PR по ADR-0024 п. 4. F-1 — направление только у встроенного pack, локальный — исправить `warrant.json` (D2); F-2 — `PACK_NOT_FOUND` `#/packs/<id>` — CLI старше, путь с фрагментом — путь файла; F-3 — при `cli` обновить файл `cli`; F-4 — версия ни выше, ни ниже — исправить диапазон; F-5 — hint `post` и при Run, SCN-ENF-050; F-6 — форма `node <cli>` при поле, проходящем шаблон, «из корня проекта», SCN-ENF-051; F-7 — design, tasks, proposal | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
