# Tasks

После каждой группы: `npm test`, `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`,
`npm run versions:check` зелёные (`/group-done`); коммит на группу в `worktree/phase-4b`; после группы — `/group-stats`.
§N — разделы design.md, N-N — решения §1, A-N и BL-N — [docs/backlog.md](../../../docs/backlog.md). Правка ожидаемого значения
golden вне задач 1.1, 2.x и 6.x — остановка и строка I-N.

## 1. Bump и швы (A-19, A-23, A-24, A-25, A-27)

- [x] 1.1 Bump CLI `0.6.0`, pack `core-sdd` `0.3.2` с `kernel: ">=0.1 <0.7"` (7 fixture-packs, `.warrant/warrant.json`,
  `warrant.lock.json` репозитория и golden-фикстур — как I-156; REQ-SDD-001 в части диапазона). Проверка: `npm run versions:check`
  зелёный; `core-sdd-catalog.test.ts` — под новый диапазон.
- [x] 1.2 A-24: `core/packs/objects.ts` — `packObjects`, `gateDefinitions`, `policyPaths` (§2), строки `helpers`; 5 мест — через
  них. Проверка: `grep "objects\.\(find\|filter\)(" packages/cli/src` — только владелец и `core/resolve/layers.ts`; нет ребра
  `core/guard → core/transition` в `cs deps`; golden, `app`, `e2e` без правок ожидаемых значений.
- [x] 1.3 A-23: `evidenceSubject`, `buildEvidenceRecord` в `core/evidence/record.ts`, сборка `human-approval` —
  `core/evidence/approval.ts` (§2), строки `helpers`. Проверка: `git grep spec_revision -- packages/cli/src` — один владелец;
  тесты `transition` и `check` без правок ожидаемых значений.
- [x] 1.4 A-25, A-27: `core/run/lifecycle.ts` (`startRun`, `finishRun`, `appendGuardEvent`), `stateDir` и `projectUri` — в
  `core/fs.ts` (§2). Проверка: `ctx.writes.write(` над Run — только в `core/run`; нет ребра `core/run → core/evidence`; тесты
  `run` и `guard` (SCN-ENF-004…016) без правок ожидаемых значений.
- [x] 1.5 A-19: `versionSatisfies` в `core/version-range.ts`, `semver` — в реестр `packages` (§2); 4 копии — через него.
  Проверка: `architecture.test.ts` роняет импорт `semver` вне владельца; тесты `openspec version`, lock, `sync` без правок.

## 2. Схемы и реестры (REQ-ENF-001, REQ-ENF-006, REQ-SDD-001)

- [x] 2.1 Реестр `enums`: `evidence-status`, `attestation-type` (§2); `run-operation` += `review`; словари 02 и 04 §6.
  Проверка: мета-тест `enums` зелёный; `COUNTING_STATUSES` — через словарь владельца.
- [x] 2.2 `run.1.schema.json`: операция `review`, пустой `write_scope` и обязательный `spec_tree` только у `review`
  (REQ-ENF-001). Проверка: SCN-ENF-001…003, SCN-ENF-022, SCN-ENF-023 (фикстуры `test/fixtures/schemas/run/`).
- [x] 2.3 `skill-result.1.schema.json` (REQ-ENF-006), имя в `DOCUMENT_SCHEMAS`; `evidence.1.schema.json` — `subject.spec_tree`;
  копии — `warrant sync`, golden — `npm run golden:update`. Проверка: SCN-ENF-028, SCN-ENF-029; `validate` проверяет
  `<state>/runs/*.result.json`.
- [x] 2.4 Kind `review` в pack — объект с `evidence/review.metrics.schema.json` (REQ-SDD-001). Проверка: SCN-SDD-024.

## 3. analyze и analyze-clean (REQ-VER-010, REQ-VER-004)

- [x] 3.1 `core/analyze/` (R2, §3): разбор delta по секциям, находки `UNSATISFIED`, `CONFLICT`, `ORPHAN`, `skipped[]`;
  строка `architecture.json`. Проверка: unit на SCN-VER-062…065, SCN-VER-067 без процессов.
- [x] 3.2 `warrant analyze <change> [--base]` (`commands/analyze.ts`, `--help` с примером — линза `cli-contract`). Проверка:
  SCN-VER-062, SCN-VER-066 (`app`: код 1 / 0, дерево проекта байт в байт прежнее), e2e `--help`.
- [x] 3.3 Калькулятор `analyze-clean` через `signals.analyze` (§5, REQ-VER-004). Проверка: SCN-VER-058, SCN-VER-059; без git —
  `BLOCKED` `NO_INPUT`; SCN-VER-015 и SCN-VER-043 переписаны на `adversarial-review`.

