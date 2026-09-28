---
id: WARRANT-ADR-0033
title: Git и PR разработки WARRANT — автоматический процесс, человек только решает; навыки git и Change, хуки основной сессии, гигиена, ревью реализации
adr_state: ACCEPTED
date: 2026-09-25
supersedes: []
amends: [WARRANT-ADR-0011, WARRANT-ADR-0031, WARRANT-ADR-0032]
amended_by: [WARRANT-ADR-0042, WARRANT-ADR-0043]
---

> Уточнено [ADR-0042](WARRANT-ADR-0042-lattice-fixes.md) п. 6: `fix/` (п. 10) — только вне policy-путей `factory-change`; правку судьи несёт PR Change ([ADR-0038](WARRANT-ADR-0038-pr-judged-by-base.md) п. 3). Уточнено [ADR-0043](WARRANT-ADR-0043-long-command.md): `git-hook.js` (п. 9) на Windows отклоняет команду Bash длиннее предела Git Bash.

## Context

Процесс git в разработке WARRANT ([ADR-0023](WARRANT-ADR-0023-warrant-dev-frontend.md)) держится на прозе `CLAUDE.md` и памяти, а не на процедурах и проверках (правило «о форме — проверкой», R-14…R-16). Что уже случалось:

| Правило | Держится | Сбой |
|---|---|---|
| Одна ветка — один worktree | шаг 1 навыка `group-done` | коммит `d2d8fd3` ушёл не в ту ветку: сессии переключали ветку в общем `D:\project\SRA` (фаза 2) |
| Текст коммита и PR — файлом | проза | PowerShell подставил `${0%/*}` в `-m`, текст коммита потерян (фаза 3) |
| impl-PR — только merge commit | `transition MERGED` → `COMMIT_NOT_MERGED` (I-97) | GitHub разрешал squash и rebase |
| Слитые ветки удаляются | ничем | на 2026-09-24 не удалены 8 локальных и 21 на origin |
| Один поток — одна цель | ничем | две сессии открыли потоки `git-flow` и `skills-git-hygiene` с одной целью |
| Закрыть Change — `warrant archive` | строка `CLAUDE.md` | перегенерированный `openspec-apply-change` советует `openspec archive` (BL-22) |

Последовательность трёх PR Change ([ADR-0011](WARRANT-ADR-0011-pr-topology.md)) пять Changes прошли вручную по прозе (архив NEXT-SESSION, память). Замены удалённого `openspec-archive-change` ([ADR-0032](WARRANT-ADR-0032-dev-context.md) п. 8) нет. Ревью фазы 3 (R-1…R-16) делалось после merge и потребовало ветку исправлений. Два дефекта проявились только на Linux (I-100, I-101), разбор шёл вручную. Структура репозитория нигде не описана целиком, мусор копится без владельца: бинарный `docs/archive/2026-09-22.zip` (единственная копия трёх исходных черновиков), имя с пробелом.

Факты на 2026-09-25: репозиторий `Homasters-max/SRA` приватный, бесплатный план — branch protection и rulesets недоступны (`403`); ADR-0011 (Consequences) рассчитывал на них. Хук `PreToolUse deny` ([ADR-0031](WARRANT-ADR-0031-pretooluse-deny.md)) проверяет только субагентов, а правила git нарушает основная сессия.

Решения приняты grilling'ом 2026-09-24/25 по черновикам `docs/drafts/2026-09-24-skills-git-hygiene/` (X1–X5, G1–G10, A1–A8, S1–S7, R1–R6, L1–L6; maintainer принял все рекомендации).

## Decision

### Принцип

1. **Человек решает, агент выполняет (X5).** Человек делает только то, что несёт доверие: решение о merge (это review, ADR-0011), принятие риска (активация waiver), настройки репозитория. Всё обратимое навык делает сам, без вопросов: ветки, worktree, коммиты, push, PR, ожидание и разбор CI, поиск run, evidence, переходы record, тег, чистка после merge. Подтверждение — только для необратимого: неслитые ветки, worktree с изменениями.

### Навыки

