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
  - `warrant waive` берёт id через `allocateUlid("WAV")`. Перед записью — проверка, что файла с таким именем нет (столкновение ULID — `INTERNAL`, код 3, не перезапись; REQ-KRN-031).
  - Вывод `warrant id WAV` — `{ id, prefix, year }`: `year` (год UTC вызова) остаётся, контракт JSON 0.10.0 не меняется (review раунда 1, F-7, D-1).
- **D2. Обе формы в схеме и аргументах.** Одно регулярное выражение `WAIVER_ID` в `core/ids/` (владелец формы), им пользуются `waive.ts` и тесты; схема — тот же шаблон строкой. Мета-тест сверяет их — по образцу `cliPattern` (I-252 `guard-recovery`).
- **D3. Копии схемы.** У потребителя копия `.warrant/schemas/` и её hash в lock обновляются `warrant sync` после перехода на 0.10.1 (review раунда 1, F-1) — шаг pin-Change и «Миграция» CHANGELOG; без него `sync --check` — дрейф. После правки схемы — `warrant sync` (копия `.warrant/schemas/`, hash в lock) и `npm run golden:update` (golden `core-sdd`). Версия pack не меняется: схема kernel поставляется с CLI, а манифест и объекты pack прежние.
- **D4. Версия** — 0.10.1 по ADR-0056 п. 1, первым impl-PR из пяти (R-14).

### 2. Риски

- **CLI 0.10.0 не читает новый файл waiver** (`SCHEMA_VIOLATION`). Потребитель на 0.10.0 с waiver от 0.10.1 — смешение версий на одной машине. Pin-Change на 0.10.1 ставит CLI и поднимает закрепление одним шагом.
- **Длина id в слове активации** («активируй WAV-…») — 30 символов; id копируется из тела PR.

## Решения по ходу реализации

| ID | Решение | Затронуто |
|---|---|---|
| I-1 | Review spec раунда 1 (PROVEN, MAJOR 3, MINOR 6, INFO 1, RUN-01M3YC8FP9SYPK438EKXFQS4TX) закрыт правкой spec и раундом 2: F-1 — `warrant sync` потребителя (D3, proposal); F-2 — SCN-KRN-171 (активация и отзыв новой формы); F-3 — SCN-KRN-168 без git, `warrant id WAV` — SCN-KRN-170; F-4 — обе формы и `WAIVER_INVALID` для `--activate` и `--revoke`; F-5 — SCN-KRN-169 (формы `id` в схеме); F-6 — неперезапись в REQ-KRN-031; F-7 — `year` остаётся (D1); F-8 — засчёт не зависит от формы id (SCN-KRN-171); F-9 — 02 §3, ADR-0012 помечен #145; F-10 — id не выводится из каталога | `specs/**`, `design.md`, `proposal.md`, `tasks.md` |
| I-2 | Ревью реализации (агент `reviewer`): 🔴 закрыт — тест SCN-KRN-122 активирует PROPOSED waiver прежней формы. 🟡: `allocateWaiver()` оставлен обёрткой `allocateUlid("WAV")`, `WAV` — отдельная ветка `warrant id` ради поля `year` (D1 говорил «удаляется»; поведение по spec); пример `--help` и шапки `waive.ts` и теста — новая форма; неизменность дерева в SCN-KRN-170, 171. CHANGELOG `## 0.10.1` — общий раздел пяти Change ADR-0056 во всех impl-PR одними байтами: тег ставится, когда слиты все пять (ADR-0056 п. 1). Тест неперезаписи с подменой ULID (R-60 F-6) — в R-60 на следующий Change | `test/app/commands/waive.test.ts`, `id.test.ts`, `commands/waive.ts`, `bin/warrant.ts` |
