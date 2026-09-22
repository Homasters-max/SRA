---
id: WARRANT-NEXT
title: WARRANT — следующий шаг: фаза 3 verification
status: informative
maturity: MVP
version: 0.2.0
---

# WARRANT — что делать в следующей сессии

Файл передачи контекста. Прочитать первым, затем [00-readme](00-readme.md).

## Состояние на 2026-09-22 (вечер)

- **Фаза 1 закрыта**: PR #1 и PR #2 смержены в `main`; `phase-1-kernel` заархивирован (`openspec/changes/archive/2026-09-22-phase-1-kernel`,
  main spec `openspec/specs/kernel/spec.md`, REQ-KRN-001…027).
- **Фаза 2 закрыта**: PR #3 смержен в `main` (`7b12534`), tag `v0.2.0`; `phase-2-core-sdd` заархивирован stock `openspec archive`
  (`openspec/changes/archive/2026-09-22-phase-2-core-sdd`, main specs `openspec/specs/{kernel,core-sdd}/spec.md`). `warrant status`
  на архивном change даёт `ARCHIVED_WITHOUT_TRANSITION` — ожидаемо до `warrant archive` фазы 3. Версии: CLI **0.2.0**, pack `core-sdd` **0.1.0** (G-20).
- Change `phase-2-core-sdd`: proposal, delta specs `kernel` (REQ-KRN-028 `classify`, MODIFIED 021/025, SCN-KRN-073…083) и `core-sdd`
  (REQ-SDD-001…009, SCN-SDD-001…016), design (D-1…D-11, I-45…I-65), tasks (6 групп, 24 задачи).
- **Итог фазы 2:**
  - pack `core-sdd` наполнен: overlays `core-default`, `risk-low/medium/high`; profiles `feature`, `chore`, `factory-change`;
    12 gates; checks `openspec-validate`, `tests-passed`; `controller/rules.json` (три правила); skill-stub
    `sra/skills/specification/adversarial-review/SKILL.md` через `provides.skills`;
  - команда `warrant classify` (REQ-KRN-028): floor rules по diff/путям, `--propose`, `from`/`ignored[]`;
  - `openspec/config.yaml` генерируется целиком, флаг `--no-generated` удалён (G-5, откат I-43);
  - репозиторий переехал на schema `warrant-sdd`; собственная classification записана (`factory-change`, `SYSTEM`, `risk_level: HIGH`);
  - три golden-фикстуры + `npm run golden:update` + e2e `golden.test.ts`;
  - **B1, B2, B6 закрыты** (таблица ниже); B3, B4, B5 остаются.
- Прогон 6.1 на выходе фазы: `npm test` — 387 passed / 37 файлов, `typecheck`, `build`, `warrant validate` `ok: true`,
  `fmt --check` и `sync --check` — `changed: []`, `openspec validate phase-2-core-sdd --strict` зелёный,
  `golden:update` — `written: []`, повторный `npm test` не меняет рабочее дерево (SCN-SDD-015).
- Решения по ходу реализации **I-45…I-65** — таблица «Решения по ходу реализации» в
  [design.md архива](../openspec/changes/archive/2026-09-22-phase-2-core-sdd/design.md). Долг, переходящий в фазу 3:

  | # | Долг |
  |---|---|
  | I-52 | skill, найденный вне корня проекта (bundled pack вне monorepo), проверяется по версии, но в lock не пишется (`warrant://lock/1` хранит пути относительно проекта). Решить: считать отсутствие skill в проекте ошибкой — или ввести источник `bundled` без пути |
  | I-57 | `warrant status` не печатает `risk_level` (REQ-KRN-027 фазы 1 — только `effective_policy.{hash,sources}`). Расширить REQ-KRN-027 в фазе 3 вместе с verdicts и `next` |
  | I-59 | `packContentHash` исключает каталог `golden/` pack'а (иначе у лока фикстуры нет неподвижной точки). Пересмотреть, если golden начнёт влиять на policy |
  | I-64 | тестовый `runCli` и `scripts/golden-lib.js` асинхронные (`spawn` + Promise) из-за таймаутов репортёра vitest; короткие `spawnSync` остались для `git` и `openspecAvailable()` |

### Вход в фазу 3 (verification) — [13 §2](13-roadmap.md)

- Исполнение gates и checks, а не только их данные: команды `check`, `gate`, `verify`, `transition`, `archive`, `waive`;
  controller выносит verdict по `controller/rules.json`.
- `classify`: human-источник classification и понижение ниже floor с подтверждением (отложено из G-3).
- Evidence `spec-report` (I-47): kind объявлен pack'ом и требуется gate `spec-valid`, но никто его пока не производит —
  в фазе 3 check должен его писать.
- **CI-матрица `ubuntu-latest` + `windows-latest`**: `npm test`, `npm i -g` из чекаута, `warrant validate` на sample-проекте.
  WARRANT на Linux не запускался **ни разу** — это главный риск фазы 3.
- Backlog B3, B4, B5 (B4 — `process.exitCode` вместо `process.exit`, вместе с CI-матрицей).
- **Долг ADR-0016…0022** — таблицы A–D раздела «Долг схем и CLI» ниже (схемы `evidence`, `pack`, `check`, `config`,
  `waiver`, `change-record`, новая `rule/1`; `validate`, `status`; `check`, `gate`/`verify`, `transition`, `link`) и
  решения ревью D-1…D-25 («Решения по находкам ревью»). Всё это — вход `phase-3-verification`; схема `run/1`,
  `skill-result/1`, `sync`, `run start`, `guard`, `analyze` — фаза 4.
- **Объём фазы 3 — резать.** Ядро: схемы A и `validate` (группа 1), затем `check`, `gate`, `verify`, `transition`,
  `archive` на profile `feature` с evidence `spec-report` и `test-report`. Второй очередью (группа 3b или отдельный
  change): `link` и `amends`/`supersedes`, частичный waiver `targets[]`, `warrant waive`, `spec-approved`,
  `execution` кроме `exclusive`/`timeout_s`. Причина: до первого работающего slice важнее замкнуть цикл
  `check → gate → verify → transition`, чем покрыть весь долг.
- **Spike S8** (hooks Codex под `codex-acp` и `codex exec`, 13 §3) — до фазы 4, можно параллельно фазе 3.

### Продолжение — готовый запрос

