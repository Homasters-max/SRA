---
id: WARRANT-NEXT
title: WARRANT — следующий шаг: закрытие фазы 3, вход в phase-3b / фазу 4
status: informative
maturity: MVP
version: 0.3.0
---

# WARRANT — что делать в следующей сессии

Файл передачи контекста. Прочитать первым, затем [00-readme](00-readme.md).

## Состояние на 2026-09-23

- **Фазы 1 и 2 закрыты**: `phase-1-kernel` и `phase-2-core-sdd` заархивированы (`openspec/changes/archive/2026-09-22-*`,
  main specs `openspec/specs/{kernel,core-sdd}/spec.md`), tag `v0.2.0`. Record `phase-2-core-sdd` остаётся
  `ARCHIVED_WITHOUT_TRANSITION` (P-13) — единственный ожидаемый `stale[]`.
- **Фаза 3 закрыта** — change `phase-3-verification` прошёл `PROPOSED → … → ARCHIVED` только через `warrant transition` /
  `warrant archive` (P-18 (2)): spec-PR #6, impl-PR #7 (`worktree/phase-3-verification`, merge commit `ea3b856`, impl-head
  `bd1e829`), archive-PR `archive/phase-3-verification` (evidence CI run 35881659520, `transition MERGED --commit bd1e829`,
  `warrant archive`), tag `v0.3.0`. Решения по ходу реализации **I-66…I-101** — таблица в конце design.md архива
  `openspec/changes/archive/<date>-phase-3-verification/`. Версии: CLI **0.3.0**, pack `core-sdd` **0.2.0**
  (`kernel: ">=0.1 <0.4"`), `.warrant/warrant.json` `kernel: "0.3"`.
- **Первый прогон на Linux** (CI impl-PR) нашёл два дефекта, невидимых на Windows: I-100 (prefix проекта через
  `path.relative` к `--show-toplevel` обнулял diff при 8.3-имени/symlink temp-каталога → `scope-valid` ложно `PASS`) и I-101
  (обёртка fake `openspec` в тестах звала внешний `dirname` при PATH только из fake). Оба исправлены в impl-PR; CI зелёный
  на ubuntu и windows — 616/616, 0 skipped (P-18 (3)).
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
| I-77 | Удаление ID delta'ой `REMOVED` в коммите archive даёт `ID_IMMUTABLE` по проверке (9) `validate`: archive-коммит нужно сравнивать с архивной копией delta, как для MODIFIED (I-73) | phase-3b |
| I-90 | `branch-isolated` на detached HEAD — `FAIL`; в CI `pull_request` HEAD detached. Сейчас не мешает (gate на `APPROVED->IMPLEMENTING`, считается локально); пересмотреть по первому failure mode | по failure mode |
| I-93 | `transition` пишет `by: "cli:local"` и на `APPROVED`/`MERGED` (REQ-VER-007), а 04 §9 называет такую запись невалидной — противоречие нормы и spec; 04 §9 не правился | ADR или правка 04 §9 |
| `files` | `package.json` `files` не включает `sra/`: установленный через `npm i -g` CLI не находит skill `adversarial-review` (bundled `provides.skills`) | quick fix + e2e на установленном пакете |
| 13 §2 | Строка фазы 3 всё ещё перечисляет `analyze` и `warrant link`, а по P-4 это `phase-3b`; поправить 13 §2 (и строку 4-й фазы, если `analyze` уйдёт туда) | с первым change phase-3b |
| P-2 | Порядок P-2 нарушен в фазе 3: spec-PR #6 смержен до появления `transition`, поэтому `SPECIFIED`/`APPROVED`/`IMPLEMENTING`/`VERIFYING` пишутся в impl-PR. Со следующего change — строго по ADR-0011 (`SPECIFIED` в spec-PR) | процесс |
| I-59 | `packContentHash` исключает `golden/` pack'а — пересмотреть, если golden начнёт влиять на policy | later |
| I-64 | `runCli` и `golden-lib.js` асинхронные; короткие `spawnSync` остались для `git` и `openspecAvailable()` | later |
| `analyze` | P-4 относит `analyze` к `phase-3b`, «Чего не делать» и таблица D ниже — к фазе 4; решить при нарезке | нарезка phase-3b |

### Вход в phase-3b / фазу 4

- **phase-3b** — вторая очередь P-4 (всё, что валидируется как поле, но не исполняется): `warrant link` (`--amends` /
  `--supersedes`, до `APPROVED`), поведение `waiver.targets[]` (D-10) и `warrant waive`, gate `spec-approved` (D-3),
  исполнение `execution.local` / `guard_prefixes`, `analyze` (см. долг), `validate --files`, проверки (d) висячие REQ/SCN и
  (f) pragma, `AGENTS.md` побайтно, понижение classification ниже floor с approval (P-5); плюс I-77.
