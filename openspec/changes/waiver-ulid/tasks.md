# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/waiver-ulid`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. Выдача и форма id (D1, D2)

- [ ] 1.1 `core/ids/allocate.ts`: `WAV` — ULID-префикс, `allocateWaiver` удалён; `WAIVER_ID` — обе формы, один владелец. `commands/id.ts` — `WAV` через ULID, вывод `{ id, prefix, year }`. `commands/waive.ts` — `allocateUlid("WAV")`, проверка свободного имени, `WAIVER_ID` для `--activate` / `--revoke`. `bin/warrant.ts` — пример `--help`.
- [ ] 1.2 `packages/cli/schemas/waiver.1.schema.json` — `id.pattern` обеих форм, `description`; фикстуры схемы (валидный ULID, невалидные формы); мета-тест — шаблон схемы равен `WAIVER_ID`.
- [ ] 1.3 Тесты: `unit/ids/allocate.test.ts`, `app/commands/id.test.ts`, `app/commands/waive.test.ts` — SCN-KRN-121, SCN-KRN-122, SCN-KRN-168, SCN-KRN-170, SCN-KRN-171; фикстуры схемы — SCN-KRN-169; e2e `waive` — форма id.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts allocate id waive fixtures`.

## 2. Копии схемы (D3)

- [ ] 2.1 `warrant sync` (копия `.warrant/schemas/`, lock), `npm run golden:update` (golden `core-sdd`).

  Проверка: `node scripts/dev/check.js`; `npx vitest run --config packages/cli/vitest.config.ts golden lock`.

## 3. Документы

- [ ] 3.1 `docs/02-vocabulary.md` §3 — форма `WAV` и обоснование; `docs/05-policy.md` §7 — пример; `CHANGELOG.md` — `## 0.10.1`, «Миграция»: новая форма id, `warrant sync` после перехода (копия схемы и lock).

  Проверка: `node scripts/dev/check.js`; полный `npm test`.
