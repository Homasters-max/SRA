---
name: change-impl-pr
description: "Провести impl-PR Change до merge — ветка worktree/<change>, transition APPROVED и IMPLEMENTING первым коммитом, группы tasks.md, transition VERIFYING последним, ревью, вердикт job warrant, merge по слову maintainer'а, затем archive-PR. Использовать, когда spec-PR Change слит, когда реализация Change закончена и её нужно довести до merge, или просят «/change-impl-pr»."
argument-hint: "<change> <номер spec-PR>"
---

# impl-PR Change

Второй из трёх PR Change ([ADR-0011](../../../docs/adr/WARRANT-ADR-0011-pr-topology.md) п. 3, [ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 4, 6). Переходы и gates держит `warrant transition`; git, PR, CI и merge — навыки `git-start` и `git-land`.

## Вход

- `<change>` и номер слитого spec-PR `S`. `W` = `node packages/cli/dist/bin/warrant.js`; maintainer — `node -p "require('./.warrant/warrant.json').roles.maintainer[0]"`.

## Шаги

1. Ветка — `git-start start worktree/<change>` (от `origin/main` со слитым spec-PR).
2. Первый коммит — `<change>: transition APPROVED --ref PR #S --by <maintainer>, transition IMPLEMENTING`:
   ```bash
   gh pr view <S> --json url,state --jq '.state + " " + .url'
   $W transition <change> APPROVED --ref <url spec-PR> --by <maintainer>
   $W transition <change> IMPLEMENTING
   ```
   `--by` — maintainer из `roles`: доверие держит `--ref` на его merge (ADR-0033 п. 4).
3. Группы `tasks.md` по порядку — навык `openspec-apply-change`; раздача субагентам — `change-coordinate`; каждая группа — коммит навыка `group-done`. Правка spec после approval (MAJOR review spec, уточнение контракта) — по [ADR-0024](../../../docs/adr/WARRANT-ADR-0024-spec-approved-contract.md) п. 4 внутри Run `implement` (его `write_scope` — и `design.md`, и `specs/**` Change): строка `I-N` — навык `decision`, правка delta spec, коммит; `spec-approved` — `FAIL` `SPEC_CHANGED_AFTER_APPROVAL`, пока waiver (`PROPOSED`, в тело PR) не активирует maintainer по слову в PR:
   ```bash
   $W waive <change> spec-approved --reason "<I-N>: …" --risk LOW --control "<контроль>" --owner human:<maintainer> --expires <YYYY-MM-DD>
   $W waive --activate <WAV> --by <maintainer>
   ```
   Вопрос реализации — не `warrant unknown` (только до `APPROVED`), а строка `I-N` с решением maintainer'а.
4. Последний коммит — `<change>: transition VERIFYING — …`:
   ```bash
   $W verify <change>
   $W transition <change> VERIFYING
   ```
5. Ревью до PR — навык `review-impl` (п. 6): 🔴 — исправить в этой ветке и снова шаг 4; 🟡 / 💭 — строками R-N в `docs/backlog.md`; отчёт — разделом «Ревью» в тело PR.
6. PR — шаги 1–3 `git-land`; тело — группы, решения I-N, waivers, отчёт ревью. CI: `test` ubuntu + windows и `warrant / warrant` (`warrant ci` на результате merge с tip `main`: `kind: impl`, artifact `evidence-<change>-<attempt>`, `human-approval` — в `deferred[]`). До коммита `VERIFYING` красный `CHANGE_NOT_VERIFYING` — штатно. Зелёный — «жду merge #N». `main` сдвинулся до merge — Re-run `warrant / warrant` пересчитает merge (иначе evidence `STALE` `tree`).
7. По «merge #N» — шаги 4–5 `git-land` (только `--merge`, I-97). Затем навык `change-archive-pr <change>` с номером этого PR.

## Стоп

- `transition` отказал (`REF_MISMATCH`, gate `FAIL`, не тот порядок) — показать вывод, не обходить правкой record (его пишет только CLI, ADR-0009).
- Задача вне tasks.md или отклонение от spec/design — вопрос maintainer'у, принятое — навык `decision`.
- `warrant` красный на последнем коммите (`GATE_NOT_PASSED`, `RECORD_MISMATCH`, `REF_NOT_VERIFIED`, код 3) — разбор [ci.md](../git-land/ci.md), merge не просить.
- Нет «merge #N» — не сливать.

## Отчёт

Коммиты переходов, закрытые группы, итог `verify`, ревью (🔴 / 🟡 / 💭), ссылка на PR и CI; после merge — merge-коммит и переход к archive-PR.
