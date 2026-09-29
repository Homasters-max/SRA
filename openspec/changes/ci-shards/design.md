# Design: ci-shards

## Context

База — `main` после PR #95 (`scripts/dev/check.js`, merge `--auto`). Change не трогает `packages/cli/src`: только workflow `ci.yml` и мета-тест workflow — архитектурный аудит не нужен.

Что уже есть:
- job `test` — matrix `os: [ubuntu-latest, windows-latest]`, шаги: PR form (только ubuntu), `npm test`, typecheck, `npm i -g .`, `warrant validate` репозитория и фикстуры `feature`;
- `npm test` = `npm run build && vitest run --config packages/cli/vitest.config.ts`: аргументы после `--` уходят `vitest`;
- замер PR #95 (тот же diff `ci.yml`): windows `1/2` — 3 мин 30 с, `2/2` — 2 мин 41 с, ubuntu — 2 мин 33 с; до правки windows — 5 мин 9 с.

Нормы: ADR-0025 п. 8 (все уровни на каждом PR, матрица ubuntu + windows), REQ-VER-014 (job `warrant` не меняется).

## Goals / Non-Goals

**Goals:**
- критический путь PR — не больше ~3,5 мин вместо ~5;
- покрытие то же: объединение shard — все файлы тестов всех уровней.

**Non-Goals:** — proposal, раздел Non-Goals.

## Decisions

### 1. Решения

| # | Решение |
|---|---|
| D1 | Два shard на windows (`vitest --shard=k/2`): замер PR #95; три — ещё один job на ~1 мин установки ради ~40 с |
| D2 | Typecheck и validate — в shard `1/2` (условие `matrix.shard != '2/2'`): один раз на ОС, как раньше |
| D3 | Без job-агрегатора: имена проверок с shard, обязательные проверки `main` обновляет maintainer до merge impl-PR |
| D4 | Shard передаётся переменной окружения `SHARD` (`npm test -- ${SHARD:+--shard=$SHARD}`): у ubuntu пусто — полный `npm test` |

### 2. Группа 1

- `ci.yml`: `matrix.include` — `{ os: ubuntu-latest, shard: "" }`, `{ os: windows-latest, shard: "1/2" }`, `{ os: windows-latest, shard: "2/2" }`; имя `test (${{ matrix.os }}${{ matrix.shard && format(', {0}', matrix.shard) || '' }})`; шаг `Test` — D4; шаги typecheck, install, validate — D2; комментарий заголовка — причина.
- `workflows.test.ts`: SCN-VER-124 — разбор `ci.yml` теми же помощниками `yamlLines`/`block`.
