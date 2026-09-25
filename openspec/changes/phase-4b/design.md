# Design: phase-4b

## Context

База — `main` на `v0.5.0` (`phase-4a` закрыт). Что уже есть: `run/1`, `run start` / `run finish`, Context Pack, guard
`pre` / `post`, адаптер `claude`, цель-подмножество `sync` (`core/sync/subset.ts`), реестр проверок `validate`. Gate
`analyze-clean` — заглушка L0-калькулятора (`core/gates/l0/analyze-clean.ts`, всегда `BLOCKED`); `adversarial-review` требует
evidence `review` `PROVEN`, producer'а нет. Пред-фильтр (`core/gates/prefilter.ts`) признаёт запись только на оцениваемом
commit и base. Skill `specification/adversarial-review@0.1.0` — список категорий (REQ-SDD-008).

Нормы — [ADR-0036](../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) (нарезка, `analyze-clean` вычисляемый, evidence
review по дереву spec, статус по `BLOCKER`), ADR-0034 п. 10 (субагент `warrant-reviewer`, `limitations`), ADR-0024 (дерево
контракта), ADR-0014 п. 3–4 (файл субагента генерирует `sync`), ADR-0030 / ADR-0035 (ранги, реестры, храповик). Аудит
[2026-09-25-phase-4a](../../../docs/process/audits/2026-09-25-phase-4a.md): A-23…A-27 — первой группой (§2).

Ограничения: kernel-схемы остаются `major = 1` (`run/1`, `evidence/1` — добавочные поля и значения); `warrant validate`
репозитория зелёный после каждой группы; guard основной сессии в этом репозитории не включается (ADR-0034 п. 4).

## Goals / Non-Goals

**Goals:**
- Критерий 4b (13 §2): e2e без настоящего `claude` — Change фикстуры проходит `SPECIFIED → APPROVED` с `adversarial-review`
  `PASS` по evidence `run submit` и `VERIFYING → MERGED` с `analyze-clean` `PASS` без waivers; контракт субагента на
  записанном входе Claude Code; CI ubuntu + windows зелёная.
- Три P1 аудита закрыты до того, как producers добавили бы через них копии.
- Собственное состояние Change — одно определение для `classify` и `scope-valid` (N27).

**Non-Goals:** — proposal «Non-Goals» (4c, находки `analyze` сверх трёх, приём `specify` / `implement`, второе семейство).

## Decisions

### 1. Решения grilling (N19–N28)

| # | Решение |
|---|---|
| N19 | `analyze-clean` — L0-калькулятор над `core/analyze`; `warrant analyze <change>` — та же функция, отчёт без записи (ADR-0036 п. 2) |
| N20 | Находки MVP: `UNSATISFIED` (REQ `ADDED` / `MODIFIED` без упоминания в `tasks.md` — сам или через SCN — или без SCN в файлах `paths.tests`), `CONFLICT` (`tasks.md` упоминает неопределённый или `REMOVED` REQ / SCN), `ORPHAN` (тест из diff упоминает неопределённый SCN); `MISSING`, `AMBIGUOUS`, `STALE` — позже |
| N21 | Evidence review — `subject.spec_tree`; пред-фильтр сравнивает дерево spec (ADR-0036 п. 3) |
| N22 | Статус из envelope: `SUCCEEDED` и 0 `BLOCKER` → `PROVEN`; `BLOCKER` → `NOT_PROVEN`; `FAILED` / `CANCELLED` → `INCONCLUSIVE`; счётчики по `severity` — `metrics` |
| N23 | Операция `review`: `PROPOSED`, пустой `write_scope`; `run submit` — только для Run `review`; схема — envelope 07 §4 целиком, `dismissed[]` — later |
| N24 | `.claude/agents/warrant-reviewer.md` — цель `sync` адаптера `claude`; в репозитории WARRANT — копия, совпадение держит мета-тест |
| N25 | Первая группа: A-24, A-23, A-25 + A-27, реестр `enums`; A-26 — с тестами `run submit` |
| N26 | Критерий выхода — e2e и контракт; dogfooding (spec-PR 4c без пары waivers) — приёмка в handoff 4c |
| N27 | Собственное состояние Change (record, evidence, файлы Run Change и их `.result.json`) — одно определение: `scope-valid` разрешает его на трёх переходах и не считает policy-путём, `classify` не сверяет с `match.paths` и floor rules |
| N28 | Сам 4b закрывает waiver'ом только `adversarial-review`; `analyze-clean` в impl-PR судит собственный CLI 4b |

