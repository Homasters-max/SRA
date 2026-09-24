---
status: active
adr: WARRANT-ADR-0026
amended_by: WARRANT-ADR-0027
graft_version: 0.19.0
---

# Graft в разработке WARRANT — протокол эксперимента

Решение и обоснование — [ADR-0026](../adr/WARRANT-ADR-0026-graft-experiment.md), донастройка после `test-levels` —
[ADR-0027](../adr/WARRANT-ADR-0027-graft-tuning.md); раздача групп — [coordinator.md](coordinator.md); алгоритм
поиска — [code-search.md](code-search.md). Пока `status: active` (frontmatter выше) действует этот протокол; после
итога — `status: closed` и ссылка на отчёт `graft-report.md`. Субагентам этот файл не передаётся.

## 1. Гипотеза

Субагент, который ищет по коду через граф (`scripts/dev/cs.js` по алгоритму [code-search.md](code-search.md)),
затягивает в контекст при исследовании кода на ≥ 20 % меньше байт и находит нужные места не хуже, чем субагент с
обычными средствами.

## 2. Установка (один раз на машину)

```bash
npm i -g @nanonets/graft@0.19.0
setx GRAFT_NO_GITIGNORE 1
setx GRAFT_NO_IGNORE 1
setx DO_NOT_TRACK 1
```

В `$(git rev-parse --git-common-dir)/info/exclude` — строки `graft/` и `.graft/` (общие для всех worktree).
Путь установки — короткий: нативная сборка `tree-sitter-kotlin` падает с `C1258` при пути длиннее 260 символов
(MAX_PATH); глобальная установка npm проходит. `cs.js` импортирует `cross-spawn` — в worktree нужен `npm ci`.

## 3. Обёртка `cs` и алгоритм

- `scripts/dev/cs.js` — единственный вход к graft для субагента: разрешены `ask`, `grep`, `skeleton`, `callers`,
  `map`, `version` (иначе код 2), флаги `--deep`, `--lsp`, `--no-refresh`, `--dir` — нет; версия ≠ 0.19.0 или
  `graft/` не исключён — код 3; переменные гигиены и телеметрии ставит сама; индекс строит сама; строки «tokens saved»
  (с инструкцией агенту отчитаться пользователю) вырезает, подсказки `graft <sub>` переписывает в `cs <sub>`.
- [code-search.md](code-search.md) — алгоритм (правила 1–6, команды, сценарии). В `.claude/skills/` его нет
  (ADR-0027 п. 2): координатор вставляет текст в промпт группы `[A]`.
- `graft init`, `upgrade`, `mcp`, `brain`, хуки, MCP, statusline — не используются (ADR-0026 п. 2).

## 4. Дизайн

- **Основной замер — парный бенчмарк** (§6): одни и те же вопросы о коде в обеих метках на одном коммите. Вердикт
  эксперимента — по нему (ADR-0027 п. 4).
- **Полевые данные — группы задач.** Группы Change чередуются: нечётная — `[A]`, чётная — `[B]`; метка в конце
  `description`; записываются **все** группы. Одна группа — один субагент; иначе части `--part k`, `report`
  суммирует. Поле — справочно: группы различаются по объёму в десятки раз.
- **Слепота.** Субагент не знает об эксперименте: промпт, `CLAUDE.md`, индекс памяти, `.claude/` его не упоминают;
  общий блок промпта и разделы отчёта одинаковы у `[A]` и `[B]`; зонд перед первой группой проверяет всё, что
  попадает в контекст субагента ([coordinator.md](coordinator.md) §1). Остаточный риск — `docs/process/**`, ADR и
  `scripts/dev/cs.js`, если агент сам туда пойдёт. Запись `[B]` засчитывается, только если в ней нет вызовов `cs` и
  `graft` (иначе — нарушение); записи с утечкой — с пометкой `blind-leak` в `notes`.
- **Соблюдение алгоритма (`[A]`).** `graft-metrics` считает отступления: поиск по содержимому кода (Grep, `grep`,
  `rg`, `git grep` по `packages/`, `scripts/`, `*.ts`), чтение файла кода целиком (Read без `offset`/`limit`, `cat`),
  `graft` в обход `cs`. Не отступления: запись файлов (heredoc, `sed -i`), JSON / конфиги / локи / документы,
  `node_modules`, список файлов (`ls`, `find`, Glob), фильтр вывода после `|`. Больше 3 — `compliant: false`: в
  отчёте видна, в вердикт не идёт.

