# Tasks

Потолок: 6 групп (G-8). После каждой группы: `npm test`, `npm run typecheck`, `warrant validate`, `warrant fmt --check`,
`warrant sync --check`, `npm run versions:check` зелёные; коммит на группу в `worktree/test-levels`. Поведение CLI не меняется:
вывод и findings `validate`/`status`/`resolve` репозитория и golden до и после группы совпадают. Отклонения — вопросом к
maintainer'у, принятые — строкой I-N (с I-117) в design.md. §N — разделы design.md, п. N — пункты ADR-0025.

## 1. Каркас и замер

- [x] 1.1 Bump CLI `0.4.1` (`package.json`, `packages/cli/package.json`). Проверка: `npm run versions:check` зелёный.
- [x] 1.2 Замер «до» (§10): время по файлу, процессы по файлу, `warrant validate` репозитория; колонка «До» таблицы §10. Проверка: таблица заполнена, счётчик процессов не остаётся в коде без переменной окружения.
- [x] 1.3 Раскладка `test/{unit,app,contract,e2e}`, projects vitest с таймаутами и ограничением параллелизма, скрипты `test:*` (§1); `unit/gates/diff-prefix`, `unit/check/interrupt`, `unit/check/check-core` → `contract/`. Проверка: `npm test` запускает четыре projects, число тестов = 686; `npm test` локально без `--maxWorkers` — результат записан в I-N.
- [x] 1.4 Проверки уровней (§8): setup-файл `SPAWN_FORBIDDEN_AT_LEVEL` для `unit`/`app`, мета-тест раскладки. Проверка: временный тест с `spawnSync` в `unit/` падает с `SPAWN_FORBIDDEN_AT_LEVEL`; файл вне уровней — мета-тест падает.

## 2. Порты, адаптеры, Ctx

- [x] 2.1 `core/ports/*`, `Ctx`, `adapters/openspec-cli` (§2): все вызовы openspec через порт, `version.ts` и `cli.ts` уходят в адаптер. Проверка: `grep` вызовов `runOpenspec` вне адаптера — пусто; все тесты зелёные.
- [x] 2.2 `adapters/git-cli` (§2): `ids/immutable.ts`, `gates/diff.ts`, `commands/classify.ts`; асинхронно (I-64). Проверка: все тесты зелёные, в том числе I-100 (prefix при 8.3/symlink).
- [x] 2.3 `adapters/check-runner` (§2): `check/runner.ts` за `CheckRunnerPort`; `today`/`warn` → `ctx` (§3). Проверка: `contract/check/interrupt`, `check-core` зелёные на обеих ОС.
- [x] 2.4 Команды получают `Ctx`; production-`ctx` в `src/bin/warrant.ts`; мета-тест «процессы только в `src/adapters/**`» (§8). Проверка: мета-тест зелёный; `warrant validate`, `status`, `resolve --explain` репозитория — вывод байт в байт как до группы.

## 3. validate

- [x] 3.1 `checkPlacement` (§4): предфильтр по тексту `REQ-`/`SCN-`, асинхронные `show` с ограничителем 6, детерминированный порядок. Проверка: тест `app` — `show` вызван только для файлов с id (журнал `FakeOpenSpec`); findings (9)–(13) на прежних фикстурах не изменились.
- [x] 3.2 Замер `warrant validate` репозитория после 3.1; > ~5 с — решение о кэше строкой I-N. Проверка: время записано в §10.

## 4. Фейки, ProjectBuilder, контракт соответствия

- [x] 4.1 `FakeOpenSpec`, `FakeGit`, `FakeCheckRunner`, `FakeClock` (§5). Проверка: unit-тесты фейков (модель, журнал, внедрение отказов).
- [x] 4.2 `ProjectBuilder` (§6) с методами, нужными первым переносимым файлам (`waive`, `transition`, `gate`). Проверка: `synced()` даёт те же сгенерированные файлы, что `warrant sync` в e2e (сравнение с `useSyncedProject`).
- [x] 4.3 Контракт соответствия (§7): `openspec`, `git`, `checks` — `describe.each([real, fake])`; `globalSetup` `contract`/`e2e` требует openspec 1.13.1; `skipIf(!openspecAvailable())` удалён. Проверка: намеренно испорченный ответ фейка роняет контракт; без openspec на PATH `contract` падает с сообщением о версии.

## 5. Перенос тестов

- [x] 5.1 `waive`, `transition`, `gate` → `app`/`unit` (§9). Проверка: SCN-теги файлов до и после совпадают; время файлов записано.
- [x] 5.2 `validate`, `validate-ids-head`, `validate-verification`. Проверка: как 5.1.
- [x] 5.3 `check`, `status`, `sync`, `verify`. Проверка: как 5.1.
- [x] 5.4 `archive`, `classify`, `init`, `link`, `exit-criterion`, `resolve`, `id`, `fmt`, `cli-skeleton`. Проверка: как 5.1.
- [x] 5.5 Остаток e2e: заголовок `// e2e: <reason>` у каждого файла, `openspec init` на тест → `useSyncedProject`, один сквозной lifecycle; `test/helpers/fake-openspec.ts` удалён; мета-тест причины e2e включён (§8). Проверка: мета-тест зелёный; `grep` `fake-openspec` — пусто.

## 6. CI, процедуры, выход

- [ ] 6.1 `.github/workflows/ci.yml`: `timeout-minutes` у job `test`, `npm test` — все projects. Проверка: CI зелёный на ubuntu и windows; время шага записано в §10.
- [ ] 6.2 `.claude/commands/group-done.md` без `--maxWorkers=3`; NEXT-SESSION — строка «Уровни тестов» в «Процессные правила → чем держатся», долг «тесты под нагрузкой» и I-64 закрыты; конвенции кода (`skipIf`, `runCli`) приведены к ADR-0025. Проверка: `git grep maxWorkers` — только конфиг vitest.
- [ ] 6.3 Критерии выхода (13 §2, строка 3c): `unit`/`app` без процессов (1.4); у каждого e2e-файла причина (5.5); `warrant validate` репозитория ≤ ~5 с (3.2); локальный `npm test` с параллелизмом по умолчанию зелёный 3 раза подряд. Проверка: колонка «После» §10 заполнена.
- [ ] 6.4 archive-PR и tag `v0.4.1` по P-2. Проверка: `warrant status` — `test-levels` `ARCHIVED`.
