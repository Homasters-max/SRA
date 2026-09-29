# WARRANT — вход для сессии Claude Code

WARRANT — governance-слой фабрики SEF поверх OpenSpec (specification kernel, stock): policy, gates, evidence, lifecycle Change; CLI `warrant` (TypeScript, Node). Смежные компоненты SEF — LATTICE (объекты), SRA (reasoning, skills), JEV (classifier без authority). Этот файл — указатель: норма — в ADR, полная таблица правил — [docs/process/rules.md](docs/process/rules.md) ([ADR-0032](docs/adr/WARRANT-ADR-0032-dev-context.md) п. 7).

## Карта

| Каталог | Что |
|---|---|
| `docs/` | спецификация 01–13 ([00-readme](docs/00-readme.md)), `adr/`, [backlog.md](docs/backlog.md) (долг), `handoff/` (передача), `process/` (процессы разработки), `archive/` (история) |
| `docs/drafts/` | черновики до решения ([README](docs/drafts/README.md)); папка удаляется PR решения (ADR-0033 п. 12) |
| `openspec/` | specs и Changes (dogfooding); `changes/archive/` неизменяем (ADR-0021) |
| `packages/cli/` | CLI `warrant`: `src/`, `test/` (уровни ADR-0025), `schemas/`; конвенции — [packages/cli/AGENTS.md](packages/cli/AGENTS.md) |
| `packs/core-sdd/` | pack по умолчанию: profiles, gates, checks, golden |
| `sra/skills/` | reasoning-skills SRA, поставляемые с pack |
| `scripts/dev/` | инструменты разработки: `cs.js` (поиск по коду), `brief.js` (состояние), `check.js` (быстрые проверки), `hygiene.js`, хуки, метрики; не поставляются |
| `.warrant/` | конфигурация и состояние WARRANT самого репозитория (record, evidence, waivers) |
| `.claude/` | `settings.json` (только хуки), `skills/` (навыки проекта) |
| `lattice/` | компонент LATTICE — не трогать |
| `graft/` | индекс Graft, игнорируется git (ADR-0026 п. 3) |

Корень и имена держит `structure.test.ts`: новый каталог верхнего уровня — правка его белого списка (ADR-0033 п. 13).

## Старт сессии

1. Состояние (ветка, worktree, теги, версии, активные Changes, файлы передачи) приходит хуком `SessionStart`; вручную — `node scripts/dev/brief.js`. Вычислимое прозой не записывается.
2. Файл передачи своего потока — `docs/handoff/<поток>.md`: цель, готовый запрос, открытые вопросы. Поток не ясен — спросить пользователя.

## Задача → навык или инструмент

| Задача | Навык / инструмент |
|---|---|
| Найти код, кто вызывает, что обновить при изменении символа | `code-search` (`node scripts/dev/cs.js`) — [ADR-0028](docs/adr/WARRANT-ADR-0028-graft-adoption.md) |
| Архитектурный аудит (обязательно перед spec-PR фазы) | `architecture-audit` |
| Начать поток в worktree, «где я», коммит через файл | `git-start` |
| PR, CI, merge по «merge #N», чистка после merge | `git-land` (+ `recovery.md`, `ci.md`) |
| Лишнее в репозитории (`brief.js`: «Гигиена: N»), перед spec-PR фазы | `repo-hygiene` (`node scripts/dev/hygiene.js`) |
| Решение по ходу реализации → строка `I-N` в design.md | `decision` |
| Три PR Change: утверждение, реализация, закрытие | `change-spec-pr` → `change-impl-pr` → `change-archive-pr` |
| Раздать группы tasks.md субагентам (перед первой раздачей) | `change-coordinate` |
| Закрыть группу задач tasks.md (проверки, галочки, коммит) | `group-done` |
| Ревью реализации на соответствие spec до merge impl-PR | `review-impl` (агент `reviewer`) |
| Статистика группы по транскрипту субагента (координатор) | `group-stats` |
| Конец сессии → файл передачи потока | `handoff` |
| Stress-test плана раундами вопросов | `grilling` |
| Архитектурная линза: границы, trade-offs, ADR; процессы с агентами | `software-architect` (+ `orchestration.md`) |
| Контракт команды CLI: ошибки, exit-коды, JSON, `--dry-run` | `cli-contract` |
| Предложить, исследовать, реализовать, обновить Change | `openspec-propose`, `-explore`, `-apply-change`, `-update-change` |
| Состояние Change, gates, evidence | `warrant status`, `warrant verify <change>` |

