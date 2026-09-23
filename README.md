# WARRANT — Specification Governance

Слой управления спецификациями SEF: вычисляет политику, открывает переходы (gates), принимает evidence.
Работает поверх OpenSpec.

Документация: [docs/00-readme.md](docs/00-readme.md) · Решения: [docs/adr/](docs/adr/README.md)

## Установка CLI

Пакет не публикуется в npm ([ADR-0013](docs/adr/WARRANT-ADR-0013-mvp-refinement.md)). Два проверенных способа
(design phase-1-kernel, D-1 и I-11):

Из локального чекаута (symlink на каталог, `prepare` собирает `packages/cli/dist/`):

```bash
npm i -g D:\project\SRA
```

Из git-тега через tarball (`npm i -g <git-url>#<tag>` напрямую на npm 10 / Windows кладёт пустое дерево — баг pacote):

```bash
git clone --branch <tag> <git-url> warrant && cd warrant && npm install && npm pack && npm i -g ./warrant-0.3.0.tgz
```

Проверка: `warrant --version`. Требуется Node ≥ 20.19 и `openspec` 1.13.x на PATH.

## Разработка

```bash
npm install
```

```bash
npm test
```

`npm run build` собирает CLI, `npm run typecheck` — проверка типов без сборки. Тесты — vitest, `packages/cli/test/`.

## Команды

Реализованы команды фаз 1 (`phase-1-kernel`, REQ-KRN-021…027), 2 (`phase-2-core-sdd`, REQ-KRN-028) и 3
(`phase-3-verification`, REQ-VER-001…008). Каждая печатает один JSON-объект `{ command, ok, change?, data, errors }`;
коды выхода `0 / 1 / 2 / 3` ([04 §7](docs/04-lifecycle.md)).

| Команда | Что делает |
|---|---|
| `warrant init [--force]` | создаёт `.warrant/` (`warrant.json`, `local/areas.json`, `local/openspec/rules.json`, каталоги), затем `sync` |
| `warrant init change <name>` | `openspec new change` + record `.warrant/changes/<name>.json` в `PROPOSED`; имя проверяется по records и archive |
| `warrant validate` | семь проверок REQ-KRN-021: схемы, lock, packs, generated, ID, секреты, каноничность |
| `warrant fmt [paths...] [--check]` | каноническая форма JSON (порядок ключей по схеме, LF, отступ 2) |
| `warrant id <PREFIX> <AREA>` · `id EVID` · `id RUN` · `id WAV` · `id renumber <old> <new> --change <c>` | стабильные ID ([ADR-0012](docs/adr/WARRANT-ADR-0012-id-allocation.md)) |
| `warrant sync [--check]` | генерирует `openspec/config.yaml` целиком, `openspec/schemas/<schema>/**`, копии схем, lock ([ADR-0015](docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md)) |
| `warrant classify <change> [--base <ref>] [--paths <file>] [--propose <json>]` | classification change'а: floor rules pack'ов по diff (`--base`) или по списку путей (`--paths`), предложения — `--propose`; максимум по каждому измерению, источник каждого значения в `from`, отклонённые предложения — в `ignored[]`; пишет `classification` в record (REQ-KRN-028) |
| `warrant classify <change> --set <dim>=<value> [--set profile=<id>] --by <login>` | human-источник classification: только повышение или подтверждение (`from: human:<login>`), ниже floor — `BELOW_FLOOR`, login вне `roles` — `ROLE_REQUIRED` |
| `warrant resolve <change> [--explain] [--classification <file>]` | effective policy; конфликт → `controller_action: ESCALATE`, код 2 |
| `warrant status [change]` | состояние record, `effective_policy.{hash,sources,risk_level}`, artifacts OpenSpec, `stale[]`, `verification` — verdicts следующего перехода по записанному evidence (checks не запускаются) |
| `warrant check <change> [id...] [--paths a,b] [--base <ref>]` | запускает checks (по умолчанию — нужные gates следующего перехода) без shell, с замком `exclusive` и `timeout_s`; пишет evidence `.warrant/evidence/<change>/EVID-*.json` и `manifest.json`, сырой вывод — в `raw/` (не коммитится). Код 0 при записанном evidence, даже `NOT_PROVEN`; 2 — `BUSY`; 3 — таймаут или check не настроен |
| `warrant gate <change> [id...] [--transition <FROM->TO>] [--base <ref>]` | verdicts gates перехода по записанному evidence (пред-фильтр `STALE` по commit/base), `findings[]`, решение controller; код по `controller_action` (`CONTINUE` 0, `STOP` 1, `WAIT`/`ESCALATE` 2) |
| `warrant verify <change> [--transition <FROM->TO>] [--base <ref>] [--paths a,b]` | `check` → `gate` → controller одним вызовом; упавший check делает свои gates `BLOCKED`, код — максимум |
| `warrant transition <change> <STATE> [--ref <url>] [--by <login>] [--commit <sha>]` | пишет переход в record, если все gates перехода `PASS`/`WAIVED`/`NOT_APPLICABLE` (иначе `GATES_NOT_PASSED`); `APPROVED`/`MERGED` требуют `--ref`, gate `human-approval` — `--by` (пишется evidence `human-approval`); `MERGED` судится на commit evidence (`--commit`, по умолчанию — свежайшая запись), который должен быть влит в HEAD; назад и `ABANDONED` — без gates |
| `warrant archive <change>` | только из `MERGED`: `openspec validate --strict`, gates `MERGED->ARCHIVED`, `openspec archive`, переход `ARCHIVED`; record замораживается |

