# Tasks

Потолок: 6 групп (Q16). После каждой группы: `npm test`, `npm run typecheck`, `warrant validate`, `warrant fmt --check`,
`warrant sync --check`, `npm run versions:check` зелёные (`/group-done`); коммит на группу в `worktree/arch-boundaries`;
после группы — `/group-stats` (группы 1–3 — замер ADR-0029 п. 8). Поведение CLI не меняется: golden, `app`, `contract`,
`e2e` — без правок, кроме путей импорта (design §8); правка ожидаемого значения — остановка и строка I-N (с I-140).
Перенос символа — по `cs impact <символ>`. §N — разделы design.md, A-N — «Архитектурный долг» docs/NEXT-SESSION.md.

## 1. Архитектурный тест и храповик

- [x] 1.1 Bump CLI `0.4.2` (`package.json`, `packages/cli/package.json`). Проверка: `npm run versions:check` зелёный.
- [x] 1.2 `test/unit/meta/architecture.json` (§1): модули с рангами R0–R4 и слои по ADR-0030 п. 1 — для модулей, которых
  ещё нет (`core/fs`, `core/json`, `core/git`, `core/waivers`, `core/roles`, `core/transition`), строки добавляет группа,
  которая их создаёт; реестры помощников и перечислений (§1). Проверка: каждое значение перечислений найдено в 02 / 04.
- [x] 1.3 `test/unit/meta/architecture.test.ts` (§2): правила `module`, `rank`, `cycle`, `sibling`, `helper`, `enum` и
  «исключение ничего не прикрывает». Проверка: временное нарушение каждого правила роняет тест (способ — строкой I-N);
  тест не порождает процессов.
- [x] 1.4 Стартовые исключения (§3) — все нарушения на коммите группы, каждое с A-N; нарушение без строки долга — вопрос
  maintainer'у. Проверка: тест зелёный; число исключений по правилам записано в §10.

## 2. `core/fs`, `core/json` (A-3, A-4, A-5 — guard)

- [x] 2.1 `core/fs.ts` (`reportPath`, `walkFiles`, `readJson`, `posix`), `core/json.ts` (`isPlainObject`, `strings`); строки
  модулей в `architecture.json` (§4). Проверка: `cs impact` каждого символа — все места переведены; исключения `helper`
  A-5 и A-3 сняты.
- [x] 2.2 `weakenings` → `core/packs/overrides.ts`. Проверка: `cs deps packages/cli/src --level 2 --cycles --runtime` —
  цикла `core/canon ↔ core/packs` нет; исключение A-4 снято.

## 3. Владелец lifecycle и перечислений (A-1, A-13)

- [x] 3.1 `core/record/lifecycle.ts` (§5); копии в `commands/check.ts`, `commands/gate.ts`, `core/ids/immutable.ts` удалены.
  Проверка: исключения `enum` A-1 сняты; `cs grep '"IMPLEMENTING"' --fixed` — массивы только у владельца.
- [x] 3.2 A-13: `RISK_LEVELS`, `PASSING_VERDICTS` и прочие подмножества по реестру — у владельцев (§5). Проверка:
  исключения `enum` A-13 сняты.

## 4. `core/git`, `core/waivers`, `core/roles`, разбор в адаптерах (A-6, A-7, A-10, A-11)

- [x] 4.1 `core/git/facts.ts` (§6); `parseNameStatus` → `adapters/git-cli.ts`. Проверка: исключения A-6 сняты;
  `contract/gates/diff-prefix` зелёный на ubuntu и windows (I-100).
- [x] 4.2 Типы статусов артефактов → `core/ports/openspec.ts`, `parseOpenspecStatus` → `adapters/openspec-cli.ts`.
  Проверка: исключения A-10, A-11 сняты; цикл `core ↔ core/ports ↔ core/openspec` исчез.
- [x] 4.3 `core/waivers/`, `core/roles.ts` (§6); `classify` не импортирует `transition`. Проверка: исключения A-7 сняты;
  срезы `runTransition` / `runStatus` (`arch-snapshot.js`) без `core/validate` ради waivers.

## 5. `core/transition` (A-2)

- [x] 5.1 Шаги сценария → `core/transition/`, `core/check/`, `core/evidence/` без смены сигнатур (§7). Проверка: все тесты
  зелёные без правок ожидаемых значений.
- [x] 5.2 `evaluate(ctx, change, opts)`; `verify`, `archive`, `gate`, `status`, `transition` переведены; `init` зовёт
  применение sync из `core/sync`. Проверка: исключений `sibling` нет; golden байт в байт.
- [x] 5.3 `app`-тест `core/transition/evaluate` через `ctx` (конфликт policy, успех, отказ gate) (§8). Проверка: тест в
  `test/app/`, без процессов.
- [x] 5.4 Снимок `arch-snapshot.js --against docs/process/audits/2026-09-24.json`, колонка «После» §10. Проверка: циклов
  runtime 0, рёбер `commands → commands` нет.

## 6. Выход

- [x] 6.1 NEXT-SESSION: строки A-1…A-7, A-10, A-11, A-13 зачёркнуты со ссылкой на impl-PR; оставшиеся исключения
  храповика совпадают с открытыми A-N; строка «Направление зависимостей…» в «Процессные правила» — «держится
  `architecture.test.ts`». Проверка: число исключений в §10 = число открытых A-N с правилом.
- [x] 6.2 Критерии выхода (13 §2, строка 3d). Проверка: все пункты строки выполнены; CI зелёный на ubuntu и windows.
- [x] 6.3 archive-PR и tag `v0.4.2` по P-2. Проверка: `warrant status` — `arch-boundaries` `ARCHIVED`.
