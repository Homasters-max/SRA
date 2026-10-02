# Proposal: ci-local

## Why

[#143](https://github.com/Homasters-max/SRA/issues/143). Правило LATTICE: перед PR владелец гоняет судью CI локально на merge со свежим `origin/main` (`git checkout --detach origin/main`, `git merge --no-ff <head>`, `warrant ci`). Отсюда две беды:

- Локальные `warrant ci` и `warrant verify` пишут записи evidence в `.warrant/evidence/<change>/` worktree'а. guard не даёт их удалить, и они остаются неотслеживаемыми файлами.
- `warrant ci fetch` в archive-PR перечисляет в manifest каждую запись каталога. Его manifest берёт за основу и manifest, который локальный `verify` перезаписал (REQ-KRN-036, design I-203: manifest пересобирается по каталогу). Так archive-PR LATTICE #109 закоммитил чужой остаток.

Класс A ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2): агент, следуя правилу проекта, оставляет состояние, которое потом ложно входит в evidence.

## What Changes

- **`warrant ci --no-record`** (новое требование REQ-VER-017). Тот же вердикт, что у `warrant ci`: checks, gates, форж, `data`, `errors[]`, код выхода. Всё, что команда записала, к её концу возвращается в состояние до вызова, в том числе при исключении и сигнале. `data.no_record: true`. С `--dry-run` — `USAGE`.
- **`ci fetch` перечисляет только своё** (REQ-VER-012). `manifest.evidence[]` после импорта — `evidence[]` manifest в HEAD плюс импортированные id. Остаток локального прогона в каталоге в manifest не попадает, и сам файл не трогается.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`:
  - REQ-VER-017 (новый) — `warrant ci --no-record`, SCN-VER-154, SCN-VER-155;
  - REQ-VER-012 — manifest после `ci fetch`, SCN-VER-156.

REQ-VER-011 не меняется: его меняет открытый Change `judge-law`, а две delta одного REQ дают `ID_DUPLICATE`.

## Non-Goals

- **`warrant verify --no-record`.** `verify` пишет evidence ради перехода, а вердикт PR — у `warrant ci`. Второй флаг — второй контракт без нового failure mode.
- **Убирать остатки из каталога.** `ci fetch` только не перечисляет их. Удаление чужого файла — решение человека.
- **Менять пересборку manifest по каталогу у `check` и `transition`** (I-203): она чинит прерванную запись.

## Impact

- `packages/cli/src/core/writes.ts` — `Writes`, который возвращает записанное.
- `packages/cli/src/commands/ci.ts`, `packages/cli/src/bin/warrant.ts` — `--no-record`.
- `packages/cli/src/core/evidence/store.ts` (`importRecords`), `packages/cli/src/core/ci/fetch.ts` — manifest из HEAD.
- `packages/cli/test/app/commands/ci.test.ts`, `ci-fetch.test.ts`, `packages/cli/test/unit/**/writes*` — SCN-VER-154…156.
- `docs/06-verification.md` §8 — локальный вердикт; `CHANGELOG.md`.
