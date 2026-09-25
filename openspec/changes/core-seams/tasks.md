# Tasks

После каждой группы: `npm test`, `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`,
`npm run versions:check` зелёные (`/group-done`); коммит на группу в `worktree/core-seams`; после группы —
`/group-stats`. Поведение CLI не меняется: golden, `app`, `contract`, `e2e` — без правок ожидаемых значений (design §9);
правка ожидаемого значения — остановка и строка I-N (с I-148). Перенос символа — по `cs impact <символ>`. §N — разделы
design.md, A-N и BL-N — [docs/backlog.md](../../../docs/backlog.md).

## 1. Bump и храповик ADR-0035

- [x] 1.1 Bump CLI `0.4.3` (`package.json`, `package-lock.json`, `.warrant/warrant.lock.json`, `warrant.lock.json`
  golden-фикстур — как I-142). Проверка: `npm run versions:check` зелёный.
- [x] 1.2 `architecture.json`: секции `packages` и `test_helpers` (§1). `architecture.test.ts`: правила `package` и
  `test-helper`, храповик для обоих. Проверка: временное нарушение каждого правила и лишнее исключение роняют тест
  (способ — строкой I-N, как I-140); тест не порождает процессов.
- [x] 1.3 Диалект Ajv (§7): `createAjv()` в `core/schemas/loader.ts`, `core/validate/evidence.ts` — через него.
  Проверка: импорт `ajv` / `ajv-formats` только в `loader.ts`; исключений `package` на `ajv` нет.
- [x] 1.4 Стартовые исключения: `package` `picomatch` ×3 — A-16, `test-helper` `git` ×9, `write` ×10 — A-18; нарушение
  без строки долга — вопрос maintainer'у. Проверка: тест зелёный; число исключений по правилам — в таблице I-N.

## 2. `WarrantConfig` (A-15)

- [x] 2.1 `core/config.ts` (§2): `CONFIG_REL`, `loadConfig` (переезд без правок сообщений), `WarrantConfig`,
  `PackEntry`, `testFiles`; модуль `core/config` в `architecture.json`; `LoadResult.config` — `WarrantConfig`.
  Проверка: `cs impact loadConfig` — все места переведены.
- [x] 2.2 8 чтений `config["…"]` (§2) — через `WarrantConfig`; `renumber.ts` получает конфиг от вызывающего.
  Отступления `renumber` — строкой I-N. Проверка: `cs grep 'config["' --in packages/cli/src` — 0; golden байт в байт.
- [x] 2.3 `test/unit/config/config.test.ts`: свойства `config/1` ↔ поля `WarrantConfig`, сборка на примере 08 §3.
  Проверка: новое свойство схемы без решения роняет тест (временная правка, откат).

## 3. Пути проекта и glob (A-16)

- [x] 3.1 `core/glob.ts` `pathMatcher` (§3); `classify/index.ts`, `gates/l0/scope-valid.ts`, `gates/verdict.ts` — через
  него; модуль `core/glob`, помощник `pathMatcher` в реестре. Проверка: исключения `package` A-16 сняты.
- [x] 3.2 `core/git/paths.ts`: `toProjectPaths`, `changedFromGit` из `commands/classify.ts`; `relativeToProject` — через
  `toProjectPaths`; помощник `toProjectPaths` в реестре. Проверка: `cs grep 'prefix.length + 1' --fixed` — одно место;
  `contract/gates/diff-prefix` зелёный на ubuntu и windows (I-100).

## 4. Предикат «waiver в силе» (A-14)

- [x] 4.1 `countingWaiverIds` в `core/waivers/status.ts` (§4); `evaluateGates` и `ensureApproval` — через него;
  `isWaiverInForce`, `activeWaiverIds` удалены. Отступление `ensureApproval` — строкой I-N. Проверка: `cs impact
  activeWaiverIds` — 0 мест; тесты `transition` (повторное использование `human-approval`) зелёные без правок.
- [x] 4.2 `WAIVER_MOVES` в `core/waivers/status.ts`, перечисление `waiver-state` в реестре `enums`. Проверка: сообщения
  `waive --activate` / `--revoke` прежние; литералов `waiver-state` вне владельца нет.

## 5. Фабрика ошибки и `findChangeDir` (A-17, A-8)

- [ ] 5.1 `cliError` в `core/errors.ts` (§5); 4 копии `err` удалены; реестр `err` → `cliError`. Проверка: исключения
  `helper` A-17 сняты.
- [ ] 5.2 `core/openspec/changes.ts`: `findChangeDir`, `ChangeDirLocation`; 6 импортёров переведены; помощник в
  реестре. Проверка: `cs deps packages/cli/src --level 2` — рёбер `ids → init`, `status → init`, `transition → init`
  ради `findChangeDir` нет.

## 6. Помощники тестов (A-18)

- [ ] 6.1 `test/helpers/git.ts` (§6); 9 копий `git` удалены. Проверка: исключения `test-helper` `git` сняты; e2e и
  contract зелёные на ubuntu и windows.
- [ ] 6.2 10 копий `write` удалены, импорт из `helpers/synced.ts`; зависимость от байтов — строкой вызова (§6).
  Проверка: исключения `test-helper` `write` сняты; ожидаемые значения не менялись.

## 7. Теги SCN (BL-26)

- [ ] 7.1 35 сценариев (design Context) — тег в держащем тесте или новый тест (§8). Проверка: `node
  scripts/dev/scn-coverage.js --main` — 199/199 или остаток с причиной строкой I-N.

## 8. Выход

- [ ] 8.1 Backlog: строки A-8, A-14…A-18 удалены (исключений храповика у них нет); BL-26 удалена или сужена до
  остатка 7.1; строка A-19 (копия проверки диапазона `semver`) — на месте. Навык `architecture-audit`: кандидаты реестра
  пакетов — из внешних импортов (ADR-0035 Consequences). Проверка: исключения храповика — только A-12;
  `dev-context.test.ts` зелёный.
- [ ] 8.2 Критерии выхода (13 §2, строка 3e). Проверка: все пункты строки выполнены; CI зелёный на ubuntu и windows.
- [ ] 8.3 archive-PR и tag `v0.4.3` по P-2. Проверка: `warrant status` — `core-seams` `ARCHIVED`.
