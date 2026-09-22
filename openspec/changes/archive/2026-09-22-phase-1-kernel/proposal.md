# Proposal: phase-1-kernel

## Why

Спроектированы документы 01–08 и ADR-0001…0015, но кода нет: ни одной JSON Schema `warrant://*`, ни одной
команды `warrant`. Без kernel нельзя ни валидировать pack `core-sdd` (фаза 2), ни проверить на практике,
что контракты из документов реализуемы. Фаза 1 ([13 §2](../../../docs/13-roadmap.md)) — минимальный kernel:
схемы контрактов и семь команд CLI, без verification, gates и frontend.

Цель: `warrant validate` проходит на pack `core-sdd` и на sample-проекте после `warrant init`.

## What Changes

- **JSON Schemas kernel** (`warrant://<name>/1`, [ADR-0006](../../../docs/adr/WARRANT-ADR-0006-json-conventions.md)):
  `config`, `lock`, `pack`, `profile`, `overlay`, `gate`, `check`, `change-record`, `evidence`, `evidence-manifest`,
  `controller-rules`, `risk-floor`, `risk-levels`, `openspec-rules`, `openspec-schema`, `waiver`, `areas`.
- **CLI `warrant`** (TypeScript, [ADR-0013](../../../docs/adr/WARRANT-ADR-0013-mvp-refinement.md)), команды фазы 1:
  `init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status`. JSON-вывод по контракту [04 §7](../../../docs/04-lifecycle.md),
  коды выхода `0 / 1 / 2 / 3`.
- **Monorepo layout**: `packages/cli/` (код и схемы), `packs/core-sdd/` (в фазе 1 — только манифест и
  минимум, достаточный для `warrant validate`; profiles `feature`, `chore`, `factory-change` — фаза 2).
- **Resolver** как чистая функция: classification + packs + local → effective policy с `hash`, `sources`, `explain`;
  golden cases в тестах ([12 §2](../../../docs/12-evolution.md)).
- **Генерация OpenSpec-файлов** по [ADR-0015](../../../docs/adr/WARRANT-ADR-0015-openspec-sync-contract.md):
  `config.yaml`, `schema.yaml`, templates; lock.

## Non-Goals

- Команды `check`, `gate`, `verify`, `analyze`, `next`, `run`, `guard`, `ci`, `transition`, `sync-state`,
  `archive`, `classify`, `unknown`, `assumption`, `waive` — фазы 2–4.
- Profiles `bugfix`, `refactor`, `experiment` — без failure mode (ADR-0013).
- Генерация `.claude/settings.json` и `.claude/agents/**` — фаза 4 (ADR-0014).
- Schema `warrant://run/1` и `warrant://skill-*` контракты — вместе с `warrant run` (фаза 3) и [07](../../../docs/07-skills.md).
- Публикация на npm; интеграции LATTICE / JEV / SEF; `docs/integrations/`, `lattice/`.
- Golden changes целиком (`golden/feature-with-bdd` и т.д.) — фаза 2; в фазе 1 только golden cases resolver'а.

## Capabilities

### New Capabilities

- `kernel` — контракты JSON Schema и команды CLI фазы 1. AREA `KRN` ([ADR-0012 §5](../../../docs/adr/WARRANT-ADR-0012-id-allocation.md)).

### Modified Capabilities

Нет.

## Impact

- Новые каталоги `packages/cli/`, `packs/core-sdd/`; корневой `package.json` (workspaces) и `README.md`.
- Документы не меняются. Любое расхождение реализации с 02–08 — новый ADR, не молчаливая правка.
- В этом репозитории `openspec/config.yaml` ведётся вручную до появления `warrant sync` (ADR-0015 п. 7).

## Risks

- Схемы, написанные до pack'а, могут не выдержать реального `core-sdd` (фаза 2) → все схемы `major = 1`,
  правки внутри фазы 2 без bump; несовместимые — новый major.
- Побайтная генерация YAML хрупка при обновлении OpenSpec → `openspec` в `warrant.json` фиксирует минор, `validate` сообщает расхождение версии.
- Scope creep в `validate` (проверки ID) → только то, что нужно для `warrant id`; gate `ids-valid` — фаза 3.

## Verification

- Тесты схем: каждый пример из документов 04–08 валиден; каждая обязательная ошибка отклоняется с путём.
- Golden cases `resolve`: вход (classification + packs) → ожидаемая effective policy; детерминизм hash.
- Критерий выхода: `warrant validate` → `ok: true`, exit 0 на `packs/core-sdd/` и на sample-проекте после `warrant init`.

## Решения review

Все семь вопросов закрыты maintainer'ом на review 2026-09-22 (в чате сессии; PR не было — CLI ещё нет).
`UNK-KRN-001…007` разрешены в `DECISION`:

> **DECISION** `UNK-KRN-001` — `warrant init change <name>` входит в фазу 1.

> **DECISION** `UNK-KRN-002` — Схемы `lock`, `areas`, `openspec-schema` входят в фазу 1; `run/1` — фаза 3.

> **DECISION** `UNK-KRN-003` — Packs в MVP: только bundled с CLI (`packs/` monorepo) + `.warrant/local/`. Без `paths.packs` и registry.

> **DECISION** `UNK-KRN-004` — `warrant validate` проверяет stable ID уже в фазе 1 (подмножество будущего `ids-valid`).

> **DECISION** `UNK-KRN-005` — Mapping схем для редакторов = копии `.warrant/schemas/<name>.<major>.schema.json`; `.vscode/` не трогается.

> **DECISION** `UNK-KRN-006` — Одна capability `kernel`, одна AREA `KRN`.

> **DECISION** `UNK-KRN-007` — `.warrant/local/areas.json` создан вручную в этом репозитории до появления `warrant init`.
