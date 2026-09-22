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
git clone --branch <tag> <git-url> warrant && cd warrant && npm install && npm pack && npm i -g ./warrant-0.2.0.tgz
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

Реализованы команды фаз 1 (`phase-1-kernel`, REQ-KRN-021…027) и 2 (`phase-2-core-sdd`, REQ-KRN-028). Каждая печатает
один JSON-объект `{ command, ok, change?, data, errors }`; коды выхода `0 / 1 / 2 / 3` ([04 §7](docs/04-lifecycle.md)).

| Команда | Что делает |
|---|---|
| `warrant init [--force]` | создаёт `.warrant/` (`warrant.json`, `local/areas.json`, `local/openspec/rules.json`, каталоги), затем `sync` |
| `warrant init change <name>` | `openspec new change` + record `.warrant/changes/<name>.json` в `PROPOSED`; имя проверяется по records и archive |
| `warrant validate` | семь проверок REQ-KRN-021: схемы, lock, packs, generated, ID, секреты, каноничность |
| `warrant fmt [paths...] [--check]` | каноническая форма JSON (порядок ключей по схеме, LF, отступ 2) |
| `warrant id <PREFIX> <AREA>` · `id EVID` · `id RUN` · `id WAV` · `id renumber <old> <new> --change <c>` | стабильные ID ([ADR-0012](docs/adr/WARRANT-ADR-0012-id-allocation.md)) |
| `warrant sync [--check]` | генерирует `openspec/config.yaml` целиком, `openspec/schemas/<schema>/**`, копии схем, lock ([ADR-0015](docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md)) |
| `warrant classify <change> [--base <ref>] [--paths <file>] [--propose <json>]` | classification change'а: floor rules pack'ов по diff (`--base`) или по списку путей (`--paths`), предложения — `--propose`; максимум по каждому измерению, источник каждого значения в `from`, отклонённые предложения — в `ignored[]`; пишет `classification` в record (REQ-KRN-028) |
| `warrant resolve <change> [--explain] [--classification <file>]` | effective policy; конфликт → `controller_action: ESCALATE`, код 2 |
| `warrant status [change]` | состояние record, `effective_policy.{hash,sources}`, artifacts OpenSpec, `stale[]` |

Типовой сценарий в новом проекте:

```bash
openspec init --tools none && warrant init && warrant init change demo && warrant validate && warrant status demo
```

`openspec/config.yaml` генерируется `warrant sync` **целиком**: ручных секций в нём нет, любая правка файла — находка
`GENERATED_DRIFT` в `warrant validate`. Флаг `--no-generated` удалён в фазе 2 (решение G-5). Языковые и прочие проектные
дополнения к rules кладутся в `.warrant/local/openspec/rules.json` — pack языково-нейтрален.

Решения, принятые по ходу реализации: I-1…I-42 — в [design.md](openspec/changes/phase-1-kernel/design.md) Change
`phase-1-kernel`, I-45…I-65 — в [design.md](openspec/changes/phase-2-core-sdd/design.md) Change `phase-2-core-sdd`.

## Golden

`packs/core-sdd/golden/<profile>/` — три эталонных проекта (`feature`, `chore`, `factory-change`): change record с полной
classification, artifacts и снимки `expected/*.json` — `resolve --explain`, `status` и lock после `sync`. Это snapshot
**effective policy** pack'а: какие gates, approvals, evidence и `risk_level` получает каждый профиль (13 §2, решение G-1).
Прогон самих gates — фаза 3.

```bash
npm run golden:update
```

Скрипт копирует каждую фикстуру во временный проект, прогоняет `sync`, `resolve --explain` и `status`, канонически
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
.warrant/       конфигурация WARRANT этого репозитория
```
