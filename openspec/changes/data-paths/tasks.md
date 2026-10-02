# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/data-paths`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. Схема и конфигурация (REQ-KRN-037, D3)

- [ ] 1.1 `schemas/config.1.schema.json`: `paths.data` — массив `relative_path`, `minItems: 1`, `uniqueItems`, элемент с `not` `pattern` для `.`, `.warrant`, `openspec` и путей под ними (с ведущими `./` и конечными `/`); `core/config.ts`: `paths.data` в `WarrantConfig`.
- [ ] 1.2 Фикстуры `test/fixtures/schemas/config/`: `valid-paths-data.json` и `invalid-paths-data-*.json` с `.expect.json` — SCN-KRN-174.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts schemas`.

## 2. Корни кода (REQ-KRN-037, D1, D4)

- [ ] 2.1 `core/run/scope.ts`: `codeScope` добавляет `<каталог>/**` каждого `paths.data` через `directory()`; текст и hint `CONFIG_INVALID` у `implement` называют `paths.data`.
- [ ] 2.2 Тесты: `app/commands/run.test.ts` и `guard.test.ts` — SCN-KRN-172; `run.test.ts` и `app/commands/ci.test.ts` — SCN-KRN-173.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts run.test guard.test ci.test`.

## 3. Документы и выпуск (D2, D5)

- [ ] 3.1 `docs/08-packs.md` §3 — `paths.data`; `CHANGELOG.md` — `## 0.10.2`, «Вердикт» и «Миграция» (сначала CLI 0.10.2, потом ключ); версия CLI — 0.10.2; `docs/backlog.md` — перенос `paths.data` в тексты REQ-ENF-002, REQ-ENF-004, REQ-VER-009, REQ-VER-011 после archive `judge-law`.

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