```text
Прочитай docs/NEXT-SESSION.md целиком (включая «Долг схем и CLI после ADR-0016…0022» A–D, «Нарезка», «Решения по
находкам ревью» D-1…D-25), затем openspec/changes/archive/2026-09-22-phase-2-core-sdd/design.md (таблица I-45…I-65),
docs/13-roadmap.md §2 и ADR-0016, 0017, 0019, 0021 (ADR-0018, 0020, 0022 — фаза 4, читать для контекста).
Фаза 2 закрыта и заархивирована, ветка ADR-0016…0022 смержена в main.
/opsx:propose новый change `phase-3-verification`. Группа 1 — схемы A и `validate` (двухступенчатая валидация D-13,
`{paths}` в REQ-KRN-010, stale-правила D-22 в `status`). Группы 2–4 — `check` (`exclusive`, `timeout_s`, `--paths`,
`--base`), `gate` с пред-фильтром допустимости (D-11, D-12), `verify`, `transition`, `archive`, controller по
`controller/rules.json`; evidence `spec-report` (I-47) и `test-report`; human-источник classification и понижение ниже
floor (G-3). Группа 5 — CI-матрица ubuntu-latest + windows-latest, B3/B4/B5, долг I-52, I-57, I-59, I-64. Группа 6 —
выход. Вторая очередь (не входит, если не влезает; отдельный change `phase-3b`): `link`, `amends`/`supersedes`,
`targets[]` и `warrant waive`, `spec-approved`, `execution.local`/`guard_prefixes`, `analyze` TASK↔item.
Потолок как в фазе 2: ≤ 6 групп, ~30 задач (G-8). Изменение REQ kernel — delta spec, не молча. Схема работы прежняя: координатор — ты (Fable), субагент Opus 5 на группу,
отчёт ≤ 70 строк с разделом Decisions/deviations. Одна ветка — один worktree (git worktree add), см. «Организационное».
Отклонения от spec/design — вопросом ко мне, не молча; принятые — I-N в design.md.
```

### Организационное — одна ветка, один worktree

В фазе 2 параллельные сессии работали в одном рабочем каталоге и переключали ветку посреди работы: коммит `d2d8fd3`
«tasks — mark group 2 done» ушёл в `feature/factory-adrs-0016-0022`, где поверх него лёг чужой коммит; на
`feature/phase-2-core-sdd` галочки пришлось проставить повторно. **Правило: одна ветка — один worktree**
(`git worktree add`). Фаза 2 доделана в отдельном worktree `D:\project\SRA-phase2` (удалён после архивирования).
`d2d8fd3` из истории не вырезан (ветка запушена, поверх неё живёт `feature/agent-rules-plan`); вместо этого `main` после
архива слит в `feature/factory-adrs-0016-0022`, конфликт modify/delete по `openspec/changes/phase-2-core-sdd/tasks.md` разрешён
в пользу удаления (все галочки уже в архиве). `feature/agent-rules-plan` перед PR должна влить `factory-adrs` (или `main`) —
тогда тот же файл разрешится автоматически. В этом файле при слиянии ожидать конфликт раздела «Состояние»: брать версию `main`
как основу и переносить пункты про ADR-0016…0022.

## Backlog из ревью фазы 1 (не закрыто, срок привязан к фазам)

| # | Где | Дефект | Когда закрыть |
|---|---|---|---|
| B1 | `packages/cli/src/core/packs/loader.ts` `weakenings()` | **закрыт группой 3**. strengthen-only не сравнивал `match` overlay и `extends` profile: override мог сузить применение политики без `OVERRIDE_WEAKENS` (SCN-KRN-078, SCN-KRN-079, SCN-SDD-010) | — |
| B2 | `packages/cli/src/core/packs/loader.ts` `loadLocalLayer()` | **закрыт группой 3**. Каталог pack в `.warrant/local/<id>/`, не включённый в `warrant.json`, всасывался в project-слой как pack `local`; теперь `CONFIG_INVALID` (SCN-KRN-080) | — |
| B3 | `packages/cli/src/core/packs/hash.ts` `checkLock()` | pack, удалённый из `warrant.json`, но оставшийся в lock, не даёт `LOCK_MISMATCH` (`sync --check` при этом видит расхождение) | quick fix, отдельный PR в любой момент |
| B4 | `packages/cli/src/bin/warrant.ts` `run()` | `process.exit` сразу после записи envelope в stdout; в pipe на Windows большой вывод может обрезаться | **фаза 3**, вместе с CI-матрицей ubuntu + windows (`process.exitCode` вместо `exit`) |
| B5 | `packages/cli/src/core/openspec/yaml-emit.ts` `emitKey()` | ключи `null` / `true` / `false` пишутся в YAML без кавычек и читаются как не-строки | quick fix, можно вместе с B3 |
| B6 | `packages/cli/src/core/ids/scan.ts` | **закрыт группой 1 фазы 2 (I-46)**. После `openspec archive` main spec `openspec/specs/**` и архивная delta `openspec/changes/archive/**` объявляют одни и те же `REQ`/`SCN` → ложный `ID_DUPLICATE` (найдено при архивировании `phase-1-kernel`, G-6). Архив должен считаться «занято», но не «объявлено дважды» | — |

Пункты не дублировать в GitHub issues без решения maintainer'а; эта таблица — единственное место учёта.

## Что уже решено для фазы 1 (не обсуждать заново)

| Решение | Где |
|---|---|
| Стек: TypeScript на Node; bin `warrant`; не публикуется, `npm i -g <git-tag>` | ADR-0013 |
| Monorepo: `docs/`, `packages/cli/`, `packs/core-sdd/`, `sra/skills/`, `lattice/` | ADR-0013 |
| Команды фазы 1: `init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status`; JSON-вывод, коды выхода 0/1/2/3 | 04 §7, 13 §2 |
| core-sdd@0.1: profiles `feature`, `chore`, `factory-change`; gates и checks из 06 §4 | ADR-0013, 05, 06 |
| Change record `.warrant/changes/<change>.json`; пишет только CLI | 04 §9, ADR-0009 |
| ID: `PREFIX-AREA-NNN` immutable с MERGED, ULID для EVID/RUN, реестр AREA, `warrant id renumber` | ADR-0012 |
| Доверие по ref, CI не пишет в репозиторий, bot-идентичность агента, forge = GitHub | ADR-0010 |
| Топология: spec-PR, impl-PR, archive-PR; `warrant archive` оборачивает `openspec archive`; gate `branch-isolated` | ADR-0011 |
| Enforcement Claude Code: static deny из `warrant sync` + hook `warrant guard`; reviewer = subagent | ADR-0014 |
| Все машинные файлы — JSON с `$schema` `warrant://<name>/<major>`; `warrant fmt` канонизирует | ADR-0006, 08 §7 |

## Порядок работы — через OpenSpec (dogfooding)