## 5. Метрики, порог, остановка

| Метрика | Откуда |
|---|---|
| `ingest.explore_bytes` — **основная** | байты результатов исследующих вызовов (Read/Grep/Glob, `cat`/`sed -n`/`grep`/…, `cs`) |
| `ingest.explore_before_edit_bytes` | то же до первой правки (Edit/Write, запись из shell) |
| `ingest.cs_bytes`, `results_bytes` | доля `cs`; все результаты инструментов |
| `tokens.total`, `output`, `context_peak` | usage ответов API (раз на `message.id`) — вторичные |
| `tool_calls.*`, `graft_commands` | `tool_use` (раз на id), команды `cs.js <sub>` и `graft <sub>` |
| `deviations`, `compliant` | правила алгоритма (`[A]`) |
| `score.recall`, `precision` (бенчмарк) | ответ агента против эталона |
| `card.red_runs`, `helped`, `misled`, `notes` (поле) | координатор по отчёту субагента |

**Accept** (бенчмарк) — все 8 вопросов в обеих метках, медиана по вопросам отношения `explore_bytes[A] /
explore_bytes[B]` ≤ 0,8, средний recall `[A]` не ниже `[B]`, ни одного вызова `cs` в `[B]`. Иначе — **reject**;
неполные пары — **insufficient**. Поле — перекрёстная проверка: те же −20 % по `explore_bytes`, красных прогонов не
больше, ни одного `misled`.

**Остановка сразу:** `cs` вернул код 3 или дерево грязное из-за graft; `misled` (неверный ответ привёл к ошибке);
установка сломалась; нужен upgrade. Тогда — `status: closed`, `/stats-report`, откат (§7).

## 6. Бенчмарк

- Вопросы и эталон — `scripts/dev/bench/code-search.json` (8 вопросов из групп `test-levels`, эталон — по AST
  TypeScript на родительском коммите группы, без graft).
- Worktree на каждый базовый коммит: `git worktree add --detach ../SRA-bench-<sha> <sha>`, в нём `npm ci
  --ignore-scripts` и `node scripts/dev/cs.js map` (индекс заранее — параллельные агенты не строят его одновременно).
- На вопрос — два субагента (`opus`), `description` = `bench <id> [A]` и `bench <id> [B]` ровно так. Промпт:

  ```text
  Worktree <путь> (коммит <sha>, только чтение: ничего не меняй, тесты не запускай). Вопрос о коде:
  <question>
  Ответ — в конце сообщения, JSON-массив в блоке ```json: [{"file": "<путь от корня репозитория>", "symbol":
  "<имя функции или метода, внутри которой это место>"}] — для вопросов о файлах "symbol": "(file)". Перечисли все
  места, ничего лишнего. Перед ответом — два предложения: как искал.
  ```

  Для `[A]` перед вопросом — блок `text` из [code-search.md](code-search.md).
- Оценка: `node scripts/dev/bench-score.js run --q <id>` (оба транскрипта, ответ из последнего сообщения) →
  `<git-common-dir>/graft-lab/bench/<id>-<A|B>.json`; сводка — `bench-score.js report`.

## 7. Записи и отчёт (поле)

- Группа: `node scripts/dev/graft-metrics.js run --change <c> --group <N> [--part <k>] --red-runs <k> --helped
  yes|partly|no --misled none|"<…>" [--notes "<…>"]` → `<git-common-dir>/graft-lab/runs/<c>-g<N>[-p<k>].json`,
  транскрипт — копией в `graft-lab/transcripts/` (вне git).
- Пересчёт всех записей текущими метриками: `graft-metrics.js rescore`.
- Сводка поля: `graft-metrics.js report`. Отчёт и черновик ADR с итогом — `/stats-report`.

## 8. Откат

```bash
npm rm -g @nanonets/graft
```

Удалить переменные `GRAFT_NO_GITIGNORE`, `GRAFT_NO_IGNORE` (и `DO_NOT_TRACK`, если не нужна) в «Переменные среды»
Windows; строки `graft/`, `.graft/` — из `.git/info/exclude`; каталоги `graft/` и worktree `SRA-bench-*`. Здесь —
`status: closed`; [coordinator.md](coordinator.md) §1.2 и блок `[A]` — убрать или оставить по итоговому ADR.
