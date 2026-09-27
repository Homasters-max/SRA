# Design: lattice-fixes

## Context

База — `main` на `v0.8.0` плюс документы (ADR-0042, строки BL-77…BL-85). Код CLI после `v0.8.0` не менялся. Архитектурный
вход — снимок аудита [2026-09-26-phase-4c](../../../docs/process/audits/2026-09-26-phase-4c.md): Change не фаза roadmap,
новых модулей и связей между модулями не добавляет (правки внутри `core/evidence/parsers`, `core/guard`, `core/run`,
`core/sync`, `core/errors.ts`, `io/output.ts`).

Что уже есть:
- `countJunit` (`core/evidence/parsers/junit.ts`) суммирует атрибуты `<testsuite …>` регулярным выражением; документов без
  `<testsuite>` — `INCONCLUSIVE` «no <testsuite> found». Исправление по `<testcase>` уже написано и проверено на настоящем
  отчёте `node:test` — коммит `c51bfc1` ветки `fix/lattice-junit` (PR #77 закрыт: `SCOPE_VIOLATION`).
- `defaultPrefix` (`core/guard/shell.ts`) — слова `run.command` до первого слова с `-` или `{`, пара `-m <модуль>` после первого
  (BL-61). `guardedChecks` (`core/guard/decide.ts`) даёт `prefixes: string[][]`, сопоставление — `startsWithPrefix`.
- `projectFiles` (`core/guard/guard.ts`) отбрасывает пути события вне проекта (F16) до решения; под Run `review` `decide`
  отклоняет любую оставшуюся правку. `projectPath` (`core/fs.ts`) — на `path.relative`, на win32 без учёта регистра.
- Генератор субагента (`core/sync/claude.ts`): `tools` без `Write`, хук `Bash`, сдача heredoc одной командой (I-167 `phase-4b`),
  пример envelope с `"provenance": {}` (R-22).
- `parseEnvelope` (`core/run/submit.ts`) бросает `SKILL_RESULT_INVALID` на не-JSON, не-объект и нарушение схемы; пустой stdin —
  `USAGE` (`commands/run.ts`). У `WarrantError` нет `data`: `failure` (`io/output.ts`) пишет `data: {}`.
- Находки `sync` — `SyncFinding` (`core/sync/plan.ts`) с одним кодом `REVIEWER_SKILL_MISSING`; `apply.ts` отдаёт их в
  `data.findings[]`, `init` вызывает тот же `sync`.

Нормы:
- [ADR-0042](../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) — решения maintainer'а 2026-09-28;
- ADR-0014 п. 3, ADR-0017 п. 5 (уточнены ADR-0042), ADR-0038 п. 3;
- ADR-0025 (порты, уровни тестов), ADR-0030 / ADR-0035 (ранги, реестры, храповик).

Ограничения:
- kernel-схемы не меняются; pack `core-sdd` не меняется;
- после каждой группы зелёные `warrant validate`, `fmt --check`, `sync --check`, `versions:check`;
- guard основной сессии в этом репозитории не включается (ADR-0034 п. 4).

## Goals / Non-Goals

**Goals:**
- отчёт `node:test` считается верно при любой вложенности; vitest и pytest — без изменения счёта;
- guard по умолчанию не запрещает интерпретатор целиком и ловит прямой запуск check с флагами режима;
- ревьюер сдаёт envelope любой длины файлом, не получая права писать в проект; ошибка envelope показывает, что получено;
- после `sync` / `init`, изменивших файлы frontend, пользователь знает, что сессию нужно перезапустить;
- LATTICE снимает четыре обхода одним поднятием тега.

**Non-Goals:** — proposal, раздел Non-Goals.

## Decisions

### 1. Решения ADR-0042

| # | Решение |
|---|---|
| L1 | Один Change, четыре группы; CLI 0.8.1, pack без изменений (п. 1) |
| L2 | junit по `<testcase>`; атрибуты `<testsuite>` — только без testcase (п. 2) |
| L3 | Префикс по умолчанию из одного слова-интерпретатора + флаги режима, сопоставление без порядка; явные `guard_prefixes` — строго (п. 3) |
| L4 | `warrant-reviewer` с `Write`, хук `Bash\|Write`; под Run `review` запись только во временный каталог ОС; сдача `--file`; `data.received` (п. 4) |
| L5 | `FRONTEND_RESTART_REQUIRED` у `sync` / `init` (п. 5) |

### 2. Группа 1 — parser `junit` (W-3)

- Перенос `c51bfc1` (`cherry-pick`): `countCases` — `<testcase>` с `<failure>` / `<error>` / `<skipped>` по первому дочернему
  тегу этого приоритета; `countSuites` — прежний подсчёт атрибутов; `countJunit` — по документу: `countCases ?? countSuites`;
  комментарии и CDATA вырезаются до разбора (`<!-- tests 7 -->` `node:test`, вывод тестов в `system-out`).
- Limitation пустого отчёта — `junit: no <testcase> or <testsuite> found in {out}`.
- Фикстура — настоящий отчёт `node --test --test-reporter=junit` Node 22.17 (стеки урезаны); vitest-фикстура — с полным списком
  `<testcase>`, как пишет vitest. Тест SCN-VER-117 — в `test/unit/evidence/parsers.test.ts` (токен в имени).
- Bump CLI `0.8.1` из того же коммита: `package.json`, `package-lock.json`, `kernel` в `warrant.lock.json` репозитория (`sync`) и
  трёх golden-фикстур pack; pack не меняется (`golden/` вне его hash, I-59).

### 3. Группа 2 — префикс guard (W-2)

- `core/guard/shell.ts`: тип `GuardPrefix { words: string[]; flags: string[] }`. `defaultPrefix(command)` — как прежде `words`;
  если `words` — ровно одно слово из `INTERPRETERS` (`node`, `deno`, `bun`, `python`, `python3`, `ruby`), `flags` — слова
  `command[1..]`, которые начинаются с `-` и не содержат `=` и `{`, в порядке первого появления без повторов; иначе `flags: []`.
  `matchesPrefix(command, prefix)`: `startsWithPrefix(command, words)` и каждое слово `flags` есть в `command[1..]`.
- `guardedChecks`: явные `guard_prefixes` → `{ words, flags: [] }`; `prefixes: GuardPrefix[]`. Вызов сопоставления в `decide`
  — `matchesPrefix`. Событие `guard_events[]` хранит `argv`, как прежде; форма `run/1` не меняется.
- `INTERPRETERS` — реестр `enums` `architecture.json` у владельца `core/guard/shell.ts`.
- Имя интерпретатора сравнивается точно (`node`, не `node.exe` и не путь) — как слова префикса сейчас.
- Тесты: unit `shell.test.ts` (флаги, `-m`, интерпретатор без флагов, `=`-флаг, повтор флага); app `guard` — SCN-ENF-040,
  SCN-ENF-013 и SCN-ENF-037 без правок ожидаемых значений.

### 4. Группа 3 — сдача review (W-6, BL-46, R-22)

- **Guard.** `GuardInput` получает `tmpDir` — `os.tmpdir()` в `commands/guard.ts` (граница процесса, ADR-0025; тесты подставляют
  свой каталог). `guard.ts`: кроме `projectFiles` — `outsideFiles` (абсолютные пути события вне проекта). В `decideEdit` при
  Run `review`: путь проекта — `deny` «Run review только читает» (как было); путь вне проекта, для которого
  `projectPath(tmpDir, file) === undefined`, — `deny` с reason и hint `warrant run submit --file <путь во временном каталоге>`;
  остальное — `allow`. Без Run и при других операциях пути вне проекта по-прежнему не рассматриваются.
- **Субагент.** `core/sync/claude.ts`: `tools` += `Write`; matcher хука `Bash|Write`. Раздел «Сдача результата»:
  1) собрать envelope; 2) записать его инструментом `Write` в файл во временном каталоге ОС (путь — абсолютный, вне проекта);
  3) `warrant run submit --file <путь> --dry-run`; 4) та же команда без `--dry-run`; ошибка — исправить файл и повторить с шага 3.
  Пример envelope — полный: `provenance.started_at`, `finished_at`, `model`; unit-тест извлекает пример из текста и проверяет
  схемой `skill-result/1` (R-22). `.claude/agents/warrant-reviewer.md` репозитория перегенерирует `sync`.
