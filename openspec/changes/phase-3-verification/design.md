# Design: phase-3-verification

## Context

Kernel фаз 1–2 (архивы `2026-09-22-phase-1-kernel`, `2026-09-22-phase-2-core-sdd`; решения D-1…D-11 и I-1…I-65 там) даёт всё, на что
опирается исполнение: `loadPacks` → слои policy → `resolveForProject(loaded, classification)` (effective policy с `gates` по переходам,
`evidence.required`, `approvals`, `hash`); `readChangeRecord`/`writeJsonFile`; `scanIds` (origin `specs|changes|archive`); `openspecStatus`
и `runOpenspec` (cross-spawn); `validateFile` по `$schema` (ajv 2020-12, `$defs` в `warrant://common/1`); `computeStale`; `classify` по
diff `git diff --name-only <base>...HEAD` (picomatch, POSIX-пути). Тесты — vitest, e2e через async `runCli` (I-64), golden через
`scripts/golden-lib.js` с fake `openspec` (I-61).

Норма исполнения: 06 §2–3 (check, execution, алгоритм verdict с пред-фильтром D-12 и `NOT_APPLICABLE` D-11), 06a §2–5 (запись,
attestation, manifest), 04 §2, §4, §7, §9 (переходы, controller, CLI, record), ADR-0009/0010/0011 (писатели состояния, доверие по ref,
топология PR), ADR-0016/0017/0021 (metrics, execution, archive/abandon), D-1…D-25 ревью. Решения grilling P-1…P-20 — данность
(NEXT-SESSION), как G-1…G-21 в фазе 2.

Ограничения: kernel-схемы `major = 1` — только добавление необязательных полей; `warrant validate` без флагов на репозитории зелёный
после каждой группы; ≤ 6 групп, ~30 задач (G-8); `Run`, `guard`, `ci`, `analyze` не реализуются (фаза 4) — всё, что на них
опирается, получает явную заглушку с finding, а не тихий `PASS`.

## Goals / Non-Goals

**Goals:**
- Цикл `check → gate → verify → transition → archive` на profile `feature` (golden) и на самом репозитории (change фазы 3).
- Evidence и record пишет только CLI; каждое решение gate объяснимо через `findings[]`.
- Долг схем A/B закрыт как поля; `validate` и `status` знают новые поля.
- CI на двух ОС зелёный и производит evidence с attestation `ci`.

**Non-Goals:**
- Семантика `targets[]`, `link`, `waive`, `spec-approved`, `execution.local`/`guard_prefixes` — только валидация полей.
- Правка алгоритма resolver'а и структуры слоёв; `analyze`; любые hooks.

## Decisions

### 1. Раскладка кода

`core/evidence/` — `record.ts` (сборка записи, `context_hash`), `manifest.ts`, `store.ts` (каталог `<state>/evidence/<change>/`,
`WARRANT_STATE_DIR`, чтение всех записей), `attestation.ts` (окружение → `attestation`), `parsers/{junit,openspec-validate}.ts`.
`core/check/` — `placeholders.ts` (`{out}`, `{change}`, `{paths}`), `lock.ts`, `runner.ts` (spawn, timeout, `{out}`).
`core/gates/` — `prefilter.ts` (D-12), `verdict.ts` (алгоритм 06 §3), `l0/*.ts` (по одному калькулятору на gate core-sdd),
`diff.ts` (base, изменённые пути, ancestry). `core/controller/` — `inputs.ts`, `evaluate.ts`. `core/record/write.ts` — transitions,
заморозка. `commands/{check,gate,verify,transition,archive}.ts`. Всё — чистые функции над уже прочитанными данными; git и процессы —
только в `diff.ts`, `runner.ts`, `commands/*`. Альтернатива «один `core/verify/`» отвергнута: check и gate — разные уровни (06 §1),
и `status` использует gate без check.

### 2. Выполнение check: argv без shell, плейсхолдеры как элементы argv

`run.command` выполняется через `cross-spawn` без shell (как `runOpenspec`): `{out}` и `{change}` подставляются внутри строки,
`{paths}` заменяется **несколькими** элементами argv (по одному на путь); элемент, равный ровно `"{paths}"`, разворачивается, иначе — ошибка
`USAGE`. Рабочий каталог — корень проекта; env наследуется плюс `WARRANT_CHANGE` не задаётся (P-14). `{out}` создаётся пустым перед
запуском. Альтернатива `shell: true` отвергнута: кавычки и пути с пробелами на Windows, INV-07 (обход через shell-обёртку — и так
предел ADR-0017).

