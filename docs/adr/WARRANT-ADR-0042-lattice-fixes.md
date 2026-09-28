---
id: WARRANT-ADR-0042
title: Change `lattice-fixes` по отказам подключения LATTICE — junit по `<testcase>`, префикс guard с флагами режима интерпретатора, сдача review файлом во временном каталоге, подсказка перезапуска сессии, CLI 0.8.1
adr_state: ACCEPTED
date: 2026-09-28
supersedes: []
amends: [WARRANT-ADR-0014, WARRANT-ADR-0017, WARRANT-ADR-0033]
---

## Context

LATTICE (`Homasters-max/LATTICE`) — второй проект под WARRANT и первый на TypeScript / `node:test`. За bootstrap и половину spec-PR `kernel-format` он упёрся в продукт 12 раз (W-1…W-12); строки — `docs/backlog.md`, источник «подключение LATTICE». Четыре отказа LATTICE обходит, но обход — не норма (maintainer, 2026-09-28).

Факты на 2026-09-28 (v0.8.0):

- **junit (W-3).** Parser `junit` суммирует атрибуты `<testsuite …>` (design §5 `phase-3-verification`). Отчёт `node --test --test-reporter=junit` (Node 22.17) кладёт тесты вне `describe()` прямо в `<testsuites>`, а в атрибуты `<testsuite>` пишет число прямых детей вместе с вложенными suite. Набор из одних `test()` — `INCONCLUSIVE` («no <testsuite>»). С вложенными `describe` счёт двоится: на настоящем отчёте 4 теста / 2 падения / 1 пропуск вместо 3 / 1 / 0. Статус верен (ненулевой код выхода не даёт ложного `PROVEN`), числа evidence — нет. Обход LATTICE «каждый тест внутри `describe()`» двойного счёта не снимает.
- **Префикс guard (W-2).** Без `execution.guard_prefixes` префикс — слова `run.command` до первого флага; пара `-m <модуль>` — часть префикса (BL-61, SCN-ENF-037). У check `node --experimental-strip-types --test …` префикс — `node`: guard запрещает `node -e`, `node --version`, любые скрипты. Обход — `guard_prefixes` в локальном check.
- **Сдача review (W-6, BL-46).** Субагент `warrant-reviewer` сдаёт envelope одной командой с heredoc (I-167 design `phase-4b`). Envelope длиннее ~8 тыс. символов ломается до `warrant` (Bash-инструмент Claude Code на Windows) или доходит искажённым; ошибка `SKILL_RESULT_INVALID` не говорит, что получено. Файл для `run submit --file` субагенту не записать: у него нет `Write` (ADR-0014 п. 3), а guard Run `review` пропускает из shell только `warrant run submit`. Guard отбрасывает пути вне проекта (F16), поэтому запись вне корня под Run `review` не отклоняется.
- **Перезапуск сессии (W-5).** Claude Code читает `.claude/agents/**` и hooks `.claude/settings.json` при старте сессии; после `init --frontend claude` / `sync` в той же сессии `Agent type 'warrant-reviewer' not found`, вывод молчит.
- **Путь правки.** `fix/lattice-junit` (PR #77) отклонён `warrant ci`: `SCOPE_VIOLATION` — судья `packages/cli/src/**`, lock и golden pack — policy-пути `factory-change`, их меняет только PR Change ([ADR-0038](WARRANT-ADR-0038-pr-judged-by-base.md) п. 3).

## Decision

1. **Change `lattice-fixes`** — один Change WARRANT, profile `factory-change`. Группы по порядку: (1) junit (п. 2); (2) префикс guard (п. 3); (3) сдача review (п. 4); (4) подсказка перезапуска (п. 5). CLI **0.8.1**, pack `core-sdd` не меняется (`kernel: ">=0.1 <0.9"`). Остальные W — нарезка фазы 5 (строки BL-77, BL-79, BL-81…BL-85, BL-62). Приёмка — Change LATTICE, который поднимает тег CLI и снимает обходы (`guard_prefixes`, сдача из основной сессии, новая сессия после `sync`); ведёт его сессия LATTICE.
2. **junit по `<testcase>`** (W-3; отступление от design §5 `phase-3-verification`). Документ считается по элементам `<testcase>`, где бы они ни лежали: с дочерним `<failure>` — падение, `<error>` — ошибка, `<skipped>` — пропуск; комментарии и CDATA — не разметка. Атрибуты `<testsuite>` — только у документа без единого `<testcase>` (`<testsuites>` не суммируется). Для vitest и pytest, которые пишут все testcase, счёт не меняется.
3. **Префикс guard: флаги режима интерпретатора** (W-2; уточняет ADR-0017 п. 5). Правило слов до первого флага и пара `-m <модуль>` остаются. Если префикс по умолчанию вышел одним словом из списка интерпретаторов (`node`, `deno`, `bun`, `python`, `python3`, `ruby`), к нему добавляются флаги режима — слова `run.command`, начинающиеся с `-`, без `=` и без плейсхолдера `{…}`. Простая команда совпадает с таким префиксом, если её первое слово — интерпретатор и среди остальных слов есть каждый флаг режима, в любом порядке. LATTICE: `node` + {`--experimental-strip-types`, `--test`} — `node -e`, `node --version`, `node scripts/x.js` разрешены, `node --experimental-strip-types --test x` — `deny`. Явные `guard_prefixes` — прежний строгий префикс. Интерпретатор без флагов режима — прежнее правило.
4. **Сдача review файлом во временном каталоге** (W-6, BL-46; уточняет ADR-0014 п. 3 и I-167 design `phase-4b`):
   - субагент `warrant-reviewer` получает `Write` (`Edit`, `NotebookEdit` — нет); хук frontmatter — matcher `Bash|Write` → `warrant guard --frontend claude`;
   - под Run `review` guard отклоняет правку любого пути проекта (как было) и любого пути вне временного каталога ОС; разрешена только запись во временный каталог;
   - сгенерированная инструкция сдачи: envelope — файлом во временном каталоге ОС, `warrant run submit --file <путь> --dry-run`, затем без `--dry-run`; пример envelope — полный, с `provenance.started_at` / `finished_at` (R-22);
   - `SKILL_RESULT_INVALID` несёт в `data.received` число байт, тип корня и ключи верхнего уровня, без содержимого. Envelope не проходит через сессию автора spec.
5. **Подсказка перезапуска** (W-5). `sync` и `init --frontend claude`, создавшие или изменившие `.claude/agents/**` или `.claude/settings.json`, дают в `data.findings[]` находку `FRONTEND_RESTART_REQUIRED` с `path` и `hint` «перезапустите сессию Claude Code: агенты и hooks читаются при старте»; код выхода — 0.
6. **`fix/` — только вне policy-путей `factory-change`** (уточняет [ADR-0033](WARRANT-ADR-0033-git-process.md) п. 10 по ADR-0038 п. 3). Правка судьи (`packages/cli/src/**`, lock, `packs/**`) — Change; `fix/` — тесты, dev-скрипты, документы.

## Consequences

- ADR-0014 п. 3, ADR-0017 п. 5 — заметки `amended_by`.
- Delta specs `lattice-fixes`: REQ-VER-002 (parser `junit`), REQ-ENF-004 (префикс guard, запись под Run `review`), REQ-ENF-007 (`data.received`), REQ-KRN-033 (субагент с `Write`, matcher `Bash|Write`, порядок сдачи, `FRONTEND_RESTART_REQUIRED`).
- `docs/backlog.md`: «Куда» BL-46, BL-78, BL-80 — `lattice-fixes`; R-22 — с BL-46.
- Навык `git-start`: `fix/` — без policy-путей `factory-change`.
- Коммит `c51bfc1` ветки `fix/lattice-junit` (junit, bump) переходит в impl-PR; ветка удаляется после него.
- После archive-PR — тег `v0.8.1`, `npm link` из основного checkout, передача в сессию LATTICE.

## Alternatives

- **Префикс до первого плейсхолдера или позиционного аргумента** (предложение W-2) — отвергнуто: прямой запуск без reporter-флагов (`node --test x`) guard не ловит, `["pytest", "-q"]` даёт префикс `pytest -q` — ломает SCN-ENF-013.
- **Отказ `validate` при префиксе из одного слова-интерпретатора** — отвергнуто maintainer'ом: обязанность конфигурации вместо рабочего умолчания.
- **Envelope сдаёт основная сессия** — отвергнуто: envelope проходит через сессию автора spec и правится до сдачи.
- **`Write` ревьюера вне проекта без ограничения каталогом** — отвергнуто: субагент review пишет в чужие файлы диска.
- **Сдача частями или лимит длины envelope** — отвергнуто: новая форма `run submit` ради ограничения инструмента.
- **Исправление `fix/` без Change** — невозможно: ADR-0038 п. 3 (PR #77).
- **Все W одним Change** — отвергнуто: W-9, W-10, W-7 требуют grilling и ADR; патч задержал бы обходы LATTICE.
