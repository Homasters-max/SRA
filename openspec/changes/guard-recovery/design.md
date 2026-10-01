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
- `isRecovery` — `warrant sync [...]`, `warrant validate [...]`, `warrant status [...]` (он уже в `isReading`), `warrant --version`, `warrant -V`.
- `allow` внутри `write_scope` активного Run остаётся без policy, как сейчас. Отказ вне `write_scope` при незагружаемой policy тоже уходит в `recoveryAnswer`: правка только `.warrant/warrant.json` проходит и при Run.
- Событие записывается в `guard_events[]` как прежде. Замок и `BUSY` не меняются.

**D2. Reason и hints режима** (REQ-ENF-004, ADR-0053 п. 2).
- Reason: `the policy does not load (<CODE> <path>: <message>): CLI <CLI_VERSION> carries <id> <version>[, …]; warrant.json pins <id> <range>[, …], kernel <kernel>`.
- Источники:
  - версии встроенных packs — новая функция `bundledPackVersions()` в `core/packs/loader.ts`, `pack.json` каталога bundled;
  - диапазоны и `kernel` — терпимое чтение `warrant.json` (сырой JSON, без `loadConfig`, который бросает на невалидной схеме). Файл не читается — части `pins` нет.
- Hints по порядку:
  1. `hint` первой ошибки, если он есть;
  2. `PIN_HINT` — шаги pin-Change: поднять `packs.<id>.version` и `kernel` до версий CLI, затем `warrant sync`, или исполнить закреплённый CLI (`cli` в `warrant.json`, CLI тега);
  3. `RECOVERY_HINT` — что guard разрешает, пока policy не грузится.
- Адаптер `claude` склеивает reason и hints в `permissionDecisionReason` — как сейчас (REQ-ENF-005).
- Сообщение `PACK_VERSION_RANGE` встроенного pack называет и CLI: «pack core-sdd 0.4.1 bundled with CLI 0.10.0 does not satisfy the configured range "^0.3.4"». Hint добавляет `kernel`. Код и путь не меняются: на них держится D8 `exit-contract`. Это та же находка `validate` и `post`-hints — «находка» ADR-0053 п. 2.

**D3. Закреплённый CLI — поле `cli` и генератор, без переадресации** (REQ-KRN-004, REQ-KRN-033).
- `cli` — путь к файлу входа CLI от корня проекта. Значения:
  - SRA — `packages/cli/dist/bin/warrant.js`;
  - Node-потребитель — `node_modules/warrant/packages/cli/dist/bin/warrant.js` после `npm i -D <tgz тега>`.
- Шаблон схемы не пропускает пробел, кавычки, `$`, `..`, абсолютный путь. Поэтому команда собирается без экранирования: `node "${CLAUDE_PROJECT_DIR}/<cli>" guard --frontend claude`.
- `${CLAUDE_PROJECT_DIR}` — потому что `cwd` хука не обязан быть корнем. Форма проверена хуками разработки SRA.
- Без `cli` байты сгенерированных файлов не меняются: у потребителя без поля дрейфа нет.
- Во frontmatter субагента команда с `cli` пишется в одинарных кавычках YAML (в ней есть `"`), без `cli` — прежняя строка в двойных кавычках.
- `isGuardHook` признаёт своими обе формы: точную строку `warrant guard --frontend claude` и `^node "\$\{CLAUDE_PROJECT_DIR\}/<шаблон cli>" guard --frontend claude$`. `merge` заменяет любую из них текущей, `own` сверяет текущую по hash. Смена или удаление `cli` — штатный `sync`, а не ручная правка.
- Тело субагента при `cli` сдаёт результат командой `node <cli> run submit --file …` — относительный путь из корня проекта. Агент сдаёт из корня без `cd` (I-197). guard читает эту форму как `warrant` (D4).
- В SRA хук берёт `CLAUDE_PROJECT_DIR`, то есть checkout, где начата сессия (обычно основной, `main`). `run submit` берёт dev-CLI worktree. Оба — dev-CLI, PATH не участвует.

**D4. guard читает `node <cli>` как `warrant`** (REQ-ENF-004).
- `cli` guard берёт терпимым чтением `warrant.json`, тем же, что D2. Значение должно пройти шаблон схемы.
- Нормализация `[node, <cli>, ...rest] → [warrant, ...rest]` применяется к простым командам до `isSubmit`, `isCancel`, `isReading`, `isRecovery`, только в ветках Run `review` и режима восстановления.
- `shellAnswer` (префиксы checks) не меняется: `node <cli>` не префикс check.
- Сравнение точное, по строке поля: `./tools/warrant.js` при `cli: "tools/warrant.js"` — `deny` (fail-closed).

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
- Навык `warrant-upgrade` (`~/.claude/skills/`, вне репозитория): подъём minor pack (caret `^0.3` не пускает `0.4`); порядок «сначала `warrant.json` (диапазон, `kernel`), `warrant sync`, затем CLI»; поле `cli` для Node-проекта; запасной выход — режим восстановления guard.
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
4. Генератор: команда хука и тела субагента, опознание своих хуков; SCN-KRN-166. Зонд хука frontmatter с `${CLAUDE_PROJECT_DIR}`.
5. SRA: `cli`, перегенерация агента, мета-тесты, навык `change-spec-pr`.
6. Документы: 08 §3, `rules.md`, CHANGELOG, backlog; навык `warrant-upgrade`.

### 4. Риски

- **Файла `cli` нет** (worktree без `npm run build`, `node_modules` без пакета). `node` падает с кодом 1, Claude Code считает это неблокирующей ошибкой, и действие проходит без guard (fail-open). Так же сейчас ведёт себя хук без `warrant` в PATH (код 127). `run submit` агента при этом падает видимо — шаг 5 «Сдачи результата» его останавливает. Контроль — шаг `npm run build` в `git-start`; долг — находка `sync` об отсутствующем файле, если понадобится.
- **`${CLAUDE_PROJECT_DIR}` во frontmatter субагента** не проверен зондом. Проверено только в `settings.json`. Задача 4.3 — зонд. Если переменной нет — I-N и форма `node <cli>` из корня.
- **Агент правит `.warrant/warrant.json`, пока policy не грузится**, и может ослабить закрепление: убрать pack, сменить диапазон. Контроль:
  - правка видна в diff PR;
  - путь — policy-путь `factory-change`; у SRA и LATTICE с 0.9.0 — профиль приёмки человеком и CODEOWNERS;
  - после правки policy грузится и guard судит обычными правилами.
- **Алиас `node <cli>`** расширяет строгую форму Run `review` ровно на одно слово из закоммиченного `warrant.json`. Сам `cli` правится только как policy-путь.
- **Хук SRA исполняет dev-CLI основного checkout, а не worktree.** Это так же, как `npm link` сейчас. Расхождение — только между merge и `npm run build` в основном checkout.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
