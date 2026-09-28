# Design: lattice-issues

## Context

База — `main` на `v0.8.1` плюс документы (ADR-0044, ADR-0045, строки BL-91, BL-92). Архитектурный вход — снимок аудита
[2026-09-26-phase-4c](../../../docs/process/audits/2026-09-26-phase-4c.md). Снимок устарел (`hygiene.js`: `audit-stale`), но
Change не фаза roadmap (ADR-0030 п. 6 требует аудита перед фазой). Новых модулей и связей между модулями Change не
добавляет, кроме чтения `core/ids/references` parser'ом `junit` (§3; ранги проверяет `architecture.test.ts`).

Что уже есть (сверено 2026-09-28, отчёты сверки S-2, S-3):
- `writeJsonFile` (`core/canon/format-json.ts`) — `writeFileSync` в целевой файл. Через него пишутся record
  (`core/record/write.ts`), evidence и manifest (`core/evidence/write.ts`), Run (`core/run/store.ts` `writeRunFile`),
  waivers (`commands/waive.ts`), результат review (`core/run/submit.ts`). Мимо него: указатель `current`
  (`core/run/lifecycle.ts`, `writeFileSync(pointer, "<id>\n")`), импорт записей `ci fetch` (`core/evidence/store.ts`,
  `writeFileSync(file, bytes)`). `renameSync` в `src` нет.
- `countCases` (`core/evidence/parsers/junit.ts`) считает `<testcase>` регулярным выражением `CASE_RE`; атрибуты testcase
  не читаются. `junitStatus`: падения → `NOT_PROVEN`, `tests − skipped ≤ 0` → `INCONCLUSIVE`, иначе `PROVEN`.
- `REFERENCE_RE` (`core/ids/references.ts`) — `(REQ|SCN)-[A-Z]{2,5}-\d{3}` с границами.
- `finishRun` (`core/run/lifecycle.ts`) сначала выполняет `also.write()` (результат, evidence, manifest), затем переписывает
  Run и удаляет `current`. `run submit` выдаёт EVID `allocateUlid` до записи; `produced_by.run` — id Run.
- `reviewShellAnswer` (`core/guard/decide.ts`) под Run `review` пропускает только строгую форму `warrant run submit`;
  `SUBMIT_HINT` отмену не называет. R-32: ветка `run.operation === "review"` в `editWithRun` недостижима.
- `run start` (`commands/run.ts`) проверяет незакоммиченное только для `review` (`committedSpecTree`, `SPEC_UNCOMMITTED`);
  `GitPort.dirty(paths)` есть. Вывод `run start` — Context Pack, без `findings`.
- `evidencePart` (`core/gates/verdict.ts`) берёт `freshest` из записей kind'а, прошедших `accepts`. `checksForTransition`
  (`core/check/execute.ts`) выбирает checks по пересечению `produces` с kinds gates. Запись check несёт `produced_by`
  `{type: "check", id, version}`.
- `roleMembers` (`core/roles.ts`); `WarrantConfig` (`core/config.ts`) без `identities` («nobody reads yet»,
  `test/unit/config/config.test.ts` держит список). `judgeDecisions` (`core/ci/decisions.ts`) — автор ∈ `roles.maintainer`
  базы; `judgeRefs` (`core/ci/refs.ts`) — `merged_by` ∈ ролей, `merged_by = pr.author` — находка `APPROVER_IS_AUTHOR`.
- Job `warrant` — в `.github/workflows/ci.yml` (триггеры `pull_request`, `workflow_dispatch` с `merge_commit`); recovery
  `ci fetch` называет файл workflow run'а, а не job.