- **Ошибка envelope.** `WarrantError` получает необязательное `data` (`core/errors.ts`); `failure` (`io/output.ts`) кладёт его в
  `data` ответа (сейчас `{}`). `parseEnvelope` при каждом `SKILL_RESULT_INVALID` добавляет `received{ bytes, root, keys }`:
  `bytes` — `Buffer.byteLength(text, "utf8")`; `root` — `not-json`, `null`, `array` или `typeof`; `keys` — отсортированные
  ключи объекта, иначе `[]`. Значения не выводятся. Другие коды `run submit` (`RUN_NOT_ACTIVE`, `STATE_INVALID`) — без
  `received`.
- **Разбор события `Write`.** Адаптер `claude` уже нормализует `Write` в `edit` с `file_path` (matcher основной сессии
  `Edit|Write|NotebookEdit|Bash`); контракт адаптера не меняется. Если зонд покажет иной вход субагента — строка I-N.

### 5. Группа 4 — `FRONTEND_RESTART_REQUIRED` (W-5)

- `SyncFinding.code` += `FRONTEND_RESTART_REQUIRED`. `apply.ts`: после записи файлов — находка на каждый созданный, изменённый
  или удалённый путь под `.claude/agents/` и на `.claude/settings.json`, `hint` «restart the Claude Code session: agents and
  hooks are read when it starts». `sync --check` и `--dry-run` находку не дают (файлы не писались). `init` отдаёт находки
  своего `sync`.