## 4. Собственное состояние и пред-фильтр (REQ-VER-003, REQ-VER-004, REQ-KRN-028)

- [x] 4.1 `core/run/state.ts` — `ownState`, `otherState` (§3, §7); `scope-valid` — на трёх переходах. Проверка: SCN-VER-060,
  SCN-VER-061; SCN-VER-019…021 без правок ожидаемых значений.
- [x] 4.2 `classify` без собственного состояния (REQ-KRN-028). Проверка: SCN-KRN-138; SCN-KRN-073 без правок.
- [x] 4.3 Пред-фильтр: `specTree` в `PrefilterContext`, `StaleReason` `spec_tree` (§5, REQ-VER-003). Проверка: SCN-VER-056,
  SCN-VER-057; SCN-VER-012…018 без правок ожидаемых значений.

## 5. Review: Run, guard, run submit (REQ-ENF-002, REQ-ENF-004, REQ-ENF-007)

- [x] 5.1 `GitPort.dirty(paths)` — адаптер, `FakeGit`, контракт соответствия (§4). Проверка: `git.contract.test.ts` —
  изменённый, новый и чистый файл.
- [x] 5.2 `run start --operation review`: `PROPOSED`, пустой `write_scope`, `spec_tree`, `SPEC_UNCOMMITTED` (REQ-ENF-002).
  Проверка: SCN-ENF-024, SCN-ENF-025; SCN-ENF-004…008 без правок.
- [x] 5.3 Guard при Run `review` (REQ-ENF-004). Проверка: SCN-ENF-026, SCN-ENF-027; SCN-ENF-011…016 без правок.
- [x] 5.4 `core/run/submit.ts` и `warrant run submit [--file] [--dry-run]` (REQ-ENF-007, §4); `--help` с примером; A-26:
  `started` → `test/app/helpers/run.ts`, `record` → `helpers/synced.ts`, строки `test_helpers`. Проверка: SCN-ENF-030…035;
  `cs dups --in packages/cli/test` без `started`.

## 6. Skill, sync, субагент (REQ-SDD-008, REQ-KRN-033)

- [x] 6.1 Skill `specification/adversarial-review` `0.2.0`: процедура, семь категорий, `severity` и критерий `BLOCKER`,
  envelope `skill-result/1`, запрет правки; pack — `^0.2`, lock — `sync` (REQ-SDD-008). Проверка: SCN-SDD-013, SCN-SDD-014,
  SCN-SDD-025; `versions:check`.
- [x] 6.2 Зонд Claude Code (maintainer, `scripts/dev/probe-hooks.js`): хук `PreToolUse` во frontmatter субагента на `Bash` —
  вызывается ли, доходит ли `deny`, чем отличается родной вход; фикстуры — `test/contract/fixtures/claude/<версия>/`. Итог —
  строка `I-N` (ADR-0034 п. 10). Проверка: фикстуры в репозитории, строка в §«Решения по ходу реализации».
- [x] 6.3 Цель `sync` `.claude/agents/warrant-reviewer.md` (§6, REQ-KRN-033), `validate` — побайтно. Проверка: SCN-KRN-139,
  SCN-KRN-140, SCN-KRN-134; контракт адаптера `claude` на фикстурах 6.2: `Bash` `warrant run submit` субагента — `allow`,
  иное при Run `review` — `deny`.
- [x] 6.4 Файл `.claude/agents/warrant-reviewer.md` репозитория, мета-тест `reviewer-agent.test.ts` (совпадение с генератором),
  строка белого списка `dev-hooks.test.ts`; навык `change-spec-pr` — шаг review до `transition SPECIFIED`. Проверка: мета-тесты
  зелёные; `dev-context.test.ts`.

## 7. Сквозная проверка и документы

- [x] 7.1 e2e критерия 4b (N26): Change фикстуры — `run start --operation review` → `run submit` (envelope фикстуры) →
  `transition SPECIFIED` → `APPROVED` с `adversarial-review` `PASS`; затем `IMPLEMENTING` → `VERIFYING` → `gate` `VERIFYING->MERGED`
  с `analyze-clean` `PASS`; без waivers. Проверка: e2e зелёный на ubuntu и windows.
- [x] 7.2 Документы: 02 (статусы evidence, `review`, `spec_tree`), 04 §6–7 (`run submit`, `analyze` — MVP), 06 §5 (находки MVP),
  07 §4 (схема), 03 §4 (Run `review`); `backlog.md` — закрыть BL-2, BL-3, BL-13, A-19, A-23…A-27. Проверка: `dev-context.test.ts`,
  `hygiene.js` без битых ссылок.
- [x] 7.3 `warrant analyze phase-4b` на ветке impl-PR — без находок (N28). Проверка: код 0; иначе правка `tasks.md` или тестов,
  а не waiver.
