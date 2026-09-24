---
status: closed
adr: WARRANT-ADR-0026
amended_by: [WARRANT-ADR-0027, WARRANT-ADR-0028]
graft_version: 0.19.0
---

# Graft в разработке WARRANT

Эксперимент [ADR-0026](../adr/WARRANT-ADR-0026-graft-experiment.md) / [ADR-0027](../adr/WARRANT-ADR-0027-graft-tuning.md)
**закрыт** 2026-09-24: вердикт `accept` — [отчёт](graft-report.md), решение — [ADR-0028](../adr/WARRANT-ADR-0028-graft-adoption.md).
Поиск по коду через граф — стандарт субагентов разработки WARRANT: навык
[code-search](../../.claude/skills/code-search/SKILL.md), раздача групп — [coordinator.md](coordinator.md). Здесь —
установка, обёртка, наблюдение, обновление, откат; §6 — протокол бенчмарка (для регрессии при обновлении).

## 1. Итог

Бенчмарк (8 вопросов, пары `[A]`/`[B]`): прочитанное при исследовании — медиана отношения 0,54, токены −22 %,
вызовы −29 %, recall и precision 1,0 у обеих меток. Поле (`test-levels`) — то же направление, неверных ответов,
приведших к ошибке, — 0. Риски — [отчёт](graft-report.md) §4.

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

## 3. Обёртка `cs` и навык

- `scripts/dev/cs.js` — единственный вход к graft: разрешены `ask`, `grep`, `skeleton`, `callers`, `map`, `version`
  (иначе код 2), флаги `--deep`, `--lsp`, `--no-refresh`, `--dir` — нет; версия ≠ `GRAFT_VERSION` или `graft/` не
  исключён — код 3; переменные гигиены и телеметрии ставит сама; индекс строит сама; строки «tokens saved» (с
  инструкцией агенту отчитаться пользователю) вырезает, подсказки `graft <sub>` переписывает в `cs <sub>`.
- [.claude/skills/code-search/SKILL.md](../../.claude/skills/code-search/SKILL.md) — алгоритм (правила 1–6, команды,
  сценарии); навык вызывается моделью сам, субагенту — строка-ссылка в промпте ([coordinator.md](coordinator.md) §2).
- `graft init`, `upgrade`, `mcp`, `brain`, хуки, MCP, statusline — не используются (ADR-0026 п. 2).

## 4. Метрики

| Метрика | Откуда |
|---|---|
| `ingest.explore_bytes`, `explore_before_edit_bytes` | байты результатов исследующих вызовов (Read/Grep/Glob, `cat`/`sed -n`/`grep`/…, `cs`), всего и до первой правки |
| `ingest.cs_bytes`, `results_bytes` | доля `cs`; все результаты инструментов |
| `tokens.*`, `tool_calls.*`, `graft_commands` | usage (раз на `message.id`), `tool_use` (раз на id), команды `cs.js` / `graft` |
| `deviations`, `compliant` | отступления от правил навыка (> 3 — `compliant: false`); не отступления: запись файлов, JSON / конфиги / документы, `node_modules`, список файлов, фильтр вывода после `\|` |
| `score.recall`, `precision` (бенчмарк) | ответ агента против эталона |
| `card.red_runs`, `helped`, `misled`, `notes` (поле) | координатор по отчёту субагента |

## 5. Наблюдение и пересмотр (ADR-0028 п. 5, 6)

- После каждой группы — `graft-metrics.js run --mode on` (`/group-stats`, [coordinator.md](coordinator.md) §3);
  записи — `<git-common-dir>/graft-lab/runs/`, транскрипты — `graft-lab/transcripts/` (вне git); пересчёт —
  `graft-metrics.js rescore`, сводка — `graft-metrics.js report`.
- **`misled`** (неверный ответ `cs` привёл к ошибке) — условие пересмотра ADR-0028; случай оформить вопросом в
  бенчмарк (`scripts/dev/bench/code-search.json`: одноимённые символы, переименованные импорты, re-export — там, где
  граф или grep ошибаются).
- **Остановка** (как ADR-0026 п. 7): `cs` вернул код 3 или дерево грязное из-за graft; установка сломалась.

## 6. Бенчмарк — протокол и регрессия при обновлении Graft (ADR-0028 п. 4)

- Вопросы и эталон — `scripts/dev/bench/code-search.json` (эталон — по AST TypeScript на базовом коммите, без graft).
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
- **Регрессия при обновлении Graft:** скопировать `graft-lab/bench/` в `graft-lab/bench-<старая версия>/`; поставить
  новую версию, поднять `GRAFT_VERSION` в `cs.js` в ветке; прогнать 8 субагентов `[A]` (записи `[B]` остаются
  прежними); `bench-score.js report` — `accept` (отношение ≤ 0,8, recall `[A]` не ниже `[B]` = 1,0) — версия
  принимается, иначе остаётся прежняя. Затем — `graft_version` здесь и §2.

## 7. Откат

```bash
npm rm -g @nanonets/graft
```

Удалить переменные `GRAFT_NO_GITIGNORE`, `GRAFT_NO_IGNORE` (и `DO_NOT_TRACK`, если не нужна) в «Переменные среды»
Windows; строки `graft/`, `.graft/` — из `.git/info/exclude`; каталоги `graft/`; навык `code-search` и строку в
промпте [coordinator.md](coordinator.md) §2 — убрать; новый ADR вместо ADR-0028.
