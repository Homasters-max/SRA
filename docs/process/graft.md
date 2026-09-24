---
status: closed
adr: WARRANT-ADR-0026
amended_by: [WARRANT-ADR-0027, WARRANT-ADR-0028, WARRANT-ADR-0029]
graft_version: 0.19.0
---

# Graft в разработке WARRANT

Эксперимент [ADR-0026](../adr/WARRANT-ADR-0026-graft-experiment.md) / [ADR-0027](../adr/WARRANT-ADR-0027-graft-tuning.md)
**закрыт** 2026-09-24: вердикт `accept` — [отчёт](graft-report.md), решение — [ADR-0028](../adr/WARRANT-ADR-0028-graft-adoption.md).
Поиск по коду через граф — стандарт субагентов разработки WARRANT: навык
[code-search](../../.claude/skills/code-search/SKILL.md), раздача групп — [coordinator.md](coordinator.md). Здесь —
установка, обёртка, хуки, наблюдение, обновление, откат; §6 — протокол бенчмарка и регрессии графа (при обновлении).
Аудит после принятия — [graft-audit.md](graft-audit.md), решения — [ADR-0029](../adr/WARRANT-ADR-0029-graft-audit-dev-hooks.md).

## 1. Итог

Бенчмарк (8 вопросов, пары `[A]`/`[B]`): прочитанное при исследовании — медиана отношения 0,54, токены −22 %,
вызовы −29 %, recall и precision 1,0 у обеих меток. Поле (`test-levels`) — то же направление, неверных ответов,
приведших к ошибке, — 0. Риски — [отчёт](graft-report.md) §4.

## 2. Установка (один раз на машину)

```bash
export DO_NOT_TRACK=1
npm i -g @nanonets/graft@0.19.0
graft telemetry disable
setx GRAFT_NO_GITIGNORE 1
setx GRAFT_NO_IGNORE 1
setx DO_NOT_TRACK 1
```

`DO_NOT_TRACK` — до установки: `postinstall` отправляет событие `install` (`setx` на текущую оболочку не действует).
`graft telemetry disable` записывает отказ в `~/.graft/telemetry.json`. Ежедневная проверка обновлений (`npm view`)
этими переменными не выключается; на Windows она падает с `ENOENT` и в сеть не ходит.

В `$(git rev-parse --git-common-dir)/info/exclude` — строки `graft/` и `.graft/` (общие для всех worktree).
Путь установки — короткий: нативная сборка `tree-sitter-kotlin` падает с `C1258` при пути длиннее 260 символов
(MAX_PATH); глобальная установка npm проходит. `cs.js` зависит только от node — `npm ci` для него не нужен.

## 3. Обёртка `cs` и навык

- `scripts/dev/cs.js` (логика — `cs-lib.js`, unit-тесты `test/unit/dev/cs.test.ts`) — единственный вход к graft.
  Подкоманды graft: `ask`, `grep`, `skeleton`, `callers`, `map`, `version`; свои: `impact` (вызовы по графу и по имени —
  список правок), `deps` (импорты файла, граф модулей, циклы — по рёбрам `imports` индекса), `dups` (одноимённые
  определения). Флаги и число позиционных — белым списком на подкоманду, `--json` у всех (иначе код 2); graft
  запускается `node <пакет>/<bin>` того пакета, чья версия проверена (≠ `GRAFT_VERSION` или `graft/` не исключён —
  код 3); `GRAFT_*` окружения удаляются, переменные гигиены и телеметрии ставятся; индекс строится под замком;
  таймаут 120 с; строки «tokens saved» вырезаются, подсказки `graft <sub>` переписываются в `cs <sub>`; вывод
  `callers` — до 80 строк.
- [.claude/skills/code-search/SKILL.md](../../.claude/skills/code-search/SKILL.md) — алгоритм (правила 1–6, команды,
  сценарии); навык вызывается моделью сам, субагенту указатель на него даёт хук `SubagentStart`.
- **Хуки разработки** (ADR-0029 п. 6, ADR-0031): `.claude/settings.json` — только `hooks`, команды —
  `scripts/dev/cs-hook.js`: `SubagentStart` (указатель на навык, `cs impact`, `cs map`); `PreToolUse` на
  `Read|Grep|Bash|PowerShell` у субагентов — **запрет** (`deny`) вызова, который детектор отступлений помечает по
  входу, причина — что сделать вместо; `PostToolUse` на `Read|Grep|Glob|Bash|PowerShell` у субагентов — предупреждение
  для видимого только по выводу. Код для детектора — `.ts`/`.js` под `packages/`, `scripts/` рабочего дерева WARRANT
  (ближайший `.git` с `scripts/dev/cs.js`); основную сессию хуки не ограничивают. Форму файла держит
  `test/unit/meta/dev-hooks.test.ts`. Отключить у себя — `"disableAllHooks": true` в `.claude/settings.local.json`
  (выключает и пользовательские хуки).
- `graft init`, `upgrade`, `mcp`, `brain`, хуки самого graft, MCP, statusline — не используются (ADR-0026 п. 2).

## 4. Метрики

