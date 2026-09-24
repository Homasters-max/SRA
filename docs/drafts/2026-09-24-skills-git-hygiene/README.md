# 2026-09-24 — навыки процесса: git, закрытие Change, ревью и CI, линзы, структура и гигиена

Источник — сессия 2026-09-24:
- оценка каталога [agency-agents/engineering](https://github.com/msitarzewski/agency-agents/tree/main/engineering)
  (64 агента);
- запрос maintainer'а: навык «git как системный процесс», навык гигиены, порядок в структуре каталогов.

## Уже решено — не гриллить

[ADR-0032](../../adr/WARRANT-ADR-0032-dev-context.md) (реализуется параллельно, ветка `process/dev-context`):
- одно место на каждый вид знания;
- передача — `docs/handoff/<поток>.md`;
- состояние — `scripts/dev/brief.js` (хук `SessionStart`);
- долг — `docs/backlog.md`;
- стандарт навыка: `.claude/skills/<name>/SKILL.md`, разделы Вход / Шаги / Стоп / Отчёт, до 80 строк, справочник — соседним файлом, форма — мета-тест `dev-context.test.ts`;
- навыки OpenSpec без `archive`/`sync`;
- `software-architect` и `grilling` переезжают в репозиторий.

Все новые навыки ниже пишутся по этому стандарту.

## Файлы и порядок grilling

| # | Файл | Зависит от |
|---|---|---|
| 1 | [01-git-flow.md](01-git-flow.md) — git как системный процесс: ветки, worktree, коммит, PR, merge, после merge, восстановление | — |
| 2 | [02-change-lifecycle.md](02-change-lifecycle.md) — процедуры spec-PR / impl-PR / archive-PR, замена `openspec-archive-change` | 01 (ветки, PR, после merge) |
| 3 | [03-hygiene-and-structure.md](03-hygiene-and-structure.md) — структура каталогов и имён, навык гигиены | 01 (ветки и worktree — часть гигиены) |
| 4 | [04-review-and-ci.md](04-review-and-ci.md) — `impl-review` (соответствие spec), `ci-triage` | 02 (место ревью в жизненном цикле) |
| 5 | [05-lenses.md](05-lenses.md) — что взять из agency-agents: оркестрация агентов, контракт CLI, минимальная правка | — |

## Сквозные вопросы — задать первыми

❓ **X1 — Место черновиков.** В таблице ADR-0032 п. 1 нет строки «черновики / идеи до решения». Варианты:
- (a) поправка к ADR-0032 — строка `docs/drafts/` и правило из [../README.md](../README.md);
- (b) считать черновик частью передачи потока.

➡️ (a): у черновика свой жизненный цикл (удаляется PR решения), и он больше 60 строк передачи.

❓ **X2 — Имена навыков.** Сейчас имена разного вида: `decision`, `group-done`, `handoff`, `code-search`,
`architecture-audit`. Вариант — префикс области: `git-*`, `change-*`, `review-*`, `repo-*`. Так список навыков в
каждой сессии группируется сам.

➡️ Префикс области для новых навыков, существующие не переименовывать: навыки процедур уже вошли в привычку.

❓ **X3 — Хуки для основной сессии.** ADR-0031 запрещает только субагентам (`agent_id`). Правила git (01, G3–G4) и
гигиены (03) нарушает как раз основная сессия. Расширять ли `PreToolUse deny` на основную сессию для узкого списка
команд git и `gh`?

➡️ Да, отдельным пунктом нового ADR. Белый список команд, по которым решает хук, — в `dev-hooks.test.ts`.

## Факты, проверенные 2026-09-24

- Репозиторий `Homasters-max/SRA` **приватный, бесплатный план**: защита веток и rulesets недоступны (`403 Upgrade to
  GitHub Pro`). В настройках репозитория разрешены merge commit, **squash и rebase**; `delete_branch_on_merge: false`.
  ADR-0011 (Consequences) рассчитывал на branch protection (обязательное review, CODEOWNERS) — её нет.
- Не удалены слитые в `main` ветки: локальных 8 (`archive/phase-3-verification`, `feature/*` ×4,
  `fix/secret-regex-archive-lookup`, `spec/phase-3-verification`, `worktree/phase-3-verification`), на origin 19.
- Теги `v0.2.0`…`v0.4.2` аннотированные. `.claude/agents/` нет. У CLI нет `--dry-run`, у `WarrantError` нет поля
  подсказки.
- На машине maintainer'а есть WSL и Docker: Linux-проблемы CI можно воспроизвести локально.
- Профиль OpenSpec 1.13.1 только глобальный (`openspec config profile`).
