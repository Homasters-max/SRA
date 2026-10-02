# Proposal: analyze-open

## Why

[#141](https://github.com/Homasters-max/SRA/issues/141). Чужой открытый Change держит archive Change в LATTICE. Так было с `infra-process-rules`: `warrant archive` отказал с `GATES_NOT_PASSED`, `analyze-clean FAIL`. Причина — 18 находок `ORPHAN` по `SCN-SR-001…014` в `test/store/*.test.ts`.

Эти тесты принадлежат `s0-store-2`. Его impl-PR уже слит в `main`, а archive-PR ещё открыт. Поэтому его SCN объявлены в `openspec/changes/s0-store-2/specs/**`, а не в `openspec/specs/**`. По REQ-VER-010 ID «определён», только если он объявлен в main specs или в delta **этого** Change. Тест чужого Change, изменённый в diff `base...HEAD`, даёт `ORPHAN`, хотя его SCN объявлен.

Итог: archive Change ждёт archive каждого Change, чей impl-PR слит раньше, даже если у них нет общего пути или AREA. Параллельные Change — штатный случай в проекте с несколькими Change в реализации.

Класс A ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2): находка ложная, агент её не исправит, а waiver на `analyze-clean` прятал бы и настоящие `ORPHAN`.

## What Changes

- **`ORPHAN` не даёт SCN другого открытого Change** (REQ-VER-010). SCN, объявленный в `ADDED` или `MODIFIED` delta specs другого Change в `openspec/changes/<другой>/` (не в `archive/`), для `ORPHAN` считается объявленным. Такой SCN — не опечатка и не тег без требования: он перейдёт в main specs archive-PR своего Change.
- `UNSATISFIED` и `CONFLICT` не меняются: они судят `tasks.md` и delta самого Change.
- `ORPHAN` по SCN, которого нет ни в main specs, ни в delta открытого Change (в том числе SCN только из архивного Change), — как раньше.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`: REQ-VER-010 — `ORPHAN` не даёт SCN, объявленный в delta другого открытого Change; новый SCN-VER-152.

## Non-Goals

- **Сузить diff `ORPHAN` до путей самого Change** (второй вариант #141). Отвергнуто в design D2.
- **Учитывать открытые Change в `CONFLICT`.** `tasks.md`, который ссылается на SCN чужого Change, — дефект своего Change.

## Impact

- `packages/cli/src/core/analyze/input.ts` — ID delta других открытых Change.
- `packages/cli/src/core/analyze/index.ts` — `ORPHAN` по ним.
- `packages/cli/test/unit/analyze/analyze.test.ts`, `packages/cli/test/app/commands/analyze.test.ts` — SCN-VER-152.
- `CHANGELOG.md` — строка в разделе релиза.