| Метрика | Откуда |
|---|---|
| `ingest.explore_bytes`, `explore_before_edit_bytes` | байты результатов исследующих вызовов (Read/Grep/Glob, `cat`/`sed -n`/`grep`/…, `cs`), всего и до первой правки |
| `ingest.cs_bytes`, `results_bytes` | доля `cs`; все результаты инструментов |
| `tokens.*`, `tool_calls.*`, `graft_commands` | usage (раз на `message.id`), `tool_use` (раз на id), команды `cs.js` / `graft` |
| `tool_calls.blocked` | вызовы, отклонённые хуком `PreToolUse` (ADR-0031): результат — ошибка с текстом причины `code-search: …`; не выполнялись — не отступления и без байтов |
| `deviations`, `compliant` | отступления от правил навыка (> 3 — `compliant: false`); тот же детектор `deviationsOf`, что у хуков `PreToolUse` / `PostToolUse`; чтение целиком — и диапазоном, покрывающим файл (кроме файлов до 40 строк); не отступления: запись файлов, JSON / конфиги / документы, `node_modules`, список файлов |
| `score.recall`, `precision` (бенчмарк) | ответ агента против эталона |
| `card.red_runs`, `helped`, `misled`, `notes` (поле) | координатор по отчёту субагента |

## 5. Наблюдение и пересмотр (ADR-0028 п. 5, ADR-0029 п. 8, ADR-0031)

- **База для сравнения после ADR-0029** — группы `test-levels` `[A]` (g1, g3, g5), пересчитанные детектором
  ADR-0029 (`rescore`; прежние записи — `graft-lab/runs-before-audit/`). Сравнение сделано на группах 1–3
  `arch-boundaries` → решение о `PreToolUse deny` (ADR-0031).
- **После ADR-0031** записи пересчитаны с областью кода H-1 (`arch-boundaries` g3: отступлений 2 → 1, прочие без
  изменений). Следующие 2–3 группы сравниваются с `arch-boundaries` g1–g3 и базой `test-levels` `[A]`: отступления
  (должны остаться только видимые по выводу), `tool_calls.blocked`, `explore_bytes`; отказ, мешавший законной работе, —
  в `notes` и повод пересмотра ADR-0031 п. 5.

- После каждой группы — `graft-metrics.js run --mode on` (`/group-stats`, [coordinator.md](coordinator.md) §3);
  записи — `<git-common-dir>/graft-lab/runs/`, транскрипты — `graft-lab/transcripts/` (вне git); пересчёт —
  `graft-metrics.js rescore`, сводка — `graft-metrics.js report`.
- **`misled`** (неверный ответ `cs` привёл к ошибке) — условие пересмотра ADR-0028; случай оформить вопросом в
  бенчмарк (`scripts/dev/bench/code-search.json`), эталон — `node scripts/dev/graph-audit.js callers <file>#<Name>`
  на базовом коммите.
- **Остановка** (как ADR-0026 п. 7): `cs` вернул код 3 или дерево грязное из-за graft; установка сломалась.

## 6. Бенчмарк — протокол и регрессия при обновлении Graft (ADR-0028 п. 4)

- Вопросы и эталон — `scripts/dev/bench/code-search.json` (эталон — по AST TypeScript на базовом коммите, без graft):
  q1–q8 — эксперимент, q9–q17 — различающие вопросы аудита (порты, одноимённые символы, ложное ребро, константы).
- Worktree на каждый базовый коммит: `git worktree add --detach ../SRA-bench-<sha> <sha>`, в нём `npm ci
  --ignore-scripts` и `node scripts/dev/cs.js map` (индекс заранее).
- На вопрос — субагент (`opus`), `description` = `bench <id> [A]` (или `[B]`) ровно так. Промпт:

  ```text
  Worktree <путь> (коммит <sha>, только чтение: ничего не меняй, тесты не запускай). Вопрос о коде:
  <question>
  Ответ — в конце сообщения, JSON-массив в блоке ```json: [{"file": "<путь от корня репозитория>", "symbol":
  "<имя функции или метода, внутри которой это место>"}] — для вопросов о файлах "symbol": "(file)". Перечисли все
  места, ничего лишнего. Перед ответом — два предложения: как искал.
  ```

  Для `[A]` перед вопросом — текст разделов «Правила», «Команды», «Сценарии» навыка `code-search`.
- Оценка: `node scripts/dev/bench-score.js run --q <id>` → `<git-common-dir>/graft-lab/bench/<id>-<A|B>.json`;
  сводка — `bench-score.js report`.
- **Регрессия графа** (ADR-0029 п. 4): `node scripts/dev/graph-audit.js` — метрики графа против компилятора
  TypeScript; база — `scripts/dev/bench/graph-baseline.json` (коммит и версия в файле). Сравнение имеет смысл только
  на том же коде: worktree на коммите базы с `node_modules`, затем `graph-audit.js --root <wt> --baseline
  scripts/dev/bench/graph-baseline.json` (код 1 — хуже базы больше допуска).
- **Обновление Graft:** скопировать `graft-lab/bench/` в `graft-lab/bench-<старая версия>/`; поставить новую версию,
  поднять `GRAFT_VERSION` в `scripts/dev/cs-lib.js` в ветке; (а) `graph-audit --baseline` не хуже базы; (б) субагенты
  `[A]` на всех вопросах (записи `[B]` остаются прежними); `bench-score.js report` — `accept` (отношение ≤ 0,8,
  recall `[A]` не ниже `[B]`). Оба условия — версия принимается, иначе остаётся прежняя. Затем — `graft_version`
  здесь и §2, новая база `graph-audit.js --write-baseline`.

## 7. Откат

```bash
npm rm -g @nanonets/graft
```

Удалить переменные `GRAFT_NO_GITIGNORE`, `GRAFT_NO_IGNORE` (и `DO_NOT_TRACK`, если не нужна) в «Переменные среды»
Windows; строки `graft/`, `.graft/` — из `.git/info/exclude`; каталоги `graft/`; навык `code-search`, хуки `.claude/settings.json` и
`scripts/dev/cs-hook.js` — убрать; новый ADR вместо ADR-0028 / ADR-0029.
