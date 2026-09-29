# Proposal: ci-shards

## Why

Job `test (windows-latest)` workflow `ci.yml` идёт около 5 мин против 2,5 на ubuntu и держит каждый PR: `warrant / warrant` — 20 с, ubuntu — 2,5 мин, остальное время ждут windows. Пробный прогон PR #95 с двумя shard `vitest` на windows: 3 мин 30 с и 2 мин 41 с вместо 5 мин 9 с, покрытие то же. Правка `ci.yml` — policy path `factory-change`: только Change.

## What Changes

- `ci.yml`, job `test`: ubuntu — один job, как сейчас; windows — два параллельных job `vitest --shard` (`1/2`, `2/2`), вместе — все файлы всех уровней (ADR-0025 п. 8).
- Имена проверок: `test (ubuntu-latest)`, `test (windows-latest, 1/2)`, `test (windows-latest, 2/2)`.
- Typecheck и `warrant validate` (репозиторий и фикстура) — один раз на ОС: ubuntu и shard `1/2`.
- **Версии:** без изменений — `ci.yml` и тесты не поставляются.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`: REQ-VER-015 — job `test` репозитория по shard; SCN-VER-124.

## Non-Goals

- **Shard на ubuntu** — ubuntu не на критическом пути (2,5 мин против 3,5 у windows shard).
- **Job-агрегатор под одно имя обязательной проверки** — лишний job ради неизменности списка; список обязательных проверок `main` обновляет maintainer один раз.
- **Автоматический archive-PR и тег** — отдельное решение (ADR-0011).

## Impact

- `.github/workflows/ci.yml` — job `test`: `matrix.include` с `shard`, имя с shard, `npm test -- --shard`, условия шагов typecheck и validate.
- `packages/cli/test/unit/meta/workflows.test.ts` — SCN-VER-124.
- Branch protection `main` (вне репозитория): обязательные проверки `test (windows-latest, 1/2)`, `test (windows-latest, 2/2)` вместо `test (windows-latest)` — maintainer, до merge impl-PR.
