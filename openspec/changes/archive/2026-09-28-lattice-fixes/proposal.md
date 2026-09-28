# Proposal: lattice-fixes

## Why

LATTICE — второй проект под WARRANT и первый на TypeScript / `node:test`. За bootstrap и половину spec-PR `kernel-format`
он упёрся в продукт 12 раз (W-1…W-12, строки `docs/backlog.md` с источником «подключение LATTICE»). Четыре отказа LATTICE
обходит, но обход — не норма (maintainer, 2026-09-28):

- **junit не видит `node:test` (W-3).** Parser суммирует атрибуты `<testsuite>`. `node --test --test-reporter=junit` кладёт
  тесты вне `describe()` прямо в `<testsuites>` и считает вложенный suite тестом родителя. Набор из одних `test()` —
  `INCONCLUSIVE`; с вложенными `describe` счёт двоится (4 / 2 / 1 вместо 3 / 1 / 0 на настоящем отчёте Node 22.17).
- **Guard запрещает любой `node` (W-2).** Префикс по умолчанию — слова `run.command` до первого флага. У check
  `node --experimental-strip-types --test …` это `node`: запрещены `node -e`, `node --version`, скрипты.
- **Длинный envelope review не сдаётся (W-6, BL-46).** Heredoc длиннее ~8 тыс. символов ломается до `warrant`; файл для
  `run submit --file` субагенту не записать — нет `Write`, а guard Run `review` пускает только `warrant run submit`.
  Ошибка `SKILL_RESULT_INVALID` не говорит, что получено.
- **Агент не виден после `sync` (W-5).** Claude Code читает агентов и hooks при старте сессии; вывод `sync` об этом молчит.

Решения — [ADR-0042](../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md). Исправление W-3 веткой `fix/` отклонил
`warrant ci` (`SCOPE_VIOLATION`, ADR-0038 п. 3) — правка судьи идёт этим Change.

## What Changes

- **Parser `junit` по `<testcase>`** (W-3): `tests`, `failures`, `errors`, `skipped` — по элементам `<testcase>` и их дочерним
  `<failure>`, `<error>`, `<skipped>`, где бы они ни лежали; комментарии и CDATA — не разметка; атрибуты `<testsuite>` — только у
  документа без `<testcase>`.
- **Префикс guard с флагами режима** (W-2): префикс по умолчанию из одного слова-интерпретатора (`node`, `deno`, `bun`, `python`,
  `python3`, `ruby`) дополняется флагами режима `run.command` (начинаются с `-`, без `=` и `{`); команда совпадает, если её первое
  слово — интерпретатор и в ней есть каждый флаг режима, в любом порядке. Явные `guard_prefixes` — строгий префикс, как прежде.
- **Сдача review файлом** (W-6, BL-46, R-22):
  - субагент `warrant-reviewer` получает `Write`, хук frontmatter — matcher `Bash|Write`;
  - guard под Run `review` отклоняет правку пути вне проекта, если он не во временном каталоге ОС; правка проекта — `deny`, как
    прежде;
  - инструкция сдачи: envelope файлом во временном каталоге, `warrant run submit --file <путь> --dry-run`, затем без
    `--dry-run`; пример envelope проходит схему;
  - `SKILL_RESULT_INVALID` несёт `data.received{ bytes, root, keys[] }`.
- **Находка `FRONTEND_RESTART_REQUIRED`** (W-5) у `sync` и `init --frontend claude`, изменивших `.claude/agents/**` или
  `.claude/settings.json`.
- **Версии:** CLI `0.8.0 → 0.8.1`; pack `core-sdd` без изменений (`kernel: ">=0.1 <0.9"`).

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`:
  - REQ-VER-002 — parser `junit` по `<testcase>`.
- `enforcement`:
  - REQ-ENF-004 — префикс с флагами режима интерпретатора, правка вне проекта под Run `review`;
  - REQ-ENF-007 — `data.received` у `SKILL_RESULT_INVALID`.
- `kernel`:
  - REQ-KRN-033 — субагент с `Write` и хуком `Bash|Write`, сдача `--file`, `FRONTEND_RESTART_REQUIRED`.

## Non-Goals

- **Bootstrap-PR и `BOOTSTRAP_PR`** (W-1, BL-77), **`init` без hooks** (W-11, BL-84) — фаза 5.
- **Команды только для чтения и `run cancel` в Run `review`** (W-7, BL-81) — ADR, фаза 5.
- **Навыки процесса и шаблон правила `process` в продукте** (W-9, W-4, W-12; BL-82, BL-79, BL-85) — grilling и ADR, фаза 5.
- **Идентичность агента** (W-10, BL-83) — решение maintainer'а вместе с BL-44, BL-75.
- **Резерв `warrant id`** (W-8, BL-62) — вместе с BL-76.
- **Находка `validate` для префикса из одного слова-интерпретатора без флагов режима** — по failure mode.

## Impact

- `packages/cli/src`:
  - `core/evidence/parsers/junit.ts`;
  - `core/guard/shell.ts` (префикс по умолчанию), `core/guard/decide.ts` (сопоставление, правка под Run `review`),
    `core/guard/guard.ts` (пути вне проекта), `commands/guard.ts` (временный каталог);
  - `core/run/submit.ts`, `core/errors.ts` (`data` ошибки);
  - `core/sync/claude.ts` (субагент), `core/sync/plan.ts`, `core/sync/apply.ts` (находка), `commands/init.ts`.
- `packages/cli/test`: unit parser junit и префикса guard; app `guard`, `run submit`, `sync`, `init`; контракт адаптера
  `claude` — только если меняется разбор события `Write`.
- `package.json` (версия), `warrant.lock.json` репозитория и golden-фикстур (`kernel`).
- `.claude/agents/warrant-reviewer.md` этого репозитория — перегенерирует `warrant sync`.
- `docs/`: 06 §2 «Execution» (`guard_prefixes` по умолчанию), 06 §7 и 07 §4 (субагент review, сдача `--file`); `backlog.md` — закрытые строки.
- **BREAKING** (внешних пользователей нет, ADR-0013): проект после обновления CLI получает `GENERATED_DRIFT` по файлу субагента
  до `warrant sync`.