## Жёсткие правила

- JSON — только канонический: `writeJsonFile` или `warrant fmt`. Держится: `validate`, `fmt --check` (ADR-0006).
- Record, evidence, waivers, ID пишет только CLI (`warrant transition`, `check`, `waive`, `id`). Держится: `validate` (ADR-0009, ADR-0012).
- Main specs меняются только archive-PR (`warrant archive`). Держится: `scope-valid`, шаг CI (ADR-0011, R-16).
- impl-PR мержится только merge commit. Держится: `transition MERGED` → `COMMIT_NOT_MERGED` (I-97).
- Версия CLI / pack / skill поднимается первым изменением поставляемого после релиза. Держится: `versions:check` (R-14).
- Процессы — только в `packages/cli/src/adapters/**` через порты; тест — в каталоге своего уровня. Держится: `levels.test.ts` (ADR-0025).
- Зависимости модулей — по рангам `architecture.json`, без циклов и копий помощников. Держится: `architecture.test.ts` (ADR-0030).
- Код ищется через `cs`, читается диапазонами. Держится у субагентов: хук `PreToolUse` — `deny` (ADR-0031).
- Хуки разработки — только из белого списка. Держится: `dev-hooks.test.ts` (ADR-0032 п. 11).
- Навыки, `AGENTS.md`, файлы передачи, `backlog.md` — по форме ADR-0032. Держится: `dev-context.test.ts`.
- Основной checkout — только `main`, работа — в worktree; force push и `openspec archive` запрещены. Держится: хук `git-hook.js` (ADR-0033 п. 9). Одна ветка — один worktree, ветку проверять перед коммитом — шаг 1 `group-done`.
- Длинный текст (коммит, PR, envelope, JSON) — файлом (`Write`) и флагом пути, не в команде Bash: Git Bash на Windows обрезает команду длиннее ~7,7 тыс. символов. Держится: `git-hook.js` `long-command` (ADR-0043).
- Отклонение от spec или design — вопросом maintainer'у, принятое — строкой `I-N` (навык `decision`); норма во время реализации меняется только новым ADR.
- Не реализовывать `guard`, `ci`, `run`, `analyze` вне фазы 4; не добавлять profiles без failure mode (ADR-0013); не трогать `docs/integrations/`, `lattice/`; второй формат конфигурации не изобретать (`warrant.json` — 08 §3).

## Язык и документы

Документы — по-русски, термины и команды — по-английски как есть; машинные файлы — JSON с `$schema` `warrant://<name>/<major>`. Большие переписывания документов — сначала обсудить с пользователем. Коммиты и PR — через файл сообщения (`git commit -F`, `gh pr create --body-file`) — шаги навыков `git-start` и `git-land`.

## ADR

Индекс — [docs/adr/README.md](docs/adr/README.md). Опорные: стек и monorepo — 0013; доверие и forge — 0010; топология spec-PR / impl-PR / archive-PR — 0011; ID — 0012; контракт с OpenSpec — 0015; frontend разработки WARRANT — 0023; уровни тестов — 0025; границы модулей — 0030; поиск по коду и хуки — 0028, 0029, 0031; контекст разработки — 0032. Прежние решения grilling (P-, V-, G-, Q-, H-, D-, R-) — [архив NEXT-SESSION](docs/archive/2026-09-24-next-session.md).
