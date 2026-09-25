---
name: change-spec-pr
description: "Провести spec-PR Change до merge — ветка spec/<change>, classify, review spec субагентом warrant-reviewer, waivers в теле PR, verify и transition SPECIFIED по слову maintainer'а, merge, затем impl-PR. Использовать, когда артефакты Change готовы к утверждению, начинают новый Change после grilling или просят «/change-spec-pr»."
argument-hint: "<change>"
---

# spec-PR Change

Первый из трёх PR Change ([ADR-0011](../../../docs/adr/WARRANT-ADR-0011-pr-topology.md),
[ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 4). Навык знает только последовательность: порядок
переходов и gates держит `warrant transition`. Git, PR, CI и merge — шаги навыков `git-start` и `git-land`.

## Вход

- `<change>` — kebab-id. Артефакты `openspec/changes/<change>/` (proposal, specs, design, tasks) — навык
  `openspec-propose`; spec-PR фазы roadmap — после навыка `architecture-audit`.
- `W` = `node packages/cli/dist/bin/warrant.js`; maintainer — `node -p "require('./.warrant/warrant.json').roles.maintainer[0]"`.

## Шаги

1. Ветка — `git-start start spec/<change>`. Артефакты — в ней, первым коммитом `<change>: … (spec)`; проверка:
   ```bash
   openspec validate <change> --strict
   ```
2. Классификация по diff spec-PR — коммит `<change>: classify …`:
   ```bash
   $W classify <change>
   ```
3. Review spec (gate `adversarial-review`, [ADR-0034](../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 10) —
   в `PROPOSED`, spec закоммичена. `warrant` должен быть на PATH (его зовёт хук субагента): `warrant --version`,
   нет — `npm link` в корне worktree. Context Pack:
   ```bash
   $W run start <change> --operation review
   ```
   Весь JSON вывода — промптом субагенту `warrant-reviewer` (`.claude/agents/warrant-reviewer.md`); envelope он сдаёт
   сам (`warrant run submit`) и возвращает `evidence`, `status`, находки по `severity`. Файлы Run, `.result.json` и
   evidence — коммитом `<change>: review <RUN> — <status>`. `BLOCKER` — правка spec, коммит, шаг 3 заново.
4. Gates `PROPOSED->SPECIFIED`:
   ```bash
   $W verify <change>
   ```
   Gate без producer'а — waiver в `PROPOSED`, образец `.warrant/waivers/WAV-2026-007.json`:
   ```bash
   $W waive <change> <gate> --reason "<почему нет producer'а>" --risk HIGH --control "<контроль>" --owner human:<maintainer> --expires <YYYY-MM-DD>
   ```
   Waivers нет — сразу шаг 6 до PR.
5. PR — шаги 1–3 `git-land`. Тело начинается разделом «Waivers на решение»: WAV, gate, risk, reason, expires и
   строка «merge #N = активация этих waivers (ADR-0033 п. 4)», затем находки review. CI зелёный — «жду merge #N».
6. По «merge #N» — активация, проверка, переход; коммит `<change>: waivers WAV-…, verify PROPOSED->SPECIFIED,
   transition SPECIFIED`, push:
   ```bash
   $W waive --activate <WAV> --by <maintainer>
   $W verify <change>
   $W transition <change> SPECIFIED
   ```
7. CI и merge — шаги 3–4 `git-land`, после merge — шаг 5. Затем навык `change-impl-pr <change>` с номером этого PR.

## Стоп

- `openspec validate`, `classify` или `verify` — ошибка или `FAIL` gate, у которого producer есть: исправить
  артефакты, а не снимать waiver'ом.
- Gate не waivable — waiver невозможен: показать gate и спросить.
- Субагент не сдал envelope (`warrant` не найден, отказ не guard'а) — `$W run finish --state FAILED`, показать причину;
  evidence руками не писать.
- Нет «merge #N» — не активировать waivers и не сливать.

## Отчёт

Ссылка на PR, класс Change, review (RUN, `status`, находки по `severity`), waivers (WAV, gate, срок), итог `verify`; после merge — merge-коммит и что дальше.
