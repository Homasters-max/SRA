---
name: change-archive-pr
description: "Закрыть Change archive-PR — evidence CI impl-head, transition MERGED, warrant archive, файл передачи, merge по слову maintainer'а, тег релиза. Использовать, когда impl-PR Change слит, когда Change нужно закрыть и архивировать, или просят «/change-archive-pr»."
argument-hint: "<change> <номер impl-PR>"
---

# archive-PR Change

Третий PR Change: `VERIFYING → MERGED → ARCHIVED` ([ADR-0011](../../../docs/adr/WARRANT-ADR-0011-pr-topology.md)
п. 3, 4, [ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 4). Архивирует только `warrant archive`:
gates `MERGED → ARCHIVED` и перенос в `openspec/changes/archive/`. Git, PR, CI и merge — `git-start`, `git-land`.

## Вход

- `<change>` и номер слитого impl-PR `I`. `W` = `node packages/cli/dist/bin/warrant.js`; maintainer —
  `node -p "require('./.warrant/warrant.json').roles.maintainer[0]"`.

## Шаги

1. impl-head — второй родитель merge-коммита impl-PR:
   ```bash
   gh pr view <I> --json mergeCommit --jq .mergeCommit.oid
   git fetch && git rev-parse <merge>^2
   ```
2. Run CI на impl-head: `headSha` = impl-head, есть artifact `evidence-<change>`; идёт — дождаться:
   ```bash
   gh run list --workflow ci --branch worktree/<change> --json databaseId,headSha,status,conclusion,url
   gh run watch <run>
   gh api repos/{owner}/{repo}/actions/runs/<run>/artifacts --jq '.artifacts[].name'
   ```
3. Ветка — `git-start start archive/<change>`. Evidence — в `.warrant/evidence/<change>/` (`raw/` не коммитится):
   ```bash
   gh run download <run> -n evidence-<change> -D .warrant/evidence/<change>
   ```
4. Коммит `<change>: transition MERGED --ref CI run <run> --commit <impl-head> --by <maintainer>`:
   ```bash
   $W transition <change> MERGED --ref <url run> --commit <impl-head> --by <maintainer>
   ```
5. Коммит `<change>: warrant archive — …`: архив, затем файл передачи потока — удалить или заменить файлом
   следующего и снять `После: <поток>` у зависящих (ADR-0033 п. 4, 12):
   ```bash
   $W archive <change>
   ```
6. PR, CI, «merge #N», после merge — шаги 1–5 `git-land`.
7. Тег на merge-коммите archive-PR: версия CLI выросла относительно последнего тега и такого тега нет; не выросла —
   тега нет, пометка в отчёте:
   ```bash
   node -p "require('./package.json').version"
   git tag -l 'v*' --sort=-v:refname | head -1
   git tag -a v<версия> <merge> -m "<change>: archive-PR #N"
   git push origin v<версия>
   ```
8. Итог: `$W status` — в `stale[]` только ожидаемое; `node scripts/dev/brief.js` — поток закрыт.

## Стоп

- Run с `headSha` = impl-head не найден или без artifact — стоп: ближайший run не брать (иначе `REF_MISMATCH`, R-6).
- `transition MERGED` или `archive` отказали — показать вывод; record руками не править (ADR-0009).
- Нет «merge #N» — не сливать и не ставить тег. Push тега заблокирован — дать команду maintainer'у.

## Отчёт

Run и impl-head, коммиты переходов, результат `archive`, ссылка на PR; после merge — тег (или почему нет) и
`stale[]`.