2. **Имена (X2).** Новые навыки — с префиксом области: `git-*`, `change-*`, `repo-*`, `review-*`. Существующие не переименовываются. Все — по стандарту ADR-0032 п. 6.
3. **`git-start` и `git-land` (G1, G5a, G8, G9).**
   - `git-start`: старт потока — проверка дублей (файлы передачи всех worktree и `main`, `docs/drafts/*`, строки `backlog.md` «Куда: поток …»), `git fetch`, `git worktree add ../SRA-<имя> -b <префикс>/<имя> origin/main`, `npm ci && npm run build`, файл передачи; «где я» — совпадение worktree и ветки, ahead/behind, PR ветки; коммит — текст в scratchpad, `git commit -F`. Сверка ветки живёт только здесь, `group-done` и `decision` на неё ссылаются.
   - `git-land`: push, `gh pr create --body-file` с шаблоном по виду PR, ожидание CI, merge (п. 5), после merge — `git pull --ff-only` в основном checkout, `git worktree remove`, `git branch -d`, `git push origin --delete`.
   - Справочники: `git-land/recovery.md` (коммит не в ту ветку, конфликты `docs/handoff/*`, `backlog.md`, номеров I-N, `reflog`; история не переписывается после того, как SHA попал в evidence, `--commit` или PR) и `git-land/ci.md`.
   - Только `git` и `gh`; инструменты Desktop-приложения — необязательная подсказка в «Шагах».
   - Имя потока — последний сегмент ветки (соглашение без проверки). Реестра потоков нет: он был бы вторым местом того же знания (ADR-0032 п. 1).
4. **`change-spec-pr`, `change-impl-pr`, `change-archive-pr` (A1–A6, A8).** Навык вызывает только `warrant`, `git`, `gh` и норм не содержит — порядок переходов держит `warrant transition`. Навыки связаны цепочкой: после merge spec-PR — worktree `worktree/<change>` и первый коммит `APPROVED` + `IMPLEMENTING`; после merge impl-PR — archive-PR.
   - `--by` для `APPROVED` и `MERGED` — из `roles.maintainer` `.warrant/warrant.json`: доверие держит `--ref` на merge человека.
   - Waivers spec-PR создаются в `PROPOSED` и перечисляются первым разделом тела PR; «merge #N» по spec-PR — активация перечисленных waivers (`--activate --by`), затем `verify`, `transition SPECIFIED`, push, CI, merge.
   - impl-head = второй родитель merge-коммита impl-PR; run — `gh run list --branch worktree/<change>` с `headSha` = impl-head и artifact `evidence-<change>`, идущий — дождаться; несовпадение — стоп (иначе `REF_MISMATCH`, R-6).
   - archive-PR — два коммита: `transition MERGED`, затем `warrant archive`. После merge — аннотированный тег `v<версия packages/cli>` на merge-коммите, сообщение `<change>: archive-PR #N`; проверки: тега нет, версия выросла (бамп — первым изменением после релиза, R-14). Удалить или заменить свой файл передачи, снять `После: <поток>` у зависящих (п. 12).
   - `dev-context.test.ts`: `change-archive-pr` содержит `warrant archive` и не содержит `openspec archive`.
5. **Merge (G10).** Человек пишет в чат «merge #N»; навык ждёт зелёного CI (`gh pr checks --watch`), выполняет `gh pr merge <N> --merge` и продолжает. Запасной путь — человек жмёт merge в GitHub, навык видит `state: MERGED` (`gh pr view`). Merge без слова в чате запрещён; хук чат не видит — держит шаг навыка. `gh pr merge * --merge` — в `permissions.allow` проекта.
6. **Ревью реализации (R1, R2, R4, R5, R6).**
   - `review-impl` запускается сам шагом `change-impl-pr` после `VERIFYING`, до merge. Агент — тип `.claude/agents/reviewer.md` без `Write` и `Edit`. Проверяет: REQ/SCN delta — код и тест с тегом (`scripts/dev/scn-coverage.js`), I-N — реализовано как записано, файлы вне задач tasks.md, нормы ADR, вопросы maintainer'а. Метки: 🔴 блокер — исправляется в той же ветке; 🟡 / 💭 — строками R-N в `backlog.md`; отчёт — в тело PR, затем просьба «merge #N».
   - Красный CI разбирает `git-land` сам (`git-land/ci.md`): `gh run view --log-failed`, класс (платформа, нестабильный тест, дефект, ожидаемый `WAIT` job `evidence`), исправление с тестом уровня по ADR-0025, push. Стоп и отчёт — тот же сбой после двух попыток или нестабильный тест (обход запрещён). Сбой только на ubuntu — `npm run test:linux` (Docker `node:22` + openspec 1.13.1); нет Docker — шаг пропускается с пометкой. Платформенные ловушки (I-100, I-101, …) — раздел `packages/cli/CLAUDE.md`.
