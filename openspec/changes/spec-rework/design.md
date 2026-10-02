# Design: spec-rework

## Context

База — `main` `36bf2fa` (ADR-0056), CLI 0.10.0. Источник — [#142](https://github.com/Homasters-max/SRA/issues/142), решение — [ADR-0056](../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 3. Пути — от `packages/cli/src`.

- **Переходы.** `core/record/lifecycle.ts` `transitionKind(from, to)`: вперёд — следующий по цепочке, назад — `BACKWARD_TRANSITIONS` (`VERIFYING->IMPLEMENTING`, `IMPLEMENTING->SPECIFIED`), `ABANDONED` — до `MERGED`; «nothing re-enters `PROPOSED`». `commands/transition.ts` `recordTransition` называет допустимые переходы в сообщении отказа.
- **Вид PR.** Состояние record в diff задаёт вид (`lifecycle.ts`, таблица `PROPOSED`/`SPECIFIED` → `spec`). `core/ci/record.ts` проверяет каждую новую запись перехода через `transitionKind` (ошибка «not a transition of 04 §2», L377) и пересчитывает gates у переходов вперёд, кроме `PROPOSED` (L288, L382).
- **Ref `APPROVED`.** `core/ci/merge.ts` `locateMerge`: merge-коммит spec-PR ref на first-parent линии базы должен «приносить» `SPECIFIED` в record (`broughtTransitions`, `confirmationOf("APPROVED").broughtBy`). Последний ли это `SPECIFIED`, не проверяется. Отказ — `REF_NOT_VERIFIED` с причиной `change` (`core/ci/refs.ts`).

## Goals / Non-Goals

**Goals:** переделка spec Change в `SPECIFIED` без `ABANDONED`; одобрение — только последней переделки.

**Non-Goals:** переделка после `APPROVED`; `--by` у перехода.

## Decisions

### 1. Решения

- **D1. `SPECIFIED->PROPOSED` в `BACKWARD_TRANSITIONS`.** Переход без gates, как прочие назад. `transition` не требует `--by` и не пишет `human-approval`. Комментарий модуля и сообщение `transition` перечисляют три перехода назад.
- **D2. Вид PR переделки — `spec`.** Конечное состояние `PROPOSED` или `SPECIFIED` даёт `spec` по таблице. Проверка цепочки в `ci/record.ts` пропускает `SPECIFIED->PROPOSED` через `transitionKind`. Пересчёт gates нового `SPECIFIED` — как у первого spec-PR.
- **D3. Последний `SPECIFIED`.** `locateMerge` для `APPROVED` дополнительно требует: после merge-коммита ref на first-parent линии базы ни один коммит не приносит в record новый `SPECIFIED`. Иначе — `REF_NOT_VERIFIED`, причина `change`, деталь «spec-PR не последнего `SPECIFIED`». Проверка — по уже читаемым ревизиям record: число переходов `SPECIFIED` в record на merge-коммите ref равно числу в record базы.
- **D4. Версия** — 0.10.1 по ADR-0056 п. 1, первым impl-PR из пяти (R-14).

### 2. Риски

- **Код, который ищет «первый `PROPOSED`»** (например, `transitions[0]`), после переделки встретит второй `PROPOSED`. Проверка — `cs grep '"PROPOSED"'` в impl-PR и тесты переходов.
- **Evidence первого review** остаётся в каталоге Change: gate `adversarial-review` нового `SPECIFIED` судит свежее review по `context_hash` (STALE у старого) — как любая правка spec после review.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