### 3. Замок `exclusive`

Файл `<git-common-dir>/warrant/check.lock` создаётся флагом `wx` (атомарно на обеих ОС) с JSON `{ pid, check, started_at, cwd }`; занят →
читаем держателя, `BUSY`, код 2. Снимается в `finally` runner'а и по `SIGINT`/`SIGTERM`; при `CHECK_TIMEOUT` — после kill. Мёртвый pid не
снимается автоматически (D-23): `data.holder` показывает pid, человек удаляет файл. `git rev-parse --git-common-dir` — один `spawnSync`
(короткий, как `git` в classify). Check без git допустим (`--paths`-режим classify уже допускает проекты без git): замок тогда кладётся в
`.warrant/check.lock` проекта с предупреждением в stderr.

### 4. Timeout и дерево процессов

`spawn` + таймер `timeout_s`; по истечении — `kill` группы: на POSIX `detached: true` + `process.kill(-pid)`, на Windows
`taskkill /pid <pid> /T /F` через `spawnSync`. Без этого дочерний `vitest`/`openspec` переживает родителя и держит замок «по факту».
Порядок default'ов: `execution.timeout_s` → `warrant.json.defaults.check_timeout_s` → `1800` (D-17).

### 5. Parsers без новых зависимостей

`junit`: считаются атрибуты `tests`, `failures`, `errors`, `skipped` всех `<testsuite …>` (регулярное выражение по открывающим тегам;
вложенные `<testsuites>` суммируются один раз — берутся только `<testsuite`), `failures + errors > 0` → `NOT_PROVEN`, `tests = 0` →
`INCONCLUSIVE`. `openspec-validate`: JSON `openspec validate <change> --strict --json`; `valid: false` или `issues[]` с `level: ERROR` →
`NOT_PROVEN`, `metrics.issues` = число issues. XML-библиотека не нужна: атрибуты junit плоские; если формат выйдет за это (CDATA в атрибутах
не встречается) — I-решение. `NOT_APPLICABLE` от parser'а в фазе 3 не производится ни одним check (первый — mutation, фаза 5); код verdict
его уже учитывает (D-11).

### 6. Запись evidence

`id` — `EVID-<ULID>` (ulid уже в зависимостях); `claim.text` — `"<check-id> passed for <change>"`, `claim.targets` — `[]` (связь с REQ — `analyze`,
фаза 4); `level` — из check; `subject.commit` — `git rev-parse HEAD` (без git — `"nogit"` и `limitations: ["no git: commit unknown"]`,
такая запись не проходит пред-фильтр на переходах с git); `subject.spec_revision` — `openspec/changes/<change>@<commit>`;
`subject.base_commit` — по D-9; `context_hash` — SHA-256 canonical JSON `{ change, commit, check: id@version, effective_policy_hash, argv }`;
`effective_policy_hash` — `resolveForProject`; `artifacts[]` — каждый файл в `{out}` с `uri` относительно корня и `sha256`; `metrics` — от
parser'а. Запись пишется `writeJsonFile` (канонически), manifest перечитывается и перезаписывается целиком (`evidence[]` отсортирован,
`gates` — не трогаются check'ом; их пишет `gate`/`verify`).

### 7. Attestation по окружению (P-15)

`GITHUB_ACTIONS === "true"` ∧ `GITHUB_SERVER_URL` ∧ `GITHUB_REPOSITORY` ∧ `GITHUB_RUN_ID` → `{ type: "ci", ref: "<server>/<repo>/actions/runs/<id>" }`;
иначе `{ type: "none" }`. Другие CI — later (первый failure mode). Проверку `accepts_attestation` делает gate: на `VERIFYING->MERGED`
без явного `none` в gate — `BLOCKED` + `ATTESTATION_REQUIRED`; на остальных переходах `none` засчитывается (06a §3 говорит только о merge).

### 8. Gate engine — чистая функция

`evaluateGates({ policy, transition, records, waivers, signals })` → `{ gates, findings }`, где `signals` — уже вычисленные входы
(diff, ветка, artifacts, unknowns, есть ли git/openspec). Таблица калькуляторов L0 по id gate core-sdd (D-15 для `scope-valid`,
branch = `git rev-parse --abbrev-ref HEAD` ≠ base-ветка, artifacts — `openspecStatus`, `ids-valid` — `scanIds` + проверка (5) без
`openspec show`, `evidence-complete` — по manifest после пред-фильтра, `analyze-clean` — `BLOCKED/NO_INPUT`); gate чужого pack без
`requires_evidence` и без калькулятора — `BLOCKED/NO_INPUT` (fail-closed, INV-10). Пред-фильтр возвращает список исключённых с причиной;
свежесть — `created_at` (ULID монотонен, но `created_at` читаемее). Waiver засчитывается только `ACTIVE` с `expires_at ≥ сегодня`;
`waivable: false` → `WAIVER_IGNORED`.

