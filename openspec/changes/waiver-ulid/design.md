# Design: waiver-ulid

## Context

База — `main` `36bf2fa` (ADR-0056), CLI 0.10.0. Источник — [#139](https://github.com/Homasters-max/SRA/issues/139), решение — [ADR-0056](../../../docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 2. Пути — от `packages/cli/src`.

- **Выдача.** `core/ids/allocate.ts` `allocateWaiver(root, year)` считает максимум `WAV-<year>-NNN` по именам и `id` файлов `.warrant/waivers/*.json`. `allocateUlid(prefix)` даёт `PREFIX-<ULID>` для `EVID` и `RUN`.
- **Команды.** `commands/id.ts`: `WAV` — отдельная ветка с выводом `{ id, prefix, year }`, ULID-префиксы — `{ id, prefix }`. `commands/waive.ts`: `WAIVER_ID_RE = /^WAV-[0-9]{4}-[0-9]{3}$/` проверяет аргумент `--activate` / `--revoke`.
- **Схема** `schemas/waiver.1.schema.json`: `id.pattern` `^WAV-[0-9]{4}-[0-9]{3}$`. Копии — `.warrant/schemas/` (её пишет `warrant sync`, сверяет lock) и golden pack `core-sdd`.
- Другого разбора формы id waiver в коде нет (`cs grep WAV`). Gates, `ci` и `validate` берут id из файла как есть.

## Goals / Non-Goals

**Goals:** id waiver не сталкиваются между ветками; старые валидны.

**Non-Goals:** переименование старых; счётчик в пределах Change.

## Decisions

### 1. Решения

- **D1. `WAV` — ULID-префикс.**
  - `isUlidPrefix` включает `WAV`, `allocateWaiver` и его `WAIVER_ID_RE` удаляются.
  - `warrant waive` берёт id через `allocateUlid("WAV")`. Перед записью — проверка, что файла с таким именем нет (столкновение ULID — `INTERNAL`, не перезапись).
  - Вывод `warrant id WAV` — `{ id, prefix }`; `year` уходит. В CHANGELOG — «Миграция».
- **D2. Обе формы в схеме и аргументах.** Одно регулярное выражение `WAIVER_ID` в `core/ids/` (владелец формы), им пользуются `waive.ts` и тесты; схема — тот же шаблон строкой. Мета-тест сверяет их — по образцу `cliPattern` (I-252 `guard-recovery`).
- **D3. Копии схемы.** После правки схемы — `warrant sync` (копия `.warrant/schemas/`, hash в lock) и `npm run golden:update` (golden `core-sdd`). Версия pack не меняется: схема kernel поставляется с CLI, а манифест и объекты pack прежние.
- **D4. Версия** — 0.10.1 по ADR-0056 п. 1, первым impl-PR из пяти (R-14).

### 2. Риски

- **CLI 0.10.0 не читает новый файл waiver** (`SCHEMA_VIOLATION`). Потребитель на 0.10.0 с waiver от 0.10.1 — смешение версий на одной машине. Pin-Change на 0.10.1 ставит CLI и поднимает закрепление одним шагом.
- **Длина id в слове активации** («активируй WAV-…») — 30 символов; id копируется из тела PR.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
