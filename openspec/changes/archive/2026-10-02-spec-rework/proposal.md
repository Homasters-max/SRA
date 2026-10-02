# Proposal: spec-rework

## Why

[#142](https://github.com/Homasters-max/SRA/issues/142). У Change в `SPECIFIED` до `APPROVED` нет пути переделки spec.

В LATTICE у двух параллельных Change (`s0-apply-checks`, `s0-store`) были слиты spec-PR с MODIFIED delta одних и тех же требований, и `ids-valid` дал `ID_DUPLICATE` каждому Change на `main`. Maintainer решил, что `s0-store` переписывает свою delta. В `SPECIFIED` это невозможно:
- Run `specify` стартует только в `PROPOSED`;
- из `SPECIFIED` назад перехода нет;
- Run `implement` требует `APPROVED`, а `APPROVED` падал на том же `ids-valid`.

Единственный выход — `ABANDONED` и новый Change (`s0-store-2`): второй `init`, второй specify, второе review тех же артефактов.

Решение maintainer'а — [ADR-0056](../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 3: `SPECIFIED -> PROPOSED` до `APPROVED`, без gates и без `--by`.

## What Changes

- **Третий переход назад `SPECIFIED -> PROPOSED`** (REQ-VER-007, [04 §2](../../../docs/04-lifecycle.md)) — только у Change, ни разу не одобренного (`APPROVED` нет в `transitions[]`), без gates, без `--by`. Record, переходы, `unknowns[]` и evidence сохраняются. Одобренный Change — `STATE_INVALID`.
- **Переделка — spec-PR заново** (REQ-VER-018, новое требование): Run `specify`, review, `verify`, `transition SPECIFIED`. Вид PR — по HEAD, как прежде (`spec`); переделка в PR вида `impl` или `archive` — `RECORD_MISMATCH` (`chain`), abandon-PR может её нести.
- **Монотонность `unknowns[]`** после переделки — как при базе в `SPECIFIED` (критерий — переход `SPECIFIED` в record базы).
- **`APPROVED --ref` после переделки — spec-PR последнего `SPECIFIED`.** Ref на spec-PR более раннего `SPECIFIED` судья отвергает (`REF_NOT_VERIFIED`, причина `change`); без этого одобрение обходило бы переделку. Record без переделки судится, как прежде: вердикт на входах 0.10.0 не меняется.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`:
  - REQ-VER-007 — переход назад `SPECIFIED->PROPOSED`;
  - REQ-VER-018 (новый) — переделка spec до `APPROVED`, вид PR, ref `APPROVED`, монотонность `unknowns[]`, SCN-VER-157…159.

Kernel spec не меняется: переходы задают 04 §2 и REQ-VER-007 (ADR-0056, Consequences, называет «kernel spec» в общем смысле).

REQ-VER-011 (судья, «Ref») не меняется: его меняет открытый Change `judge-law`. Правило ref после переделки живёт в REQ-VER-018.

## Non-Goals

- **Переделка после `APPROVED`.** Она идёт через `IMPLEMENTING->SPECIFIED` и spec-approved (ADR-0024).
- **`--by` у перехода.** Акт человека — merge spec-PR переделки maintainer'ом (ADR-0056 п. 3).

## Impact

- `packages/cli/src/core/record/lifecycle.ts` — `BACKWARD_TRANSITIONS` и комментарий «nothing re-enters PROPOSED».
- `packages/cli/src/core/ci/merge.ts` (`locateMerge`: последний `SPECIFIED` после переделки), `core/ci/record.ts` (цепочка: переделка только в виде `spec` и без `APPROVED`; `unknownsRule` — критерий по переходу `SPECIFIED` базы).
- `packages/cli/src/commands/transition.ts` — `STATE_INVALID` для одобренного Change, сообщение о допустимых переходах.
- `packages/cli/test/app/commands/transition.test.ts`, `ci.test.ts` — SCN-VER-157…159.
- `docs/04-lifecycle.md` §2, `CHANGELOG.md`.