- **Фаза 4** (MVP frontend, [13 §2](13-roadmap.md)): `sync` (`.codex/hooks.json`, `AGENTS.md`), `run start` / `run submit`,
  схемы `run/1` и `skill-result/1`, `guard` (pre/post, без Run → `deny`, D-4), `warrant ci` (verdict impl-PR вместо ручного
  переноса artifact'а), адаптер `codex` — после spike **S8** (hooks Codex под `codex-acp` и `codex exec`, 13 §3), finding
  `FRONTEND_HOOKS_INACTIVE` (D-14), producer'ы `analyze-clean` и `adversarial-review` (снимают WAV-2026-001/002).
- **Нарезка**: phase-3b — отдельный change по той же схеме (≤ 6 групп, ~30 задач, G-8), он же первый, который проходит
  P-2 без отступлений. Фаза 4 — после phase-3b или параллельно по S8; если S8 затягивается, `ci` и `run`/`guard`
  можно резать в два change.

### Продолжение — готовый запрос

```text
Прочитай docs/NEXT-SESSION.md целиком (состояние фазы 3, «Долг после фазы 3», «Вход в phase-3b / фазу 4», решения P-1…P-20,
«Долг схем и CLI» C–E, D-1…D-25), затем design.md архива phase-3-verification (таблица I-66…I-101), docs/13-roadmap.md §2 и
§3 (S8), ADR-0011, 0016, 0021. Фаза 3 закрыта: impl-PR и archive-PR смержены, tag v0.3.0.
Сначала — долг, не требующий spec: package.json files (sra/), 13 §2 (analyze/link → phase-3b). Затем решим нарезку:
/opsx:propose change `phase-3b` (link, targets[] и warrant waive, spec-approved, execution.local/guard_prefixes,
validate --files, (d)/(f), AGENTS.md, понижение ниже floor, I-77; analyze — по решению). Порядок P-2 строго: spec-PR с
transition SPECIFIED, impl-PR с APPROVED/IMPLEMENTING первым и VERIFYING последним коммитом, CI job evidence, archive-PR
с artifact'ом, merge impl-PR только merge commit. Потолок ≤ 6 групп, ~30 задач (G-8). Изменение REQ — delta spec, не молча.
Схема работы прежняя: координатор — ты (Fable), субагент Opus на группу, отчёт ≤ 70 строк с Decisions/deviations.
Одна ветка — один worktree. Отклонения от spec/design — вопросом ко мне; принятые — I-N в design.md.
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
`worktree/phase-3-verification`; после archive-PR оба удалить.

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
команды регистрируются в `src/bin/warrant.ts` через `register`; e2e через `test/helpers/cli.ts` (`runCli`, `makeTempDir`);
тесты, которым нужен `openspec`, — `it.skipIf(!openspecAvailable())` из `core/openspec/cli.ts`; JSON писать только через
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
| `validate` | REQ-KRN-021 | `--files`; висячие REQ / SCN; pragma mutation-инструментов; `AGENTS.md` побайтно и ≤ 16 KiB | 0019, 0022 | 3b |
| `status` | REQ-KRN-027 | finding `FRONTEND_HOOKS_INACTIVE` (D-14) | 0018 | 4 |
| `init` | REQ-KRN-023 | проверка `codex --version ≥ MIN` при генерации `.codex/hooks.json` (D-7) | 0018 | 4 |
| `sync` | REQ-KRN-025 | `.codex/hooks.json` (постоянная строка `warrant guard --frontend codex`), `AGENTS.md` | 0018, 0022 | 4 |

### D. Новые команды — остаток

| Команда | Требования | Фаза |
|---|---|---|
| `check` | `--wait`, `local: ci-only`, `max_paths`, авто-снятие замка мёртвого pid — later (D-23); исполнение `execution.local`/`guard_prefixes` | 3b / later |
| `gate` / `verify` | gate `spec-approved` транспортно-нейтральный (D-3); отпечатки `targets` в пред-фильтре (D-10, D-12); finding `FRONTEND_HOOKS_INACTIVE` (D-14) | 3b, 4 |
| `waive` | создание waiver-файла; частичный `targets[]` | 3b |
| `analyze` | `STALE` для неприменимого target waiver; обратные ссылки; TASK ↔ sef item | 3b или 4 (см. долг) |
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

Правки по решениям внесены коммитами `737312b` (D-24), `a1fc129` (ADR-0016), `fdc9a9b` (ADR-0017/0019/0022),
`9d597f5` (ADR-0018), `f449f84` (ADR-0020), `e582c2d` (ADR-0021); D-8 и D-25 — без правок ADR.

## Чего не делать

- Не реализовывать `guard`, `ci`, `run` вне фазы 4; `analyze` — только по решению нарезки (P-4 — `phase-3b`, раньше — фаза 4).
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