Skills superpowers из Claude Code убраны. Репозиторий ведётся **самим OpenSpec**: это закрыло S2 (`config.yaml` и schema
видны изнутри) и дало первые артефакты для `factory-change`. Фазы 1 и 2 пройдены по этой схеме — она проверена, менять её
в фазе 3 не нужно.

### Шаг 1 — спайк S2 · выполнен

`openspec init --tools claude` сделан, результат — [ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md). S2 и остаток S3 закрыты в 13 §3.

### Шаг 2 — планирование Change `phase-1-kernel` · выполнено

`openspec/changes/phase-1-kernel/`: proposal (решения review — `DECISION` в конце), specs (REQ-KRN-001…027, SCN-KRN-001…072),
design (D-1…D-10), tasks (10 групп, 47 задач). `openspec validate phase-1-kernel --strict` — зелёный.

### Шаг 2a — apply · выполнен

Ветка `feature/phase-1-kernel`. Вести через `/opsx:apply phase-1-kernel` по tasks.md; коммит на группу с зелёными тестами.
Ничего сверх tasks.md: новая потребность — сначала правка tasks/design, потом код. Отклонения от spec/design — вопросом
к maintainer'у, не молча; принятые — в таблицу «Решения по ходу реализации» design.md (I-N).

**Модели и схема работы (проверена на фазах 1 и 2).** Сессия (координатор) — Fable 5.1: читает spec/design/tasks целиком,
пишет субагенту полный prompt (пути, REQ/SCN, конвенции кода, что уже есть), принимает отчёт, сам гоняет `npm test` и
`npm run typecheck`, делает ручную проверку команды, коммитит. Субагент — Agent tool, `model: "opus"`, одна группа задач,
`run_in_background: false`, отчёт ≤ 70 строк с разделом «Decisions/deviations». Sonnet не использовать.

Порядок и зависимости:

| Группа | Зависит от | Заметки |
|---|---|---|
| 4 `fmt` | 2 | сделана (I-12, I-13) |
| 6 `id` | 2, 3.5 | сделана (I-14, I-15) |
| 7 `sync` | 4 | сделана (I-16…I-18); `runSync`/`planSync` в `core/sync/plan.ts`, версия OpenSpec — `core/openspec/version.ts` |
| 8 `resolve` | 3.1 | сделана (I-19…I-21); `resolveForProject(loaded, classification?)` в `core/resolve/index.ts` — использовать в `status` |
| 5 `init` | 4, 7 | `init` вызывает `runSync`; JSON писать только через `writeJsonFile` (`core/canon/format-json.ts`); `init change` — имя проверять до `openspec new change` |
| 9 `status` | 8, 5 | `effective_policy.{hash,sources}` через `resolveForProject`; `openspec status --change <c> --json` через `runOpenspec` |
| 10 | всё | 10.2: `.warrant/warrant.json` этого репозитория через `warrant init` без перезаписи `config.yaml` |

Конвенции кода, которые субагент должен знать: TypeScript ESM NodeNext (`.js` в импортах), strict +
`exactOptionalPropertyTypes`; `WarrantError(code, message, {path})` из `core/errors.ts`; `success/failure/failures` из `io/output.ts`;
команды регистрируются в `src/bin/warrant.ts` через `register`; e2e через `test/helpers/cli.ts` (`runCli`, `makeTempDir`);
тесты, которым нужен `openspec`, — `it.skipIf(!openspecAvailable())` из `core/openspec/cli.ts`.

Готовый запрос:

```text
Прочитай docs/NEXT-SESSION.md, затем openspec/changes/phase-1-kernel/{proposal,design,tasks}.md и specs/kernel/spec.md
(design.md — включая таблицу «Решения по ходу реализации»). Документы 02–08 и ADR-0006, 0012, 0013, 0015 — по мере
необходимости. Ветка feature/phase-1-kernel уже есть, группы 1–3 сделаны. Продолжай /opsx:apply phase-1-kernel по той же
схеме: координатор — ты, субагенты Opus 5 по одной группе. Группы 4, 6, 7, 8 сделаны. Запусти группу 5, затем 9, затем 10 (последовательно: 9 зависит от 5, 10 — от всего). Коммит после каждой группы с зелёными тестами; сам проверяй результат
субагента (npm test, npm run typecheck, ручной прогон команды). Отклонения от spec/design — вопросом ко мне, не молча.
Остановись после группы 10 и покажи результат.
```

### Шаг 3 — фаза 2 `core-sdd` · выполнен

Roadmap [13 §2](13-roadmap.md): schema `warrant-sdd`, profiles, core gates и checks, templates, controller rules, risk;
критерий выхода — golden `feature`, `chore`, `factory-change` (ADR-0013). Расхождение roadmap с `bugfix` устранено группой 1: 13 §2 и 08 §6 приведены к G-1, G-2.
Источники нормы: [05](05-policy.md), [06](06-verification.md), [08](08-packs.md), ADR-0013, ADR-0015. Шаблоны — 13 §5 (proposal, spec, design, tasks, waiver, experiment).

Решения grilling 2026-09-22 (G-1…G-21), приняты maintainer'ом; proposal/design фазы 2 ссылаются на них:

