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
git clone --branch <tag> <git-url> warrant && cd warrant && npm install && npm pack && npm i -g ./warrant-0.1.0.tgz
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

## Команды фазы 1

Все команды Change `phase-1-kernel` реализованы (REQ-KRN-021…027). Каждая печатает один JSON-объект
`{ command, ok, change?, data, errors }`; коды выхода `0 / 1 / 2 / 3` ([04 §7](docs/04-lifecycle.md)).

| Команда | Что делает |
|---|---|
| `warrant init [--force]` | создаёт `.warrant/` (`warrant.json`, `local/areas.json`, `local/openspec/rules.json`, каталоги), затем `sync` |
| `warrant init change <name>` | `openspec new change` + record `.warrant/changes/<name>.json` в `PROPOSED`; имя проверяется по records и archive |
| `warrant validate [--no-generated]` | семь проверок REQ-KRN-021: схемы, lock, packs, generated, ID, секреты, каноничность |
| `warrant fmt [paths...] [--check]` | каноническая форма JSON (порядок ключей по схеме, LF, отступ 2) |
| `warrant id <PREFIX> <AREA>` · `id EVID` · `id RUN` · `id WAV` · `id renumber <old> <new> --change <c>` | стабильные ID ([ADR-0012](docs/adr/WARRANT-ADR-0012-id-allocation.md)) |
| `warrant sync [--check]` | генерирует `openspec/config.yaml`, `openspec/schemas/<schema>/**`, копии схем, lock ([ADR-0015](docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md)) |
| `warrant resolve <change> [--explain] [--classification <file>]` | effective policy; конфликт → `controller_action: ESCALATE`, код 2 |
| `warrant status [change]` | состояние record, `effective_policy.{hash,sources}`, artifacts OpenSpec, `stale[]` |

Типовой сценарий в новом проекте:

```bash
openspec init --tools none && warrant init && warrant init change demo && warrant validate && warrant status demo
```

Решения, принятые по ходу реализации (I-1…I-42), — в [design.md](openspec/changes/phase-1-kernel/design.md) Change `phase-1-kernel`.

## Структура

```text
docs/           нормативные документы и ADR
openspec/       OpenSpec: specs и changes этого репозитория
packages/cli/   код CLI (TypeScript, ESM) и JSON Schemas warrant://<name>/<major>
packs/core-sdd/ bundled pack
.warrant/       конфигурация WARRANT этого репозитория
```
