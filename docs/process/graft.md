---
status: active
adr: WARRANT-ADR-0026
graft_version: 0.19.0
---

# Graft в разработке WARRANT — протокол эксперимента

Решение и обоснование — [ADR-0026](../adr/WARRANT-ADR-0026-graft-experiment.md); раздача групп —
[coordinator.md](coordinator.md). Пока `status: active` (frontmatter выше) действует этот протокол; после итога —
`status: closed` и ссылка на отчёт `graft-report.md`. Субагентам этот файл не передаётся.

## 1. Гипотеза

Субагент группы задач, который ищет по коду через граф (`scripts/dev/cs.js` по навыку
[code-search](../../.claude/skills/code-search/SKILL.md)), тратит на ≥ 20 % меньше токенов или tool calls и
ошибается не чаще, чем субагент с обычными средствами.

## 2. Установка (один раз на машину)

```bash
npm i -g @nanonets/graft@0.19.0
setx GRAFT_NO_GITIGNORE 1
setx GRAFT_NO_IGNORE 1
setx DO_NOT_TRACK 1
```

В `$(git rev-parse --git-common-dir)/info/exclude` — строки `graft/` и `.graft/` (общие для всех worktree).
Путь установки — короткий: нативная сборка `tree-sitter-kotlin` падает с `C1258` при пути длиннее 260 символов
(MAX_PATH); глобальная установка npm проходит.

## 3. Обёртка `cs` и навык

- `scripts/dev/cs.js` — единственный вход к graft для субагента: разрешены `ask`, `grep`, `skeleton`, `callers`,
  `map`, `version` (иначе код 2), флаги `--deep`, `--lsp`, `--no-refresh`, `--dir` — нет; версия ≠ 0.19.0 или
  `graft/` не исключён — код 3; переменные гигиены и телеметрии ставит сама; индекс строит сама; строки «tokens saved»
  (с инструкцией агенту отчитаться пользователю) вырезает, подсказки `graft <sub>` переписывает в `cs <sub>`.
- `.claude/skills/code-search/SKILL.md` — алгоритм поиска (правила 1–6, команды, сценарии, раздел отчёта).
  `disable-model-invocation: true`: навык не предлагается агентам сам, его получает только группа `[A]` — ссылкой
  в промпте. Шаблон — официальный SKILL.md Graft без «For ANY task» и без отчёта об экономии.
- `graft init`, `upgrade`, `mcp`, `brain`, хуки, MCP, statusline — не используются (ADR-0026 п. 2).

## 4. Дизайн

- **Метки.** Группы Change по `tasks.md` чередуются: нечётная — `[A]` (граф), чётная — `[B]` (контроль). Метка —
  в конце `description` вызова субагента; записываются **все** группы, без отбора. Фон — транскрипты phase-3b
  g1–g5 (`baseline`, записаны).
- **Слепота.** Субагент не знает об эксперименте: ни промпт, ни `CLAUDE.md`, ни видимые ему навыки и команды его
  не упоминают; `/group-stats`, `/stats-report`, `code-search` скрыты от модели (`disable-model-invocation`);
  общий блок промпта и разделы отчёта одинаковы у `[A]` и `[B]` ([coordinator.md](coordinator.md) §2); видимость
  проверяет субагент-зонд перед первой группой (там же §1, п. 0). Остаточный
  риск: ADR-0026, этот файл и строка индекса ADR читаются, если агент сам туда пойдёт — координатор их не называет.
- **Соблюдение алгоритма (`[A]`).** `graft-metrics run` считает отступления от правил навыка: Grep/Glob и
  `grep`/`rg`/`find` по коду, чтение файла кода целиком (Read без `offset`/`limit`, `cat`), `graft` в обход `cs`.
  Больше 3 — запись `compliant: false`: в отчёте видна, в вердикт не идёт.

## 5. Метрики, порог, остановка

| Метрика | Откуда |
|---|---|
| `tokens.total`, `output`, `context_peak` | usage ответов API в транскрипте (раз на `message.id`) |
| `tool_calls.total`, `read_like` (Read/Grep/Glob), `shell_search` (`cat`/`sed -n`/`grep`/… в цепочке) | `tool_use` (раз на id) |
| `tool_calls.graft`, `raw_graft`, `graft_commands` | команды `cs.js <sub>` и `graft <sub>` |
| `deviations`, `compliant` | правила навыка (`[A]`) |
| `window.duration_s` | первая и последняя метка времени |
| `card.red_runs`, `helped`, `misled`, `notes` | координатор по отчёту субагента |

**Accept** — в каждой метке ≥ 2 засчитанных групп, медиана токенов **или** tool calls `[A]` ниже `[B]` на ≥ 20 %,
красных прогонов у `[A]` не больше, ни одного `misled`, ни одного нарушения (`graft` в группе `[B]`). Иначе —
**reject**; мало групп — **insufficient** (продлить на фазу 4).

**Остановка сразу:** `cs` вернул код 3 или дерево грязное из-за graft; `misled` (неверный ответ привёл к ошибке);
установка сломалась; нужен upgrade. Тогда — `status: closed`, `/stats-report`, откат (§7).

## 6. Записи и отчёт

- Группа: `node scripts/dev/graft-metrics.js run --change <c> --group <N> --red-runs <k> --helped yes|partly|no
  --misled none|"<…>" [--notes "<…>"]` → `<git-common-dir>/graft-lab/runs/<c>-g<N>.json` (вне git).
- Фон: `run --change phase-3b --group <N> --find "phase-3b group <N>:" --mode baseline`.
- Сводка: `node scripts/dev/graft-metrics.js report` — медианы, дельты `[A]` к `[B]`, `non_compliant`, `missing`
  (группы, закрытые в `tasks.md` без записи), вердикт. Отчёт и черновик ADR — `/stats-report`.

## 7. Откат

```bash
npm rm -g @nanonets/graft
```

Удалить переменные `GRAFT_NO_GITIGNORE`, `GRAFT_NO_IGNORE` (и `DO_NOT_TRACK`, если не нужна) в «Переменные среды»
Windows; строки `graft/`, `.graft/` — из `.git/info/exclude`; каталоги `graft/` в worktree. Здесь — `status: closed`;
[coordinator.md](coordinator.md) §1.2 и блок `[A]` — убрать или оставить по итоговому ADR.