| # | Решение |
|---|---|
| G-1 | Golden фазы 2 = fixture-change в `packs/core-sdd/golden/<profile>/` + snapshot `resolve --explain` и `status`; прогон gates — фаза 3 (roadmap 13 §2 уточнить) |
| G-2 | Profiles 0.1: `feature`, `chore`, `factory-change` (ADR-0013); roadmap 13 §2 и 08 §6 поправить в этом change, без нового ADR |
| G-3 | `warrant classify` в фазе 2: floor rules по diff + `--propose <json>`; human-подтверждение и понижение ниже floor — фаза 3 |
| G-4 | Gates/checks/controller rules кладутся как данные pack (все gates из 04 §5 + `factory-golden-passed`), исполнение — фаза 3; checks только `openspec-validate` и формат для `tests-passed` |
| G-5 | `--no-generated` удаляется: `config.yaml` полностью генерируется из pack rules + `.warrant/local/openspec/rules.json` |
| G-6 | `phase-1-kernel` архивируется stock `openspec archive` до propose фазы 2 |
| G-7 | B1, B2 — delta spec kernel (SCN на `OVERRIDE_WEAKENS`, `CONFIG_INVALID`), чинятся в той же группе, где появляются реальные overlays |
| G-8 | Потолок: ≤ 6 групп, ~30 задач; не влезает — второй change; схема «координатор Fable + субагенты Opus»; `warrant validate` без флагов зелёный после каждой группы |
| G-9 | Artifacts `warrant-sdd` остаются четырьмя; waiver — JSON через будущий `warrant waive`, experiment — с profile (13 §5 поправить); `chore` = proposal + tasks при `skip_specs` |
| G-10 | Golden в pack, тест `golden.test.ts` в CLI; project-слой в `sources` — content hash (как в фазе 1), не git-sha |
| G-11 | `classify <change> [--base main] [--paths <file>] [--propose <json>]` пишет `classification` с источником каждого значения; повторный запуск не понижает записанное |
| G-12 | `risk-high` в core-sdd только `adversarial-review` + `human-approval` на `VERIFYING->MERGED`; чужие gates добавляют свои packs overlay'ями по `match.risk_level`; `risk-low` пустой |
| G-13 | Общий слой — overlay `core-default` с пустым `match`, а не profile `base` |
| G-14 | `controller/rules.json`: три правила (blocking UNKNOWN → WAIT/clarify, POLICY_CONFLICT → ESCALATE, gate FAIL → WAIT) |
| G-15 | `sra/skills/specification/adversarial-review/SKILL.md` — stub + `provides.skills`, чтобы lock/validate/sync прошли путь skill |
| G-16 | Change фазы 2 ведётся через `warrant init change` + `classify`; AREA `SDD` для REQ/SCN pack'а |
| G-17 | Gates по переходам: `feature` = 04 §5; `chore` без `adversarial-review`/`blocking-unknowns-resolved`; `factory-change` = feature + `factory-golden-passed`; общие (`spec-valid`, `ids-valid`) в `core-default`; 06 §4 `worktree-ready` → `branch-isolated` |
| G-18 | «Language: Russian» переезжает из pack rules в `.warrant/local/openspec/rules.json`; pack языково-нейтрален |
| G-19 | Группы: 1 docs + delta spec + init change; 2 данные pack; 3 kernel (`classify`, B1/B2, semantic); 4 `sync` + переезд; 5 golden; 6 выход |
| G-20 | Pack остаётся `0.1.0`; CLI `0.2.0` + tag `v0.2.0` в конце фазы 2 |
| G-21 | `capabilities.forbidden: ["PRODUCTION_WRITE"]` только у `factory-change`; approvals — роль `maintainer` на `SPECIFIED->APPROVED` у всех трёх |

Все решения G-1…G-21 реализованы. Дальше — фаза 3 (verification, см. «Вход в фазу 3» выше; CI-матрица **ubuntu-latest + windows-latest**:
`npm test`, `npm i -g` из чекаута, `warrant validate` на sample-проекте; WARRANT на Linux ещё не запускался ни разу), затем 4
(frontend Codex, ADR-0018 / ADR-0020). Vertical slice по ADR-0013 — после фазы 4.
LATTICE — после slice ([../lattice/NEXT-SESSION.md](../lattice/NEXT-SESSION.md)).

## Долг схем и CLI после ADR-0016…0022 — вход для фаз 3–4

Ветка `feature/factory-adrs-0016-0022` (main после фазы 2 влит в неё, PR в main — после ревью). Решения записаны только в документах;
все затронутые схемы — `additionalProperties: false`, поэтому до правки новые поля не пройдут `validate`.
Все правки — **добавление необязательных полей**, версия `/1` не меняется.

### A. Существующие схемы (фаза 3)

| Схема | REQ | Добавить | ADR |
|---|---|---|---|
| `evidence.1` | REQ-KRN-012 | `metrics` (object; форму задаёт pack для kind — валидация в два шага, D-13); `subject.base_commit` | 0016 |
| `pack.1` → `provides` | REQ-KRN-006 | `rules[]`; `evidence_kinds` → `[{ "kind", "metrics_schema" }]` (сейчас список строк; D-13) | 0016, 0022 |
| `check.1` | REQ-KRN-010 | `execution{exclusive, timeout_s, local, guard_prefixes}` (`max_paths` — later, D-23); `run.scoped_command` с плейсхолдером `{paths}` (сейчас REQ допускает только `{out}`) | 0017 |
| `config.1` | REQ-KRN-004 | `defaults{check_timeout_s}` | 0017 |
| `waiver.1` | REQ-KRN-019 | `targets[]` (object[]; форму задаёт pack gate — валидация в два шага, D-13; читает check, D-10) | 0016 |
| `change-record.1` | REQ-KRN-011 | `amends[]`, `supersedes[]` | 0021 |

### B. Новая схема

| Схема | Содержание | ADR |
|---|---|---|
| `rule/1` | `{ $schema, id, paths[], text, enforced_by? }`; новый REQ в kernel spec | 0022 |
| `run/1` | 03 §4: `change`, `operation`, `skill`, `write_scope[]`, `context_hash`, `run_state`, `guard_events[]`; `.warrant/runs/current`; путь через `WARRANT_STATE_DIR` (фаза 4; D-2, D-9) | 0014, 0017–0019, 0022 |
| `skill-result/1` | envelope 07 §4 для `run submit`; `codex exec --output-schema` пишет его (фаза 4; D-5, D-9) | 0013, 0020 |

Черновик первого набора правил (грилинг 2026-09-22; `text` — EN, формулируется при реализации). Критерий отбора:
правило **о форме** обязано иметь `enforced_by`, иначе это проза (INV-04); правило **о решении** может быть без него —
доля таких правил видна в `warrant status` (ADR-0022 п. 4).

| id | paths | enforced_by |
|---|---|---|
| `generated-not-hand-edited` | `openspec/config.yaml`, `openspec/schemas/**`, `.warrant/warrant.lock.json`, `.warrant/schemas/**`, `AGENTS.md`, `.codex/**`, `packs/*/golden/**/expected/**` | `validate` (drift) |
| `ids-allocated-by-cli` | `**` | `ids-valid` |
| `json-canonical` | `.warrant/**/*.json`, `packs/**/*.json`, `packages/cli/schemas/*.json` | `fmt --check` |
| `state-written-by-cli-only` | `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**` | `guard` (фаза 4) |
| `pack-object-id-equals-basename` | `packs/**`, `.warrant/local/**` | `validate` (semantic) |
| `no-secrets-in-repo` | `.warrant/**`, `.claude/**`, `.codex/**` | `validate` (проверка 6) |
| `language-split` | `**` | — |
| `abstraction-choice-first` | `packs/**`, `packages/cli/schemas/**`, `sra/skills/**` | — |

