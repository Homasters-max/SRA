# Proposal: ci-local

## Why

[#143](https://github.com/Homasters-max/SRA/issues/143). Правило LATTICE: перед PR владелец гоняет судью CI локально на merge со свежим `origin/main` (`git checkout --detach origin/main`, `git merge --no-ff <head>`, `warrant ci`). От этого две беды:

- **Остатки в worktree.** Локальные `warrant ci` и `warrant verify` пишут записи evidence в `.warrant/evidence/<change>/` worktree'а. guard не даёт их удалить, и они остаются неотслеживаемыми файлами.
- **Остаток в archive-PR.** `warrant ci fetch` перечисляет в manifest каждую запись каталога. Так archive-PR LATTICE #109 закоммитил чужой остаток.

Класс A ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2): агент, следуя правилу проекта, оставляет состояние, которое потом ложно входит в evidence.

## What Changes

- **`warrant ci --no-record`** (новое требование REQ-VER-017).
  - Тот же вердикт, что у `warrant ci`: checks, gates, форж, `kind`, `gates`, `findings[]`, `errors[]`, код выхода.
  - Каждая запись состояния WARRANT (записи evidence, `manifest.json`, `raw/`) к концу команды возвращается, как была. Так и при исключении, и при сигнале.
  - Что вернуть не удалось — в `data.not_restored[]`. Другой писатель того же `<state>` во время прогона не поддерживается: его запись откатывается вместе с этой.
  - Каждый вывод несёт `data.no_record: true`. С `--dry-run` и в GitHub Actions — `USAGE`.

  Этим остатки локального судьи не возникают.
- **`ci fetch` называет чужие записи каталога** (REQ-VER-012). Запись, которой нет ни в manifest HEAD, ни среди записей выбранной попытки, ни в `evidence[]` переходов record, попадает в `data.untracked[]` и в находку `EVIDENCE_UNTRACKED` с `hint` «удалить и повторить», и не трогается. Повтор после удаления переписывает manifest. archive-PR видит, какие файлы не коммитить.
  - Manifest по-прежнему перечисляет ровно записи каталога: этого требует `warrant validate` ([REQ-KRN-021](../../../openspec/specs/kernel/spec.md) п. 12).
  - Буквальное «`ci fetch` перечисляет только импортированное» из #143 сломало бы `validate` (design D3).

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`:
  - REQ-VER-017 (новый) — `warrant ci --no-record`, SCN-VER-154, SCN-VER-155;
  - REQ-VER-012 — `data.untracked[]` у `ci fetch`, SCN-VER-156.

REQ-VER-011 не меняется: его меняет открытый Change `judge-law`, а две delta одного REQ дают `ID_DUPLICATE`. Флаг в синопсисе REQ-VER-011 — строка backlog.

## Non-Goals

- **`warrant verify --no-record`.** `verify` пишет evidence ради перехода, а вердикт PR — у `warrant ci`.
- **Удалять остатки.** Удаление файла, который не писала эта команда, — решение человека.
- **Менять пересборку manifest по каталогу** у `check`, `transition`, `ci fetch` (REQ-KRN-021 п. 12, I-203).
- **Возврат файлов, которые команды checks пишут вне `{out}`.**

## Impact

- `packages/cli/src/core/writes.ts` — `Writes`, который возвращает записанное.
- `packages/cli/src/commands/ci.ts`, `packages/cli/src/bin/warrant.ts` — `--no-record`.
- `packages/cli/src/core/ci/fetch.ts`, `packages/cli/src/core/evidence/store.ts` — `data.untracked[]`.
- `packages/cli/test/app/commands/ci.test.ts`, `ci-fetch.test.ts`, unit-тест `writes` — SCN-VER-154…156.
- `docs/06-verification.md` §8 — локальный вердикт; `CHANGELOG.md`; `docs/backlog.md` — флаг в синопсисе REQ-VER-011.