### 9. Base, diff и commit перехода

`base` = `--base` | `merge-base(HEAD, main)` (`main` — константа; конфигурируемая base-ветка — по failure mode); diff —
`git diff --name-only --diff-filter=ACDMR <base>...<commit>` (переименования видны как пары, D-15 «удаление каталога Change» — `D`).
Для `transition MERGED`: `<commit>` = `--commit` | `subject.commit` самой свежей записи; `git merge-base --is-ancestor <commit> HEAD` иначе
`COMMIT_NOT_MERGED`; base = `merge-base(main, <commit>)`; пред-фильтр сравнивает с `<commit>`, а не с HEAD. Для остальных переходов
`<commit>` = HEAD. Без git (`--paths` не предусмотрен для gate) — `BLOCKED/NO_INPUT` у gates, зависящих от diff и ветки.

### 10. Transition и заморозка record

`core/record/write.ts`: `appendTransition(record, entry)` через `writeJsonFile`; матрица допустимых переходов 04 §2 (вперёд по цепочке,
назад `VERIFYING->IMPLEMENTING`, `IMPLEMENTING->SPECIFIED`, `ABANDONED` из любого до `MERGED`); `ARCHIVED`/`ABANDONED` → `RECORD_FROZEN`
для `transition`, `classify`. `human-approval`: если policy требует gate `human-approval` на переходе — `--by` обязателен,
роль берётся из `approvals[]` перехода (fallback `maintainer`), запись пишется **до** вычисления gates и остаётся в manifest даже при
`GATES_NOT_PASSED` (акт человека состоялся; повторный `transition` её переиспользует по пред-фильтру). `ABANDONED`: `rm -rf`
каталога Change после записи record — порядок «record, затем каталог», чтобы сбой между ними давал `ABANDONED_DIR_PRESENT`, а не
`CHANGE_DIR_MISSING` в живом состоянии.

### 11. Controller

Входы по 04 §4 из verdicts + record + policy; `gate_verdict` — худший verdict, `gate_waivable` — его gate. Правила всех packs в порядке
загрузки (core-sdd первый); `when` сравнивается по типу: boolean — равенство, строка — равенство enum, `">N"` — численно.
Ни одно не совпало → `CONTINUE` без `next`. Код выхода — из `controller_action` (P-20); ошибки checks в `verify` — `max(код ошибки, код controller)`.

### 12. `status` — gate без check