7. **Координатор и субагенты (L1, L2, L4, L6).** `docs/process/coordinator.md` становится навыком `change-coordinate`. Промпт субагента получает поля «не отвечаешь за», «при сбое» (N красных подряд — стоп и отчёт, не обход), бюджет; отчёт — «тронутые файлы и причина» и «замечено, но не сделано» (координатор переносит в `backlog.md` или отбрасывает с причиной). Из типов агентов — только `reviewer`; `implementer`, `explorer` — по сбою, который они бы предотвратили.
8. **Линзы (L3, L5).** Навык-линза `cli-contract` — до grilling фазы 4: ошибка называет исправление, exit-коды по 04 §7, стабильный `--json` под golden, `--dry-run` у меняющих состояние команд, `--help` с примером. Типы сбоев оркестрации и расстановка проверок человеком — справочник `software-architect/orchestration.md`.

### Проверки

9. **Хук `PreToolUse deny` и для основной сессии — уточняет ADR-0031 (X3, G3, G6, A7).** Узкий список команд Bash/PowerShell, у основной сессии и субагентов:
   - в основном checkout (`git rev-parse --git-dir` = `--git-common-dir`) — `commit`, `merge`, `cherry-pick`, `revert`, `checkout` / `switch` на другую ветку и с `-b`; разрешены `pull --ff-only`, `fetch`, `worktree add/remove`, `branch -d`, `push origin --delete`;
   - `git push --force`, `--force-with-lease`, refspec `+…` — везде; force push делает только maintainer вручную;
   - `openspec archive` — везде, причина: `warrant archive <change>`, навык `change-archive-pr`. `warrant archive` вызывает `openspec archive` из своего процесса, хук его не видит. Закрывает BL-22.

   Хук разбирает текст команды и страхует от ошибки, а не от обхода (`cd … &&`, `git -C` ловятся не все). Команды, по которым решает хук, — таблица-белый список в `dev-hooks.test.ts`. Решения ADR-0031 о `Read` / `Grep` субагентов не меняются.
10. **Форма PR — шаг CI (G2, G5).** `scripts/dev/pr-form.js` (unit-тесты) — dev-скрипт, не `warrant ci`:
    - префикс ветки (`github.head_ref`): `spec/`, `worktree/`, `archive/` (Change), `process/` (ADR и реализация процесса), `docs/` (только документы), `fix/` (исправление вне Change); `feature/` снят;
    - заголовки коммитов PR (`base..head --no-merges`): `<change>: …` в ветках Change, `<префикс>: …` в остальных.
11. **Сервер (G4).** Squash и rebase выключены в настройках репозитория (maintainer, 2026-09-25), I-97 держит сам GitHub; `delete_branch_on_merge` — `false` (удаление ветки удаляет её worktree). Автопроверки настроек нет.

### Контекст разработки — уточняет ADR-0032

12. **Черновики и порядок потоков (X1, X4).**
    - Таблица ADR-0032 п. 1 получает строку: идеи до решения — `docs/drafts/<YYYY-MM-DD>-<тема>/` по `docs/drafts/README.md`, пишет сессия, удаляет PR решения. Строка в «Карте» `CLAUDE.md`, форма папки — в `dev-context.test.ts`.
    - Форма файла передачи (ADR-0032 п. 3) — строка `После: <поток>[, <поток>]` сразу под заголовком. `brief.js` (п. 4) печатает потоки в порядке зависимостей и помечает ждущие; `dev-context.test.ts` проверяет, что поток из «После» существует (файл передачи в `main` или в worktree) и циклов нет. Строку снимает последний PR потока-предшественника.