### 2. Первая группа — швы (без изменения поведения)

- **A-24** — `core/packs/objects.ts` (R1): `packObjects(loaded, kind)`, `gateDefinitions(loaded)`, `policyPaths(loaded)`;
  `core/transition/gates.ts`, `core/check/execute.ts`, `core/waivers/check.ts`, `commands/waive.ts`, `core/guard/decide.ts` —
  через них; три имени — строки реестра `helpers`. Ребро `core/guard → core/transition` уходит.
- **A-23** — `core/evidence/record.ts`: `evidenceSubject({ change, commit, baseCommit?, specTree? })` и
  `buildEvidenceRecord({ id, kind, level, status, subject, producedBy, attestation, claim, contextHash, … })`; `buildCheckRecord` —
  обёртка; сборка `human-approval` из `commands/transition.ts#ensureApproval` — в `core/evidence/approval.ts`. Оба — в `helpers`.
- **A-25** — `core/run/lifecycle.ts`: `startRun`, `finishRun`, `appendGuardEvent` владеют планом записи
  (`ctx.writes.write([runFile, current])`), замком и проверкой `RUNNING`; ошибки `RUN_ACTIVE`, `RUN_NOT_ACTIVE`, `brokenCurrent` —
  там же. `commands/run.ts` — опции и вывод; `core/guard/guard.ts#appendEvent` — через `appendGuardEvent`.
- **A-27** — `stateDir`, `projectUri` — в `core/fs.ts` (R0), строки `helpers`; `core/run → core/evidence` уходит.
- **Реестр `enums`**: `evidence-status` (`PROVEN`, `NOT_PROVEN`, `INCONCLUSIVE`, `NOT_APPLICABLE`; владелец
  `core/evidence/record.ts`), `attestation-type` (`ci`, `human-review`, `signature`, `none`; `core/evidence/attestation.ts`);
  `COUNTING_STATUSES` `evidence-complete` — через словарь владельца.
- **A-19** — `run submit` проверяет версию skill по диапазону pack: это первая правка проверки диапазона после аудита, триггер
  строки A-19 — общий помощник `versionSatisfies(version, range, { coerce? })` в `core/version-range.ts` (R0), `semver` — в реестр
  `packages` с этим владельцем; четыре копии — через него.
- Выход группы — как `core-seams`: golden, `app`, `contract`, `e2e` без правок ожидаемых значений; ни одной строки spec.

### 3. Модули и ранги

- `core/analyze/` (R2): `delta.ts` — разбор delta specs по секциям `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` в
  `{ section, req, scenarios[] }` (ID — `ID_COMMENT_RE` владельца `core/ids/scan.ts`); `index.ts` — чистая
  `analyze({ delta, mainIds, tasksText, testFiles, changedTests }) → { findings, skipped }`. Файлы читает вызывающий
  (`commands/analyze.ts`, калькулятор через `signals`).
- `core/run/submit.ts` (R2): разбор envelope, статус по N22, запись результата, evidence (через A-23) и `finishRun`.
- `core/run/state.ts` (R2): `ownState(root, change) → (path) => boolean` — record, `<state>/evidence/<change>/`, файлы Run с
  `change` этого Change (читаются `readChangeRuns`) и их `.result.json`; `otherState(path)` — то же для любых Changes. Владелец
  N27: `core/gates/l0/scope-valid.ts` получает матчер через `signals`, `core/classify` (R2) — от `commands/classify.ts`.
- Схемы: `skill-result.1.schema.json` (новая, имя `skill-result` в `DOCUMENT_SCHEMAS` — `validate` проверяет
  `<state>/runs/*.result.json`), `run.1.schema.json` (`review`, условные `write_scope` / `spec_tree` через `if` / `then`),
  `evidence.1.schema.json` (`subject.spec_tree`). Копии — `warrant sync`; golden — `npm run golden:update`.

### 4. Review: Run, guard, submit

- **`run start --operation review`**: `PROPOSED`; `spec_tree` = `canonicalHash(contractTree(HEAD))` — пары путь → blob sha
  `{proposal.md, specs/**}`, та же функция, что у `spec-approved`. Незакоммиченная spec — новый метод `GitPort.dirty(paths)`
  (`git status --porcelain -- <paths>`), `FakeGit` и контракт соответствия; иначе блобы HEAD и рабочие байты расходятся на
  CRLF Windows.
