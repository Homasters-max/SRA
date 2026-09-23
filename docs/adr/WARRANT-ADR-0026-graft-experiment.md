---
id: WARRANT-ADR-0026
title: Graft в разработке WARRANT — эксперимент на группах задач, только CLI, без записи в конфиги агента
adr_state: ACCEPTED
date: 2026-09-24
supersedes: []
amends: []
---

## Context

Разработку WARRANT ведёт сессия-координатор, каждую группу задач `tasks.md` выполняет субагент Opus
([NEXT-SESSION](../NEXT-SESSION.md)). Каждый субагент заново исследует `packages/cli/src` (~23 тыс. строк TS с
тестами): в транскриптах phase-3b на группу 36–98 shell-вызовов `cat` / `sed -n` / `grep` при 50–120 tool calls и
5–22 млн токенов (с кэшем). Это цена, которая платится заново в каждой группе, и риск пропустить затронутый код.

[Graft](https://github.com/trailhq/Graft) (npm `@nanonets/graft`, MIT) — локальный граф кода на tree-sitter для
coding-агентов: `graft ask` (узлы по задаче), `callers` (кто вызывает символ), `skeleton` (API файла), `map`;
граф обновляется по hash при каждом запросе, без LLM. Проверено 2026-09-24 на Windows 11 (Node 22, VS Build Tools):
0.19.0 ставится (нужен короткий путь — MAX_PATH, `npm i -g` годится), граф SRA — 4,5 с, 1033 узла, 3181 ребро;
`callers evaluateGates` находит все 7 вызывающих мест.

Против полного внедрения:

- `graft init` пишет хуки в `.claude/settings.json` проекта и по умолчанию в `~/.claude/settings.json`,
  `~/.claude.json`, а также `.mcp.json`, `.gitignore`, `.ignore`. `settings.json` принадлежит будущему `warrant sync`
  ([03 §6](../03-architecture.md)); в SEF конфиги движков сверяются с эталоном побайтно, Beads отвергнут ровно за
  `bd init`, переписывающий конфиги агента (`integrations/2026-09-17-sef-platform-design.md`).
- Навык Graft требует использовать его «For ANY task», хук UserPromptSubmit подмешивает контекст в каждый ход,
  вывод CLI содержит инструкцию агенту сообщать пользователю «🌱 graft saved ~N tokens» — это конкурирует с `/opsx:*` и
  `/group-done`, а оценка «saved» считается против чтения файлов целиком и завышена.
- Markdown (ADR, design.md, specs) не индексируется — больше половины работы в репозитории Graft не касается.
- Pre-1.0: создан 2026-07-03, 31 версия за 2 месяца, breaking changes в 0.6 / 0.7 / 0.9 / 0.17; фокус смещается к
  SaaS Trail Brain, который выгружает `docs/adr`, историю PR и CODEOWNERS на trailhq.com и пишет «правила дома» в
  `CLAUDE.md` / `AGENTS.md` — второй источник решений рядом с ADR (INV-06).
- `graft build` без переменных окружения правит `.gitignore` и создаёт `.ignore` — рабочее дерево грязное.

SEF R1 (готовое вместо своего) — за; P9 / R2 (инструмент только под доказанную проблему) — против внедрения без замера.

## Decision

1. **Эксперимент, не внедрение.** Graft — инструмент разработки самого WARRANT, не часть продукта. Решение о
   постоянном использовании — отдельным ADR по итогам (п. 4). Продуктовая интеграция (сигнал blast radius для
   `classify`, контекст исполнителей SEF) — later, [13 §3](../13-roadmap.md).
2. **Только CLI, ничего в конфигах агента.** Разрешены `graft ask --source`, `callers`, `skeleton`, `map`, `grep`,
   `build`, `version`. Запрещены `graft init`, `upgrade`, `mcp`, `brain`/`push`/`pull`, `--deep`, `--lsp`; хуки,
   MCP, statusline, навык `.claude/skills/graft` не ставятся; graphify в процесс не включается.
3. **Установка и гигиена.** `npm i -g @nanonets/graft@0.19.0`, версия зафиксирована на весь эксперимент. Переменные
   пользователя `GRAFT_NO_GITIGNORE=1`, `GRAFT_NO_IGNORE=1`, `DO_NOT_TRACK=1`; `graft/` и `.graft/` — в
   `.git/info/exclude` (общий для всех worktree). В git — только наши файлы процесса: `CLAUDE.md` (указатель без
   правил), [docs/process/graft.md](../process/graft.md), `scripts/dev/graft-metrics*.js`, команды
   `/graft-log`, `/graft-report`.
4. **Замер.** Группы `test-levels` (затем, если мало, фазы 4) чередуются: нечётные — `[graft:on]`, чётные —
   `[graft:off]`, тег в `description` вызова субагента; фон — транскрипты phase-3b (`baseline`). Метрики — из
   транскрипта субагента (`scripts/dev/graft-metrics.js`): токены (вход, кэш, выход, пик контекста), tool calls,
   исследующие вызовы, вызовы graft, время; карточка координатора — красные прогоны `/group-done`, помог ли graft,
   ввёл ли в ошибку. Самооценка Graft «tokens saved» не используется. Записи — `<git-common-dir>/graft-lab/runs/`,
   вне git.
   **Accept**, если в каждом режиме ≥ 2 групп, медиана токенов **или** tool calls у ON ниже OFF на ≥ 20 %, красных
   прогонов у ON не больше, ни одного случая «graft ввёл в ошибку» и ни одного нарушения п. 2. Иначе — **reject**.
5. **Остановка сразу**, без добора групп: graft загрязнил дерево; неверный ответ graft привёл к красному прогону;
   установка сломалась; понадобился upgrade. Откат: `npm rm -g @nanonets/graft`, удалить переменные и строки
   `exclude`; `CLAUDE.md` указывает на отчёт.
6. **Отчёт.** `/graft-report` — `docs/process/graft-report.md` (сводка, дельты, карточки, вердикт) и черновик ADR
   с итогом; коммит — отдельной веткой `process/*`, не в ветке Change (иначе `scope-valid`).

## Consequences

- Координатор выбирает блок промпта ON / OFF по номеру группы и ставит тег `[graft:on|off]` — без тега
  `graft-metrics run` не пишет запись ([docs/process/graft.md](../process/graft.md) §4).
- `/group-done` получает шаг 6 — `/graft-log`, пока эксперимент активен: маркер — `status: active` во frontmatter
  [docs/process/graft.md](../process/graft.md); по итогам — `status: closed`.
- Нарушения п. 2 ловятся автоматически: `graft-metrics run` выходит с кодом 1 на запрещённую подкоманду или флаг и на
  любой вызов graft в OFF-группе; грязное дерево — `git status --short` в `/group-done`.
- `scripts/dev/` не входит в пакет — `package-contents.test.ts`; версия CLI не меняется (R-14: скрипты разработки не
  поставляются).
- Корневой `CLAUDE.md` появляется впервые: только ссылки (NEXT-SESSION, процесс Graft), правил в нём нет — как в
  `.claude/` по P-1.

## Alternatives

- **Внедрить по умолчанию (`graft init`)** — отвергнуто: запись в глобальные и проектные конфиги агента, хуки на
  каждый ход, конфликт с владением `settings.json` и эталоном SEF.
- **Не внедрять** — отвергнуто: проблема повторного исследования кода видна в транскриптах, проверка дешёвая и
  откатывается одной командой.
- **MCP вместо CLI** — отвергнуто: нужен закоммиченный `.mcp.json`, регистрация на каждый путь worktree или
  глобальная; вызовы CLI видны в транскрипте как команды и считаются аудитом.
- **Двойной прогон каждой группы (ON и OFF)** — отвергнуто: вдвое дороже; чередование плюс фон phase-3b достаточно
  для порога 20 %.
- **graphify** — не для кода: пересобирает граф целиком, `callers` нет; два источника контекста хуже одного.
- **Trail Brain** — отвергнуто: ADR и история PR уходят во внешний SaaS, «правила» дублируют ADR.
