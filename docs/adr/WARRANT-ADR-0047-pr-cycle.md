---
id: WARRANT-ADR-0047
title: Цикл PR без ожидания — быстрый режим навыком, merge `--auto` под branch protection, archive-PR в сессии, тег workflow'ом, `merge=union` для backlog, конфликт версий — перегенерацией
adr_state: ACCEPTED
date: 2026-09-29
supersedes: []
amends: [WARRANT-ADR-0032, WARRANT-ADR-0033]
---

## Context

Сессия 2026-09-29 (релиз `v0.8.2`, PR #95, Change `ci-shards` #96–#98) потратила больше времени на ожидание CI, конфликты и ручную рутину, чем на работу. Замеры и уже сделанное:

- Критический путь PR — job `test (windows-latest)` ~5 мин против ~2,5 на ubuntu. Change `ci-shards` (REQ-VER-015) делит его на два shard `vitest`: ~3,5 мин, покрытие то же (1599 тестов в обоих вариантах).
- Maintainer включил 2026-09-29 auto-merge репозитория и branch protection `main` с обязательными проверками `test (ubuntu-latest)`, `test (windows-latest, 1/2)`, `test (windows-latest, 2/2)`, `warrant / warrant`: `gh pr merge N --merge --auto` сливает при зелёных проверках, сессия не опрашивает CI. Навык `git-land` шаг 4 — `--auto` (PR #95).
- `scripts/dev/check.js` — быстрые проверки одной командой; вне CI пул `threads` vitest ограничен третью ядер (PR #95): таймауты 5 с на загруженной машине стали редкими, предел 5 с (ADR-0025 п. 8) не менялся.
- Правила быстрого режима жили в личной памяти сессии и в файле вне репозитория — вне формы ADR-0032 и вне проверки `dev-context.test.ts`.
- Конфликт `docs/backlog.md` (PR #89): две ветки дописали строки в конец одной таблицы. Номера `R-36`, `R-37` совпали, но конфликт git — от соседства строк, а не от номеров: разные номера конфликтуют так же.
- Конфликт версий по R-14: одинаковый bump `0.8.1 → 0.8.2` git сливает сам; конфликтуют `warrant.lock.json` репозитория и golden-фикстур — хэши, вычисленные из разного содержимого веток.
- Archive-PR и тег — механические шаги после merge; предложено отдать их workflow.

## Decision

1. **Быстрый режим — навык проекта `fast-mode`** (`.claude/skills/fast-mode/SKILL.md`, форма ADR-0032 п. 6): план и вопросы один раз, затем без остановок — быстрые проверки, коммит на звено, merge `--auto`, чистка. Ответ maintainer'а на план («запускай», «всё в автоматическом режиме») — разрешение сливать при зелёном CI в этой задаче; жёсткие правила `AGENTS.md` не ослабляются. Личная память сессии правил процесса не держит (ADR-0032 п. 9).
2. **Merge `--auto` под branch protection** (уточняет [ADR-0033](WARRANT-ADR-0033-git-process.md) п. 5). Решение о merge — по-прежнему maintainer'а: «merge #N» или ответ на план быстрого режима; `--auto` лишь откладывает исполнение до зелёных обязательных проверок. Без branch protection `--auto` сливает сразу — навыки проверяют `allow_auto_merge` и список проверок. Список обязательных проверок меняет maintainer вместе с именами job (Change `ci-shards`, D5).
3. **Archive-PR — в сессии, не workflow.** PR, открытый workflow с `GITHUB_TOKEN`, не запускает workflow — у него не будет обязательных проверок, merge не наступит; запись record (`transition MERGED`, `archive`) из CI противоречит [ADR-0010](WARRANT-ADR-0010-trust-by-reference.md) п. 1 (CI ничего не коммитит) и требует отдельной identity. Сессия ставит `--auto` на impl-PR, ждёт merge и сразу открывает archive-PR с `--auto`. Пересмотр — когда у агента появится своя GitHub App (`SHARED_IDENTITY`, ADR-0044).
4. **Тег — workflow после merge archive-PR** (реализация — Change с новым workflow, policy path `factory-change`). При push в `main`: версия CLI выросла относительно последнего тега `v*`, такого тега нет, и push переводит Change в `ARCHIVED` — workflow ставит аннотированный тег на этот коммит. Права — `contents: write` только этому workflow; ни коммитов, ни record. Тег по-прежнему ставится только на merge archive-PR (шаг 6 `change-archive-pr`); до Change — шаг навыка.
5. **`docs/backlog.md` — `merge=union`** (уточняет ADR-0032 п. 5). `.gitattributes`: при merge строки обеих веток сохраняются без конфликта. Совпавший новый номер ловит `dev-context.test.ts` («IDs: PREFIX-N, unique») с подсказкой следующего свободного номера; свою строку перенумеровать в merge-коммите. Правка одной строки в двух ветках даёт две строки с одним ID — тот же тест.
6. **Конфликт версий — перегенерацией, не ручной правкой.** Конфликт в `package.json`, `package-lock.json`, `warrant.lock.json` репозитория или golden-фикстур: взять сторону `main` (`git checkout --theirs`), поднять версию, если `versions:check` требует (`npm version <x.y.z> --no-git-tag-version`), и перегенерировать — `warrant sync`, `npm run golden:update`; затем `node scripts/dev/check.js`. Скрипта `versions:bump` нет: генераторы уже есть, рецепт — в `git-land` `recovery.md`.

## Consequences

- Навык `fast-mode`; строка в таблице «Задача → навык» `AGENTS.md`; файл вне репозитория и память сессии `fast-mode` удаляются.
- `.gitattributes` — `docs/backlog.md merge=union`; `dev-context.test.ts` — подсказка следующего номера при повторе ID.
- `git-land` `recovery.md` — строки «Конфликт `docs/backlog.md`» и «Конфликт версий».
- Backlog: Change с workflow тега (п. 4).
- ADR-0032, ADR-0033 — заметка `amended_by`.

## Alternatives

- **Archive-PR workflow'ом с PAT или GitHub App** — отвергнуто сейчас: секрет в репозитории и identity, от имени которой CI пишет record; вернуться с GitHub App агента.
- **Тег при merge impl-PR** — отвергнуто: версия растёт в impl-PR, но main spec Change попадает в `main` только archive-PR; тег должен указывать на согласованные spec и код.
- **Номер строки backlog выдаёт CLI (`warrant id`) или workflow при merge** — отвергнуто: у двух веток от одного `main` нет общего состояния, CLI выдаст один номер; workflow с записью в `main` — то же возражение, что в п. 3. Соседство строк лечит только `merge=union`.
- **ID строк backlog с источником (`R-<change>-N`)** — отвергнуто: уникальность по построению ценой длинных ID; повтор номера редок и ловится тестом.
- **Скрипт `versions:bump`** — отвергнуто: одинаковый bump не конфликтует, а хэши lock всё равно перегенерируются.
- **Поднять таймаут `app` до 15–20 с** — отвергнуто (ADR-0025, «Поднять таймауты / число workers»): ограничение потоков вне CI сняло таймауты без смены предела.
