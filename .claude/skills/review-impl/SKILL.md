---
name: review-impl
description: "Ревью реализации Change до merge impl-PR — агент reviewer (без записи) сверяет diff с delta specs, I-N и ADR, покрытие SCN; блокеры исправляются в ветке, остальное — строками backlog, отчёт — в тело PR. Использовать, когда impl-PR дошёл до VERIFYING (шаг change-impl-pr), когда нужно проверить реализацию на соответствие spec, или просят «/review-impl»."
argument-hint: "<change> [вопросы maintainer'а]"
---

# Ревью реализации на соответствие spec

Ревью — до merge, в отдельном агенте, который не писал код ([ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 6). Правка до merge дешевле ветки исправлений после него (ревью фазы 3, R-1…R-16). Баги вне сверки со spec ищет встроенный `code-review`; продуктовый gate `adversarial-review` — другое (BL-24).

## Вход

- `<change>` в своём worktree `worktree/<change>`, последний коммит — `transition VERIFYING` (шаг 4 `change-impl-pr`).
- Вопросы maintainer'а к реализации, если заданы.

## Шаги

1. Факты для промпта:
   ```bash
   git diff --stat origin/main...HEAD
   node scripts/dev/scn-coverage.js <change>
   grep -n "^| I-" openspec/changes/<change>/design.md
   ```
2. Агент — тип `reviewer` (`.claude/agents/reviewer.md`, без `Write` и `Edit`), `description` = `<change> review`:
   ```text
   Change <change>, ветка worktree/<change>, worktree <путь>. Прочитай openspec/changes/<change>/ (proposal, specs, design, tasks) и ADR из proposal. Diff: <stat>. Покрытие SCN: <вывод scn-coverage>. Вопросы maintainer'а: <или «нет»>. Отчёт — по твоей инструкции.
   ```
3. Разбор отчёта — самому, каждую находку проверить по `файл:строка`:
   - 🔴 — исправить в этой ветке (коммит `<change>: review — …` навыка `git-start`), затем снова шаг 4 `change-impl-pr` и шаги 1–3 этого навыка;
   - 🟡 и 💭 — строками `R-N` в `docs/backlog.md` (следующий номер после максимального `R-`), «Куда» — Change или фаза;
   - находка не подтвердилась — в отчёт с причиной, не в backlog.
4. Отчёт ревью — разделом «Ревью» в тело impl-PR: число 🔴 (исправлено) / 🟡 / 💭, покрытие SCN, строки `R-N`.

## Стоп

- Тот же 🔴 после двух исправлений или 🔴 требует отступить от spec — вопрос maintainer'у; принятое — навык `decision`.
- Агент не смог прочитать spec или diff — повторить с явными путями; снова нет — ревью «не проведено» в теле PR.

## Отчёт

🔴 найдено / исправлено, 🟡, 💭, покрытие SCN `covered/total`, добавленные `R-N`, раздел для тела PR.
