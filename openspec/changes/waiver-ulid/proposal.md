# Proposal: waiver-ulid

## Why

[#139](https://github.com/Homasters-max/SRA/issues/139). Id waiver `WAV-YYYY-NNN` — сквозная последовательность по `.warrant/waivers/` (`core/ids/allocate.ts` `allocateWaiver`).

В LATTICE два Change в реализации, каждый на своей ветке от одного `main`, вызвали `warrant waive … spec-approved` и оба получили `WAV-2026-004`. Maintainer активировал оба. После merge первого второй impl-PR получил конфликт `.warrant/waivers/WAV-2026-004.json`. Исправление — новый `warrant waive` (`WAV-2026-005`) и повторная активация.

[ADR-0012](../../../docs/adr/WARRANT-ADR-0012-id-allocation.md) п. 3 оставил счётчик, так как waivers «редки и создаются человеком на `main`». Теперь их создаёт агент в ветке каждого Change. Решение maintainer'а — [ADR-0056](../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 2: `WAV-<ULID>`, прежние id валидны.

## What Changes

- **`warrant waive` и `warrant id WAV` выдают `WAV-<ULID>`**, как `EVID` и `RUN` (REQ-KRN-024, REQ-KRN-031): без счёта по каталогу, без координации веток. Вывод `warrant id WAV` — `{ id, prefix }`, как у `EVID` и `RUN`; поле `year` уходит.
- **Схема `waiver/1` принимает обе формы `id`** (REQ-KRN-019): `^WAV-([0-9]{4}-[0-9]{3}|[0-9A-HJKMNP-TV-Z]{26})$`. `--activate` и `--revoke` принимают обе. Старые файлы и ссылки на них валидны.
- **02 §3** — форма `WAV`.
- **Копии схемы** — `.warrant/schemas/` SRA (`warrant sync`) и golden pack `core-sdd` (`npm run golden:update`). Манифест и объекты pack не меняются, hash pack в lock прежний, как I-252 `guard-recovery`.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `kernel`: REQ-KRN-019 (схема waiver), REQ-KRN-024 (`warrant id WAV`), REQ-KRN-031 (`warrant waive`); SCN-KRN-121, SCN-KRN-122 уточнены; новый SCN-KRN-168.

## Non-Goals

- **Переименование существующих waivers.** Старые id остаются.
- **Счётчик в пределах Change** (вариант B в #139) — отвергнут в ADR-0056.

## Impact

- `packages/cli/src/core/ids/allocate.ts` — `allocateWaiver` уходит, `WAV` — ULID-префикс.
- `packages/cli/src/commands/id.ts`, `packages/cli/src/commands/waive.ts`, `packages/cli/src/bin/warrant.ts` (пример `--help`).
- `packages/cli/schemas/waiver.1.schema.json`, `.warrant/schemas/waiver.1.schema.json`, `packs/core-sdd/golden/*/.warrant/schemas/waiver.1.schema.json`, `.warrant/warrant.lock.json` (hash копии схемы).
- `packages/cli/test/**` — `allocate`, `id`, `waive`, фикстуры схемы.
- `docs/02-vocabulary.md` §3, `docs/05-policy.md` §7 (пример), `CHANGELOG.md`.
