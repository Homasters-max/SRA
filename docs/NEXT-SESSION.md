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
  [openspec/changes/phase-2-core-sdd/design.md](../openspec/changes/phase-2-core-sdd/design.md). Долг, переходящий в фазу 3:

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

### Продолжение — готовый запрос

```text
Прочитай docs/NEXT-SESSION.md, затем openspec/changes/phase-2-core-sdd/design.md (таблица I-45…I-65) и docs/13-roadmap.md §2.
Фаза 2 закрыта, ветка feature/phase-2-core-sdd смержена в main, tag v0.2.0 поставлен.
Шаг 1: заархивируй phase-2-core-sdd стоковым `openspec archive` (как G-6) и убедись, что `warrant validate` на репозитории ok: true
(B6/I-46 это уже покрывает). Шаг 2: /opsx:propose новый change `phase-3-verification` — исполнение gates/checks/controller
(`check`, `gate`, `verify`, `transition`, `archive`, `waive`), human-источник classification и понижение ниже floor,
evidence `spec-report` (I-47), CI-матрица ubuntu-latest + windows-latest, backlog B3/B4/B5 и долг I-52, I-57, I-59, I-64.
Потолок как в фазе 2: ≤ 6 групп, ~30 задач (G-8). Схема работы прежняя: координатор — ты (Fable), субагент Opus 5 на группу,
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

Все решения G-1…G-21 реализованы. Дальше — фаза 3 (verification, см. «Вход в фазу 3» выше), затем 4 (Claude Code frontend). Vertical slice по ADR-0013 — после фазы 4.
LATTICE — после slice ([../lattice/NEXT-SESSION.md](../lattice/NEXT-SESSION.md)).

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
