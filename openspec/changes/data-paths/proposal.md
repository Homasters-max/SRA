# Proposal: data-paths

## Why

[#160](https://github.com/Homasters-max/SRA/issues/160) п. 13 ([триаж](https://github.com/Homasters-max/SRA/issues/160#issuecomment-5959504251)). Код проекта для WARRANT — каталоги `paths.src` и `paths.tests` `warrant.json`. Только их пишет Run `implement`, только их guard ведёт через Run, только их судья пускает в impl-PR.

Каталог данных проекта — файл установки, генерируемый справочник, фикстуры поставки — не код и не тест. Его нельзя записать ни одним путём процесса:

- `write_scope` Run `implement` его не содержит, guard отказывает в правке;
- без Run путь не policy и не код — правка проходит в любой PR, мимо Change.

Пример: каталог `std/` в LATTICE, файл установки `std/std.json`. Сейчас его копируют руками, и так будет на каждом следующем Change этого каталога.

## What Changes

- **`paths.data`** (новое требование REQ-KRN-037) — необязательный список каталогов данных в `warrant.json`.
  - Схема `config/1` принимает его. Корень проекта, `.warrant/**` и `openspec/**` — невалидны.
  - Каждый каталог — корень кода наравне с `paths.src` и `paths.tests`. Он попадает в `write_scope` Run `implement` и в классы путей guard. Его считает `FRONTEND_HOOKS_INACTIVE`. В правиле путей `warrant ci` его меняет только impl-PR Change.
  - Где `paths.tests` значит именно тесты — ссылки на ID, покрытие SCN, — `paths.data` не участвует.
- Выпуск — **0.10.2**, `kernel` 0.10 прежний. Ключ необязательный, без него поведение то же. CLI 0.10.1 и раньше отвергает `warrant.json` с `paths.data` (`additionalProperties: false`), поэтому потребитель сначала ставит 0.10.2, потом пишет ключ.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `kernel`: REQ-KRN-037 (новый) — `paths.data`, SCN-KRN-172…174.

REQ-KRN-004, REQ-ENF-002, REQ-ENF-004, REQ-VER-009 и REQ-VER-011 не меняются текстом: REQ-KRN-037 дополняет их ссылкой, как REQ-VER-017 дополнил REQ-VER-011. REQ-ENF-007 и REQ-VER-011 меняет открытый Change `judge-law`, а две delta одного REQ дают `ID_DUPLICATE` (design D2).

## Non-Goals

- **Объявление путей записи в самом Change** (Impact proposal, утверждаемый вместе со spec). Точнее, но требует нового поля spec, его разбора и правил gates. Вернуться, если одного списка на проект станет мало.
- **Policy-класс данных.** Классификация по путям (`risk-floor`, профили) каталоги данных отдельно не видит. Floor для них задаёт сам проект своим `floors[].paths`.
- **`paths.src` списком.** Данные не код, а каждый читатель `paths.src` получил бы две формы значения.

## Impact

- `packages/cli/schemas/config.1.schema.json` — `paths.data`.
- `packages/cli/src/core/config.ts` — `WarrantConfig.paths.data`.
- `packages/cli/src/core/run/scope.ts` — `codeScope` с каталогами `paths.data`, текст и hint `CONFIG_INVALID`.
- `packages/cli/test/fixtures/schemas/config/**`, `packages/cli/test/app/commands/run.test.ts`, `guard.test.ts`, `ci.test.ts` — SCN-KRN-172…174.
- `docs/08-packs.md` §3 — `paths.data`; `CHANGELOG.md` — `## 0.10.2`; версия CLI — 0.10.2.