Правило живёт в том канале, чьи пути защищает, и только в одном. Целиком внутри `openspec/changes/**` — только
`openspec-rules` (это же проверяет `validate`, ADR-0022 п. 4). Следствие для фазы 3: `context` «Language: Russian…»
уезжает из `.warrant/local/openspec/rules.json` в правило `language-split` и из `rules.json` удаляется (INV-06).

### C. Существующие команды

| Команда | REQ | Добавить | ADR | Фаза |
|---|---|---|---|---|
| `validate` | REQ-KRN-021 | `--files`; stable ID изменён / удалён относительно `HEAD`; висячие REQ / SCN; pragma mutation-инструментов; правила с `paths` только в `openspec/changes/**` — ошибка; `AGENTS.md` побайтно и ≤ 16 KiB; цель `amends` / `supersedes` в допустимом состоянии | 0019, 0021, 0022 | 3 |
| `status` | REQ-KRN-027 | вычисляемые `amended_by[]` / `superseded_by[]`; доля правил без `enforced_by`; `stale[]`: `ABANDONED_DIR_PRESENT`, `DIR_MISSING_WITHOUT_TRANSITION` (D-22); finding `FRONTEND_HOOKS_INACTIVE` (D-14) | 0021, 0022, 0018 | 3–4 |
| `init` | REQ-KRN-023 | проверка `codex --version ≥ MIN` при генерации `.codex/hooks.json` (D-7) | 0018 | 4 |
| `sync` | REQ-KRN-025 | `.codex/hooks.json` (постоянная строка `warrant guard --frontend codex`), `AGENTS.md` | 0018, 0022 | 4 |

### D. Новые команды — требования с первого дня

| Команда | Требования | Фаза |
|---|---|---|
| `check` | замок `exclusive` в `git-common-dir`, `BUSY` (код 2), `--paths` + `scoped_command`, `timeout_s` (default 1800, D-17), `local: allowed \| scoped-only`; `--base <commit>` и `WARRANT_STATE_DIR` (D-2, D-20); `--wait`, `ci-only`, `max_paths` — later (D-23) | 3 (0017) |
| `gate` / `verify` | пред-фильтр допустимости evidence (commit/base, `metrics.threshold`, `limitations` `scoped:`, отпечатки `targets`) → `STALE` (D-12); шаг 1 `NOT_APPLICABLE` от check (D-11); gate `spec-approved` транспортно-нейтральный (D-3); `scope-valid` запрещает архив, record и evidence архивных Changes, кроме archive-PR для своего каталога (D-15); `--base <commit>` (D-20); finding `FRONTEND_HOOKS_INACTIVE` (D-14) | 3 (0016, 0018, 0020, 0021) |
| `analyze` | `STALE` для неприменимого target waiver; обратные ссылки; TASK ↔ sef item | 4 (0016, 0020, 0021; было 3 — перенесено по правилу «Чего не делать») |
| `transition` | `ABANDONED` удаляет каталог Change и замораживает record | 3 (0021) |
| `link` | `--amends` / `--supersedes`, до `APPROVED` | 3 (0021) |
| `run start` | Context Pack и JSON-вывод с `rules[]` по `write_scope` | 4 (0022) |
| `guard` | нормализованный контракт pre / post, `--frontend codex`; без Run → `deny`; `guard_prefixes`; hints через `additionalContext`, текст правил раз за Run; `guard_events[]` | 4 (0017–0019, 0022) |

### E. Не фазы 3–4

| Что | Когда |
|---|---|
| `attestation_type` `sef-approval`, `sef-gate` (enum в `common.1`); gate `spec-approved`; `analyze` TASK ↔ sef item; `SEF_PROTECTED_DRIFT`; forge `sef-hub` | срез S1 SEF (ADR-0020, proposed; черновик SEF предварительный) |
| pack `bdd-tdd`: check `mutation`, parser в mutation-testing-report-schema, фильтр по diff, lint pragma | фаза 5 (0016); инструмент — spike S7 |
| floor по размеру diff, pack `ui`, `dismissed[]` в skill-result | later по триггерам ([13 §3](13-roadmap.md)) |

### Нарезка

- Change `phase-3-verification`: A, B (`rule/1`), C (без `sync`, без `init`) и из D — `check`, `gate`, `verify`, `transition`;
  `link` и `analyze` — вторая очередь (`analyze` — фаза 4 по правилу «Чего не делать»). Первая группа задач — схемы и
  `validate`: остальное от них зависит. Порядок групп — в «готовом запросе» выше.
- Change фазы 4: `sync`, `run start`, `guard`, `analyze`, адаптер `codex`, схемы `run/1` и `skill-result/1`.

### Карта агента и первые правила — план (грилинг 2026-09-22)

Разбор `oinsio/clear-progress` (запрос «сделать так же у нас») показал: его форма — 23 правила в `.claude/rules/*.md`,
PostToolUse-хуки с прогоном тестов, рукописный корневой файл — уже отвергнута [ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)
и [ADR-0019](adr/WARRANT-ADR-0019-post-edit-hints.md). Взято три вещи: адресность правила по путям, `enforced_by` как
маркер «держится на prompt», тест на удаление строки.

Порядок работ, каждый шаг зависит от предыдущего:

1. Закрыть фазу 2 (часть группы 5, группа 6), `feature/phase-2-core-sdd` → `main`.
2. Ребейз `feature/factory-adrs-0016-0022` поверх `main` и влитие. Генерируемое — `warrant.lock.json`,
   `.warrant/changes/*.json`, `openspec/config.yaml` — **не мержить построчно, пересоздать** (`sync`, `classify`).
3. Change `agent-session-guide` (`chore`) — состав ниже.
4. Change `phase-3-verification` по нарезке выше; ADR-0023 пишется внутри него, а не дописывается в отревьюированную ветку.

Change `agent-session-guide` — заодно полигон топологии [ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md)
(`spec/` → `worktree/` → `archive/`, три PR) на трёх файлах, до того как по ней пойдёт фаза 3:

- `scripts/preflight.js` + `npm run preflight`: `typecheck` → `build` → `vitest` → `fmt --check` → `validate` →
  `openspec validate <change> --strict` (нет на PATH — пропуск с предупреждением) → проверка markdown-ссылок
  (`docs/**` и карта: файл и якорь существуют). Останов на первом падении. В шапке — «схлопнется в обёртку над
  `warrant verify` в фазе 3». Проверка ссылок — кандидат в `check`, далее в gate `spec-valid`.
