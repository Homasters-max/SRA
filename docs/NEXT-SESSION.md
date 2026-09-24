---
id: WARRANT-NEXT
title: WARRANT — следующий шаг: grilling нарезки фазы 4 (frontend Codex), spike S8
status: informative
maturity: MVP
version: 0.4.1
---

# WARRANT — что делать в следующей сессии

Файл передачи контекста. Прочитать первым, затем [00-readme](00-readme.md).

## Состояние на 2026-09-24

- **Фазы 1 и 2 закрыты**: `phase-1-kernel` и `phase-2-core-sdd` заархивированы (`openspec/changes/archive/2026-09-22-*`,
  main specs `openspec/specs/{kernel,core-sdd}/spec.md`), tag `v0.2.0`. Record `phase-2-core-sdd` остаётся
  `ARCHIVED_WITHOUT_TRANSITION` (P-13) — единственный ожидаемый `stale[]`.
- **Фаза 3 закрыта** — change `phase-3-verification` прошёл `PROPOSED → … → ARCHIVED` только через `warrant transition` /
  `warrant archive` (P-18 (2)): spec-PR #6, impl-PR #7 (`worktree/phase-3-verification`, merge commit `ea3b856`, impl-head
  `bd1e829`), archive-PR `archive/phase-3-verification` (evidence CI run 35881659520, `transition MERGED --commit bd1e829`,
  `warrant archive`), tag `v0.3.0`. Решения по ходу реализации **I-66…I-101** — таблица в конце design.md архива
  `openspec/changes/archive/<date>-phase-3-verification/`. Версии: CLI **0.3.0**, pack `core-sdd` **0.2.0**
  (`kernel: ">=0.1 <0.4"`), `.warrant/warrant.json` `kernel: "0.3"`.
- **После фазы 3** — ветка `fix/phase-3-review` (ревью R-1…R-16): CLI **0.3.1**, pack `core-sdd` **0.2.1** (R-14); после
  merge в `main` — tag `v0.3.1`. С этой ветки bump версии делается первым изменением после релиза и проверяется
  (`versions.test.ts`).
- **Первый прогон на Linux** (CI impl-PR) нашёл два дефекта, невидимых на Windows: I-100 (prefix проекта через
  `path.relative` к `--show-toplevel` обнулял diff при 8.3-имени/symlink temp-каталога → `scope-valid` ложно `PASS`) и I-101
  (обёртка fake `openspec` в тестах звала внешний `dirname` при PATH только из fake). Оба исправлены в impl-PR; CI зелёный
  на ubuntu и windows — 616/616, 0 skipped (P-18 (3)).
- **phase-3b закрыт** (2026-09-24): archive-PR `archive/phase-3b` — evidence CI run 35920574061, `transition MERGED --commit 6db3352`, `warrant archive` → `openspec/changes/archive/2026-09-24-phase-3b`, main specs `kernel`/`verification`/`core-sdd` обновлены, tag `v0.4.0`; impl-PR #11 смержен merge-коммитом `702cbac`. Ход: spec-PR #10 (merge `3d6a4cd`, `SPECIFIED` в spec-PR — P-2 без отступлений),
  impl-PR #11 `worktree/phase-3b` (worktree `D:\project\SRA-phase3b-impl`): первым коммитом `APPROVED --ref #10 --by
  Homasters-max` + `IMPLEMENTING`, группы 1–5 по коммиту, последним — `VERIFYING`. Решения **I-102…I-116** — таблица
  design.md `openspec/changes/phase-3b/`. Версии: CLI **0.4.0**, pack `core-sdd` **0.3.0** (`kernel: ">=0.1 <0.5"`),
  `.warrant/warrant.json` `kernel: "0.4"`. Итог: `warrant link`, `warrant waive` (PROPOSED / `--activate` / `--revoke`),
  `classify --set --by --ref` ниже floor, gate `spec-approved` (ADR-0024), `execution.local: scoped-only`, `validate` (13)
  `ID_DANGLING` и I-77, фиксы ревью R-2/6/7/8/9/10/13 в коде и нормы R-1/2/4/5/14 в delta specs, процедуры
  `.claude/commands/{decision,group-done,next-session}.md`, 04 §9 по ADR-0010 (I-93), INV-03 «Частично». Тесты: 686/686
  (`--maxWorkers=3`), CI зелёный на ubuntu и windows на каждой группе.
- **Уровни тестов — ADR-0025** (grilling 2026-09-24, Q1–Q15 приняты maintainer'ом): `unit` / `app` / `contract` / `e2e`, порты
  процессов и `Ctx`, фейки с контрактом соответствия, проверки уровней, `validate` без N вызовов `openspec` подряд. Change
  `test-levels` (`skip_specs: true`, CLI `0.4.1`) идёт **до фазы 4** (13 §2, строка 3c). spec-PR #14 смержен (merge `5fdde73`;
  `classify` — `chore` + `factory-change`, risk HIGH; waivers `WAV-2026-005` `analyze-clean`, `WAV-2026-006` `adversarial-review`).
  Impl: worktree `D:\project\SRA-test-levels-impl`, ветка `worktree/test-levels`, **impl-PR #15** — первым коммитом `APPROVED
  --ref #14 --by Homasters-max` + `IMPLEMENTING`, группы 1–6 по коммиту (CI зелёный на ubuntu и windows на каждой), последним —
  `VERIFYING`; смержен merge-коммитом `a78108d` (impl-head `bd1f069`). **test-levels закрыт** (2026-09-24): archive-PR
  `archive/test-levels` — evidence CI run 35950663998, `transition MERGED --commit bd1f069`, `warrant archive` →
  `openspec/changes/archive/2026-09-24-test-levels` (main specs не менялись — `skip_specs`), tag `v0.4.1`. Решения
  **I-117…I-139** — таблица design.md архива. Версии: CLI **0.4.1**, pack `core-sdd` **0.3.0**. Итог (design §10):
  - уровни `unit`/`app`/`contract`/`e2e` — projects vitest; `unit`/`app` идут первой группой (`sequence.groupOrder`, I-138),
    `contract`/`e2e` — пул forks с `maxForks` (I-119); `SPAWN_FORBIDDEN_AT_LEVEL`, мета-тесты раскладки, причины e2e и
    «процессы только в `src/adapters/**`»;
  - порты `OpenSpecPort`/`GitPort`/`CheckRunnerPort`/`ClockPort`, `Ctx` у всех команд, асинхронные адаптеры; фейки, `ProjectBuilder`,
    контракт соответствия; `globalSetup` `contract`/`e2e` требует openspec 1.13.1;
  - e2e: 216 тестов / 22 файла → 48 / 20 (причины `argv`/`output`/`platform-spawn`/`golden`/`package`/`lifecycle`), сквозной
    lifecycle `init → … → archive` в `e2e/exit-criterion`; `fake-openspec.ts` удалён; SCN-теги не потеряны;
  - `npm test` локально без флагов — 178 с → ~70 с, зелёный 3 раза подряд (788 тестов); CI шаг тестов ubuntu / windows —
    346 / 751 с → 137 / 263 с; `warrant validate` репозитория — 11–12 с → 4,5 с (кэш `show` не нужен, I-128).
  - Эксперимент Graft: записи групп test-levels g1–g6 помечены `blind-leak` — индекс `MEMORY.md` сессии
    называл эксперимент (зонд это поймал; индекс исправлен для следующих сессий, снимок текущей сессии — нет). Засчитывать ли
    их — решение maintainer'а при `/stats-report`.