Типовой сценарий в новом проекте:

```bash
openspec init --tools none && warrant init && warrant init change demo && warrant validate && warrant status demo
```

`openspec/config.yaml` генерируется `warrant sync` **целиком**: ручных секций в нём нет, любая правка файла — находка
`GENERATED_DRIFT` в `warrant validate`. Флаг `--no-generated` удалён в фазе 2 (решение G-5). Языковые и прочие проектные
дополнения к rules кладутся в `.warrant/local/openspec/rules.json` — pack языково-нейтрален.

Решения, принятые по ходу реализации: I-1…I-42 — в [design.md](openspec/changes/archive/2026-09-22-phase-1-kernel/design.md)
Change `phase-1-kernel`, I-45…I-65 — в [design.md](openspec/changes/archive/2026-09-22-phase-2-core-sdd/design.md) Change
`phase-2-core-sdd`, I-66…I-97 — в design.md Change `phase-3-verification` (после archive — в `openspec/changes/archive/`).

## Порядок работы с change

Топология [ADR-0011](docs/adr/WARRANT-ADR-0011-pr-topology.md): три PR на change, одна ветка — один worktree. Evidence и
record пишет только CLI; сырой вывод checks (`.warrant/evidence/**/raw/`) в git не попадает.

1. **spec-PR** (`spec/<change>`): `warrant init change <change>`, `warrant classify <change>`, артефакты OpenSpec,
   `warrant verify <change>` (переход `PROPOSED->SPECIFIED`), `warrant transition <change> SPECIFIED`. Review PR, merge.
2. **impl-PR** (`worktree/<change>`): первым коммитом — `warrant transition <change> APPROVED --ref <url review spec-PR> --by <login>`
   и `warrant transition <change> IMPLEMENTING` (gate `branch-isolated`: не на `main`); код; последним коммитом —
   `warrant transition <change> VERIFYING`. Gate, которому нечем произвести evidence, закрывается waiver'ом maintainer'а
   в `.warrant/waivers/WAV-<год>-NNN.json` (`ACTIVE`, срок, `risk`, `compensating_controls`). CI-job `evidence` на PR
   запускает `warrant verify <change> --transition VERIFYING->MERGED --base <точка ответвления>` и выгружает artifact
   `evidence-<change>` — записи с `attestation.type: "ci"`; `WAIT` не роняет PR. impl-PR вливается **только «Create a merge
   commit»**: после squash или rebase commit evidence не станет предком `main` (`COMMIT_NOT_MERGED`, I-97).
3. **archive-PR** (`archive/<change>`, от `main` после merge impl-PR): скачать artifact CI-job `evidence` impl-PR, положить
   `manifest.json` и `EVID-*.json` в `.warrant/evidence/<change>/` (`raw/` не нужен), затем

   ```bash
   warrant transition <change> MERGED --ref <url run CI> --commit <head impl-PR> --by <login>
   warrant archive <change>
   ```

   и открыть PR. `--by` нужен, если policy ставит gate `human-approval` на `VERIFYING->MERGED` (profile `factory-change`, risk `HIGH`).

`warrant status <change>` в любой момент показывает следующий переход, его verdicts и `next`.

## Golden

`packs/core-sdd/golden/<profile>/` — три эталонных проекта (`feature`, `chore`, `factory-change`): change record с полной
classification, artifacts и снимки `expected/*.json` — `resolve --explain`, `status` и lock после `sync`. Это snapshot
**effective policy** pack'а: какие gates, approvals, evidence и `risk_level` получает каждый профиль (13 §2, решение G-1),
и `expected/verify.json` — прогон `verify` на `PROPOSED->SPECIFIED` с fake `openspec validate` (P-18).

```bash
npm run golden:update
```

Скрипт копирует каждую фикстуру во временный проект, прогоняет `sync`, `resolve --explain`, `status` и `verify`, канонически
переписывает `expected/*.json` без volatile-полей и печатает `written[]` — список изменившихся снимков. Обновлять нужно
после любой правки объектов pack (profiles, overlays, gates, checks, controller rules) или вывода этих команд: сравнение
снимков побайтно делает e2e-тест `golden.test.ts`, и без обновления `npm test` краснеет. Пустой `written: []` означает,
что политика не изменилась. Каталог `golden/` не входит ни в `provides` pack'а, ни в `packContentHash` (I-59), ни в
устанавливаемый пакет (I-65).

## Структура

```text
docs/           нормативные документы и ADR
openspec/       OpenSpec: specs и changes этого репозитория
packages/cli/   код CLI (TypeScript, ESM) и JSON Schemas warrant://<name>/<major>
packs/core-sdd/ bundled pack: overlays, profiles, gates, checks, controller, golden
sra/skills/     skills, объявленные packs через provides.skills (adversarial-review)
scripts/        build.js, golden-lib.js, golden-update.js
.warrant/       конфигурация WARRANT этого репозитория: records, evidence, waivers, override check tests-passed
.github/        CI: job test (ubuntu + windows), job evidence для impl-PR (worktree/*)
```
