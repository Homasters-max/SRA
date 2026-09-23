# Proposal: test-levels

## Why

Около 250 из 686 тестов CLI запускают `warrant` отдельным процессом, а он порождает `openspec` и `git`. Полный `npm test` на
Windows в CI идёт 751 с и падает на перегрузке раннера (`Timeout calling "onTaskUpdate"`), локально с параллелизмом по умолчанию
даёт таймауты — `/group-done` держится на ручном `--maxWorkers=3` (долг «тесты под нагрузкой»). Сам `warrant validate` на
репозитории идёт около 30 с: `openspec show` на каждый Change и spec подряд.

Причина не в настройке раннера, а в том, что логика команд проверяется через самый дорогой слой. Это же блокирует фазу 5:
Stryker мутирует `src`, а e2e запускают собранный `dist`, поэтому mutation по diff (ADR-0016) на самом WARRANT невозможен, пока
логика покрыта только e2e. Фаза 4 добавит `run`, `guard`, `ci`, `analyze` — делать это нужно до неё, иначе новые команды придут
со старой схемой тестов.

## What Changes

- **Уровни тестов** `unit` / `app` / `contract` / `e2e` ([ADR-0025](../../../docs/adr/WARRANT-ADR-0025-test-levels.md)): каталог =
  уровень, project vitest на уровень, скрипты `test:unit|app|contract|e2e|fast`, таймауты и параллелизм по уровню в конфиге.
- **Порты процессов и `Ctx`**: `OpenSpecPort`, `GitPort`, `CheckRunnerPort`, `clock`; команды и функции `core`, обращающиеся к
  порту, получают `Ctx` вместо `root`; порождение процессов — только в адаптерах.
- **Фейки с контрактом соответствия**: `FakeOpenSpec` (модель от `ProjectBuilder`, без разбора markdown), `FakeGit` (снимки
  деревьев), фейк запуска checks; набор `contract`, который проходят и адаптер, и фейк. Shim `openspec` на `PATH` удаляется.
- **Перенос тестов**: каждый из 20 e2e-файлов с процессами пересматривается — тест уходит в `app`/`unit` или остаётся в e2e с
  причиной из закрытого списка.
- **Проверки правила уровней**: запрет процессов в `unit`/`app` (setup-файл), заголовок `// e2e: <reason>`, файл вне уровней —
  ошибка; строка в таблице «Процессные правила» NEXT-SESSION.
- **`validate`**: `openspec show` только для Changes и specs, где есть `REQ-`/`SCN-`, асинхронно с ограниченным параллелизмом.
- **CI**: `timeout-minutes` у job `test`; все уровни на ubuntu и windows на каждом PR.
- CLI `0.4.0 → 0.4.1` (R-14). Pack `core-sdd` не меняется.

## Capabilities

### New Capabilities

Нет.

### Modified Capabilities

Нет — наблюдаемое поведение CLI не меняется (`skip_specs: true`): вывод, коды выхода и findings `validate` те же, меняются
только внутренняя структура, тесты и время выполнения.

## Impact

- `packages/cli/src/**`: новые `core/ports/*` и адаптеры; сигнатуры команд и части `core` (`root` → `ctx`); `core/ids/scan.ts`
  (`checkPlacement`); `src/bin/warrant.ts` собирает production-`ctx`.
- `packages/cli/test/**`: новая раскладка, helpers `ProjectBuilder`, фейки, мета-тесты; удаление `fake-openspec.ts`.
- `packages/cli/vitest.config.ts`, корневой `package.json` (скрипты, версия), `.github/workflows/ci.yml`,
  `.claude/commands/group-done.md`.
- Документы: ADR-0025 (+ `amended_by` в ADR-0016), 02 §5, 13 §2, NEXT-SESSION.

## Non-Goals

- Изменение поведения команд, схем, pack `core-sdd`, main specs.
- Классификация уровней тестов для проектов под WARRANT (`test_kind`, уровень `@SCN`-тестов) — фаза 5, pack `bdd-tdd`.
- Mutation testing самого WARRANT (Stryker) — фаза 5; здесь только условие для него.
- Кэш вывода `openspec show` — только если замер после §9 ADR-0025 покажет `validate` дольше ~5 с.
- Порт файловой системы, контейнер зависимостей, публичный library-API WARRANT.
- Ночные прогоны, шардирование CI, подбор числа workers сверх ограничения тяжёлых уровней.
