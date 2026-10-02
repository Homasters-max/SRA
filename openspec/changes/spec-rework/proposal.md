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

- **Третий переход назад `SPECIFIED -> PROPOSED`** (REQ-VER-007, [04 §2](../../../docs/04-lifecycle.md)) — только из `SPECIFIED`, без gates, без `--by`. Record, переходы, `unknowns[]` и evidence сохраняются.
- **Переделка — spec-PR заново** (REQ-VER-018, новое требование): Run `specify`, review, `verify`, `transition SPECIFIED`. PR с `SPECIFIED->PROPOSED` `warrant ci` судит видом `spec`, сливает его maintainer.
- **`APPROVED --ref` — spec-PR последнего `SPECIFIED`.** Ref на spec-PR более раннего `SPECIFIED` судья отвергает (`REF_NOT_VERIFIED`, причина `change`). Без этого одобрение обходило бы переделку.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`:
  - REQ-VER-007 — переход назад `SPECIFIED->PROPOSED`;
  - REQ-VER-018 (новый) — переделка spec до `APPROVED` и ref `APPROVED`, SCN-VER-157, SCN-VER-158.

REQ-VER-011 (судья, «Ref») не меняется: его меняет открытый Change `judge-law`. Правило ref после переделки живёт в REQ-VER-018.

## Non-Goals

- **Переделка после `APPROVED`.** Она идёт через `IMPLEMENTING->SPECIFIED` и spec-approved (ADR-0024).
- **`--by` у перехода.** Акт человека — merge spec-PR переделки maintainer'ом (ADR-0056 п. 3).

## Impact

- `packages/cli/src/core/record/lifecycle.ts` — `BACKWARD_TRANSITIONS` и комментарий «nothing re-enters PROPOSED».
- `packages/cli/src/core/ci/merge.ts` (`locateMerge`: последний `SPECIFIED`), `core/ci/record.ts`, `core/ci/kind.ts` — вид PR с `SPECIFIED->PROPOSED`, проверка цепочки.
- `packages/cli/src/commands/transition.ts` — сообщение о допустимых переходах.
- `packages/cli/test/app/commands/transition.test.ts`, `ci.test.ts` — SCN-VER-157, SCN-VER-158.
- `docs/04-lifecycle.md` §2, `CHANGELOG.md`.