- **Итог фазы 3:**
  - capability `verification` (REQ-VER-001…008): `warrant check` (runner без shell, замок `exclusive` в `git-common-dir`,
    `timeout_s` с kill дерева, parsers `junit`/`openspec-validate`, evidence + manifest, attestation `ci` под GitHub Actions),
    `gate` (пред-фильтр D-12, алгоритм 06 §3, L0-калькуляторы, waiver шагом 4 — и для `BLOCKED`, I-84), controller
    (`controller/rules.json` + kernel fallback `verify-incomplete`, I-91), `verify`, `transition` (матрица 04 §2,
    `human-approval` по `--ref --by`, `MERGED` на commit evidence с base = точка ответвления, I-97; `ABANDONED`),
    `archive`, `classify --set --by`;
  - kernel: схемы A и `rule/1`, `validate` (8)–(12) (правила, `ID_IMMUTABLE` относительно `HEAD`, `LINK_TARGET_INVALID`,
    семантика waiver, двухступенчатая валидация D-13), `status` (`risk_level`, `verification`, D-22, `amended_by[]`, `rules`);
    B3/B4/B5 и I-52/I-57 закрыты;
  - golden: `expected/verify.json` у трёх фикстур (P-18 (1));
  - CI `.github/workflows/ci.yml`: job `test` (ubuntu + windows) и job `evidence` (impl-PR из `worktree/*`);
  - dogfooding: override `.warrant/local/checks/tests-passed.json` (`npm test` с junit), waivers `WAV-2026-001`
    (`analyze-clean`) и `WAV-2026-002` (`adversarial-review`) до 2026-12-31, `.gitignore` `.warrant/evidence/**/raw/`.
- Прогон выхода: `npm test` — 616 passed / 55 файлов, 0 skipped (локально и в CI на обеих ОС); `warrant check
  phase-3-verification tests-passed` — `test-report` `PROVEN` (SCN-SDD-019); `verify` `PROPOSED->SPECIFIED` — `CONTINUE`;
  CI job `evidence` на impl-head — `tests-passed`/`factory-golden-passed` `PASS` с attestation `ci`, `WAIT` только по
  `human-approval`; `transition MERGED` — все gates `VERIFYING->MERGED` `PASS`/`WAIVED`.

### Как прошёл 6.5 (образец для следующего change)

1. `worktree/phase-3-verification`: `verify` + `transition SPECIFIED`; `transition APPROVED --ref <PR #6> --by Homasters-max`
   (evidence `human-approval`, `adversarial-review` — WAV-2026-002); `IMPLEMENTING`; `VERIFYING` — по коммиту на переход.
2. impl-PR #7: CI `test` (ubuntu + windows) и `evidence` (artifact `evidence-phase-3-verification`, `WAIT` по `human-approval` —
   ожидаемо); merge «Create a merge commit».
3. archive-PR от `main`: `gh run download <run> -n evidence-<change>` → `.warrant/evidence/<change>/`; `transition MERGED
   --ref <run-url> --commit <impl-head> --by <login>`; `warrant archive <change>`; PR, merge, tag.
4. P-18 (4): `warrant status` репозитория — `stale[]` только у `phase-2-core-sdd`.

### Долг после фазы 3

| # | Долг | Куда |
|---|---|---|
| I-77 | Удаление ID delta'ой `REMOVED` в коммите archive даёт `ID_IMMUTABLE` по проверке (9) `validate`: archive-коммит нужно сравнивать с архивной копией delta, как для MODIFIED (I-73) | **закрыт** phase-3b (3.3) |
| I-90 | `branch-isolated` на detached HEAD — `FAIL`; в CI `pull_request` HEAD detached. Сейчас не мешает (gate на `APPROVED->IMPLEMENTING`, считается локально); пересмотреть по первому failure mode | по failure mode |
| I-93 | `transition` пишет `by: "cli:local"` и на `APPROVED`/`MERGED` (REQ-VER-007), а 04 §9 называет такую запись невалидной — противоречие нормы и spec; 04 §9 не правился | **закрыт** phase-3b (1.3): 04 §9 приведён к ADR-0010 |
| `files` | ~~`package.json` `files` не включает `sra/`~~ — **закрыт R-15** (`sra/skills` в `files`, тест состава `npm pack`) | — |
| 13 §2 | Строка фазы 3 всё ещё перечисляет `analyze` и `warrant link`, а по P-4 это `phase-3b`; поправить 13 §2 (и строку 4-й фазы, если `analyze` уйдёт туда) | **закрыт** phase-3b (1.4) |
| P-2 | Порядок P-2 нарушен в фазе 3: spec-PR #6 смержен до появления `transition`, поэтому `SPECIFIED`/`APPROVED`/`IMPLEMENTING`/`VERIFYING` пишутся в impl-PR. Со следующего change — строго по ADR-0011 (`SPECIFIED` в spec-PR) | процесс |
| I-59 | `packContentHash` исключает `golden/` pack'а — пересмотреть, если golden начнёт влиять на policy | later |
| ~~I-64~~ | ~~`runCli` и `golden-lib.js` асинхронные; короткие `spawnSync` остались для `git` и `openspecAvailable()`~~ | **закрыт** test-levels (2.1, 2.2): асинхронные адаптеры портов, в `src` синхронных вызовов процессов нет (I-122, I-124) |
| `analyze` | **Решено V-1**: фаза 4 | — |
| ~~тесты под нагрузкой~~ | **закрыт** test-levels: `npm test` без флагов ~70 с, зелёный 3 раза подряд (I-138: `unit`/`app` первой группой, тяжёлые — `maxForks`), `validate` репозитория 4,5 с (3.1). Было: `warrant validate` на репозитории — ~30 с (вызовы `openspec` на каждый Change/spec); полный `npm test` с параллелизмом по умолчанию на машине maintainer'а даёт таймауты e2e `validate`/`golden` (поодиночке и с `--maxWorkers=3` — зелёные, CI — зелёный). Один `openspec` на проект невозможен (у OpenSpec 1.13.1 нет пакетного `show`); таймауты не поднимаем | **решено ADR-0025**: `test-levels` — `show` только для файлов с id и параллельно, логика в `unit`/`app` без процессов; до его закрытия `/group-done` гоняет `--maxWorkers=3` вручную |
| I-103 | Пред-фильтр исключает запись, чей `metrics.waivers[]` ссылается на waiver с `targets[]` — пересмотреть вместе с D-10 | фаза 5 |
| Graft | Слепой эксперимент ADR-0026 активен ([process/graft.md](process/graft.md), `status: active`): группы раздаются по [process/coordinator.md](process/coordinator.md) — зонд, метки `[A]` (нечётные, навык `code-search`) / `[B]` (чётные), одинаковые шаблоны; после группы — `/group-stats`; фон phase-3b g1–g5 записан. Субагентам об эксперименте не сообщать | `/stats-report` после ≥ 2 засчитанных групп в каждой метке |
| `fmt` packs | `warrant fmt --check` без пути не проверяет `packs/**`; `packs/core-sdd/pack.json` неканоничен (порядок `rules`/`skills`), а правило `json-canonical` из черновика `rule/1` покрывает `packs/**/*.json` | вместе с первым правилом `rule/1` или отдельным fix |