`status` вызывает gate engine по записанному evidence (без runner'а) для следующего перехода и печатает `verification`; при отсутствии
git/`openspec` — `BLOCKED` c findings, не ошибка команды. `rules{total, unenforced}` считается по `provides.rules` + `.warrant/local/rules/`.
Golden `expected/status.json` перегенерируется (`golden:update`) — поле `verification` входит в snapshot.

### 13. Двухступенчатая валидация (D-13)

`loadPacks` читает `evidence_kinds` в нормальную форму `{ kind, metrics_schema? }`; `validate` (12) компилирует `metrics_schema` ajv'ом
(`additionalProperties: false` не навязывается — форма pack'а), применяет к `metrics` записи по `kind`; `targets[]` — по `targets_schema`
gate'а: поле схемы gate **не добавляется** в фазе 3 (первый потребитель — `bdd-tdd`), поэтому непустой `targets[]` при любом gate →
`PACK_FORM_UNKNOWN`. Это честнее, чем принять любой object.

### 14. `validate` (9): stable ID относительно HEAD

`git show HEAD:<path>` для каждого файла `openspec/specs/**` и `openspec/changes/<change>/**` при record ≥ `APPROVED` (по `scanIds`
рабочего дерева и той же функции по содержимому из HEAD); множество ID из HEAD ⊆ множество из дерева, иначе `ID_IMMUTABLE`. Файл,
отсутствующий в HEAD, пропускается. Без git — проверка пропускается с предупреждением в stderr (не ошибка: `validate` обязан работать в
fixture-проектах без git).

### 15. B4 — `process.exitCode`

`run()` в `bin/warrant.ts`: `emit()` пишет JSON через `process.stdout.write(text, cb)`; код выхода — `process.exitCode = code` и возврат,
без `process.exit`. Открытые handles (таймеры runner'а) закрываются в `finally`, иначе процесс не завершится — e2e на `check` это поймает.
`--version`/`--help` — тот же путь.

### 16. Golden `verify` и fake `openspec validate`

`scripts/golden-lib.js`: fake `openspec` получает `validate <change> --strict --json` → `{ "valid": true, "issues": [] }`; снимок
`expected/verify.json` = `data` без `findings[].evidence` (ULID) и полей времени; `effective_policy.hash` остаётся — он стабилен вне git
(content hash слоя, G-10). Golden-проекты не git-репозитории, поэтому только `PROPOSED->SPECIFIED` (P-18). `factory-golden-passed`
в фазе 3 — `applies_when` по diff + evidence `test-report`: тот же junit vitest, отдельного check нет (kind общий; failure mode «golden
прошёл, а тесты нет» невозможен — golden часть `npm test`).

### 17. Dogfooding: override, waivers, CI-артефакт

`.warrant/local/checks/tests-passed.json`: `{ "overrides": "core-sdd:tests-passed", "run": { "command": ["npm", "test", "--", "--reporter=junit",
"--outputFile={out}/junit.xml"] }, "execution": { "exclusive": true, "timeout_s": 1200 } }` — `npm test` уже делает build. Два waiver'а:
`WAV-2026-001` (`analyze-clean`), `WAV-2026-002` (`adversarial-review`), `approved_by: human:Homasters-max`, `expires_at: 2026-12-31`, `risk: HIGH`,
`compensating_controls: ["phase-4 change implements the producer", "maintainer review of PR"]`. Workflow `ci.yml`: job `test` (матрица) →
`npm ci`, `npm i -g @fission-ai/openspec@1.13.1`, `npm test`, `npm run typecheck`, `npm i -g .`, `warrant validate` в `packages/cli/test/fixtures`-проекте
и в корне; job `evidence` (только `pull_request` с веткой `worktree/*`, ubuntu): `warrant verify <change из ветки> --transition VERIFYING->MERGED --base origin/main`
(`fetch-depth: 0`), `upload-artifact` `.warrant/evidence/<change>/`; job не роняет PR при `WAIT` (evidence — продукт, verdict — `ci` фазы 4).

### 18. ADR-0023

«Frontend разработки самого WARRANT»: Context — 12 §7; Decision — код репозитория WARRANT в MVP пишут сессии Claude Code (координатор +
субагенты) без `guard`, защита — топология PR, review, CI, `validate`; норма ADR-0018 п. 7 / ADR-0020 п. 4 относится к проектам под WARRANT
и к slice; адаптер `claude` — кандидат фазы 4 по итогам S8; `amends: [ADR-0018]`, README ADR, строки 12 §7 удаляются. Пишется в группе 1
вместе с правками 04 §7, 06 §3, 06a §3, 13 §2.

### 19. Порядок работы

Как в фазах 1–2: координатор Fable, субагент Opus на группу, отчёт ≤ 70 строк с «Decisions/deviations»; после группы — `npm test`,
`npm run typecheck`, `warrant validate`, `warrant fmt --check`, `sync --check`; коммит на группу в `worktree/phase-3-verification`
(после merge spec-PR). Отклонения — вопросом, принятые — I-66… в таблице ниже.

## Risks / Trade-offs

- [Linux никогда не запускался: пути, `spawn`, замок, `taskkill`] → группа 1 = CI-матрица до кода исполнения; всё платформенное — в
  `runner.ts`/`lock.ts` с unit-тестами на обеих ОС.
- [`process.exitCode` вместо `exit`: висящий handle не даёт процессу завершиться] → e2e с таймаутом на каждую команду; runner закрывает
  таймеры и потоки в `finally`.
- [Двухступенчатая валидация ломает существующие evidence фикстур] → фикстур evidence ещё нет; golden получают записи только через `check`.
- [Pack `0.2.0` меняет lock, golden, `sources`] → одна задача «bump + `golden:update` + просмотр diff `expected/*`».
- [Пред-фильтр по `commit` делает любой локальный `verify` после коммита `BLOCKED`] → это цель (STALE по D-12); `verify` запускает checks
  заново, `status` показывает, что записи устарели.
- [`transition MERGED` требует ручного переноса artifact'а из CI] → временная цена до `warrant ci`; описано в README и NEXT-SESSION.
- [Объём: 8 REQ-VER + 13 MODIFIED KRN] → задачи режутся по группам с проверкой после каждой; что не влезло — `phase-3b`, не тихое сужение.

## Migration Plan

1. Группа 1: CI и схемы — репозиторий остаётся зелёным (новые поля необязательны).
2. Pack `0.2.0` и `warrant.json` `^0.2.0` в одной задаче с `golden:update`.
3. Dogfooding: override `tests-passed`, waivers, `.gitignore` — после появления `check`; transitions change фазы 3 — по мере прохождения PR.
4. Откат: `git revert` группы; evidence и waivers без исполнителя ни на что не влияют.

## Open Questions

Нет: вопросы, меняющие spec, закрыты P-1…P-20; деферируемое (мёртвый pid, другие CI, base-ветка ≠ `main`) — later по failure mode.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-66 | `packages/cli/test/fixtures` — не проект WARRANT (нет `.warrant/warrant.json`); CI-шаг «`warrant validate` в fixture-проекте» идёт в копии golden `packs/core-sdd/golden/feature` во временном каталоге | 1.1, `.github/workflows/ci.yml` |
| I-67 | Плейсхолдер в `check.1` — только `{name}` из `[A-Za-z0-9_.-]`; `{}` и `{ a: 1 }` не плейсхолдеры (иначе отклонялся бы код в `node -e`) | 1.3, `check.1.schema.json` |
| I-68 | Объектная форма `evidence_kinds` требует и `kind`, и `metrics_schema` (объект без формы не отличается от строки); `guard_prefixes` — каждый префикс ≥ 1 непустого токена | 1.3, `pack.1`, `check.1` |
| I-69 | Формы `metrics` core-sdd строгие: все поля обязательны, `additionalProperties: false`, integer ≥ 0 — решение pack, kernel строгость не навязывает (D-13) | 1.4, `packs/core-sdd/evidence/*.metrics.schema.json` |
| I-70 | Версии объектов pack (`checks/*.json` и др.) остаются `1.0.0`, поднята только версия pack `0.2.0`; каталог `evidence/` pack'а вне `provides` допустим, если его файлы ровно совпадают со ссылками `metrics_schema` | 1.4, `core-sdd-catalog.test.ts` |
| I-71 | B4: e2e SCN-KRN-085 на Windows проходит и со старым `process.exit` — тест регрессионный, дефект не воспроизводит; Linux проверяет CI | 1.2, `status.test.ts` |
| I-72 | `path` bundled skill в lock — относительно корня поставки (каталог с bundled `packs/`: репозиторий или установленный пакет), а не корня pack: skill лежит в `sra/skills/`, путь от pack был бы `../../…`, а `relative_path` запрещает `..`. Skill, найденный в проекте, пишется путём проекта (lock репозитория не изменился) | 2.5, `sync/plan.ts`, `packs/hash.ts` |
| I-73 | `validate` (9): `ABANDONED` не проверяется (каталог удалён по design §10); Change, перенесённый в `archive/`, сравнивается со своей архивной копией (иначе коммит archive давал бы ложный `ID_IMMUTABLE`); без git/коммита — предупреждение в stderr, `data.skipped` не пополняется; git — `ls-tree` + один `cat-file --batch` | 2.2, `core/ids/immutable.ts` |
| I-74 | `DUPLICATE_OBJECT_ID` распространён на id правила (packs и local) и на kind, объявленный двумя packs (иначе форма `metrics` неоднозначна); kind, не объявленный ни одним pack, — `SEMANTIC_INVALID` `#/kind` (+ `PACK_FORM_UNKNOWN` при непустом `metrics`); расхождение `manifest.evidence[]` с каталогом — `SEMANTIC_INVALID`; ошибка формы — `SCHEMA_VIOLATION` `<file>#/metrics/…` | 2.3, `core/validate/evidence.ts` |
| I-75 | «Сегодня» для `expires_at` waiver — дата UTC; `id === basename` правила — семантическое правило схемы `rule` (`SEMANTIC_INVALID #/id`) | 2.1, `core/validate/waivers.ts`, `semantic.ts` |
| I-76 | Сырой вывод checks `.warrant/evidence/**/raw/**` исключён из проверок `validate` (1) и (7): он не часть записи (REQ-VER-001, P-19) и может быть JSON без `$schema`; REQ-KRN-021 уточнён в delta spec (решение maintainer'а) | 3.x, `validate` |
| I-77 | Удаление ID из `openspec/specs/**` delta'ой REMOVED в коммите archive даёт `ID_IMMUTABLE` по (9); у `phase-3-verification` REMOVED нет — отложено в `phase-3b` (решение maintainer'а) | NEXT-SESSION, долг |