- **Guard** (`core/guard/decide.ts`): при Run `review` правка — `deny`; shell — `allow`, только если каждая простая команда
  (токенайзер `core/shell.ts`) начинается с `warrant run submit`. Остальная логика `pre` / `post` не меняется.
- **`run submit`**: envelope из `--file` или stdin (`io/stdin.ts`); проверки — схема, `run` = активный, `skill` = skill review
  pack'а (`skills` lock) с версией в диапазоне (A-19); запись — `<state>/runs/<RUN>.result.json` (`writeJsonFile`), evidence
  (`produced_by.run`, `attestation: none`, `limitations` ADR-0034 п. 10, `subject` без `base_commit`), `finishRun` — один план
  записи `[result, evidence, manifest, run, current]` для `--dry-run`. Envelope коммитится рядом с Run: maintainer читает находки
  в spec-PR, а `raw/` игнорируется git'ом.
- Alternatives: envelope в `raw/` evidence — отвергнуто (не коммитится, maintainer не видит review в PR); `evidence_status`
  выносит skill — отвергнуто 07 §4; submit из основной сессии — отвергнуто: результат переписывал бы автор.

### 5. Пред-фильтр и `analyze-clean`

- `PrefilterContext.specTree?: Availability<string>` — hash дерева spec на оцениваемом commit; считает `core/transition`
  (`contractTree` уже есть в `core/git/facts.ts`). Запись с `subject.spec_tree`: сравнение дерева вместо `commit` / `base`,
  `StaleReason` += `spec_tree`; дерево недоступно → `STALE` с причиной.
- `analyze-clean`: `signals.analyze` (`Availability<AnalyzeResult>`) строит `core/transition` из того же diff, что у
  `scope-valid`; калькулятор — `FAIL` с находками, `PASS`, либо `BLOCKED` `NO_INPUT` без diff.
- Alternatives: evidence от `analyze` — отвергнуто ADR-0036; отдельный разбор markdown через `openspec show` — отвергнуто:
  процесс на каждый gate, а `ids` уже разбирает ID без процесса.

### 6. `sync`: субагент `warrant-reviewer`

- Точная цель плана (`PlannedFile`) в `core/sync/claude.ts` при `frontends ∋ "claude"`: frontmatter (`name`, `description`,
  `tools: Read, Grep, Glob, Bash`, `hooks.PreToolUse` — matcher `Bash`, command `warrant guard --frontend claude`), маркер, тело
  skill из lock без его frontmatter, раздел «Сдача результата»: envelope `skill-result/1` одной командой
  `warrant run submit <<'JSON' … JSON`. Файл хешируется lock'ом как все точные цели.
- Репозиторий WARRANT: `.claude/agents/warrant-reviewer.md` — вывод генератора для `warrant.json` репозитория с
  `frontends: ["claude"]`; мета-тест `test/unit/meta/reviewer-agent.test.ts` сверяет байты; хук frontmatter — строка белого
  списка `dev-hooks.test.ts` (ADR-0032 п. 11).
- Сдача результата из субагента — зонд Claude Code (задача 6.x): хук frontmatter действует ли на `Bash` субагента, доходит ли
  его `deny`. Отступление по итогам зонда — строка `I-N` (ADR-0034 п. 10); фикстуры — `test/contract/fixtures/claude/<версия>/`.

### 7. Собственное состояние Change (N27)

- `scope-valid`: `ownState` разрешён на трёх переходах и исключён из policy-путей; `otherState` запрещён везде (раньше файлы Run
  не входили ни в одно из множеств).
- `classify`: пути `ownState` удаляются из списка до floor rules и `match.paths`; остальные пути `.warrant/**` (конфигурация,
  `local/`) по-прежнему делают Change `factory-change` (SCN-KRN-073).
- Alternatives: исключить весь `.warrant/runs/**` — отвергнуто: Runs чужого Change в PR — нарушение топологии; добавить Runs
  в `match.paths` исключением — отвергнуто: второй формат конфигурации.

### 8. Версии и порядок