- `CLAUDE.md` — **временный**, RU, ≤ 45 строк: только карта (навигация «трогаешь X → норма Y §Z», цикл `/opsx:*` и
  команд `warrant`, `preflight`, формат ветки / коммита / `I-N`) плюс строка «правила — в `rule/1` и `openspec-rules`,
  здесь их нет». Ни одного правила об артефактах OpenSpec (их канал — `config.yaml`) и ни одного из восьми выше.
  Удаляется в фазе 4, когда `sync` начнёт генерировать `AGENTS.md`; TTL зафиксирован здесь и задачей в `tasks.md` фазы 4.
- `.claude/settings.json` — только `permissions.deny` на генерируемые пути и `.warrant/{changes,evidence,runs}/**`,
  без хуков (наполнять нечем до `guard` и `validate --files`), тот же TTL. Предел известен: `deny` на `Edit` / `Write`
  не мешает записи через `Bash` ([ADR-0014](adr/WARRANT-ADR-0014-claude-code-enforcement.md)), гарантия — CI.
- `.claude/commands/`: `/decision` (следующий `I-N` строкой в таблицу `design.md`), `/group-done <N>`, `/next-session`.
  Критерий: файл в `.claude/` автоматизирует **процедуру**; **правило** туда не пишется никогда.
- Skills, пересказывающие норму (`warrant-adr`, `warrant-doc-edit`, `warrant-schema-change`, `warrant-pack-object`),
  не пишутся: их содержание — каналы 2 и 3 ADR-0022.
- Приёмка (`tasks.md`): (1) `preflight` зелёный на чистом дереве и падает на первом шаге при намеренно сломанном файле;
  (2) карта ≤ 45 строк, построчный проход теста на удаление — в описании PR; (3) grep подтверждает отсутствие дублей
  с `config.yaml` и восемью правилами; (4) `/decision` даёт верный номер `I-N`; (5) попытка `Edit` по
  `warrant.lock.json` из сессии отклонена.

Ещё одна правка нормы: `rules.design` в **pack** `core-sdd` (не в local) получает пункт «отклонение от spec фиксируется
строкой `I-N` в `design.md`» — это часть метода SDD, а не привычка одного репозитория. Цена — меняется
`packContentHash`, нужен `npm run golden:update`.

### Не потерять

- (Было: раздел жил только в ветке `feature/factory-adrs-0016-0022`, а в `feature/phase-2-core-sdd` его не было.) После
  слияния `main` в ветку ADR и её PR в `main` раздел общий; долг закрывается changes фаз 3–4, строки помечать «сделано».
- При ревизии черновика SEF ([integrations/2026-09-17-sef-platform-design.md](integrations/2026-09-17-sef-platform-design.md),
  предварительный) сверить его с [11 §2](11-integrations.md) «Требования WARRANT к SEF» и ADR-0020 п. 8–14 (`proposed`):
  approval без hash spec, `source_ref` TASK ↔ item, один тестовый гейт `warrant verify`, `warrant transition` в
  `sef work approve` и `landing`, archive в `landing`, `protected[]` ⊇ пути WARRANT, `AGENTS.md` и `.codex/hooks.json`
  в эталоне `.sef/engines/<profile>/`.
- Решение, отданное по умолчанию: `attestation_type` `sef-*` — со срезом S1 SEF, не в фазе 3.

### Ревью ADR-0016…0022 — готовый запрос (выполнено 2026-09-22)

Выполнено: находки L1-1…L1-11, F-1…F-28; решения D-1…D-25 и коммиты — в разделе «Решения по находкам ревью» ниже.
Запрос сохранён как образец для ревью следующих ADR (заменить номера и ветку).

```text
Проведи ревью / аудит проектных решений WARRANT в ветке feature/factory-adrs-0016-0022 (репозиторий D:\project\SRA).
Ветка поверх feature/phase-2-core-sdd; наш объём — коммиты после c0379c1 (git log c0379c1..HEAD), только docs/.
Ты — независимый ревьюер: ничего не исправляй, только находки. Транскрипт сессии, где это писалось, не читай.

Прочитай: docs/adr/WARRANT-ADR-0016…0022 целиком; изменённые ими части docs/01, 03, 04, 05, 06, 06a, 07, 08,
10-pack-bdd-tdd, 10-pack-brownfield, 11, 12, 13, NEXT-SESSION (git diff c0379c1..HEAD -- docs/); для контекста —
ADR-0009…0015, docs/01-principles.md (INV-01…11), openspec/specs/kernel/spec.md, packages/cli/schemas/*.json,
docs/integrations/2026-09-17-sef-platform-design.md (черновик SEF, ПРЕДВАРИТЕЛЬНЫЙ — расхождения с ним не дефект, а вопрос).

Слой 1 — детерминированно (выполни команды, приложи вывод):
- битые относительные ссылки в docs/**;
- симметрия amends ↔ amended_by во frontmatter всех ADR и соответствие таблице docs/adr/README.md;
- полнота frontmatter ADR-0016…0022;
- openspec validate --strict по активным change и warrant validate --no-generated — зелёные;
- устаревшие формулировки после ADR-0018/0020: «Claude Code» как frontend MVP, «codex-acp в MVP», «Claude-оркестратор».

Слой 2 — по смыслу:
- противоречия между ADR-0016…0022 и между ними и docs 01–13 (включая тело ADR, перекрытое только заметкой «Уточнено…»);
- нарушения INV-01…11; второй authority для одного факта (INV-06, P9 черновика SEF);
- решения, опирающиеся на непроверенные факты (адаптеры ACP не запускались, hooks Codex под codex-acp — medium),
  без пометки proposed/later;
- избыточность для MVP (что можно вычеркнуть без потери);
- полнота долга в NEXT-SESSION «Долг схем и CLI» относительно реальных схем packages/cli/schemas (additionalProperties: false).

Отчёт: таблица находок {id, severity BLOCKER|MAJOR|MINOR|INFO, где (файл:строка), что не так, почему, предлагаемое
направление исправления}, отдельно «вопросы к владельцу». Сначала слой 1, потом слой 2. По-русски, термины по-английски.
После отчёта — не исправлять; разбор находок проведём раундами (/grilling), правки — отдельными коммитами.
```

Было открыто до ревью (закрыто: ветки запушены, фаза 2 смержена и заархивирована): пуш веток `feature/phase-2-core-sdd` и `feature/factory-adrs-0016-0022`;
устаревший раздел «Состояние» и готовый запрос фазы 2 (группы 2–3 уже закоммичены; группа 2 в `tasks.md` отмечена здесь коммитом d2d8fd3 — cherry-pick в phase-2, D-25) —
править в ветке phase-2.

## Решения по находкам ревью ADR-0016…0022 (2026-09-22, ревьюер)

