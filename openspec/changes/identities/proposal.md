# Proposal: identities

## Why

Агент и maintainer работали под одним аккаунтом `Homasters-max` (WS-04, S1): merge, решение UNKNOWN и `human-approval`, выполненные агентом, `warrant ci` засчитывал как акты человека, а `SHARED_IDENTITY` оставался информационной находкой. 2026-09-29 maintainer завёл машинного пользователя `homasters` («WARRANT agent»): collaborator `Homasters-max/SRA` с `write`, classic PAT (`repo`, `workflow`) в `GH_TOKEN` среды Claude Code ([ADR-0049](../../../docs/adr/WARRANT-ADR-0049-flow.md) п. 3). Осталось объявить его судье: `identities.agents` в `.warrant/warrant.json` — policy-путь, только Change.

## What Changes

- `.warrant/warrant.json`: `identities.agents: [{ "login": "homasters", "kind": "machine-user", "description": … }]`.
- С этого merge судья (`core/ci/refs.ts`, `ci/decisions.ts`) отказывает ref `APPROVED` / `MERGED`, если PR слит агентом или автором PR, и решение UNKNOWN от агента; `SHARED_IDENTITY` пропадает. Код не меняется — поведение уже в spec (REQ-VER-011, ADR-0044 п. 3).
- Процесс: spec-PR и impl-PR сливает maintainer своим аккаунтом (ADR-0049 п. 2); archive-PR и docs/process-PR — бот `--auto`.
- **Версии:** без изменений — `.warrant/warrant.json` репозитория не поставляется.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

нет — поведение судьи с `identities.agents` уже в main spec `verification`; `.openspec.yaml` — `skip_specs: true`.

## Non-Goals

- **`identities.agents` в LATTICE** — сессия LATTICE, свой Change.
- **Проверка автора `--by` waiver и поиск UNKNOWN по границе слова** (остаток WS-04) — цикл 1.
- **GitHub App** — BL-101.

## Impact

- `.warrant/warrant.json` — `identities`.
- `docs/handoff/stabilization.md`, `docs/backlog.md` (WS-04) — в archive-PR.