### Ревью фазы 3 (2026-09-23) — R-1…R-16

Ревью кода `main` после PR #8 по пяти вопросам maintainer'а: (1) `MERGED --commit` на старом предке; (2) I-96,
кто проверяет свежесть и attestation каждого kind; (3) I-84 + I-91, не проходит ли переход с непроверенным gate;
(4) модель доверия `human-approval`; (5) кроссплатформенность. Быстрые фиксы — ветка `fix/phase-3-review`
(worktree `D:\project\SRA-review-fixes`), по коммиту на находку. Ни один REQ/SCN main specs и ни одна строка архивного
design.md не правились: уточнения нормы — отдельными строками ниже, delta'ой в phase-3b. **Решение maintainer'а:** до конца
phase-3b можно отложить документы (04/06/06a/13, README), стиль кода и полноту тестов вне ядра; ядро (`check → gate →
verify → transition`, gate engine, runner) — нет. Нерешённые вопросы ревью maintainer делегировал («реши сам, системно»):
решения R-8, R-14 ниже.

Сделано (`fix/phase-3-review`):

| # | Находка | Фикс | Долг нормы |
|---|---|---|---|
| R-1 | `transition MERGED` принимал любой commit-предок HEAD, в том числе по умолчанию (commit свежайшей записи): gates считались по `base...commit`, коммиты impl-PR после него не судились (`scope-valid`, `tests-passed`, `applies_when`). Воспроизведено: CI-evidence на раннем commit + поздний commit в `openspec/specs/**` → `MERGED` с `scope-valid PASS`. Fast-forward давал base = head^1 (diff одного commit) | `2cd9793`: commit обязан быть не первым родителем merge-коммита M (head impl-PR); ранний commit PR, commit first-parent линии, fast-forward → `COMMIT_NOT_MERGED` с именем head | REQ-VER-007: «commit SHALL быть head impl-PR (родитель M, кроме первого); fast-forward → `COMMIT_NOT_MERGED`» + SCN (ранний commit, ff) — delta в phase-3b |
| R-2 | `approved_by ∈ roles` waiver'а проверял только `validate` (11); `gate`/`verify`/`transition` его не вызывают — waiver от любого логина снимал `BLOCKED`/`FAIL` waivable gate, извинял kind в `evidence-complete`, держал записи с `metrics.waivers` | `5ecf580`: gate engine получает `approvers`; waiver вне roles → `WAIVER_IGNORED` reason `approver`, в `evidence-complete` и пред-фильтре не участвует | REQ-VER-003 шаг 4: «waiver, `approved_by` которого ∈ roles» + SCN — delta в phase-3b |
| R-3 | `check` ловил только `SIGINT`/`SIGTERM`; child `detached` = своя сессия на POSIX, поэтому закрытие терминала (`SIGHUP`) убивало CLI без cleanup: замок оставался, дерево `npm test` работало сиротой. Windows: закрытие консоли = `SIGHUP`, Ctrl+Break = `SIGBREAK` | `a4cd2a5`: + `SIGHUP`, на win32 + `SIGBREAK`; повторный подъём сигнала, где Windows не умеет, — `exit(128 + n)`; unit-тест в дочернем процессе (замок снят) | — |
| R-4 | junit, где все тесты `skipped`, давал `PROVEN` (`tests` включает skipped) — `tests-passed` проходил без выполненного теста | `d52aa71`: `tests - skipped <= 0` → `INCONCLUSIVE`, limitation `junit: all N tests skipped` | design §5 «`tests = 0` → `INCONCLUSIVE`» читать как «ни один не выполнен»; в REQ-VER-002 — строкой при delta phase-3b |
| R-5 | `tests-passed`, `factory-golden-passed` без `accepts_attestation` → на `MERGED` засчитывалась любая attestation ≠ `none` (`human-review`, `signature`) | `6da9b65`: `accepts_attestation: ["ci"]`; lock'и репозитория и golden пересчитаны | версия — R-14 |
| R-14 | Правило «поднять версию к следующему tag» жило прозой (G-20) и забывалось: после `v0.3.0` CLI и pack изменились, версии — нет; проект с lock'ом получил бы `LOCK_MISMATCH` при той же версии pack'а | `6d08377`: **bump первым изменением после релиза, с проверкой**: `scripts/versions-lib.js`, `npm run versions:check`, e2e `versions.test.ts` (CLI, каждый pack без `golden/`, каждый skill против последнего tag `v*`; в CI без tags — падение); CI `test` с `fetch-depth: 0`. Bump: CLI `0.3.1`, `core-sdd` `0.2.1`; тесты читают версию pack из `pack.json` | REQ-SDD-001 фиксирует «версии `0.2.0`» — spec не должен фиксировать patch: delta «`0.2.x`, patch — по R-14» в phase-3b (тест уже проверяет `0.2.x`) |
| R-15 | Долг `files`: `sra/` не входил в пакет — установленный CLI не находил skill `adversarial-review`; дефект виден только на установленном пакете | `6fe3259`: `files` + `sra/skills`; e2e `package-contents.test.ts` по `npm pack --dry-run` (bin, схемы, pack без golden, SKILL.md каждого `provides.skills`) | — |
| R-16 | «Main specs меняются только archive-PR» (ADR-0011, D-15) держал `scope-valid` лишь на переходах Change; PR вне Change не проверял никто | `84c46bc`: шаг CI `test` (ubuntu, `pull_request`): diff `openspec/specs/**` в PR не из `archive/*` → ошибка; временно до `warrant ci` фазы 4 | — |

Не исправлено — в phase-3b (или куда указано):

