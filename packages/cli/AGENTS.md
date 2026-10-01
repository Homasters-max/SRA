# packages/cli — конвенции кода

Подгружается при работе в `packages/cli` ([ADR-0032](../../docs/adr/WARRANT-ADR-0032-dev-context.md) п. 7). Норма — в ADR; здесь — как писать код так, чтобы проверки прошли с первого раза.

## Код

- TypeScript ESM `NodeNext`: в импортах — `.js`; `strict` + `exactOptionalPropertyTypes`.
- Ошибка — `WarrantError(code, message, { path, hint })` из `src/core/errors.ts`; вывод команды — `success` / `failure` / `failures(errors, data, change?, outcome?)` из `src/io/output.ts`. Код выхода 0…4 считает `exitCodeFor` по классу кода ошибки и действию controller (REQ-KRN-003); место вызова его не выбирает.
- Команда регистрируется в `src/bin/warrant.ts` через `register` и получает `Ctx`: `runX(ctx, …)`. Команда не импортирует другую команду, кроме `commands/context.ts`; сценарий оценки перехода — `core/transition`.
- Процессы (`git`, `openspec`, `gh`, checks) — только в `src/adapters/**` через порты `src/core/ports/**` ([ADR-0025](../../docs/adr/WARRANT-ADR-0025-test-levels.md)). Новый внешний вызов = метод порта + адаптер + фейк + сценарий контракта.
- Модули и ранги — `test/unit/meta/architecture.json` ([ADR-0030](../../docs/adr/WARRANT-ADR-0030-module-boundaries.md)): импорт только своего или нижнего ранга; общий помощник — у владельца из реестра (`isPlainObject`, `strings` → `core/json.ts`), перечисление словаря — у владельца (lifecycle — `core/record/lifecycle.ts`).
- JSON пишется только через `writeJsonFile` (`src/core/canon/format-json.ts`) или `warrant fmt`.
- Код работает на Linux и Windows (CI ubuntu + windows): пути через `path`, без shell, без внешних утилит.

## Тесты (ADR-0025)

| Уровень | Каталог | Что |
|---|---|---|
| `unit` | `test/unit/` | чистые функции, мета-тесты; процессы запрещены (`SPAWN_FORBIDDEN_AT_LEVEL`) |
| `app` | `test/app/` | команда через `invoke(() => runX(p.ctx, …))` с `useProjectBuilder` и фейками; без процессов |
| `contract` | `test/contract/` | адаптер против настоящего `git` / `openspec` и фейк против того же сценария |
| `e2e` | `test/e2e/` | один-два теста на команду через `runCli` (`test/helpers/cli.ts`); первая строка — `// e2e: <reason>` |

- `skipIf` по openspec запрещён: `globalSetup` `contract`/`e2e` требует openspec 1.13.1.
- Скрипты — в корневом `package.json`: `npm test` — без флагов (уровни, таймауты, порядок — `vitest.config.ts`); `npm run test:fast` (`unit` + `app`) — внутренний цикл; `test:unit` / `test:app` / `test:contract` / `test:e2e`.
- Новая команда — сразу тест `app`; SCN-тег сценария spec — в имени теста.
- Golden (`packs/*/golden/**/expected/**`) генерируется, руками не правится.

## Платформенные ловушки

Дефекты, которые проявились только на одной ОС CI; новый — строкой сюда (ADR-0033 п. 6), разбор — `git-land/ci.md`.

- Путь внутри репозитория — из `git rev-parse --show-prefix`, не `path.relative(--show-toplevel, …)`: 8.3-имена (`RUNNER~1`) и symlink дают `../…` (I-100).
- Shell-обёртки в тестах — без внешних утилит: `${0%/*}`, не `$(dirname "$0")`; PATH теста может содержать только каталог fake (I-101). Fake-бинарь на Windows — `.cmd` + абсолютный `process.execPath` (I-42).
- Долгие процессы в тестах — асинхронный `spawn`: `spawnSync` блокирует воркер vitest (I-64).
- Настоящий git в тестах — `-c core.autocrlf=false`: CRLF Windows меняет diff и хэши (I-132).
- `npm i -g <git-url>#<tag>` на Windows npm 10 не работает — ставить из чекаута или tgz (I-11).

## Проверки перед коммитом

Навык `group-done`: `npm run typecheck`, `npm test`, `warrant validate`, `fmt --check`, `sync --check`, `npm run versions:check`.
