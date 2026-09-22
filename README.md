# WARRANT — Specification Governance

Слой управления спецификациями SEF: вычисляет политику, открывает переходы (gates), принимает evidence.
Работает поверх OpenSpec.

Документация: [docs/00-readme.md](docs/00-readme.md) · Решения: [docs/adr/](docs/adr/README.md)

## Установка CLI

Пакет не публикуется в npm ([ADR-0013](docs/adr/WARRANT-ADR-0013-mvp-refinement.md)). Устанавливается глобально из git-тега
или из локального чекаута; `prepare` собирает `packages/cli/dist/`:

```bash
npm i -g "git+https://github.com/<owner>/SRA.git#<tag>"
```

```bash
npm i -g D:\project\SRA
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

| Команда | Состояние |
|---|---|
| `warrant validate [--no-generated]` | реализована (проверки 1, 2, 3, 5, 6; 4 и 7 — в `data.skipped`) |
| `warrant fmt`, `init`, `id`, `sync`, `resolve`, `status` | заглушки, задачи групп 4–9 Change `phase-1-kernel` |

Все команды печатают один JSON-объект `{ command, ok, change?, data, errors }`; коды выхода `0 / 1 / 2 / 3`
([04 §7](docs/04-lifecycle.md)).

## Структура

```text
docs/           нормативные документы и ADR
openspec/       OpenSpec: specs и changes этого репозитория
packages/cli/   код CLI (TypeScript, ESM) и JSON Schemas warrant://<name>/<major>
packs/core-sdd/ bundled pack
.warrant/       конфигурация WARRANT этого репозитория
```
