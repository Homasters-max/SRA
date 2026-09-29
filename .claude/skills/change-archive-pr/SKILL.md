---
name: change-archive-pr
description: "Закрыть Change archive-PR — warrant ci fetch evidence слитого impl-PR, transition MERGED по URL impl-PR, warrant archive, файл передачи, merge сессией `--auto`, тег релиза. Использовать, когда impl-PR Change слит, когда Change нужно закрыть и архивировать, или просят «/change-archive-pr»."
argument-hint: "<change> <номер impl-PR>"
---

# archive-PR Change

Третий PR Change: `VERIFYING → MERGED → ARCHIVED` ([ADR-0011](../../../docs/adr/WARRANT-ADR-0011-pr-topology.md) п. 3, 4, [ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 4). Архивирует только `warrant archive`: gates `MERGED → ARCHIVED` и перенос в `openspec/changes/archive/`. Evidence CI приносит `warrant ci fetch` ([ADR-0037](../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md), [04 §7](../../../docs/04-lifecycle.md)). Git, PR, CI и merge — `git-start`, `git-land`.

## Вход

- `<change>` и номер слитого impl-PR `I`. `W` = `node packages/cli/dist/bin/warrant.js`; maintainer — `node -p "require('./.warrant/warrant.json').roles.maintainer[0]"`; `gh` авторизован (`gh auth status`).

## Шаги

1. Ветка — `git-start start archive/<change>` (от `origin/main` со слитым impl-PR).
2. Evidence CI impl-PR — run, чьи записи сделаны на дереве merge-коммита M (`subject.tree`); `raw/` и `manifest.json` artifact'а не импортируются:
   ```bash
   $W ci fetch <I> --dry-run
   $W ci fetch <I>
   ```
   `NO_CI_EVIDENCE` — `main` сдвинулся до merge или artifact истёк: run восстановления командой из `hint`, дождаться, снова `ci fetch`:
   ```bash
   gh workflow run ci.yml -f merge_commit=<M>
   gh run list --workflow ci --event workflow_dispatch --limit 1 --json databaseId,status,conclusion
   gh run watch <run>
   ```
3. Коммит `<change>: ci fetch #<I>, transition MERGED --ref PR #<I>`; `--ref` — URL impl-PR (не CI-run: run берётся из `attestation.ref` записей), оцениваемый commit — head из записей; `--by` не передаётся — решение о merge доказывает `merged_by` слитого PR (ADR-0040 п. 5):
   ```bash
   gh pr view <I> --json url,state --jq '.state + " " + .url'
   $W transition <change> MERGED --ref <url impl-PR>
   ```
4. Коммит `<change>: warrant archive — …`: архив, затем файл передачи потока — удалить или заменить файлом следующего и снять `После: <поток>` у зависящих (ADR-0033 п. 4, 12):
   ```bash
   $W archive <change>
   ```
5. PR, `--auto` сессией (archive-PR — механика, ADR-0050 п. 8), после merge — шаги 1–5 `git-land`. Job `warrant` судит archive-PR: run и artifact записей `MERGED` через форж, повтор archive на базе (R-16).
6. Тег на merge-коммите archive-PR: версия CLI выросла относительно последнего тега и такого тега нет; не выросла — тега нет, пометка в отчёте:
   ```bash
   node -p "require('./package.json').version"
   git tag -l 'v*' --sort=-v:refname | head -1
   git tag -a v<версия> <merge> -m "<change>: archive-PR #N"
   git push origin v<версия>
   ```
7. Итог: `$W status` — в `stale[]` только ожидаемое; `node scripts/dev/brief.js` — поток закрыт.

## Стоп

- `ci fetch` — `PR_NOT_MERGED` (squash, rebase, не слит), `PR_NOT_IMPL`, `EVIDENCE_CONFLICT`, `FORGE_UNAVAILABLE` — показать вывод; записи artifact'а руками не раскладывать (BL-12), ближайший run не брать.
- `transition MERGED` (`STALE` `tree`, `REF_MISMATCH`, `COMMIT_NOT_MERGED`) или `archive` отказали — показать вывод; record руками не править (ADR-0009).
- archive-PR красный — не сливать и не ставить тег. Push тега заблокирован — дать команду maintainer'у.

## Отчёт

Run из `ci fetch` и impl-head, коммиты переходов, результат `archive`, ссылка на PR и job `warrant`; после merge — тег (или почему нет) и `stale[]`.
