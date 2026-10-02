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

- **D1. `SPECIFIED->PROPOSED` в `BACKWARD_TRANSITIONS`.** Переход без gates, как прочие назад; `--by` не требуется, переданный — предупреждение (как у прочих). `transitionKind` знает только состояния, поэтому `commands/transition.ts` добавляет проверку истории: `APPROVED` в `transitions[]` — `STATE_INVALID`, код 3 (review раунда 1, F-3). Комментарий модуля и сообщение `transition` перечисляют три перехода назад.
- **D2. Вид PR — по HEAD, переделка — только в виде `spec`.** Таблица видов не меняется. `ci/record.ts` проверку цепочки дополняет: новая запись `SPECIFIED->PROPOSED` и `SPECIFIED` после неё — только в PR вида `spec` и только у record без `APPROVED`, иначе `RECORD_MISMATCH` `chain` (F-1). Пересчёт gates нового `SPECIFIED` — как у первого spec-PR.
- **D3. Ref `APPROVED` после переделки.** Правило действует, только если в record на HEAD перед новым `APPROVED` есть `SPECIFIED->PROPOSED`: иначе вердикт прежний, и повторное `APPROVED` после `IMPLEMENTING->SPECIFIED` судится, как в 0.10.0 (F-4). `locateMerge` находит последний перед `APPROVED` переход `SPECIFIED` из `PROPOSED` (предыдущая запись — `PROPOSED`) в record на HEAD, и требует, чтобы merge-коммит ref приносил именно его: в record на M^1 ref этого перехода ещё нет, в record на M он есть (сравнение по индексу в `transitions[]`). Иначе — `REF_NOT_VERIFIED` `change` (F-2).
- **D3a. `unknownsRule`.** Критерий «база удерживает `unknowns[]`» — в record базы есть переход в `SPECIFIED` (а не `change_state` базы ∈ `UNKNOWNS_HELD_STATES`). Для record без переделки это то же условие: `SPECIFIED` в истории ⇔ состояние `SPECIFIED` и дальше (F-5).
- **D4. Версия** — 0.10.1 по ADR-0056 п. 1, первым impl-PR из пяти (R-14).

### 2. Риски

- **Код, который ищет «первый `PROPOSED`»** (например, `transitions[0]`), после переделки встретит второй `PROPOSED`. Проверка — `cs grep '"PROPOSED"'` в impl-PR и тесты переходов.
- **Evidence первого review** остаётся в каталоге Change: gate `adversarial-review` нового `SPECIFIED` судит свежее review по `context_hash` (STALE у старого) — как любая правка spec после review.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
| I-2 | Review spec раунда 2 (PROVEN, MAJOR 2, MINOR 5, RUN-01M3YCRK6Y52GF0CX6CN4ECK0J) закрыт правкой spec и раундом 3 — последним (прецедент I-249): F-1 — `chain` в видах `impl`/`archive` для новой переделки и нового `SPECIFIED` из `PROPOSED` после неё, случай раздельной переделки в SCN-VER-158; F-2 — решение blocking UNKNOWN после переделки — в spec-PR переделки, выход `--replace`; F-3 — считается только `SPECIFIED` из `PROPOSED`; F-4 — монотонность как дополнение к REQ-VER-011; F-5 — abandon-PR может нести переделку; F-6 — причина `unknowns`; F-7 — «SHALL быть допустим» | `specs/**`, `design.md` |
| I-1 | Review spec раунда 1 (NOT_PROVEN, BLOCKER 3, MAJOR 2, MINOR 3, INFO 1, RUN-01M3YCCJ7CJY1Z37H68SPZH7P7) закрыт правкой spec до раунда 2: F-1 — вид по HEAD, переделка только в виде `spec` (D2); F-2 — последний `SPECIFIED` по record на HEAD, обход через impl-PR закрыт `chain` (D2, D3); F-3 — «до `APPROVED`» = нет `APPROVED` в `transitions[]`, `STATE_INVALID` (D1); F-4 — правило ref только при переделке (D3); F-5 — `unknownsRule` по переходу `SPECIFIED` базы, SCN-VER-159 (D3a); F-6 — `STATE_INVALID`, код 3; F-7 — `--by` — предупреждение; F-8 — merge maintainer'ом как следствие вида `spec`; F-9 — kernel spec не меняется (proposal) | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
