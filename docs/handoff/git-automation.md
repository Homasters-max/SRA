# git-automation

## Цель

Реализовать [ADR-0033](../adr/WARRANT-ADR-0033-git-process.md): git и PR разработки WARRANT — автоматический процесс,
человек только решает («merge #N», waivers в теле spec-PR). Порядок — ADR-0033 п. 14.

## Готовый запрос

```text
Реализация ADR-0033 (поток git-automation), продолжение. Прочитай ADR-0033 целиком, ADR-0032 п. 3, 4, 6, 10, 11,
docs/process/rules.md. Готово: хук git-hook.js (п. 9), разовая чистка веток, навыки git-start / git-land,
pr-form.js в CI, «После:» в brief.js и dev-context.test.ts, навыки change-*-pr и change-coordinate,
repo-hygiene с hygiene.js и structure.test.ts. Осталось — последний PR потока (п. 14); работа — навыком git-start
(ветка process/<имя>, worktree ../SRA-<имя>), доставка — git-land, со своими тестами:
5) review-impl, .claude/agents/reviewer.md, scn-coverage.js, npm run test:linux, ловушки в packages/cli/CLAUDE.md
   (п. 6); линза cli-contract и software-architect/orchestration.md (п. 8).
Навыки — по стандарту ADR-0032 п. 6 (до 80 строк), имена — п. 2. Последний PR потока удаляет этот файл и снимает
«После: git-automation» в phase-4.md.
```

## Открытые вопросы

- Нарезку PR 5 готового запроса сессия может укрупнить или разбить — по объёму, без смены порядка.

## Не забыть

- Squash и rebase в репозитории уже выключены (2026-09-25); `delete_branch_on_merge` оставить `false`.
- Разрешения `gh pr merge * --merge` и `git push origin --delete *` — в `.claude/settings.local.json` машины
  maintainer'а (`rules.md` «Настройка машины»), не в коммитимом `settings.json`.
- `«После:»` может называть только поток с файлом передачи в `main` (`dev-context.test.ts` видит один checkout).
- `docs/integrations/` и `lattice/` не трогать (`CLAUDE.md`).
