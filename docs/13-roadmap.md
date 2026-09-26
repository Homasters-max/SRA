---
id: WARRANT-DOC-13
title: Roadmap и открытые вопросы
status: informative
maturity: MVP
version: 0.1.0
---

# 13. Roadmap

## 1. MVP

MVP = **kernel + pack `core-sdd` + один vertical slice** (WARRANT-ADR-0007, уточнён [ADR-0013](adr/WARRANT-ADR-0013-mvp-refinement.md): sample-проект Python + pytest, slice ведёт агент под hooks — Claude Code, [ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md); фазы 4a, 4b и 4c входят в MVP).

Vertical slice — одно реальное FEATURE-изменение, проведённое от intent до archive:

```text
OpenSpec + warrant-sdd schema + profile feature
→ spec с stable ID → tasks → worktree → tests → warrant verify
→ evidence manifest → CI merge gate → archive
```

После этого новые возможности добавляются **по фактическим failure modes**.

## 2. Фазы

| Фаза | Содержание | Критерий выхода |
|---|---|---|
| **0. Spikes** | см. §3 | Все spikes закрыты решением |
| **1. Kernel** | JSON Schemas контрактов, CLI: `init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status` | `warrant validate` работает на core-sdd |
| **2. core-sdd** | schema `warrant-sdd`, profiles, core gates и checks, templates, controller rules, risk | Golden `feature`, `chore`, `factory-change` — snapshot effective policy (`resolve --explain`, `status`); прогон gates — фаза 3 |
| **3. Verification** | `check`, `gate`, evidence manifest, CI integration; evidence schema с `metrics`, объявляемыми pack для kind ([ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md)); `execution` в схеме check, runner с замком ([ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)); `amends` / `supersedes` в record, пути архива в `scope-valid` ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)); схема `rule/1`, `provides.rules`, проверки правил в `validate` ([ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)) | (1) три golden получают `expected/verify.json` для `PROPOSED->SPECIFIED`; (2) Change `phase-3-verification` проходит `PROPOSED → … → ARCHIVED` только через `transition` / `archive` по топологии [ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md), с waivers и CI-evidence; (3) CI-матрица ubuntu + windows зелёная; (4) `warrant status` репозитория — `stale[]` только у `phase-2-core-sdd` (P-18) |
| **3b. Verification, вторая очередь** | `warrant link` ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)); `warrant waive` (создать / активировать / отозвать, waiver на gate целиком); gate `spec-approved` ([ADR-0024](adr/WARRANT-ADR-0024-spec-approved-contract.md)); исполнение `execution.local` ([ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)); `validate` (13) — висячие REQ/SCN; I-77; понижение risk ниже floor (`classify --ref`); delta под фиксы ревью фазы 3 (R-1, R-2, R-4, R-5, R-14) и находки R-6…R-10, R-13 | Change `phase-3b` проходит `PROPOSED → … → ARCHIVED` по P-2 без отступлений (`SPECIFIED` в spec-PR, `APPROVED`/`IMPLEMENTING` первым и `VERIFYING` последним коммитом impl-PR); CI-матрица ubuntu + windows зелёная |
| **3c. Уровни тестов** | Change `test-levels` ([ADR-0025](adr/WARRANT-ADR-0025-test-levels.md)): уровни `unit` / `app` / `contract` / `e2e`, порты `OpenSpecPort` / `GitPort` / `CheckRunnerPort` и `Ctx`, `FakeOpenSpec` / `FakeGit` с контрактом соответствия, `ProjectBuilder`, проверки уровней (запрет процессов в `unit`/`app`, причина e2e), перенос e2e; `validate` — `show` только для файлов с id, параллельно; CLI `0.4.1`, `skip_specs` | (1) `unit`/`app` не порождают процессов (проверка); (2) у каждого e2e-файла причина; (3) `warrant validate` репозитория ≤ ~5 с; (4) локальный `npm test` с параллелизмом по умолчанию зелёный 3 раза подряд, `--maxWorkers=3` убран из `/group-done`; CI ubuntu + windows зелёная |
| **3d. Границы модулей** | Change `arch-boundaries` ([ADR-0030](adr/WARRANT-ADR-0030-module-boundaries.md), аудит [2026-09-24](process/audits/2026-09-24.md)): мета-тест `architecture.test.ts` — ранги модулей `core` R0–R4 и слои, нет циклов модулей, команда не импортирует команду, реестры общих помощников и перечислений, храповик исключений A-N; `core/fs`, `core/json`, владелец lifecycle, `core/git`, `core/waivers`, `core/roles`, сценарий `core/transition`; разбор вывода внешних инструментов — в адаптерах; CLI `0.4.2`, `skip_specs` | (1) `architecture.test.ts` зелёный, исключения храповика = открытые A-N с правилом; (2) циклов модулей runtime нет, импортов команда → команда нет (кроме `context.ts`); (3) `verify` / `archive` / `transition` / `gate` / `status` зовут `core/transition`; (4) golden, `app`, `contract`, `e2e` без правок ожидаемых значений; CI ubuntu + windows зелёная |
| **3e. Швы ядра** | Change `core-seams` ([ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 6, [ADR-0035](adr/WARRANT-ADR-0035-ratchet-external-packages.md), аудит [2026-09-25](process/audits/2026-09-25.md) §5): `WarrantConfig` (A-15), `toProjectPaths` и `pathMatcher` (A-16), `countingWaiverIds` (A-14), фабрика `cliError` (A-17), `findChangeDir` в `core/openspec` (A-8), `test/helpers/git.ts` (A-18), реестр внешних пакетов и помощники тестов в `architecture.json`, теги SCN (BL-26); CLI `0.4.3`, `skip_specs` | (1) исключения храповика A-14…A-18, A-8 сняты; (2) golden, `app`, `contract`, `e2e` без правок ожидаемых значений; CI ubuntu + windows зелёная |
| **4a. Run и guard** (MVP) | Адаптер `claude` в локальном режиме ([ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md)): реестр проверок `validate` (A-9), `run/1`, `run start` (Context Pack, `rules[]`) и `run finish`, `warrant guard` pre / post (ADR-0017…0019, порт — A-12), `guard_prefixes`, guard без Run → `deny` (ADR-0022), `validate --files`, `FRONTEND_HOOKS_INACTIVE`; `sync` → `.claude/settings.json` (управляемое подмножество: static deny `Edit(/…)` и `Bash(…)`, hooks `warrant guard --frontend claude`) и `AGENTS.md` (BL-20); `hint` в ошибках, `--dry-run` у `transition` / `archive` / `waive`; адаптер `claude` последней группой (фикстуры родного входа — `scripts/dev/probe-hooks.js`); CLI `0.5.0` | Сессия Claude в sample-проекте получает `deny` вне `write_scope` и hints после правки (e2e без настоящего `claude`: `init --frontend claude` → `sync` → `run start` → `guard` → `run finish` → `verify` без `FRONTEND_HOOKS_INACTIVE`); контракт адаптера на записанном родном входе (Claude Code 2.1.263); CI ubuntu + windows зелёная |
| **4b. Producers** (MVP) | Находки аудита [2026-09-25-phase-4a](process/audits/2026-09-25-phase-4a.md) первой группой (A-23…A-27); `skill-result/1`, `run start --operation review`, `run submit`, `warrant analyze`; gates `analyze-clean` (вычисляемый) и `adversarial-review` (Claude-субагент `warrant-reviewer`, [ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 10; evidence по дереву spec — [ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md)) | e2e без настоящего `claude`: Change фикстуры проходит `SPECIFIED → APPROVED` с `adversarial-review` `PASS` по evidence `run submit` и `VERIFYING → MERGED` с `analyze-clean` `PASS` без waivers; контракт субагента на записанном входе Claude Code; CI ubuntu + windows зелёная |
| **4c. CI** (MVP) | Change `phase-4c` ([ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md), [ADR-0038](adr/WARRANT-ADR-0038-pr-judged-by-base.md), аудит [2026-09-26-phase-4b](process/audits/2026-09-26-phase-4b.md)): швы A-28, A-29 первой группой; `warrant ci` с `ForgePort` через `gh` (вид PR и Change по record в diff, требования из базы HEAD^1; verdict impl-PR по evidence на дереве merge, `subject.tree`, `STALE` `tree` — R-12; specs только результатом archive по record — R-16; refs `APPROVED` / `MERGED` — слитый PR и `merged_by` — R-10; `FRONTEND_HOOKS_INACTIVE` — BL-7); `warrant ci fetch` evidence impl-PR — BL-12; `transition MERGED --ref <URL impl-PR>`; job `warrant` на всех PR и `workflow_dispatch` восстановления; `analyze` архивированного Change (BL-43), `sync` без skill review (BL-40); CLI `0.7.0`, pack `core-sdd` `0.3.3`, `factory-change` `1.1.0`; слой ACP — срез S1 SEF (ADR-0020) | (1) verdict impl-PR без ручного переноса artifact'а; (2) spec-PR 4c — первый без пары waivers (приёмка 4b); затем vertical slice (§1) в отдельном репозитории — критерий MVP: Claude проходит slice под hooks, в `guard_events[]` нет обойдённых `deny`, `FRONTEND_HOOKS_INACTIVE` отсутствует (D-14) |
| **5. bdd-tdd, arch** | Gherkin/SCN, red-first, ADR, glossary; pack `bdd-tdd` на самом `packages/cli` — mutation по diff (ADR-0016, ADR-0025); классификация уровней тестов для проектов под WARRANT (`test_kind`, уровень `@SCN`-тестов); `targets[]` частичного waiver (D-10), проверка (f) pragma mutation-инструментов; adversarial review — расширение набора skills (producer `adversarial-review` — фаза 4, D-5) | Снижение spec defects после implementation |
| **6. data** | Contracts, compatibility engine, migration, rollback | Golden: breaking-data-change |
| **7. Orchestration** | Вызов агентов через ACP / API, retry policy, context packs; адаптер `opencode` (ADR-0018); адаптер `codex` — до среза S1 SEF после S8 (ADR-0034) | Два frontends на одном CLI |
| **8. Runtime** | Runtime evidence, drift detection | Runtime observation → новый Change |
| **9. Integrations** | LATTICE, SEF (транспорт `sef-hub`, гейты WARRANT в pack SEF — ADR-0020), JEV, SRA | [11](11-integrations.md) заполнен |

## 3. Spikes (до MVP)

| Spike | Вопрос |
|---|---|
| S1 | ~~HTML-комментарии ID через `openspec validate` и archive~~ — **закрыт** на OpenSpec 1.13.1: проходят при размещении строго под заголовком с непустым телом ([ADR-0012 §7](adr/WARRANT-ADR-0012-id-allocation.md)) |
| S2 | ~~Устройство project-local schema и `config.yaml`, что генерирует `warrant sync`~~ — **закрыт** на OpenSpec 1.13.1: `config.yaml` = `schema` + `context` + `rules` + `operations`; schema — `openspec/schemas/<name>/{schema.yaml, templates/}`; `.openspec.yaml` — metadata Change, WARRANT читает `schema` и `skip_specs` ([ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md)) |
| S3 | ~~Хранение `classification` и `change_state`~~ — **закрыт**: `.warrant/changes/<change>.json` ([04 §9](04-lifecycle.md), ADR-0009). Остаток (metadata Change у OpenSpec) закрыт в ADR-0015: `.openspec.yaml`, читаются `schema` и `skip_specs` |
| S4 | ~~Язык и распространение CLI~~ — **закрыт**: TypeScript на Node, monorepo, `npm i -g <git-tag>` ([ADR-0013](adr/WARRANT-ADR-0013-mvp-refinement.md)) |
| S5 | ~~Claude Code hooks / permissions~~ — **закрыт**: static deny из `warrant sync` + hook `warrant guard`, reviewer как subagent ([ADR-0014](adr/WARRANT-ADR-0014-claude-code-enforcement.md)); после ADR-0018/0020 — адаптер `claude` (later); [ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md) — MVP-адаптер фазы 4a (локальный режим) |
| S6 | Принимает ли LATTICE внешние stable ID (`REQ-ING-001`) как identity, или выдаёт свои и нужен mapping. Формат ID фиксируется в фазе 1, поэтому вопрос — до MVP, а не в фазе 9. Proposed ответ: identity LATTICE = `<context>/<name>`, name = stable ID WARRANT без mapping ([integrations/06 D1](../lattice/docs/03-substrate-decisions.md)) |
| S8 | Hooks Codex под `codex-acp` и `codex exec`: загружаются ли проектные hooks, как выдаётся trust в слоте, минимальная версия Codex с hooks на `apply_patch` (openai/codex#16732 → PR #18391), `additionalContext` виден модели. До адаптера `codex`, то есть до среза S1 SEF (ADR-0034 п. 5); MVP не блокирует; до результата адаптер `codex` (ADR-0018 п. 7) и review через `codex exec` (ADR-0020 п. 5) — proposed (D-7) |
| S7 | Mutation-инструмент для Python sample (до фазы 5; MVP не блокирует). Критерии: результат по каждому мутанту, location в строках, стабильный вывод, parser в mutation-testing-report-schema без опоры на недокументированный формат (mutmut 3 `.meta` — не годится как есть) ([ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md)) |

### Later-идеи без отдельного ADR (источник — `oinsio/clear-progress`)

| Идея | Где записана | Триггер |
|---|---|---|
| Floor `blast_radius` по размеру diff | [05 §4](05-policy.md) | Failure mode: слишком большой Change |
| Pack `ui`: UI States Matrix, a11y, visual regression | [08 §6](08-packs.md) | Первый проект с UI |
| `dismissed[]` и покрытие входного списка в skill-result | [07 §4](07-skills.md) | Первый skill с входным списком |
| `check`: `--wait`, снятие мёртвого замка, `local: "ci-only"`, `max_paths` | [ADR-0017](adr/WARRANT-ADR-0017-check-execution.md) | Failure mode параллельных прогонов (D-23) |
| Бюджет 500 мс и лимит строк hints | [ADR-0019](adr/WARRANT-ADR-0019-post-edit-hints.md) | Замер задержки hook (D-23) |
| `AGENTS.md` и `rules[]` в Context Pack | [ADR-0022](adr/WARRANT-ADR-0022-path-rules.md) | Первое правило pack или проекта (D-23) |

### Later-идеи из ADR

| Идея | Где записана | Триггер |
|---|---|---|
| Graft в продукте: blast radius как сигнал `classify`, граф кода в Context Pack исполнителей SEF (фаза 9) | [ADR-0026](adr/WARRANT-ADR-0026-graft-experiment.md) п. 1 | Эксперимент ADR-0026 — `accept` (**выполнено**, [ADR-0028](adr/WARRANT-ADR-0028-graft-adoption.md)) и Graft ≥ 1.0 |

## 4. Не входит в MVP

```text
distributed event bus · graph database · Kafka · complex workflow engine
multi-agent swarm · 10+ specialized agents · automatic architecture generation
automatic policy evolution · semantic memory platform · autonomous production deployment
```

## 5. Шаблоны к созданию

| Шаблон | Pack | Фаза |
|---|---|---|
| proposal, spec, design, tasks | core-sdd | 2 |
| waiver | core-sdd | later (по failure mode) |
| experiment (hypothesis / result / decision) | core-sdd | later (по failure mode) |
| ADR | arch | 5 |
| glossary entry | arch | 5 |
| data contract, migration plan | data | 6 |
| behavior baseline | brownfield | 5 |

Proposal отвечает только на: WHY, WHAT changes, WHAT is affected, WHAT is NOT changing.
Разделы: Problem · Goal · Changes · Non-Goals · Impact · Risks · Verification. Proposal MUST NOT превращаться в design.

## 6. Открытые вопросы

| #   | Вопрос                                          | Состояние                                                                                                                                                                           | Где                                                                              |
| --- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Q1  | Содержание интеграций LATTICE / SEF / SRA / JEV | **Форма закрыта** (pack + адаптер + два канала, единый proposal envelope). Содержание LATTICE, JEV, SRA — proposed; SEF — открыт: вызывает ли SEF `warrant` как CLI или ожидает API | [11](11-integrations.md), [integrations/](integrations/00-readme.md)             |
| Q2  | Соответствие маркеров осям LATTICE              | **Proposed**: правило проекции задано; ждёт подтверждения семантики `contested` и `derived` со стороны LATTICE                                                                      | [02 §1](02-vocabulary.md), [integrations/05](integrations/05-warrant-lattice.md) |
| Q3  | Хранение состояния Change (S3)                  | **Закрыт**: Change record, пишет только CLI                                                                                                                                         | [04 §9](04-lifecycle.md), ADR-0009                                               |
| Q4  | Pack `security`: состав overlay и threat review | **Состав определён** (later). Kernel-зависимость закрыта: overlay `match` по любому полю classification                                                                             | [10-pack-security](10-pack-security.md), [05 §4](05-policy.md)                   |
| Q5  | Подписание evidence, полученного вне CI         | **Закрыт для MVP**: attestation по месту производства; `signature` — later                                                                                                          | [06a §3](06a-evidence.md), ADR-0009                                              |
| Q6  | Оркестрация реализации в MVP | **Закрыт**: MVP — Claude Code в ручном режиме под hooks и CI (адаптер `claude`, ADR-0034); оркестрация через ACP — диспетчер SEF (срез S1), Claude — стол | [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md) |
| Q7  | Кто выполняет adversarial review в MVP | **Закрыт**: в MVP — Claude-субагент отдельным локальным Run, unattested, `limitations` «same model family as author» (ADR-0034); второе семейство (`codex exec`, `opencode`) — тем же контрактом по триггеру; в SEF — независимость по семействам | [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md), ADR-0013 |

Q3 и Q5 — один вопрос с двух сторон: кто имеет право писать состояние. Ответ один: authoritative записи делают
CLI в CI и человек через PR; локальный CLI пишет черновики ([ADR-0009](adr/WARRANT-ADR-0009-change-record-attestation.md)).
