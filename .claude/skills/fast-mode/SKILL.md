---
name: fast-mode
description: "Быстрый режим — задача WARRANT одной сессией до merge: план и вопросы один раз, затем без остановок — быстрые проверки, коммит на звено, merge `--auto` при зелёном CI, чистка; жёсткие правила не ослабляются. Использовать, когда maintainer просит «быстрый/упрощённый режим», «всё в автоматическом режиме», «самостоятельно, без остановок», или «/fast-mode»."
argument-hint: "<задача>"
---

# Быстрый режим

Та же цепочка навыков (`git-start`, `git-land`, `change-*`), но без остановок между звеньями: maintainer решает один раз — в ответ на план ([ADR-0047](../../../docs/adr/WARRANT-ADR-0047-pr-cycle.md)). Жёсткие правила `AGENTS.md` не ослабляются: JSON и record — через CLI, merge — только `--merge`, длинный текст — файлом.

## Вход

- Задача и явная просьба о быстром режиме. Без просьбы — обычные навыки.
- `gh api repos/Homasters-max/SRA --jq .allow_auto_merge` → `true` и обязательные проверки `main`: `test (ubuntu-latest)`, `test (windows-latest, 1/2)`, `test (windows-latest, 2/2)`, `warrant / warrant`. Без защиты `--auto` сливает сразу — тогда вместо него `gh pr checks N --watch`.

## Шаги

1. **План до действий.** Ответить, возможно ли; честно назвать недостижимое (цепочка PR Change — три merge, не один); минимальная цепочка звеньев и 2–3 вопроса, снимающих остановки (merge при зелёном CI, порядок archive/тег, что делать с flaky). Ничего не менять до ответа. «Запускай» / «всё в автоматическом режиме» = разрешение сливать при зелёном CI archive- и docs-PR (spec- и impl-PR — auto-merge maintainer'а, `git-land` шаг 4), ждать CI и чистить ветки — только в этой задаче.
2. **Звено = ветка, коммит, PR.** Ветка — в своём worktree (`git-start`); worktree переиспользуется под следующую ветку `git switch -c <ветка> origin/main`. Policy paths (`.github/workflows/**` и другие пути профиля `factory-change`) — только в PR своего Change: в process/docs/fix-PR `warrant / warrant` даёт `SCOPE_VIOLATION` — такую правку вынести в Change, не смешивать.
3. **Проверки — быстрые.** `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`), точечный vitest по затронутому (`npx vitest run --config packages/cli/vitest.config.ts <имя>`), `npm run typecheck`. Полный набор — CI. `warrant verify` только ради перехода: он пишет evidence; вызов ради проверки — откатить (`git checkout` manifest, удалить новый EVID).
4. **PR и merge.** Тело — файлом; сразу после `gh pr create` — `gh pr merge N --merge --auto` для archive- и docs-PR, для spec-, impl-PR и PR с защитой агента — ссылка maintainer'у «Enable auto-merge» (`git-land` шаг 4), CI не опрашивать — пока он идёт, готовить следующее звено, текст передачи, отчёт. Нужен итог — `gh pr checks N --watch`. `CLEAN`, но не слит через 60 с — `gh pr merge N --merge`.
5. **Change.** Review spec (gate `adversarial-review`) — субагент `warrant-reviewer`, Context Pack `run start` промптом, корень worktree явно. `PROVEN` с MAJOR — один раунд правки spec в spec-PR; второй раунд — последний: оставшееся — тестом impl-PR, решением design или строкой backlog, перечислить в теле PR. `review-impl` пропускается.
6. **Между PR Change.** После merge spec-PR evidence `spec-report` — `STALE`: сначала `warrant verify <change>`, потом `transition APPROVED`; неудавшийся `transition APPROVED` уже записал `human-approval` — откатить. `IMPLEMENTING->VERIFYING` без gates — `verify` быстрый. Impl-PR слит — сразу archive-PR (`change-archive-pr`): workflow его не откроет (ADR-0047 п. 3). Тег — только если выросла версия поставляемого (`ci.yml`, тесты, `scripts/dev` не поставляются).
7. **Чистка.** После последнего merge — из основного checkout `git pull --ff-only`, `git worktree remove`, `git branch -d` и `git push origin --delete` каждой ветки звена.

## Стоп

- Известный flaky WS-30 (e2e `gate`/`verify (argv)` на ubuntu, «does not provide an export named …»): один раз `gh run rerun <run>` (весь run, BL-72); второе падение — стоп и отчёт. Не чинить по ходу; `--admin` и обход защиты — нет.
- Отказ классификатора auto mode (настройки репозитория, защита ветки, откат правки ради зелёного job, PR с правкой `.github/workflows/**`) — не обходить другим путём: дать maintainer'у команды отдельными `bash`-блоками, остальное продолжать.
- Красный CI не по flaky — разбор по `git-land` [ci.md](../git-land/ci.md); тот же сбой после двух исправлений — стоп.
- Решение, меняющее spec, design или ADR, — вопросом maintainer'у, не по ходу.

## Отчёт

Короткий: что слито (PR, merge-коммиты), тег или почему его нет, что не сделано и почему, команды для maintainer'а (если были отказы) и готовый текст передачи агенту — блоком кода.