Ревью проведено (отчёт — в сессии ревью: слой 1 L1-1…L1-11, слой 2 F-1…F-28, вопросы Q-1…Q-10). Ниже — принятые
решения; ADR и docs **правлены по ним отдельными коммитами** (список ниже, с хешами). Изменённые формулировки
сохранены рядом как «(было: …)» или в Alternatives соответствующего ADR. Согласование с черновиком SEF —
[приложение F](integrations/2026-09-17-sef-platform-design.md) черновика (строки W-01…W-27).

### Решения

| # | Решение | Закрывает | Куда |
|---|---|---|---|
| D-1 | `sef-hub`: `MERGED` записывается один раз — в коммите посадки последнего item, вместе с `IMPLEMENTING`, `VERIFYING` (refs attempt / gate / landing); промежуточные посадки record не трогают (`STALE` между посадками — штатно, ADR-0011 п. 3); `warrant archive` — следующим коммитом | Q-1, F-7 | ADR-0020 п. 11–12; 11 §2; SEF W-14 |
| D-2 | В `sef-hub` Run и evidence попытки живут вне репозитория: CLI читает `WARRANT_STATE_DIR` (`.warrant/runs/`, `.warrant/evidence/` → `var/sef/attempts/<id>/warrant/`); `.warrant/**` остаётся в `protected[]` целиком. Транспорт `github` — без изменений (в git) | Q-2, F-8 | ADR-0020 п. 13; 03 §4 (триггер «внешнее хранение» = S1 SEF); долг C (`run start`, `check`, `verify`: `WARRANT_STATE_DIR`); SEF W-09 |
| D-3 | Gate `spec-approved` — транспортно-нейтральный, core-sdd, переход `VERIFYING→MERGED` (в `github` — CI impl-PR, в `sef-hub` — lane/integration): hash дерева `{proposal.md, design.md, specs/**}` на коммите из ref `APPROVED` ↔ на base; `tasks.md` исключён. Новых полей record нет | Q-3, F-6, F-18 | ADR-0020 п. 9; 06 §4; долг D `gate` |
| D-4 | `guard pre` без активного Run отвечает `deny` только для путей под `paths.src`, `paths.tests`, `openspec/changes/**` и policy-путей (`match.paths` профилей); остальные пути (например `docs/**`) — `allow` + hint «начни с `run start`». Dogfooding: Codex на коде этого репозитория не используется до фазы 4; Claude-сессии guard не получают (ADR-0018 п. 7) | Q-4, F-21 | ADR-0022 п. 7 |
| D-5 | Adversarial review spec в MVP: стол выполняет `warrant run start <change> --operation review` → `codex exec --output-schema <skill-result> -o result.json` → `warrant run submit result.json`; attestation `none`, `limitations: ["produced locally, unattested"]`. Плагин Claude Code не используется (Claude — только интерактив, ADR-0020) | Q-5, F-19 | ADR-0020 п. 5; 13 Q7 |
| D-6 | Строка `MEDIUM` для mutation убирается: `LOW`/`MEDIUM` — check не выполняется, `HIGH` — gate `mutation-score` required. Примитив «check без gate» (`evidence.recommended`) — later по failure mode | Q-6, F-13 | ADR-0016 п. 10; 05 §4 (строка 182); 10-pack-bdd-tdd §4 |
| D-7 | ADR-0018 п. 7 (адаптер `codex`) и ADR-0020 п. 5 (`codex exec`) — `proposed` до spike S8 «hooks Codex под codex-acp и `codex exec`; минимальная версия с hooks на `apply_patch`» (13 §3, до фазы 4). `warrant init` проверяет `codex --version ≥ MIN` (константа CLI); в SEF версия — в `image.pins` | Q-7, F-22 | ADR-0018, ADR-0020, 13 §3; SEF W-23 |
| D-8 | Копия черновика SEF — снимок с баннером провенанса; изменения WARRANT → только приложение F; при новой rev — обновить снимок и перепроверить F | Q-8, F-25 | сделано в этом коммите |
| D-9 | В долг B добавляются схемы `warrant://run/1` и `warrant://skill-result/1` (фаза 4); в C/D — `--base <commit>` для `check`/`verify`/`gate`, `WARRANT_STATE_DIR`, проверка версии Codex в `init`; в A — механизм pack-схем (D-13) и правка REQ-KRN-010 (`{paths}`) | Q-9, F-24 | этот файл, раздел «Долг» |
| D-10 | `targets[]` частичного waiver читает **check** (waivers — файлы на `main`, пересчёт в CI воспроизводим): исключает мутанты, пишет в `metrics` `excluded_equivalent` и `waivers[]`; gate только сверяет, что waiver `ACTIVE` и отпечатки совпадают с текущим кодом (иначе `STALE`, исключение снимается) | Q-10, F-2 | ADR-0016 п. 6–7; 05 §7 |
| D-11 | `NOT_APPLICABLE` для 0 мутантов в diff: шаг 1 алгоритма 06 §3 расширяется — «`applies_when` не выполнено **или все `requires_evidence` имеют статус `NOT_APPLICABLE`, выставленный детерминированным check**»; правило 02 §2 — «ставится правилом `applies_when` или check, не мнением агента» | F-1 | 06 §3; 02 §2; ADR-0016 п. 4 |
| D-12 | 06 §3 получает пред-фильтр «допустимость evidence» перед шагами 1–5: `subject.commit`/`base_commit` ≠ текущие; `metrics.threshold` ≠ effective param; `limitations` содержит `scoped:`; отпечаток target не совпал → finding `STALE`, evidence исключается. ADR-0016 п. 6 «алгоритм не меняется» → «алгоритм получает пред-фильтр» | F-3 | 06 §3; 06a §2; ADR-0016 п. 6; ADR-0017 п. 4 |
| D-13 | Двухступенчатая валидация pack-форм: kernel-схема допускает `evidence.metrics` и `waiver.targets[]` как object; `validate` затем применяет JSON Schema pack по `kind` (evidence) или по `gate` (waiver); неизвестный kind/gate → ошибка (INV-10). REQ-KRN-001 получает это исключение; `pack.1.provides.evidence_kinds` → `[{ "kind", "metrics_schema" }]` | F-4 | долг A; REQ-KRN-001/006/012/019 |
| D-14 | Живость hooks в MVP без ACP: `warrant verify`/`ci` на `VERIFYING→MERGED` сверяет пути diff ∩ (`paths.src` ∪ `paths.tests`) с `guard_events[]` Runs Change; путь без события → finding `FRONTEND_HOOKS_INACTIVE` в `status` и отчёте `verify` (не `FAIL`: правки человека без hooks легитимны). Критерий выхода MVP: finding отсутствует | F-5 | ADR-0018 п. 5; ADR-0013 критерий; 13 §2 фаза 4 |
| D-15 | `scope-valid`: запрет путей архива, record и evidence архивных Changes действует для spec-PR и impl-PR; archive-PR может создать ровно свой каталог `openspec/changes/archive/<date>-<change>/` и изменить `openspec/specs/**` как результат `openspec archive`; чужие каталоги архива — запрещены | F-11 | ADR-0021 п. 2; 06 §4 |
| D-16 | ADR-0016 п. 8c (`params.mutation_config_paths` → `match.paths`) снимается: параметра нет; проект объявляет конфиг mutation-инструмента policy-путём через существующий override `.warrant/local/profiles/factory-change.json` (`overrides: "core-sdd:factory-change"`, `match.paths` + путь конфига); pack `bdd-tdd` документирует это как SHOULD | F-12 | ADR-0016 п. 8c; 10-pack-bdd-tdd |
| D-17 | `timeout_s`: default `defaults.check_timeout_s`; при его отсутствии — константа CLI `1800` (как в 08 §3) | F-14 | ADR-0017 п. 1; 06 §2 |
| D-18 | ADR-0019 п. 1(c) (stable ID изменён/удалён относительно `HEAD`) — только для файлов `openspec/specs/**` и для Changes с record ≥ `APPROVED`; до `APPROVED` renumber и удаление REQ легитимны | F-15 | ADR-0019 п. 1 |
| D-19 | `forge sef-hub` верифицирует refs по git (снимок approval в коммите из ref) и по control-API SEF (`sef audit --json`: attempt, gate, landing, актор); INV-03 в `sef-hub` — TTY + owner-токен keyring SEF, записывается как требование в 11 §2 и строкой в таблице 01 INV-03 | F-16, F-17 | ADR-0020 п. 8; 11 §2; 01; SEF W-18, W-19 |
| D-20 | Base по транспорту: `github` — `merge-base(HEAD, base PR)`; `sef-hub` — `manifest.base_commit`, передаётся `--base <commit>` | F-20 | ADR-0016 п. 2; ADR-0020; долг C/D |
| D-21 | Вопросы 11 §4 получают идентификаторы I1…I5; I5 «SEF: CLI или API» — **закрыт: CLI (argv) в обе стороны**; I6 «кто создаёт Run» — **закрыт: SEF при prepare** (D-2, SEF W-07). Ссылки в ADR-0018 п. 6 и ADR-0020 п. 11 обновить | F-23 | 11 §4; ADR-0018; ADR-0020 |
| D-22 | `ABANDONED`: `status`/`ci` дают `STALE` `ABANDONED_DIR_PRESENT` (record `ABANDONED` ∧ каталог есть) и `DIR_MISSING_WITHOUT_TRANSITION` (обратное); в `github` удаление каталога и transition едут в ветке `abandon/<change>` → PR или push как для archive | F-10 | ADR-0021 п. 8; ADR-0011 п. 2; REQ-KRN-027 |
| D-23 | Избыточность → later по триггерам: ADR-0017 `--wait`, авто-снятие замка мёртвого pid, `local: "ci-only"`, `max_paths` (MVP: `exclusive`, `timeout_s`, `local: allowed \| scoped-only`, `scoped_command`); ADR-0019 бюджет 500 мс и лимит строк; ADR-0022 генерация `AGENTS.md` и `rules[]` в Context Pack — с первым правилом pack или проекта (в фазе 4 остаются схема `rule/1` и `guard` без Run → `deny`). `warrant link`, `supersedes[]`, `targets[]` — остаются (стоимость схемы мала) | избыточность | ADR-0017, ADR-0019, ADR-0022; 13 §3 later-идеи |
| D-24 | Устаревшие формулировки L1-1…L1-10 правятся одним коммитом «docs: after ADR-0020»: ADR-0018 title/п. 7/Consequences, заметки в ADR-0013/0014 (+ `amended_by: 0020`), README 0018, 13 S5, 04 §6 `WRITE_SPEC`, 03 §7 (строки `.codex/hooks.json`, `AGENTS.md`, `.warrant/local/rules/`, `.claude/**` → later), 01 INV-07 (ACP client → S1), 06 §5 таблица `STALE` | L1-* | docs |
| D-25 | Коммит d2d8fd3 (tasks.md, группа 2) переносится cherry-pick в `feature/phase-2-core-sdd`; здесь остаётся до merge | F-26 | git |