Задача 1.1 — CLI `0.6.0`, pack `core-sdd` `0.3.2` (`kernel: ">=0.1 <0.7"`, 7 fixture-packs, `.warrant/warrant.json`, lock
golden — как I-156). Skill `0.2.0` и `^0.2` — в группе skill (6), тогда же lock. Порядок групп: 1 (швы) → 2 (схемы и
реестры) → 3 (`analyze`, `analyze-clean`) → 4 (своё состояние, пред-фильтр `spec_tree`) → 5 (`review`, guard, `run submit`) →
6 (skill, `sync`, субагент, зонд) → 7 (e2e, документы). 3 и 4 независимы; 5 зависит от 1, 2, 4; 6 — от 5.

### 9. Dogfooding

`warrant classify phase-4b` по diff spec-PR (с N27 ещё старым CLI — `factory-change` здесь законен: `packs/**`,
`packages/cli/schemas/**`). Waiver только на `adversarial-review` (N28), срок 2026-12-31. Следующий Change (4c) делает review
субагентом в spec-PR — шаг навыка `change-spec-pr` правится в группе 6.

## Risks / Trade-offs

- [Хук во frontmatter субагента не поддерживается или `deny` не доходит] → зонд до генератора; без хука субагент всё равно без
  `Write` / `Edit`, а в проектах с `frontends` действует хук сессии; решение — `I-N`.
- [В этом репозитории `warrant` не на `PATH` — хук frontmatter падает и не блокирует] → в описании агента: `npm link` перед
  review; последняя инстанция — CI (ADR-0014 п. 5), файл envelope и evidence пишет только CLI.
- [`analyze` ложно находит `UNSATISFIED` на Change со старыми REQ в `MODIFIED`] → gate waivable; правило — «упоминание REQ или
  его SCN», старые SCN тестов засчитываются.
- [`spec_tree` не судит `design.md`] → так по ADR-0024: контракт — `proposal` и `specs`; design — журнал реализации.
- [Модель автора и ревьюера одного семейства] → `limitations`; второе семейство — BL-28.

## Migration Plan

1. Spec-PR: артефакты, record, classify, waiver `adversarial-review`; `transition SPECIFIED` по «merge #N».
2. Impl-PR: первым коммитом `APPROVED --ref <review spec-PR> --by` и `IMPLEMENTING`; группы 1–7; последним — `VERIFYING`.
3. Archive-PR: evidence CI, `transition MERGED`, `warrant archive phase-4b`, tag `v0.6.0`.
4. Откат: `git revert` группы; `analyze-clean` возвращается к `BLOCKED` только с откатом группы 3.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-166 | `analyze-clean` вычисляется (REQ-VER-004): в app-тестах SCN-VER-036 (`archive`), SCN-VER-019 (`gate`) и I-96 (`transition`) ожидание `analyze-clean` — `PASS` (BREAKING из proposal); тесты `waive` SCN-KRN-121, 122, 124 и `--dry-run` — фикстура без git, `analyze-clean` `BLOCKED` `NO_INPUT`, текст сценариев kernel не меняется. Решение maintainer'а 2026-09-25 | `test/app/commands/{archive,gate,transition,waive}.test.ts`, задача 3.3 |
| I-167 | Токенайзер guard (`core/shell.ts`) разбирает heredoc — `<<DELIM`, `<<'DELIM'`, `<<"DELIM"`, `<<-DELIM` (в том числе без пробела и внутри строки `bash -c`): перенаправление и тело до строки-разделителя — данные команды и отбрасываются, строки тела не становятся простыми командами. Причина — субагент `warrant-reviewer` сдаёт envelope одной командой `warrant run submit <<'JSON' … JSON` (§6), guard при Run `review` отвечает `allow`; раньше каждая строка тела была отдельной командой → `deny`. Тело отбрасывается, а не прикрепляется словом: перенаправление перед именем (`<<X pytest`) не сдвигает первое слово команды и не обходит `guard_prefixes`, JSON envelope не попадает в `argv` событий Run. Строка-разделитель не пришла — heredoc не распознан, строки остаются командами (fail-safe); `<<<` и `<<` без разделителя — слова, как прежде; тело, поданное оболочке (`bash <<X`), не читается — как скрипт `bash file.sh` (INV-07). `argv` shell-события адаптера `claude` для команд с heredoc меняется. Решение maintainer'а 2026-09-26 | `core/shell.ts`; `test/unit/guard/shell.test.ts`, `test/app/commands/guard.test.ts`; задача 6.3 |
