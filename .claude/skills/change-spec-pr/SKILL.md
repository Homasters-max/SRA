---
name: change-spec-pr
description: "Провести spec-PR Change до merge — ветка spec/<change>, classify, review spec субагентом warrant-reviewer, waivers в теле PR, verify и transition SPECIFIED по слову maintainer'а, merge, затем impl-PR. Использовать, когда артефакты Change готовы к утверждению, начинают новый Change после grilling или просят «/change-spec-pr»."
argument-hint: "<change>"
---

# spec-PR Change

Первый из трёх PR Change ([ADR-0011](../../../docs/adr/WARRANT-ADR-0011-pr-topology.md), [ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 4). Навык знает только последовательность: порядок переходов и gates держит `warrant transition`. Git, PR, CI и merge — шаги навыков `git-start` и `git-land`.

## Вход

- `<change>` — kebab-id. Артефакты `openspec/changes/<change>/` (proposal, specs, design, tasks) — навык `openspec-propose`; spec-PR фазы roadmap — после навыка `architecture-audit`.
- `W` = `node packages/cli/dist/bin/warrant.js`; maintainer — `node -p "require('./.warrant/warrant.json').roles.maintainer[0]"`.

## Шаги

1. Ветка — `git-start start spec/<change>`. Артефакты — в ней, первым коммитом `<change>: … (spec)`; проверка:
   ```bash
   openspec validate <change> --strict
   ```
2. Классификация — `$W classify <change> --paths <файл>` (diff spec-PR и пути «Impact» proposal, BL-45), коммит `<change>: classify …`.
3. Review spec (gate `adversarial-review`, [ADR-0034](../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 10) — в `PROPOSED`, spec закоммичена. Хук субагента исполняет dev-CLI основного checkout, а `run submit` — dev-CLI worktree (`cli` в `warrant.json`, ADR-0053 п. 3), PATH не нужен: `npm run build` в обоих. Context Pack:
   ```bash
   $W run start <change> --operation review
   ```
   Весь JSON вывода — промптом субагенту `warrant-reviewer` (`.claude/agents/warrant-reviewer.md`); envelope он сдаёт сам — `cd <worktree> && node packages/cli/dist/bin/warrant.js run submit --file` (ADR-0042 п. 4, ADR-0043; до CLI 0.8.1 — heredoc ≤ 6 000 символов, сверх — сводной находкой, полный текст — в ответе и в тело PR) — и возвращает `evidence`, `status`, находки по `severity`. Файлы Run, `.result.json` и evidence — коммитом `<change>: review <RUN> — <status>`. `BLOCKER` — правка spec, коммит, шаг 3 заново. `PROVEN` с `MAJOR` — не новый раунд (правка `specs/**` делает review `STALE`): строка backlog, исправление — в impl-PR по [ADR-0024](../../../docs/adr/WARRANT-ADR-0024-spec-approved-contract.md) п. 4 (строка I-N, правка delta spec, waiver на `spec-approved`, активирует maintainer; [ADR-0038](../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md)).
4. Gates `PROPOSED->SPECIFIED`:
   ```bash
   $W verify <change>
   ```
   Gate без producer'а — waiver в `PROPOSED`, образец `.warrant/waivers/WAV-2026-007.json`:
   ```bash
   $W waive <change> <gate> --reason "<почему нет producer'а>" --risk HIGH --control "<контроль>" --owner human:<maintainer> --expires <YYYY-MM-DD>
   ```
   Waivers нет — сразу шаг 7 до PR.
5. PR — шаги 1–3 `git-land`. Тело начинается разделом «Waivers на решение»: WAV, gate, risk, reason, expires и строка «слово maintainer'а в чате „активируй WAV-…“ = активация этих waivers (ADR-0033 п. 4, I-222)», затем находки review. CI (`test`, `warrant / warrant` — `kind: spec`, правило путей) — ссылка maintainer'у на auto-merge только после push коммита `transition SPECIFIED` (шаг 7): слитый без него spec-PR не несёт перехода, ref `APPROVED` — отказ `change`.
6. Blocking UNKNOWN (ответ меняет spec): `$W unknown add <change> --area <AREA> --text "<вопрос>" --blocking` → `$W status <change>` — `WAIT`, next `clarify`. Решение — комментарий maintainer'а в этом PR с id `UNK-…` в тексте:
   ```bash
   $W unknown resolve <change> <UNK> --as decision --text "<ответ>" --ref <URL …#issuecomment-<id> | …#pullrequestreview-<id>>
   ```
   Коммит `<change>: unknown <UNK> — decision`; исправить до `APPROVED` — тот же вызов с `--replace`. `warrant unknown` — только в `PROPOSED` и `SPECIFIED` ([ADR-0040](../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 2, 3).
7. По слову maintainer'а в чате «активируй WAV-…» (без waivers — сразу, шаг 4) — активация, проверка, переход; коммит `<change>: waivers WAV-…, verify PROPOSED->SPECIFIED, transition SPECIFIED`, push:
   ```bash
   $W waive --activate <WAV> --by <maintainer>
   $W verify <change>
   $W transition <change> SPECIFIED
   ```
8. CI и merge — шаги 3–4 `git-land`, после merge — шаг 5. Затем навык `change-impl-pr <change>` с номером этого PR.

## Стоп

- `openspec validate`, `classify` или `verify` — ошибка или `FAIL` gate, у которого producer есть: исправить артефакты, а не снимать waiver'ом.
- Gate не waivable — waiver невозможен: показать gate и спросить.
- Субагент не сдал envelope (`warrant` не найден, отказ не guard'а) — `$W run finish --state FAILED`, показать причину; evidence руками не писать.
- Нет слова «активируй WAV-…» или blocking UNKNOWN открыт — не активировать waivers и не просить auto-merge; spec-PR агент не сливает.

## Отчёт

Ссылка на PR, класс Change, review (RUN, `status`, находки по `severity`), waivers (WAV, gate, срок), итог `verify`; после merge — merge-коммит и что дальше.