Нормы: [ADR-0044](../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) (решения maintainer'а 2026-09-29); ADR-0010 п. 4,
ADR-0036, ADR-0037 п. 4, 5, ADR-0040 п. 3 (уточнены ADR-0044); ADR-0025 (порты, уровни тестов); ADR-0030 / ADR-0035 (ранги,
реестры, храповик); ADR-0038 (требования PR — из базы).

Ограничения:
- после каждой группы зелёные `warrant validate`, `fmt --check`, `sync --check`, `versions:check`;
- форма `run/1`, `evidence/1`, `waiver/1` не меняется; `gate/1` — аддитивно (необязательное поле);
- guard основной сессии в этом репозитории не включается (ADR-0034 п. 4).

## Goals / Non-Goals

**Goals:**
- обрыв процесса не оставляет битый JSON состояния;
- тест сценария нельзя выключить `skip` / `todo` незаметно для gate;
- повтор `run submit` после обрыва не плодит EVID; под Run `review` автор видит состояние и может отменить Run;
- проверка проекта с тем же kind, что у проверки pack'а, не маскирует и не маскируется;
- доверие к актам под общим аккаунтом видно в выводе `warrant ci`; с GitHub App агента самослияние — отказ;
- подключённый проект берёт job `warrant` по тегу CLI, без копии.

**Non-Goals:** — proposal, раздел Non-Goals.

## Decisions

### 1. Решения ADR-0044

| # | Решение |
|---|---|
| L1 | Один Change, шесть групп и документы; CLI 0.8.2 (п. 1) |
| L2 | Пропущенный testcase с `SCN-…` в имени — `NOT_PROVEN`, limitation `junit: skipped SCN-…` (п. 2) |
| L3 | `SHARED_IDENTITY` при пустом `identities.agents`; `validate` — `identities.agents` ∩ `roles`; `merged_by = pr.author` — отказ при непустом (п. 3) |
| L4 | Атомарная запись: временный файл + rename (п. 4) |
| L5 | Повтор `run submit`; чтение и отмена под Run `review`; `UNCOMMITTED_IN_SCOPE`; R-32; таблица восстановления (п. 5) |
| L6 | `requires_evidence[].check` (п. 6) |
| L7 | Reusable workflow job `warrant` (п. 7) |

### 2. Группа 1 — атомарная запись (L4)

- `writeFileAtomic(absolute, text | bytes)` — рядом с `writeJsonFile` в `core/canon/format-json.ts` (или `core/fs.ts`, если ранги
  требуют): `mkdirSync(dir, {recursive})`, запись в `<dir>/.<name>.<pid>.<random>.tmp`, `renameSync` на место. На `win32`
  rename повторяется при `EPERM`, `EBUSY`, `EACCES` до 5 раз с паузой 20 мс (антивирус, индексатор держат файл); неудача —
  временный файл удаляется, ошибка пробрасывается. `writeJsonFile` пишет через него.
- Мимо `writeJsonFile` — тоже через `writeFileAtomic`: указатель `current`, импорт `ci fetch`. Сырой вывод checks
  (`raw/**`), файлы `sync`, `fmt`, `renumber`, `init` — не состояние CLI, остаются как есть (обрыв видит `validate` /
  `sync --check`).
- Имя временного файла начинается с `.` и кончается `.tmp`: `validate` читает только `*.json`; `hygiene.js` их не трогает;
  остаток после `kill -9` — мусор без смысла, строка таблицы восстановления (§4).
- Тесты: unit — запись поверх существующего файла, каталог создаётся, временный файл не остаётся, сбой rename (фейковый
  `renameSync` через параметр) оставляет прежний файл целым и удаляет временный.

### 3. Группа 2 — пропущенный тест сценария (L2)

- `countCases` для каждого `<testcase>` с `<skipped>` читает атрибут `name` из `match[0]` (значение в `"…"` или `'…'`,
  сущности `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;` раскрываются) и собирает ссылки `SCN-…` через `findReferences`
  (`core/ids/references.ts`, только префикс `SCN`), без повторов, в порядке появления. `JunitCounts` не меняется;
  рядом — `skippedScenarios: string[]`.
- `junitStatus(counts, skippedScenarios)`: падения или ошибки → `NOT_PROVEN`; `skippedScenarios` непуст → `NOT_PROVEN`;
  `tests − skipped ≤ 0` → `INCONCLUSIVE`; иначе `PROVEN`. Limitation — `junit: skipped SCN-VER-001, SCN-VER-002`.
- Документ без `<testcase>` (только атрибуты `<testsuite>`) — имён нет, правило R-4 как прежде.
- Импорт `core/ids` из `core/evidence/parsers` — проверка рангов `architecture.test.ts`; если ранг не позволяет —
  регулярное выражение в parser'е и строка реестра помощников (дубль `REFERENCE_RE`), строка I-N.
- Тесты: unit `parsers.test.ts` — SCN-VER-118 (vitest-отчёт с `it.skip("SCN-… …")`, `todo` `node:test`, имя без SCN —
  `PROVEN`, `&amp;` в имени); SCN-VER-040, SCN-VER-117 без правок ожидаемых значений.

### 4. Группа 3 — Run (L5)

- **Повтор `run submit`.** До `allocateUlid` — поиск записи в каталоге evidence Change с `produced_by.run` = id Run и kind
  `review`. Есть — sha256 канонической формы нового envelope сравнивается с `artifacts[0].sha256` записи (решение D-2 review 1):
  равны — id переиспользуется, запись не переписывается, id дописывается в `manifest.evidence[]`, если его нет (обрыв до
  manifest, F-4), результат записывается атомарно, Run завершается (`evidence[]` без повтора id), `current` удаляется, вывод —
  `evidence_status` и `metrics` записи, `data.reused: true`; различаются — `EVIDENCE_CONFLICT`, код 3, ничего не записано.
  `--dry-run` — `data.reused: true`, `would_write[]` без файла записи (F-5).
- **Guard под Run `review`.** `reviewShellAnswer` пропускает строку, если каждая простая команда — строгая форма
  `warrant run submit` или одна из команд без записи:
  - `warrant status [...]`, `warrant gate <change> [...]` (не пишут; у `verify` нет `--dry-run` — решение D-1 review 1),
    `warrant <слова> --help` / `-h`;
  - `warrant run finish --state CANCELLED [--dry-run]`;
  - `git status | log | diff | show`: подкоманда — первое слово после `git` (глобальные опции — `deny`), аргументы не
    начинаются с `-o` / `--o` и не равны `--ext-diff` (F-7);
  - `cd <путь>`.

  Соединители — только `&&`, `||`, `;`; перенаправление, `|`, `&`, `$(…)`, обратные кавычки, присваивание, heredoc — `deny`
  (F-6); heredoc остаётся только у `warrant run submit` (I-167).

  Остальное — `deny`. `SUBMIT_HINT` дополняется: «to stop the review: `warrant run finish --state CANCELLED`; to read state:
  `warrant status`». Строгость формы — как у `isSubmit`: без `$(…)`, `&`, присваиваний.
- **`UNCOMMITTED_IN_SCOPE`.** `run start` `specify` / `implement` после расчёта `write_scope` вызывает
  `ctx.git.dirty(write_scope)` (изменения в индексе и рабочем дереве, удалённые, неотслеживаемые без игнорируемых — ответ
  `git status --porcelain`; F-8; пути отсортированы); непустой ответ — `data.findings[]` `{ code: "UNCOMMITTED_IN_SCOPE", paths[], hint }`,
  код выхода 0, Run стартует. Без git — находки нет (`limitations` Context Pack, как сейчас). `data.findings[]` у
  `run start` — новое поле вывода, всегда присутствует (пустой массив); golden вывода `run start` обновляется.
- **R-32.** Удалить недостижимую ветку в `editWithRun`, строку R-32 — из backlog.
- **Таблица восстановления** (04, раздел Run):

  | Точка обрыва | Что на диске | Что делать |
  |---|---|---|
  | `run start` до `current` | Run `RUNNING` без указателя | ничего: Run не активен; файл — мусор, `warrant status` его не показывает |
  | Run `RUNNING`, исполнитель упал | Run и `current` | `warrant run finish --state CANCELLED` (или `FAILED`), затем новый `run start` |
  | `run submit` после evidence, до Run | evidence, Run `RUNNING` | повторить `warrant run submit --file <тот же файл>` |
  | замок остался после `kill -9` | `<state>/runs/*.lock` | удалить файл, если процесса нет (hint `BUSY`) |
  | временный файл записи | `.*.tmp` рядом с JSON | удалить; прежний JSON цел |

- Тесты: app `run submit` — SCN-ENF-043 (повтор); app `guard` — SCN-ENF-044 (команды без записи, отмена), SCN-ENF-026
  без правок ожидаемых значений кроме `hint`; app `run start` — SCN-ENF-045.

### 5. Группа 4 — gate по check (L6)

- `gate/1`: у элемента `requires_evidence[]` необязательное `check` (`kebab_id`). Копии схемы в `.warrant/schemas/` и
  golden-фикстурах — `warrant sync`.
- `evidencePart`: при `requirement.check` кандидаты — записи kind'а с `produced_by.type = "check"` и
  `produced_by.id = check`; находка при отсутствии называет check. Без `check` — прежнее правило.
- `checksForTransition`: для требования с `check` выбирается только этот check (если его `produces` содержит kind), а не все
  checks kind'а; требования без `check` — прежнее пересечение. Итог — объединение, по id (SCN-VER-123). Тот же набор —
  `check` без `id`, `verify`, `warrant ci`.
- `warrant ci`, правило `ci_evidence` (`core/ci/record.ts` или место проверки): у требования с `check` — запись этого check с
  `attestation.type: "ci"` (F-10).
- `validate` (REQ-KRN-021 п. 3): `check` называет загруженный check, чей `produces` (с учётом override) содержит `kind`,
  иначе `CONFIG_INVALID` с `path` `…#/requires_evidence/<i>/check`.
- Override gate (`weakenings`): `check` сужает допустимые записи. Добавить `check` — усиление; снять или сменить —
  ослабление (`requires_evidence:<kind>.check`), `OVERRIDE_WEAKENS`, как у прочих полей.
- Тесты: app `gate` — SCN-VER-119 (две записи `test-report` разных checks; gate с `check` берёт свою, упавшую), схема — SCN-KRN-159, `validate` —
  SCN-KRN-156; `check` без id при `check` gate — только он.

### 6. Группа 5 — идентичность (L3)

- `WarrantConfig.agents: readonly string[]` — логины `identities.agents[].login` (первый читатель; список
  `config.test.ts` обновляется).
- `validate`: логин и в `identities.agents`, и в любой роли `roles` — `CONFIG_INVALID`, `path`
  `.warrant/warrant.json#/identities/agents/<i>/login`. `loadConfig` этого не проверяет: остальные команды работают
  (ошибку показывает `validate` и job `warrant`).
- `judgeRefs` (`core/ci/refs.ts`): агенты — из конфигурации базы. Пусто — на каждый проверенный ref `APPROVED` / `MERGED`
  находка `{ code: "SHARED_IDENTITY", message }` на каждый ref без нарушения («… merged by <login>: an agent and the maintainer
  share the account, no identities.agents in the base (ADR-0010 п. 4)»). Непусто — `merged_by = pr.author` или
  `merged_by` ∈ агентов (F-9) — `REF_NOT_VERIFIED` с причиной `merged_by`, находки `APPROVER_IS_AUTHOR` нет.
- `judgeDecisions` (`core/ci/decisions.ts`): автор ∈ агентов — деталь `author` («… is an agent identity»); пусто — находка
  `SHARED_IDENTITY` на каждое проверенное решение. Находка не меняет код выхода; в PR с новым `APPROVED` — тоже находка.
- Тесты: app `ci` — SCN-VER-120 (пустой список — находка; непустой — самослияние отказ), SCN-VER-121 (решение агента);
  `validate` — SCN-KRN-157. Существующие SCN с `APPROVER_IS_AUTHOR` — фикстура без `identities`: находка
  `APPROVER_IS_AUTHOR` остаётся при пустом списке вместе с `SHARED_IDENTITY`.

### 7. Группа 6 — reusable workflow (L7)

- `.github/workflows/warrant.yml`: `on: workflow_call` с входами:
  - `setup` (string, default `""`) — команды подготовки проекта (bash), выполняются после checkout и merge;
  - `node-version` (default `22`), `openspec-version` (default `1.13.1`);
  - `warrant` (string, required) — источник CLI: `checkout` — `npm i -g .` (только этот репозиторий), тег `v<semver>` —
    `npm i -g github:Homasters-max/SRA#<тег>`; иное — шаг падает до `warrant ci` с допустимыми значениями (F-11);
  - `merge_commit` (string, default `""`) — recovery-прогон.

  Шаги — нынешнего job `warrant` (checkout, merge в tip базы, setup, OpenSpec, warrant, `warrant ci`, upload artifact);
  `GH_TOKEN` — `github.token` вызывающего; `permissions` задаёт вызывающий: `contents`, `actions`, `pull-requests`, `issues` —
  `read` (F-12).
- `ci.yml`: job `warrant` — `uses: ./.github/workflows/warrant.yml` с `warrant: checkout`, `setup: npm ci`, `merge_commit` из
  `workflow_dispatch`. Триггеры и `if` — прежние. Имя проверки в GitHub меняется на `warrant / warrant` —
  `pr-form`, навыки и `ci.md`, которые называют проверку, — обновить (I-N по факту); branch protection здесь нет (06 §8),
  у проекта с обязательной проверкой её имя обновляет maintainer (F-13).
- Проект: `jobs.warrant.uses: Homasters-max/SRA/.github/workflows/warrant.yml@v0.8.2` с `warrant: v0.8.2` и своим
  `setup`; пример — 06 §8.
- Тест: unit (`test/unit/meta/`) — `warrant.yml` содержит `workflow_call` и входы, `ci.yml` вызывает его (разбор YAML
  без новой зависимости — по строкам); SCN-VER-122.

### 8. Документы и backlog

- 04 — таблица восстановления (§4); 06 §2 — форма «id SCN в имени теста» и правило L2; 06 §3 — `check` в
  `requires_evidence`; 06 §8 — угроза «общий аккаунт» (ADR-0044 п. 3), reusable workflow, проверки PR без Change — job
  проекта; 02 — `SHARED_IDENTITY`, `UNCOMMITTED_IN_SCOPE` в перечне находок, если он там есть.
- `backlog.md` — удалить BL-44, BL-51, BL-81, R-32 (закрыты); BL-83 — «Куда»: GitHub App maintainer'а и
  `identities.agents`; BL-57 — «Куда»: привязка по failure mode.

### 9. Порядок групп

1 → 2 → 3 → 4 → 5 → 6 → документы. Группа 1 несёт bump CLI (первое изменение поставляемого после `v0.8.1`, R-14) и первой
делает запись атомарной: группы 3 и 4 пишут через неё.

### 10. Dogfooding

- Review этого spec-PR — субагент `warrant-reviewer` CLI 0.8.1, сдача файлом (ADR-0042 п. 4). Review 1: shell субагента
  стартует в основном checkout, где Run нет, — сдача прошла через `cd <worktree> && warrant run submit`; guard решает по `cwd`
  события (I-198), поэтому `cd` не был отклонён. С группой 3 `cd` под Run `review` разрешён явно.
- Под Run `review` этого spec-PR действует старый guard (команды без записи ещё `deny`).
- Приёмка — Change LATTICE после тега `v0.8.2`: job `warrant` по reusable workflow, `dev-check` с `check` в gate.

## Risks / Trade-offs

- [rename на Windows отказывает, пока файл открыт другим процессом] → повтор до 5 раз; дальше — ошибка записи, прежний
  файл цел (лучше отказ, чем битый JSON).
- [Тест сценария законно пропущен на одной ОС матрицы] → `NOT_PROVEN` на этой ОС; job `warrant` работает на Ubuntu, и
  пропуск «только Windows» там виден. Снимается waiver'ом или тестом без SCN в имени, который зовёт сценарий на своей ОС.
- [Имя теста не несёт SCN, а файл упоминает] → правило L2 не срабатывает; норма формы — 06 §2; `analyze` по-прежнему
  засчитывает упоминание (L0).
- [Под Run `review` `git diff --output=<файл>` пишет] → `--output` / `-o` — `deny`.
- [`SHARED_IDENTITY` на каждом impl-PR этого репозитория до GitHub App] → шум осознанный: он и есть сигнал BL-83.
- [Reusable workflow в публичном репозитории вызывает любой] → workflow не несёт секретов; токен — вызывающего.
- [Имя проверки `warrant / warrant`] → ссылки на имя проверки в навыках и документах обновляются группой 6.

## Migration Plan

1. **Spec-PR:** артефакты, record, `classify`, review субагентом; `transition SPECIFIED` по «merge #N».
2. **Impl-PR:** первым коммитом `APPROVED --ref <URL spec-PR> --by` и `IMPLEMENTING`; группы 1–7; последним — `VERIFYING`.
   Вердикт — job `warrant` (с группы 6 — через reusable workflow).
3. **Archive-PR:** `warrant ci fetch <impl-PR>`, `transition MERGED --ref <URL impl-PR> --by`, `warrant archive
   lattice-issues`, тег `v0.8.2`, `npm link`; передача в сессию LATTICE.
4. **Откат:** `git revert` группы; `gate/1` — аддитивно, старые gates валидны.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-202 | Review 2 spec, F-1 (BL-93): под Run `review` `cd <путь>` разрешён, только если путь после `realpath` лежит внутри проекта события; иначе `deny` — `cd ../<другой worktree> && warrant run finish --state CANCELLED` не отменяет чужой Run; уточняет REQ-ENF-004, SCN-ENF-044 (ADR-0024 п. 4) | `core/guard/decide.ts`, задача 3.2 |
| I-203 | Review 2 spec, F-2: запись из нескольких файлов — в порядке «записи evidence → `manifest.json` → record / Run»; manifest пересобирается из каталога при каждой записи evidence (`storeRecord`), поэтому запись вне `manifest.evidence[]` после обрыва чинит следующая запись evidence Change (`warrant verify`); находка `validate` (12) называет это в `hint`; строка таблицы восстановления 04; уточняет REQ-KRN-036 | `core/evidence/write.ts`, `core/validate/**`, задачи 1.2, 7.1 |
| I-204 | Review 2 spec, F-3: `requires_evidence[].check` на незагруженный check или check без этого kind в `produces` у `check` без `id`, `verify`, `warrant ci` — `CONFIG_INVALID` с `path` элемента, код 3, до запуска checks (как `validate`); уточняет REQ-VER-002, SCN-VER-123 | `core/check/execute.ts`, задача 4.2 |
| I-205 | Review 2 spec, F-4: сценарий `ci_evidence` с `check` — вариант SCN-VER-108 (`RECORD_MISMATCH` с причиной `ci_evidence`, когда CI-запись kind'а есть, но от другого check) | `core/ci/record.ts`, задача 4.4 |
| I-206 | Review 2 spec, F-5, F-6: «до 5 попыток» — всего 5 вызовов rename; сбой после них (`EPERM`, `EBUSY`, `EACCES`) — `BUSY`, код 2, `hint` «файл держит другой процесс (антивирус, редактор): повторите», прочие ошибки записи — как прежде; уточняет REQ-KRN-036, SCN-KRN-158 | `core/canon/format-json.ts`, задача 1.2 |
| I-207 | Review 2 spec, F-7, F-8: строгая форма под Run `review` — перевод строки — соединитель, как `;`; группы `( … )`, `{ …; }` и `!` — `deny`; `--state=CANCELLED` равен `--state CANCELLED`; у `git` запрещены `-o…` и префиксы `--output` не короче `--ou` (`--output=…` тоже), `--oneline`, `--ours` разрешены; уточняет REQ-ENF-004, SCN-ENF-044 | `core/guard/decide.ts`, задача 3.2 |
| I-208 | Review 2 spec, F-9, F-10: `warrant: checkout` — шаг установки проверяет, что checkout — репозиторий WARRANT (есть `packages/cli/package.json` с именем пакета CLI), иначе падает до `warrant ci`; неверный вход — тот же шаг; SCN-VER-122 проверяет наличие шага. Pack `core-sdd` не поднимается: golden-фикстуры вне его hash (I-59), посылка ADR-0044 п. 1 «копии схем в golden» к версии pack не относится; уточняет REQ-VER-014 | `.github/workflows/warrant.yml`, задача 6.1 |
| I-209 | Запасной путь §3: импорт `findReferences` из `core/evidence/parsers` ранги допускают (оба ранга 1), но замыкает цикл модулей `core/evidence → core/ids → core/git → core/evidence` (`architecture.test.ts`, правило `cycle`). Parser `junit` держит свою копию `SCN`-половины `REFERENCE_RE` (`SCENARIO_RE`, те же границы) в помощнике `scenariosOf`, строка реестра помощников `architecture.json`; комментарий у `REFERENCE_RE` называет копию. REQ-VER-002, SCN-VER-118 не меняются | `core/evidence/parsers/junit.ts`, `core/ids/references.ts`, `test/unit/meta/architecture.json`, задача 2.1 |
| I-210 | Задача 3.2, строгая форма под Run `review` (уточняет REQ-ENF-004, I-207): heredoc у команды без записи guard не видит — frontend (`shellWords`) и разбор `bash -c` отбрасывают его как данные (I-167) до решения, поэтому «heredoc — `deny`» держится только для слов, которые остались: `<<` без разделителя и `<<<` — перенаправление, `deny`; тело heredoc — данные, как у `warrant run submit`. Строже нормы (fail-closed, кавычки токенизатор снял): слово с `<`, `>`, `&`, `$`, `` ` ``, `(`, `)`, `{`, `}` — `deny` (раскрытия `$VAR`, `{a,b}` собирают `--output`); у `git` — ещё префиксы `--ext-diff` от `--ext`; `warrant <слова> --help` — слова только имена подкоманд (`warrant -- --help` — `deny`); `cd` — ровно один путь без `-`, `~` в начале, проверяется от каждого каталога, где строка может быть к этому месту (`cd`, который не удался, оставляет прежний: `cd a \|\| cd ..` — `deny`); submits без других команд сохраняют прежние соединители (I-167). Повтор `run submit` (задача 3.1): `manifest.commit` при дописывании id — `subject.commit` записи | `core/guard/decide.ts`, `core/guard/shell.ts`, `core/run/submit.ts`, задачи 3.1, 3.2 |
| I-211 | Задача 4.2 (уточняет REQ-VER-003 по его смыслу): в `baseOutcome` упавший check лишает gate входа (`BLOCKED` / `NO_INPUT`), только если питает его требование — для требования с `check` только падение этого check; иначе упавший `tests-passed` блокировал бы gate с `check: "dev-check"`, то есть маскировал бы требование. Требования без `check` — как прежде | `core/gates/verdict.ts`, задача 4.2 |