13. **Структура и гигиена (S1–S7, G7).**
    - Карта — только «Карта» `CLAUDE.md` (+ `docs/drafts/`, `lattice/`, `graft/`); отдельного `structure.md` нет.
    - Имена: нормативные — `NN[a-z]?-<тема>.md`; ADR — `WARRANT-ADR-NNNN-<slug>.md`; датированные — `YYYY-MM-DD-<тема>`; kebab-case латиницей, без пробелов; бинарных файлов в `docs/` нет. Держит `structure.test.ts` вместе с белым списком верхнего уровня (`git ls-files`; игнорируемые не видны). Приведение: zip распаковать в `docs/archive/2026-09-22-openspec-drafts/`, ссылку `00-readme.md` поправить; файл с пробелом переименовать; `docs/integrations/` не трогать. `docs/process/` не делится, пока в нём меньше 10 файлов.
    - `scripts/dev/hygiene.js` поверх `brief-lib.js` находит, навык `repo-hygiene` исправляет; `brief.js` показывает счётчик «гигиена: N» и число слитых `origin/*` по последнему `fetch` (без сети). Запуск — перед spec-PR фазы и по счётчику; в конце потока работает «после merge» `git-land`.
    - Удаление: сам — слитые ветки (локальные и на origin), worktree слитых веток без изменений, игнорируемые остатки; через hygiene-PR (merge = review) — всё, что в git; с подтверждением — неслитые ветки и worktree с изменениями.

### Порядок

14. Реализация — поток `git-automation` (ветки `process/…`), первым — хуки (п. 9), затем `git-start` / `git-land`, навыки Change, гигиена и структура, ревью, линзы. Разовая чистка накопленных слитых веток — сразу после merge этого ADR. Поток `phase-4` ждёт `git-automation` (`После:`).

## Consequences

- Для человека Change сводится к трём «merge #N»; waivers spec-PR принимаются тем же словом по тексту PR.
- ADR-0011 п. 3 и Consequences: для разработки WARRANT (ADR-0023) решение о merge — человек, выполнение — агент; «review» принуждает процесс, а не branch protection, до смены плана. Продуктовая норма — `MERGE` никому из агентов SEF, принуждение правами GitHub App — не меняется.
- ADR-0031: основная сессия впервые под `deny`; предел — разбор текста команды.
- ADR-0032 п. 1, 3, 4: строка черновиков, `После:`, вывод `brief.js`.
- Отложено в `backlog.md`: issue в OpenSpec о настраиваемой команде архивации (публикация — с согласия maintainer'а); сравнение dev-ревью и gate `adversarial-review` на одном Change — фаза 4 (dev-ревью не producer gate: attestation `none`); продуктовый check `scn-covered` — фаза 5. `--dry-run` у `transition` / `archive` / `waive` и подсказка у `WarrantError` — вход grilling фазы 4.

## Alternatives

- **Человек запускает `gh pr merge` сам (G10 a).** Отвергнуто: рутина ожидания CI и «готово» без добавочного доверия — решение то же, исполнитель не важен.
- **Отдельная остановка на активацию waivers (A5 a).** Отвергнуто: риск принимается по тексту того же PR, вторая остановка ничего не проверяет.
- **Один навык `git-flow` / `change-pr <вид>` (G1 c, A1 c).** Не помещается в 80 строк; у каждого вида PR свой момент остановки.
- **Реестр потоков, приоритет числом (G9 b, X4 b–c).** Второе место знания; числа из разных сессий несравнимы.
- **`docs/process/structure.md` (S1 b).** Третье место рядом с «Картой» и `structure.test.ts`.
- **Удалить zip из git (S2 b).** Теряется единственная копия в рабочем дереве.
- **Хук на создание ветки вместо шага CI (G2).** Не работает для людей и других агентов.
- **Публичный репозиторий или GitHub Pro ради branch protection (G4).** Не сейчас; пересмотр — при смене плана.