| # | Находка | Направление | Куда |
|---|---|---|---|
| R-6 | `--ref` перехода `MERGED` не сверяется с `attestation.ref` CI-записей, на которых вынесены verdicts: можно сослаться на один run, а записи взять из другого | `transition MERGED`: все записи `ci` перехода с `attestation.ref === --ref`, иначе `USAGE`/finding | phase-3b (или `ci` фазы 4) |
| R-7 | Kind из `evidence.required`, который не читает ни один gate policy, закрывается любой записью: любой commit, статус, attestation (рукописный JSON) | `validate`/`resolve`: `EVIDENCE_KIND_UNGATED` — kind без gate с `requires_evidence` этого kind | phase-3b |
| R-8 | `evidence-complete` не смотрит `evidence_status` (`review` `NOT_PROVEN` засчитан — так задумано I-96, есть unit-тест) и `waivable`/`targets[]` waiver'а-извинения (I-99) | **Решено (делегировано maintainer'ом):** kind засчитывается записью в статусе `PROVEN` или `NOT_APPLICABLE` (на любом commit — как I-96); waiver-извинение — только на waivable gate без `targets[]` (как шаг 4). Уточняет I-96/I-99; unit-тест I-96 с `review` `NOT_PROVEN` меняется | phase-3b, вместе с delta REQ-VER-004 |
| R-9 | `NOT_APPLICABLE` засчитывается из любой записи, D-11 требует «выставлен детерминированным check»; `produced_by.type` не проверяется. Сейчас ни один parser `NOT_APPLICABLE` не производит | verdict: `NOT_APPLICABLE` только при `produced_by.type === "check"` | до первого producer'а (mutation, фаза 5); лучше в phase-3b |
| R-10 | Предел доверия не записан: `--ref` проверяется только как http(s) URL, `--by` — заявление, `human-approval` с `attestation: human-review` неотличима от будущей верифицированной; при этом 04 §7 помечает «верифицируемый `--ref`» как MVP, ADR-0010 п. 3 считает запись без верифицируемого ref невалидной, INV-03 требует `review.author ≠ pr.author` (при одном maintainer'е невыполнимо — в dogfooding фазы 3 автор и approver совпадают). Предел есть только в P-17 | (а) запись `human-approval` получает `limitations: ["ref not verified (phase 4: warrant ci)"]`; (б) фраза в REQ-VER-007 и 06a §3; (в) INV-03 — статус «Частично» с пояснением | одной правкой с I-93 (ADR или 04 §9) |
| R-11 | Код замка, kill дерева и путей на Linux проверен только CI-тестами, реального использования не было | smoke в WSL Ubuntu (node не установлен): `check` с timeout и деревом процессов, Ctrl+C, закрытие терминала (после R-3), `BUSY`, ручное снятие замка | **отложено решением maintainer'а** (2026-09-23); до первого реального использования на Linux |
| R-12 | INFO: CI-evidence считается на head impl-PR, а не на результате merge: «злой» merge или сдвиг `main` после CI-прогона не судятся | branch protection «require branches up to date» или `ci` фазы 4 на merge-коммите | фаза 4 / настройка GitHub |
| R-13 | INFO: controller-rules project-слоя могут отобразить `gate_verdict: BLOCKED` в `CONTINUE` — меняется код выхода `verify` (на `transition` не влияет: он сам проверяет verdicts) | `validate`: правило не может давать `CONTINUE` при `BLOCKED`/`FAIL`, или kernel fallback раньше правил project-слоя | phase-3b |

### Процессные правила → чем держатся (R-14…R-16, 2026-09-23)

Почему забылись bump, `files` и «REQ только delta'ой»: правило о **форме** жило прозой в NEXT-SESSION / решениях G-, P- без
`enforced_by` — ровно то, что ADR-0022 запрещает для правил проекта (INV-04). Принцип: у каждого процессного правила о форме
есть проверка в `npm test` / `validate` / CI; прозой остаются только правила о **решении** (что выбрать), и они помечены как
таковые. Новое правило о форме без проверки не принимается.

| Правило | Где записано | Чем держится |
|---|---|---|
| JSON канонический | ADR-0006 | `validate` (canonical) + CI |
| Генерируемое не правится руками | ADR-0015, rule `generated-not-hand-edited` | `validate` (drift, проверка 4) |
| Lock после изменения pack | 08 §7 | `validate` `LOCK_MISMATCH` |
| Golden после изменения pack | REQ-SDD-009 | `golden.test.ts` |
| Версия после изменения поставляемого | было G-20 (проза) | **R-14** `versions.test.ts`, `versions:check` |
| Состав пакета | было долгом `files` | **R-15** `package-contents.test.ts` |
| Main specs только через archive-PR | ADR-0011, D-15 | `scope-valid` в Change + **R-16** шаг CI вне Change |
| impl-PR — только merge commit | I-97 | **R-1** `transition MERGED` (`COMMIT_NOT_MERGED`) |
| CI на ubuntu + windows | P-9 | `ci.yml` matrix |
| Уровни тестов: процессы только в `contract`/`e2e`, у e2e-файла причина, тест только в каталоге уровня | ADR-0025 п. 7 | `SPAWN_FORBIDDEN_AT_LEVEL` (setup `unit`/`app`), мета-тесты `test/unit/meta/levels.test.ts` (раскладка, причина e2e, процессы в `src` только из `src/adapters/**`, порядок групп, нет `skipIf` по openspec), `globalSetup` `contract`/`e2e` (openspec 1.13.1) — test-levels (1.4, 2.4, 4.3, 5.5, 6.3); выбор уровня теста — правило о решении |
| Порядок P-2 (что в каком PR) | ADR-0011, P-2 | частично: `transition` (последовательность), `scope-valid`; размещение по PR — `warrant ci`, фаза 4 |
| Одна ветка — один worktree, ветку проверять перед коммитом | «Организационное», memory | проза: машина не знает, какой ветке принадлежит работа; шаг процедуры `/group-done` (ниже) |
| Отклонение от spec — строкой I-N в design.md, вопросом maintainer'у | pack `rules.design` (1.4) | правило о решении (ADR-0022 допускает без `enforced_by`); нумерацию I-N ведёт `/decision` (ниже) |
| NEXT-SESSION обновляется в конце сессии | этот файл | процедура `/next-session` (ниже) |
| Graft только через `cs.js`, разрешённые подкоманды и версия | ADR-0026 п. 2 | `scripts/dev/cs.js` (код 2 / 3); `graft` в группе `[B]` — код 1 `graft-metrics run` |
| Алгоритм поиска `code-search` в группах `[A]` | ADR-0026 п. 4 | `graft-metrics run`: `deviations`, > 3 → `compliant: false` (вне вердикта) |
| Graft не пачкает дерево | ADR-0026 п. 3 | `cs.js` ставит переменные и проверяет `.git/info/exclude`; `git status --short` в `/group-done` |
| Каждая группа записана и помечена `[A]`/`[B]` | ADR-0026 п. 5 | `graft-metrics run` без метки не пишет; `report` — `missing` (группа закрыта без записи), код 1 |
| Слепота эксперимента | ADR-0026 п. 5 | зонд перед первой группой ([coordinator.md](process/coordinator.md) §1); шаблоны промпта — правило о решении |
| `scripts/dev/` не поставляется | ADR-0026 | `package-contents.test.ts` |

Процедуры `.claude/commands/` — `/decision` (следующий I-N строкой в таблицу design.md), `/group-done <N>` (ветка и worktree,
typecheck, test, validate, `versions:check`, коммит, галочки tasks.md), `/next-session` — были в плане «Карта агента» и
выпали вместе с change `agent-session-guide` (решение P-1), никуда не перенесённые. **Сделано** группой 1
phase-3b: `.claude/commands/{decision,group-done,next-session}.md`; критерий P-1 сохраняется — файл в `.claude/` автоматизирует
процедуру, правил в нём нет.

Skills (reasoning SRA, [07](07-skills.md)) — где они в плане: контракт вызова (`run start` / `run submit`, схемы `run/1`,
`skill-result/1`) и первый реальный skill `adversarial-review` через `codex exec` (D-5, снимает WAV-2026-002) — **фаза 4**;
расширение набора (bdd-tdd, arch) — фаза 5; интеграция каталога SRA — фаза 9. Расхождение 13 §2 («adversarial review» в фазе 5)
закрыто phase-3b (1.4): producer — фаза 4 (D-5).

### phase-3b — нарезка (V-1…V-9, grilling 2026-09-23, приняты maintainer'ом)

Change `phase-3b` предложен в worktree `D:\project\SRA-phase3b`, ветка `spec/phase-3b` (spec-PR): proposal, delta specs `kernel`
(REQ-KRN-030 `link`, REQ-KRN-031 `waive`, MODIFIED 011/019/021/026/028), `verification` (MODIFIED REQ-VER-002…007), `core-sdd`
(MODIFIED REQ-SDD-001/002/007), design (§1–§14), tasks (6 групп, 25 задач); waivers `WAV-2026-003` (`analyze-clean`),
`WAV-2026-004` (`adversarial-review`) до 2026-12-31.

| # | Решение |
|---|---|
| V-1 | Из 3b вынесено: поведение `waiver.targets[]` (D-10) и проверка (f) pragma → фаза 5 (`bdd-tdd`: нет producer'а, формы target, S7); `guard_prefixes`, `validate --files`, `AGENTS.md` побайтно, `analyze` → фаза 4 (единственный исполнитель/потребитель там; WAV-2026-001 уже ссылается на фазу 4). В 3b: `link`, `waive` без targets, `spec-approved`, `execution.local`, (d) висячие REQ/SCN, понижение ниже floor, I-77, delta R-1/2/4/5/14, R-6…R-10, R-13, `.claude/commands`, I-93 |
| V-2 | Группы: 1 процедуры и документы; 2 версии + gate engine + controller; 3 схемы + validate; 4 `link`, `waive`, `classify` ниже floor; 5 `spec-approved`, `execution.local`; 6 выход |
| V-3 | `warrant waive <change> <gate> …` создаёт `PROPOSED` без `approved_by`; `--activate <WAV> --by`, `--revoke <WAV> --by` (`roles.maintainer`); waiver на невэйвабельный gate и `targets[]` — отказ; `approved_by` в схеме обязателен кроме `PROPOSED` |
| V-4 | Понижение ниже floor: `classify --set <dim>=<v> --by <login> --ref <url>`, только до `APPROVED`; значение `{ value, from: human:<login>, ref }`; отдельной evidence нет; `ref` не верифицируется до `warrant ci` |
| V-5 | `spec-approved`: overlay `core-default`, `VERIFYING->MERGED`; дерево Change на commit записи `human-approval` перехода `APPROVED` ↔ на оцениваемом commit; нет записи → `BLOCKED/NO_INPUT` (состав дерева и `waivable` — V-9) |
| V-6 | R-6 → `REF_MISMATCH` на `transition MERGED`; R-7 → `EVIDENCE_KIND_UNGATED` как `POLICY_CONFLICT` resolver'а; R-13 → правило `CONTINUE` при `FAIL`/`BLOCKED` пропускается (`CONTROLLER_RULE_IGNORED`) |
| V-7 | CLI `0.4.0`, pack `core-sdd` `0.3.0` (`kernel: ">=0.1 <0.5"`) первой задачей группы 2 (R-14); tag `v0.4.0` после archive-PR |
| V-8 | Profiles/risk — `classify` по diff spec-PR; waivers `analyze-clean`, `adversarial-review` — файлами в spec-PR (`warrant waive` появится только в impl-PR, а `adversarial-review` стоит на `SPECIFIED->APPROVED`) |
| V-9 | **Уточняет D-3**: дерево `spec-approved` — только `{proposal.md, specs/**}` (`design.md` с I-N и `tasks.md` — журнал реализации); gate `waivable: true` — правка контракта после approval снимается waiver'ом maintainer'а (`warrant waive`, reason `I-N`). Повторный `APPROVED` из `IMPLEMENTING` невозможен (`scope-valid` `SPECIFIED->APPROVED` не пропускает код). Норма — ADR-0024 (amends ADR-0020 п. 9), задача 1.2 |

I-93 решается без нового ADR: ADR-0010 п. 2 уже заменил правило 04 §9 «`cli:local` невалиден» — 04 §9 просто не приведён к нему (задача 1.3).

- **Фаза 4** (MVP frontend, [13 §2](13-roadmap.md)): `sync` (`.codex/hooks.json`, `AGENTS.md`), `run start` / `run submit`,
  схемы `run/1` и `skill-result/1`, `guard` (pre/post, без Run → `deny`, D-4, `guard_prefixes`), `validate --files`, `analyze`,
  `warrant ci` (verdict impl-PR вместо ручного переноса artifact'а, верификация `--ref`), адаптер `codex` — после spike **S8**
  (hooks Codex под `codex-acp` и `codex exec`, 13 §3), finding `FRONTEND_HOOKS_INACTIVE` (D-14), producer'ы `analyze-clean` и
  `adversarial-review` (снимают WAV-2026-001…004). Если S8 затягивается, `ci` и `run`/`guard` можно резать в два change.

### Продолжение — готовый запрос

```text
Grilling по нарезке фазы 4 (MVP frontend Codex). Прочитай docs/NEXT-SESSION.md (состояние, «Фаза 4», долг B/C/D, «Чего не
делать»), docs/13-roadmap.md (§2 строка 4, §3 S8), ADR-0017…0020, ADR-0022, ADR-0025 (новые команды — сразу с тестами app через
Ctx; новый внешний вызов — метод порта + адаптер + фейк + сценарий контракта). Вопросы раунда 1:
(1) spike S8 (hooks Codex под codex-acp и codex exec) — отдельной сессией до spec фазы 4? codex на машине maintainer'а не
установлен; (2) нарезка: 4a без Codex (run/1, skill-result/1, run start/submit, guard pre/post, guard_prefixes, validate --files,
analyze, warrant ci) и 4b после S8 (адаптер codex, .codex/hooks.json, AGENTS.md, FRONTEND_HOOKS_INACTIVE, codex --version,
slice) — или один Change; (3) warrant ci ходит в GitHub API — ForgePort и как держать его контракт (настоящий GitHub в CI
с токеном или записанные ответы, которые ADR-0025 отверг для OpenSpec); (4) где живёт sample-проект slice (Python + pytest,
ADR-0013); (5) producers analyze-clean / adversarial-review — до истечения WAV-2026-001…006 (2026-12-31).
После раунда — сводка решений, затем ADR/нарезка в 13 §2 и NEXT-SESSION на отдельной ветке (процесс «Decision workflow»).
```

### Решения grilling 2026-09-22 по фазе 3 (P-1…P-20) — приняты maintainer'ом

Два раунда; proposal/design `phase-3-verification` ссылаются на них. Исполнено до propose: PR #5 (`feature/agent-rules-plan` → `main`,
только docs), worktree `D:\project\SRA-phase3` на ветке `spec/phase-3-verification`, `warrant init change phase-3-verification`.

| # | Решение |
|---|---|
| P-1 | Change `agent-session-guide` (шаг 3 плана «Карта агента») **пропущен**: `preflight` становится `warrant verify`, `CLAUDE.md`/`settings.json` с TTL до фазы 4 не стоят отдельного change; полигон ADR-0011 — сама фаза 3 (P-2) |
| P-2 | Топология ADR-0011 на фазе 3: сначала PR `feature/agent-rules-plan` → `main`; затем `spec/phase-3-verification` (proposal/specs/design/tasks → PR → review → merge), `worktree/phase-3-verification` (код → PR), `archive/phase-3-verification`; один worktree на ветку |
| P-3 | Новые REQ команд исполнения — новая capability `openspec/specs/verification/spec.md`, AREA `VER`; правки схем, `validate`, `status`, `classify` — delta `kernel` |
| P-4 | Ядро: схемы A целиком как поля (`waiver.targets[]`, `amends/supersedes`, `execution.*` — валидируются, не исполняются), `rule/1` + `provides.rules` + проверки правил в `validate` и доля без `enforced_by` в `status`, D-13, `validate` (c) D-18 и цель `amends`/`supersedes`, `status` (`risk_level`, verdicts, `next`, D-22, `amended_by[]`), `check`, `gate` (D-11, D-12), `verify`, `transition` (в т.ч. `ABANDONED`), `archive`, controller, evidence `spec-report` + `test-report`, human-источник classification, CI-матрица, B3/B4/B5, I-52/57/59/64, ADR-0023. В `phase-3b`: `link`, поведение `targets[]`, `warrant waive`, `spec-approved`, исполнение `execution.local`/`guard_prefixes`, `analyze`, `validate --files`, проверки (d) висячие REQ/SCN и (f) pragma, `AGENTS.md` побайтно, понижение ниже floor |
| P-5 | Human-источник: `warrant classify <change> --set <dim>=<value> [--set profile=<id>] --by <login>`, `login` ∈ `roles.*`, `from: human:<login>`; только повышение/подтверждение; понижение ниже floor → отказ `BELOW_FLOOR` (форма approval — 3b) |
| P-6 | `transition` **принуждает**: вычисляет gates перехода, отказывает, если хоть один не в `PASS`/`WAIVED`/`NOT_APPLICABLE`; при успехе пишет `gates{}`, `evidence[]`, `effective_policy_hash`; `APPROVED`/`MERGED` без `--ref` → `USAGE`; без `--force`; переходы назад — без gates, записываются |
| P-7 | Нет ни одной допустимой записи нужного kind → `BLOCKED` (controller `verify-incomplete`); запись есть, статус ≠ требуемому → `FAIL`. L0-gates без `requires_evidence` CLI считает сам; `BLOCKED` только без входа (не git, нет `openspec`) |
| P-8 | Команды `next` нет: `verify` и `status` печатают `controller_action`, `next`, `rule`; правила pack (три) не расширяются; входы 04 §4 вычисляются |
| P-9 | Группа 1 = CI-матрица (ubuntu + windows, Node 22, `npm i -g @fission-ai/openspec@1.13.1`, `npm i -g` из чекаута, `warrant validate` на fixture-проекте) + B3/B4/B5 + схемы A/B; группа 2 = `validate`/`status`; дальше по запросу |
| P-10 | CLI `0.3.0` + tag `v0.3.0`; pack `core-sdd` `0.2.0`, `kernel: ">=0.1 <0.4"`; `evidence_kinds` принимает строку и объект `{kind, metrics_schema}` |
| P-11 | I-52: skill вне проекта пишется в lock как `{ version, hash, source: "bundled", path: <относительно pack> }`; `source` — новое необязательное поле |
| P-12 | ADR-0023 «Frontend разработки самого WARRANT» в группе 1: код репозитория WARRANT в MVP пишут сессии Claude Code без guard; норма ADR-0018/0020 — для проектов под WARRANT и slice; адаптер `claude` — кандидат фазы 4 по S8; `amends: [ADR-0018]`; строки 12 §7 (первая и третья) закрываются |
| P-13 | Record `phase-2-core-sdd` остаётся `ARCHIVED_WITHOUT_TRANSITION` (ретро-запись подделала бы акт, ADR-0009) |
| P-14 | Плейсхолдеры `run.command`/`scoped_command`: `{out}`, `{paths}`, `{change}`; env-контрактов нет; `{base}` не вводится |
| P-15 | Attestation по окружению: локально `none`, под `GITHUB_ACTIONS` — `ci` с `ref` = URL run'а; workflow impl-PR запускает `warrant verify --transition VERIFYING->MERGED` и выгружает `.warrant/evidence/<change>/` artifact'ом; человек кладёт записи в archive-PR и пишет `transition MERGED --ref <run-url>`. Для `MERGED` «текущий commit» = commit evidence (`--commit <sha>`, default — свежайшая запись), обязан быть предком HEAD, все записи перехода на одном commit; L0-gates на том же commit, base = `merge-base(main, commit)` (уточнено I-97: точка ответвления) |
| P-16 | `analyze-clean` и `adversarial-review` для change фазы 3 закрываются двумя waiver-файлами maintainer'а в `.warrant/waivers/` (`risk: HIGH`, `expires_at` — конец фазы 4); `validate` получает семантику waiver: gate существует и `waivable`, change существует, `approved_by` ∈ `roles`, дата в будущем (иначе `EXPIRED`); gate даёт `WAIVED` шагом 4 |
| P-17 | Evidence `human-approval` создаёт `warrant transition <change> APPROVED\|MERGED --ref <URL review> --by <login>` (`produced_by: {human, <login>}`, `attestation: {human-review, ref}`); `--by` ∈ роли `approvals[]` policy; ссылку верифицирует `ci` (фаза 4) |
| P-18 | Критерий выхода фазы 3: (1) три golden получают `expected/verify.json` для `PROPOSED->SPECIFIED` (fake `openspec validate`); (2) `phase-3-verification` проходит `PROPOSED→…→ARCHIVED` только через `transition`/`archive` по P-2 с waiver'ами P-16 и CI-evidence P-15; (3) CI-матрица зелёная; (4) `status` репозитория — `stale[]` только у `phase-2-core-sdd`. Vertical slice — критерий MVP после фазы 4 (13 §2 поправить) |
| P-19 | `.warrant/evidence/<change>/manifest.json` + `<EVID>.json` коммитятся; raw — `{out}` = `.warrant/evidence/<change>/raw/<check-id>/`, не коммитится (`.gitignore`), запись ссылается `artifacts[{uri, sha256}]`; gate берёт свежайшую допустимую запись по kind, чистки нет; `WARRANT_STATE_DIR` переносит только `evidence/` и `runs/` |
| P-20 | Сигнатуры: `check <change> [id...] [--paths] [--base]`, `gate <change> [id...] [--transition] [--base]`, `verify <change> [--transition] [--base] [--paths]`; переход по умолчанию — следующий вперёд от `change_state`; код выхода `verify`/`gate` по `controller_action` (gate `FAIL` → `WAIT` → 2); `check` — 0 при записанном evidence (и `NOT_PROVEN`), 2 `BUSY`, 3 таймаут/конфигурация |

### Организационное — одна ветка, один worktree

**Правило: одна ветка — один worktree** (`git worktree add`); несколько сессий делят `D:\project\SRA`, поэтому перед
коммитом проверять ветку. Появилось после фазы 2: коммит `d2d8fd3` ушёл не в ту ветку, когда сессии переключали ветку
в общем каталоге. В фазе 3: `D:\project\SRA-phase3` — `spec/phase-3-verification`, `D:\project\SRA-phase3-impl` —
`worktree/phase-3-verification`; после archive-PR оба удалить. В phase-3b: D:\project\SRA-phase3b — spec/phase-3b (PR #10 смержен, можно удалить), D:\project\SRA-phase3b-impl — worktree/phase-3b (impl-PR #11). В test-levels: `spec/test-levels` — spec-PR #14 (смержен, ветку можно удалить); impl — `D:\project\SRA-test-levels-impl` (`worktree/test-levels`, PR #15 смержен), archive — `D:\project\SRA-test-levels-archive` (`archive/test-levels`); после merge archive-PR оба удалить.

## Backlog из ревью фазы 1

| # | Где | Дефект | Статус |
|---|---|---|---|
| B1 | `packs/loader.ts` `weakenings()` | strengthen-only не сравнивал `match` overlay и `extends` profile | закрыт фазой 2 (группа 3) |
| B2 | `packs/loader.ts` `loadLocalLayer()` | каталог pack в `.warrant/local/<id>/` вне `warrant.json` всасывался как pack `local` | закрыт фазой 2 (группа 3) |
| B3 | `packs/hash.ts` `checkLock()` | pack в lock без записи в `warrant.json` не давал `LOCK_MISMATCH` | закрыт фазой 3 (1.2) |
| B4 | `bin/warrant.ts` `run()` | `process.exit` сразу после записи envelope — обрезка вывода в pipe | закрыт фазой 3 (1.2, `process.exitCode`) |
| B5 | `openspec/yaml-emit.ts` `emitKey()` | ключи `null`/`true`/`false` без кавычек | закрыт фазой 3 (1.2) |
| B6 | `ids/scan.ts` | ложный `ID_DUPLICATE` main spec ↔ архивная delta | закрыт фазой 2 (I-46) |

Открытых пунктов нет; новые дефекты — в «Долг после фазы 3». В GitHub issues не дублировать без решения maintainer'а.

## Что уже решено (не обсуждать заново)

| Решение | Где |
|---|---|
| Стек: TypeScript на Node; bin `warrant`; не публикуется, `npm i -g <git-tag>` | ADR-0013 |
| Monorepo: `docs/`, `packages/cli/`, `packs/core-sdd/`, `sra/skills/`, `lattice/` | ADR-0013 |
| Команды фаз 1–3: `init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status`, `classify`, `check`, `gate`, `verify`, `transition`, `archive`; JSON-вывод, коды выхода 0/1/2/3 | 04 §7, 13 §2 |
| core-sdd: profiles `feature`, `chore`, `factory-change`; gates и checks из 06 §4 | ADR-0013, 05, 06 |
| Change record `.warrant/changes/<change>.json`; пишет только CLI | 04 §9, ADR-0009 |
| ID: `PREFIX-AREA-NNN` immutable с MERGED, ULID для EVID/RUN, реестр AREA, `warrant id renumber` | ADR-0012 |
| Доверие по ref, CI не пишет в репозиторий, bot-идентичность агента, forge = GitHub | ADR-0010 |
| Топология: spec-PR, impl-PR, archive-PR; `warrant archive` оборачивает `openspec archive`; gate `branch-isolated` | ADR-0011 |
| Enforcement Claude Code: static deny из `warrant sync` + hook `warrant guard`; reviewer = subagent; сам репозиторий WARRANT в MVP — без guard | ADR-0014, ADR-0023 |
| Все машинные файлы — JSON с `$schema` `warrant://<name>/<major>`; `warrant fmt` канонизирует | ADR-0006, 08 §7 |
| Тесты CLI: уровни `unit`/`app`/`contract`/`e2e`, порты процессов и `Ctx`, фейки с контрактом соответствия | ADR-0025 |

## Порядок работы — через OpenSpec (dogfooding)

Репозиторий ведётся **самим OpenSpec** (spike S2 → [ADR-0015](adr/WARRANT-ADR-0015-openspec-sync-contract.md)); фазы 1–3
пройдены по этой схеме. С фазы 3 change ведётся и **через `warrant`**: record, classify, evidence, transitions, archive.

**Модели и схема работы.** Сессия (координатор) — Fable: читает spec/design/tasks целиком, пишет субагенту полный prompt
(пути, REQ/SCN, конвенции кода, что уже есть), принимает отчёт, сам гоняет `npm test` и `npm run typecheck`, делает ручную
проверку команды, коммитит. Субагент — Agent tool, `model: "opus"`, одна группа задач, отчёт ≤ 70 строк с разделом
«Decisions/deviations». Sonnet не использовать. Ничего сверх tasks.md: новая потребность — сначала правка tasks/design,
потом код. Отклонения от spec/design — вопросом к maintainer'у, не молча; принятые — строкой I-N в design.md.

Конвенции кода: TypeScript ESM NodeNext (`.js` в импортах), strict + `exactOptionalPropertyTypes`;
`WarrantError(code, message, {path, exitCode})` из `core/errors.ts`; `success/failure/failures` из `io/output.ts`;
команды регистрируются в `src/bin/warrant.ts` через `register`, получают `Ctx` (`runX(ctx, …)`); процессы — только в
`src/adapters/**` через порты. Тесты (ADR-0025): команда — `test/app/commands/<cmd>.test.ts`, `invoke(() => runX(p.ctx, …))` с
`useProjectBuilder` и фейками; e2e — один-два теста на команду через `runCli` (`test/helpers/cli.ts`), первая строка файла
`// e2e: <reason>`; `skipIf` по openspec запрещён (`globalSetup` падает без openspec 1.13.1); `npm test` без флагов,
`npm run test:fast` — внутренний цикл; новый внешний вызов — метод порта + адаптер + фейк + сценарий контракта. JSON писать только через
`writeJsonFile` (`core/canon/format-json.ts`) или `warrant fmt`; код должен работать на Linux (CI ubuntu).

### Решения grilling фазы 2 (G-1…G-21) — реализованы

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

## Долг схем и CLI после ADR-0016…0022 — что осталось после фазы 3

Сделано в фазе 3: вся таблица A (поля схем `evidence`, `pack`, `check`, `config`, `waiver`, `change-record`), схема
`rule/1`, из C — `validate` (правила, `ID_IMMUTABLE`, цель `amends`/`supersedes`) и `status` (`amended_by[]`, доля правил
без `enforced_by`, D-22), из D — `check`, `gate`/`verify` (кроме `spec-approved` и `FRONTEND_HOOKS_INACTIVE`),
`transition` (`ABANDONED`). Ниже — только остаток.

### B. Новые схемы (фаза 4)

| Схема | Содержание | ADR |
|---|---|---|
| `run/1` | 03 §4: `change`, `operation`, `skill`, `write_scope[]`, `context_hash`, `run_state`, `guard_events[]`; `.warrant/runs/current`; путь через `WARRANT_STATE_DIR` (D-2, D-9) | 0014, 0017–0019, 0022 |
| `skill-result/1` | envelope 07 §4 для `run submit`; `codex exec --output-schema` пишет его (D-5, D-9) | 0013, 0020 |

Черновик первого набора правил `rule/1` (грилинг 2026-09-22; `text` — EN; в pack сейчас `rules: []`). Правило **о форме**
обязано иметь `enforced_by`, иначе это проза (INV-04); правило **о решении** может быть без него — доля таких видна в
`warrant status` (ADR-0022 п. 4).

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
`openspec-rules`. Когда правило `language-split` появится, `context` «Language: Russian…» уезжает из
`.warrant/local/openspec/rules.json` (INV-06).

### C. Существующие команды — остаток

| Команда | REQ | Добавить | ADR | Фаза |
|---|---|---|---|---|
| `validate` | REQ-KRN-021 | `--files`; висячие REQ / SCN; pragma mutation-инструментов; `AGENTS.md` побайтно и ≤ 16 KiB | 0019, 0022 | висячие REQ/SCN — 3b; `--files`, `AGENTS.md` — 4; pragma — 5 (V-1) |
| `status` | REQ-KRN-027 | finding `FRONTEND_HOOKS_INACTIVE` (D-14) | 0018 | 4 |
| `init` | REQ-KRN-023 | проверка `codex --version ≥ MIN` при генерации `.codex/hooks.json` (D-7) | 0018 | 4 |
| `sync` | REQ-KRN-025 | `.codex/hooks.json` (постоянная строка `warrant guard --frontend codex`), `AGENTS.md` | 0018, 0022 | 4 |

### D. Новые команды — остаток

| Команда | Требования | Фаза |
|---|---|---|
| `check` | `--wait`, `local: ci-only`, `max_paths`, авто-снятие замка мёртвого pid — later (D-23); исполнение `execution.local`/`guard_prefixes` | `local` — 3b; `guard_prefixes` — 4; остальное later (V-1) |
| `gate` / `verify` | gate `spec-approved` транспортно-нейтральный (D-3); отпечатки `targets` в пред-фильтре (D-10, D-12); finding `FRONTEND_HOOKS_INACTIVE` (D-14) | `spec-approved` — 3b (V-9); `targets` — 5; `FRONTEND_HOOKS_INACTIVE` — 4 |
| `waive` | создание waiver-файла; частичный `targets[]` | создание — 3b; `targets[]` — 5 (V-1) |
| `analyze` | `STALE` для неприменимого target waiver; обратные ссылки; TASK ↔ sef item | 4 (V-1) |
| `link` | `--amends` / `--supersedes`, до `APPROVED` | 3b (0021) |
| `ci` | verdict impl-PR по evidence CI вместо ручного переноса artifact'а | 4 |
| `run start` | Context Pack и JSON-вывод с `rules[]` по `write_scope` | 4 (0022) |
| `guard` | нормализованный контракт pre / post, `--frontend codex`; без Run → `deny`; `guard_prefixes`; hints через `additionalContext`, текст правил раз за Run; `guard_events[]` | 4 (0017–0019, 0022) |

### E. Не фаз 3–4

| Что | Когда |
|---|---|
| `attestation_type` `sef-approval`, `sef-gate` (enum в `common.1`); gate `spec-approved` в `sef-hub`; `analyze` TASK ↔ sef item; `SEF_PROTECTED_DRIFT`; forge `sef-hub` | срез S1 SEF (ADR-0020, proposed; черновик SEF предварительный) |
| pack `bdd-tdd`: check `mutation`, parser в mutation-testing-report-schema, фильтр по diff, lint pragma | фаза 5 (0016); инструмент — spike S7 |
| floor по размеру diff, pack `ui`, `dismissed[]` в skill-result | later по триггерам ([13 §3](13-roadmap.md)) |

### Карта агента — итог плана 2026-09-22

Шаги 1–2 плана (закрыть фазу 2, влить ветку ADR-0016…0022) выполнены; шаг 3 — change `agent-session-guide` (`CLAUDE.md`,
`.claude/settings.json`, `preflight`) — **пропущен** решением P-1 (`preflight` = `warrant verify`); шаг 4 — фаза 3.
Пункт `rules.design` про `I-N` в pack `core-sdd` сделан (1.4). Критерий на будущее: файл в `.claude/` автоматизирует
**процедуру**, **правило** туда не пишется никогда (каналы правил — ADR-0022).

### Не потерять

- При ревизии черновика SEF ([integrations/2026-09-17-sef-platform-design.md](integrations/2026-09-17-sef-platform-design.md),
  предварительный) сверить его с [11 §2](11-integrations.md) «Требования WARRANT к SEF» и ADR-0020 п. 8–14 (`proposed`):
  approval без hash spec, `source_ref` TASK ↔ item, один тестовый гейт `warrant verify`, `warrant transition` в
  `sef work approve` и `landing`, archive в `landing`, `protected[]` ⊇ пути WARRANT, `AGENTS.md` и `.codex/hooks.json`
  в эталоне `.sef/engines/<profile>/`.
- Решение, отданное по умолчанию: `attestation_type` `sef-*` — со срезом S1 SEF.

### Ревью ADR — образец запроса (выполнен 2026-09-22 для ADR-0016…0022)

Находки L1-1…L1-11, F-1…F-28; решения D-1…D-25 — ниже. Для следующих ADR заменить номера и ветку.

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
| D-3 | Gate `spec-approved` — транспортно-нейтральный, core-sdd, переход `VERIFYING→MERGED` (в `github` — CI impl-PR, в `sef-hub` — lane/integration): hash дерева `{proposal.md, design.md, specs/**}` на коммите из ref `APPROVED` ↔ на base; `tasks.md` исключён. Новых полей record нет. **Уточнено V-9** ([ADR-0024](adr/WARRANT-ADR-0024-spec-approved-contract.md)): дерево без `design.md`, gate `waivable: true` | Q-3, F-6, F-18 | ADR-0020 п. 9; 06 §4; долг D `gate` |
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

Правки по решениям внесены коммитами `737312b` (D-24), `a1fc129` (ADR-0016), `fdc9a9b` (ADR-0017/0019/0022),
`9d597f5` (ADR-0018), `f449f84` (ADR-0020), `e582c2d` (ADR-0021); D-8 и D-25 — без правок ADR.

## Чего не делать

- Не реализовывать `guard`, `ci`, `run` вне фазы 4; `analyze` — фаза 4 (V-1).
- Не мержить impl-PR squash'ем или rebase'ом: commit CI-evidence должен стать предком `main` (I-97).
- Не коммитить `.warrant/evidence/**/raw/` и не писать record/evidence руками — только CLI (ADR-0009).
- Не добавлять profiles `bugfix`, `refactor`, `experiment`: без failure mode (ADR-0013).
- Не трогать `docs/integrations/`, `lattice/`: не на критическом пути.
- Не изобретать второй формат конфигурации: `warrant.json` — единственная точка (08 §3).
- Изменение любого нормативного документа во время реализации — только через новый ADR, не молча.

## Контекст для агента

SEF (Software Factory): OpenSpec — specification kernel (stock, без форка); WARRANT — governance, этот проект;
LATTICE — субстрат объектов (`../lattice/`); SRA — reasoning (skills); JEV — classifier без authority.
Документы RU с EN-терминами, машинные файлы JSON. Перед большими переписываниями — обсуждать с пользователем.
