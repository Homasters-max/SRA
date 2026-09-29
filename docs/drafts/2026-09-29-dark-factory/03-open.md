# Тёмная фабрика — открытое и состояние на 2026-09-29

Что осталось сделать после решений Q1–Q7 ([01-accepted](01-accepted.md)) и где остановилась сессия 2026-09-29. Проверить заново перед работой: состояние PR и веток меняется.

## Проблема

Решения приняты, но не записаны нормой (ADR-0050), схема v2 не перестроена, а Change `identities` не доведён. Новая сессия должна продолжить без повторного разбора.

## Идея

### 1. Перестройка схемы v2 под модель «человек до запуска»

Узлы человека схемы v2 ([02-scheme-v2](02-scheme-v2.md)) → `docs/process/dark-factory.md`:

| Узел схемы v2 | Было | Станет |
|---|---|---|
| §2 «Одобрить намерение и план» (HI) | каждая задача | сливается с одобрением spec (Q1); задачи без spec — метка `ready` |
| §3 одобрение spec | LOW — авто, HIGH — человек | всегда человек: это запуск (Q1) |
| §3–§4 решение UNKNOWN, активация waiver по ходу | человек в чате | только до запуска, в spec-PR; после запуска — FAIL `spec` или `human` с отчётом (Q3) |
| §4 эскалация при исчерпании бюджета | вопрос человеку | FAIL `budget` — конечный результат (Q3, Q4) |
| §6 приёмка impl HIGH (HA) | человек | только контур доверия (Q2); до 0.9.0 — временный узел: все impl-PR (Q7) |
| §6 «не готово ≤ N → Build» | с эскалацией | петля машины; сверх бюджета — FAIL (Q4) |
| §6, §11 выборочный аудит | постоянная роль | остаётся — после результата, вне цикла |
| §11 таблица «человек: временно / навсегда» | условия удаления по риску | переписать по Q1–Q7: внутри цикла только исключение Q2 и временный узел Q7 |
| §13.2 «H потребляет у 7 поставщиков» | цель — очередь входящих | до запуска — spec, после — отчёт PASS/FAIL; внутри цикла — ничего |
| §13.4 светофор | волны ADR-0049 | порядок работ [01-accepted](01-accepted.md) «Порядок работ» |

WARRANT (§10) и порядок исправлений судьи (WS-03, WS-04, WS-13, WS-14 до снятия человека) — без изменений.

### 2. Change `identities` (WS-04) — где остановились

- **Spec-PR [#106](https://github.com/Homasters-max/SRA/pull/106)** (ветка `spec/identities`, открыл бот `homasters`) — все проверки зелёные, ждёт merge maintainer'ом: это запуск по Q1. Auto-merge на нём не включён (maintainer пробовал, GitHub не сохранил).
- **Правки impl-PR подготовлены, не закоммичены** — worktree `D:/project/SRA-identities` (ветка `spec/identities`):
  - `.warrant/warrant.json`: `identities.agents` — `homasters`, `kind: "machine-user"`; `validate` и `fmt` зелёные;
  - навыки `git-land`, `fast-mode`, `change-spec-pr`, `change-impl-pr`, `change-archive-pr`: spec- и impl-PR агент не сливает; archive-PR — бот `--auto`; `SPECIFIED` до просьбы о merge; `gh run rerun` — весь run. `dev-context.test.ts` зелёный.
- **После merge #106:**
  1. в том же worktree `git switch -c worktree/identities origin/main` (незакоммиченные правки переедут);
  2. первым коммитом — `transition APPROVED --ref <URL #106> --by Homasters-max`, `transition IMPLEMENTING`;
  3. группы 1 и 2 `tasks.md`, решения `I-N` по остатку review 2 (тело PR #106):
     - F-1, F-6 — правки навыков уже шире группы 2;
     - F-2 — `SPECIFIED` до merge;
     - F-3 — D5: восстановление через revert не работает (судья отказывает в укороченной записи), путь через lifecycle — строка backlog, проверить;
     - F-5 — токен maintainer'а доступен агенту на той же машине: не класс B, а граница доверия 06 §8;
  4. `VERIFYING`, impl-PR; его сливает maintainer (временный узел Q7);
  5. archive-PR — бот `--auto`. Проверка F-6 review 1: в выводе `warrant ci` archive-PR нет `SHARED_IDENTITY`.
- Навыки сейчас в `main` ещё велят агенту сливать spec- и impl-PR — до merge impl-PR `identities` следовать 01-accepted, а не им.

### 3. Бот и разрешения

- `C:\Users\Xiaomi\.claude\settings.json`:
  - `env.GH_TOKEN` — PAT `homasters`;
  - `permissions.allow` — `gh pr merge`, `git pull --ff-only`, `git worktree remove`, `git branch -d`, `git push origin --delete`.

  Правила читаются при старте Claude Code; команды — по одной, без цепочек `&&`.
- Git-автор бота (`GIT_AUTHOR_*` / `GIT_COMMITTER_*` = `WARRANT agent <52467145+homasters@users.noreply.github.com>`) в `env` настроек **ещё не добавлен**. Пока агент задаёт их в команде (`export … && git commit`). Добавить в `env` — шаг maintainer'а.
- Классификатор auto-режима запрещает агенту:
  - запись правил, расширяющих его полномочия («Instruction Poisoning»);
  - цепочку чистки после merge.

  Разрешены: merge, чистка по одной команде, `gh api -X PATCH` настроек репозитория (после правил maintainer'а).
- Правило «разработка — автономно по умолчанию» (строка `AGENTS.md` и `fast-mode`) maintainer не добавил; текст и места — в истории сессии. Его накрывает ADR-0050.

### 4. Решения стабилизации, ещё не принятые

Р-5 (archive/abandon через push в `main`), Р-9 (активация waiver по ссылке), Р-10 (код 4, `retryable` — по Q4 нужен в 0.9.0), форма проверки форжа (`doctor` или находки) — на spec-PR цикла 1. Р-2, Р-7, Р-8, Р-11 — цикл 2 и позже ([ADR-0048](../../adr/WARRANT-ADR-0048-stabilization.md), [backlog](../../backlog.md) WS-N).

## Вопросы для grilling

1. **Метка `ready` — где живёт?** Issue GitHub с меткой или строка `docs/backlog.md` с полем. Рекомендация: issue с меткой `ready`. Её видит исполнитель Q5, а строка backlog — долг, а не намерение.
2. **Хранение advisory-ревью (Q6).** Рекомендация: файл отчёта Run вне `.warrant/evidence/**` (например, `.warrant/runs/<RUN>.result.json` с `advisory: true`) и раздел отчёта Q3. Kind `review` не использовать, пока нет attestation.
3. **Формат отчёта Q3.** Рекомендация: Markdown-комментарий бота с таблицей «стадия · попытки · вердикт · причина» и JSON-блоком для машин; шаблон — в `flow.js`, текст детерминированный (ADR-0049 п. 4).

## Вне объёма

- Реализация flow и правки судьи — Change и PR по порядку работ [01-accepted](01-accepted.md).
- Схема v2 §9б (LATTICE) — после первого запуска LATTICE.