### Правки по решениям — внесены отдельными коммитами

1. `737312b` docs: after ADR-0020 — D-24.
2. `a1fc129` ADR-0016: D-6, D-10, D-11, D-12, D-16, D-20 + 02 §2, 05 §4/§7, 06 §3, 06a §2, 10-pack-bdd-tdd.
3. `fdc9a9b` ADR-0017: D-17, D-23; ADR-0019: D-18, D-23; ADR-0022: D-4, D-23 + 06 §2, 08 §8, 13 later-идеи.
4. `9d597f5` ADR-0018: D-7, D-14 + 13 §2/§3 (S8), заметка ADR-0013.
5. `f449f84` ADR-0020: D-1, D-2, D-3, D-5, D-19, D-20, D-21 + 11 §2/§4, 01 INV-03, 06 §4, 03.
6. `e582c2d` ADR-0021: D-15, D-22 + 06 §4, 04 §5/§9.
7. этот коммит — NEXT-SESSION; долг A–D дополнен ранее (D-9, D-13). Черновик SEF — следующий коммит (W-01…W-27 в тело §1–§16).
D-8 и D-25 — без правок ADR (снимок SEF; cherry-pick d2d8fd3 в phase-2 — при merge).

## Чего не делать

- Не реализовывать `guard`, `ci`, `analyze` в фазе 3: это фаза 4 (`check`, `gate`, `verify`, `transition`, `archive`, `waive` — фаза 3).
- Не добавлять profiles `bugfix`, `refactor`, `experiment`: без failure mode (ADR-0013).
- Не трогать `docs/integrations/`, `lattice/`: не на критическом пути.
- Не изобретать второй формат конфигурации: `warrant.json` — единственная точка (08 §3).
- Изменение любого нормативного документа во время реализации — только через новый ADR, не молча.

## Контекст для агента

SEF (Software Factory): OpenSpec — specification kernel (stock, без форка); WARRANT — governance, этот проект;
LATTICE — субстрат объектов (`../lattice/`); SRA — reasoning (skills); JEV — classifier без authority.
Документы RU с EN-терминами, машинные файлы JSON. Перед большими переписываниями — обсуждать с пользователем.
