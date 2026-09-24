# Процессные правила → чем держатся

Полная таблица правил разработки WARRANT ([ADR-0032](../adr/WARRANT-ADR-0032-dev-context.md) п. 2, 7). Норма — в ADR;
`CLAUDE.md` — короткий указатель на жёсткие правила. Принцип (R-14…R-16): у правила о **форме** есть проверка в
`npm test` / `validate` / CI, прозой остаются только правила о **решении** (что выбрать), и они помечены как таковые.
Новое правило о форме без проверки не принимается (ADR-0022, INV-04).

| Правило | Где записано | Чем держится |
|---|---|---|
| JSON канонический | ADR-0006 | `validate` (canonical) + CI |
| Генерируемое не правится руками | ADR-0015, rule `generated-not-hand-edited` | `validate` (drift, проверка 4) |
| Lock после изменения pack | 08 §7 | `validate` `LOCK_MISMATCH` |
| Golden после изменения pack | REQ-SDD-009 | `golden.test.ts` |
| Версия поднимается первым изменением поставляемого после релиза | R-14 | `versions.test.ts`, `npm run versions:check` |
| Состав пакета | R-15 | `package-contents.test.ts` |
| Main specs только через archive-PR | ADR-0011, D-15 | `scope-valid` в Change + шаг CI `test` вне Change (R-16, до `warrant ci`) |
| impl-PR — только merge commit (не squash, не rebase) | I-97, ADR-0033 п. 11 | настройки репозитория (squash и rebase выключены); `transition MERGED` (`COMMIT_NOT_MERGED`, R-1) |
| CI на ubuntu + windows | P-9 | `ci.yml` matrix |
| Record и evidence пишет только CLI; `.warrant/evidence/**/raw/` не коммитится | ADR-0009, P-19 | `.gitignore`; `validate` (схемы record, evidence); `guard` — фаза 4 |
| Уровни тестов: процессы только в `contract`/`e2e`, у e2e-файла причина, тест только в каталоге уровня | ADR-0025 п. 7 | `SPAWN_FORBIDDEN_AT_LEVEL` (setup `unit`/`app`), `test/unit/meta/levels.test.ts`, `globalSetup` `contract`/`e2e` (openspec 1.13.1); выбор уровня — правило о решении |
| Порядок P-2 (что в каком PR) | ADR-0011, P-2 | частично: `transition` (последовательность), `scope-valid`; размещение по PR — `warrant ci`, фаза 4 (BL-12) |
| Направление зависимостей модулей, циклы, копии помощников, один владелец перечислений | ADR-0030 | `test/unit/meta/architecture.test.ts` + `architecture.json`; исключения храповика — строки `A-N` в [backlog.md](../backlog.md) |
| Архитектурный аудит перед spec-PR каждой фазы; находки — `A-N` в `backlog.md` | ADR-0030, навык `architecture-audit` | правило о решении; шаг навыка `handoff`: следующий поток — фаза → готовый запрос начинается с аудита |
| Graft только через `cs.js`: разрешённые подкоманды, флаги и версия | ADR-0026 п. 2, ADR-0028 п. 2, 4, ADR-0029 п. 3 | `scripts/dev/cs.js` (код 2 / 3), `test/unit/dev/cs.test.ts`; обновление — `graph-audit.js --baseline` + `bench-score.js report` |
| Поиск по коду — навык `code-search` | ADR-0028, ADR-0029 п. 1, 5, 6, ADR-0031 | у субагентов: `SubagentStart` (указатель), `PreToolUse` — `deny` вызова, помеченного по входу, `PostToolUse` — подсказка (`test/unit/dev/cs-hook.test.ts`); `graft-metrics run --mode on`: `deviations`, `blocked` |
| Хуки разработки — только `hooks`, белый список скриптов | ADR-0029 п. 6, 7, ADR-0031, ADR-0032 п. 11, ADR-0033 п. 9 | `test/unit/meta/dev-hooks.test.ts`: `cs-hook.js` — `SubagentStart`/`PreToolUse`/`PostToolUse`, `git-hook.js` — `PreToolUse` на Bash/PowerShell (набор правил закреплён), `brief.js` — `SessionStart` |
| Graft не пачкает дерево | ADR-0026 п. 3 | `cs.js` (переменные, `.git/info/exclude`); `git status --short` в навыке `group-done` |
| Одна группа — один агент, транскрипт сохранён | ADR-0027 п. 5 | `graft-metrics run --part k`, копия в `graft-lab/transcripts/` |
| `scripts/dev/` не поставляется | ADR-0026 | `package-contents.test.ts` |
| У каждого вида знания одно место; вычислимое прозой не пишется | ADR-0032 п. 1 | правило о решении; состояние — `scripts/dev/brief.js` (хук `SessionStart`) |
| Навыки — `.claude/skills/<name>/SKILL.md` по стандарту; `.claude/commands/` нет; `openspec-archive-change`, `openspec-sync-specs` нет | ADR-0032 п. 6, 8 | `test/unit/meta/dev-context.test.ts` |
| `CLAUDE.md` ≤ 100 строк, `packages/cli/CLAUDE.md` ≤ 60 | ADR-0032 п. 7 | `dev-context.test.ts` |
| Передача — `docs/handoff/<поток>.md`: разделы по порядку, ≤ 60 строк, «Не забыть» ≤ 5; `docs/NEXT-SESSION.md` нет | ADR-0032 п. 2, 3 | `dev-context.test.ts`; что считать потоком — правило о решении |
| Долг — одна таблица `docs/backlog.md`, уникальные ID; закрытая строка удаляется | ADR-0032 п. 5 | `dev-context.test.ts` (колонки, ID); удаление — правило о решении |
| auto-memory — только `user`/`feedback`, индекс ≤ 10 строк | ADR-0032 п. 9 | предупреждение `brief.js` (память вне репозитория, тест её не видит) |
| Профиль OpenSpec: навыки `propose`, `explore`, `apply`, `update`, `delivery: skills` | ADR-0032 п. 8, ADR-0015 п. 6 | настройка машины — команды ниже (конфиг OpenSpec 1.13.1 только глобальный); отсутствие файлов archive/sync — `dev-context.test.ts` |
| Основной checkout — только `main`: в нём нет `commit`, `merge`, `cherry-pick`, `revert`, `pull` без `--ff-only`, смены ветки; работа — в worktree | ADR-0011 п. 3, ADR-0033 п. 9 | `git-hook.js` — `deny` у основной сессии и субагентов (`test/unit/dev/git-hook.test.ts`); разбор текста команды ловит ошибку, не обход |
| Одна ветка — один worktree; ветку проверять перед коммитом | архив NEXT-SESSION («Организационное»), ADR-0033 п. 3 | шаг «где я» навыка `git-start` (его зовёт `group-done`); машина не знает, какой ветке принадлежит работа |
| Префикс ветки `spec/ worktree/ archive/ process/ docs/ fix/`, заголовок коммита `<change>: …` / `<префикс>: …` | ADR-0033 п. 10 | шаг CI `PR form` — `scripts/dev/pr-form.js` (`test/unit/dev/pr-form.test.ts`) |
| Текст коммита и PR — файлом (`-F`, `--body-file`) | ADR-0033 п. 3 | правило держится навыками `git-start`, `git-land`, `group-done`: искажённый оболочкой текст механически не отличить |
| Merge — только `--merge` по слову «merge #N» maintainer'а; после merge — worktree и ветки удаляются | ADR-0033 п. 5, 13 | шаги 4–5 навыка `git-land`; слово в чате хук не видит; `brief.js` — счётчики слитых веток (локальных и на origin) |
| Порядок потоков — строка `После:` в файле передачи; черновики — `docs/drafts/<дата>-<тема>/NN-*.md` | ADR-0033 п. 12 | `dev-context.test.ts` (поток из «После» есть, циклов нет; форма черновиков); `brief.js` — «Потоки по порядку» |
| Force push — только maintainer вручную | ADR-0033 п. 9 | `git-hook.js` — `deny` (`--force`, `-f`, `--force-with-lease`, `+refspec`) |
| Закрыть Change — `warrant archive`, не `openspec archive` | ADR-0011 п. 4, ADR-0033 п. 9 | `git-hook.js` — `deny` на `openspec archive` (в том числе совет навыка `openspec-apply-change`, BL-22) |
| Отклонение от spec — строкой `I-N` в design.md, вопросом maintainer'у | pack `rules.design` | правило о решении; нумерацию ведёт навык `decision` |
| Изменение нормативного документа во время реализации — только через новый ADR | ADR-0021, 12 §7 | правило о решении |

## Настройка машины

Профиль OpenSpec (ADR-0032 п. 8) — один раз на машину, затем `openspec update` в корне репозитория не создаёт
`openspec-archive-change`, `openspec-sync-specs` и `.claude/commands/opsx/`:

```bash
openspec config set profile custom
openspec config set delivery skills
openspec config set workflows '["propose","explore","apply","update"]'
```

Разрешения агента для автоматического процесса git (ADR-0033 п. 5, 13) — один раз на машину, их ставит maintainer
(коммитимый `.claude/settings.json` — только `hooks`, ADR-0029 п. 6): в `.claude/settings.local.json` (не в git)
добавить в `permissions.allow`:

```json
["Bash(gh pr merge * --merge)", "Bash(git push origin --delete *)"]
```

Merge — только по слову «merge #N» в чате (шаг навыка `git-land`); удаление веток на origin — только слитых
(`repo-hygiene`, `git-land`). Хук `git-hook.js` действует поверх разрешений.