- Тесты: app `sync`, `init` — SCN-KRN-154; SCN-KRN-139 — тело субагента с `--file`, пример проходит схему.

### 6. Документы и backlog

- 06 §2 «Execution» — строка `guard_prefixes`: умолчание с флагами режима интерпретатора; 06 §7, 07 §4 — сдача файлом во
  временном каталоге.
- `backlog.md` — удалить BL-46, BL-78, BL-80, R-22 (закрыты); W-3 строки не имеет.

### 7. Порядок групп

Группы 1 → 2 → 3 → 4, по одному коммиту на группу; группа 1 несёт bump. Группы независимы, порядок — от готового к новому.

### 8. Dogfooding

- Review этого spec-PR идёт ещё старым субагентом (heredoc); длинный envelope — известный риск BL-46, сдача из файла основной
  сессией не допускается (ADR-0042, «Alternatives»).
- Приёмка — Change LATTICE после тега `v0.8.1`: `guard_prefixes` снят, `node -e` проходит guard, review 2 `kernel-format` сдан
  субагентом файлом, отчёт `node:test` без `describe()` даёт `PROVEN` с верным числом тестов.

## Risks / Trade-offs

- [Флаг режима со значением через пробел (`--test-reporter junit`)] → флаг попадает в режим, а значение — нет: прямой запуск без
  этого флага guard пропустит. Контроль — явные `guard_prefixes`; guard — страховка от ошибки, не от обхода (INV-07).
- [Интерпретатор вызван путём или `node.exe`] → совпадения нет, запуск проходит — как у любых префиксов сейчас.
- [Ревьюер с `Write` пишет в чужие файлы временного каталога] → каталог общий для процессов пользователя, но вне проектов;
  запись в проект по-прежнему `deny`, envelope проверяет `run submit`.
- [`os.tmpdir()` guard и каталог, который выбирает Claude Code, различаются] → hint называет требование «временный каталог ОС»;
  Claude Code на Windows пишет scratchpad под `%TEMP%`, на Linux — под `/tmp`. Расхождение — строка I-N по зонду.
- [`data` у ошибок — изменение контракта вывода] → аддитивно: прочие ошибки несут `data: {}`, как прежде; golden вывода ошибок
  не меняется.

## Migration Plan

1. **Spec-PR:** артефакты, record, `classify`, review субагентом; `transition SPECIFIED` по «merge #N».
2. **Impl-PR:** первым коммитом `APPROVED --ref <URL spec-PR> --by` и `IMPLEMENTING`; группы 1–4; последним — `VERIFYING`.
   Вердикт — job `warrant`.
3. **Archive-PR:** `warrant ci fetch <impl-PR>`, `transition MERGED --ref <URL impl-PR>`, `warrant archive lattice-fixes`, тег
   `v0.8.1`, `npm link`; передача в сессию LATTICE.
4. **Откат:** `git revert` группы; схемы не менялись.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
