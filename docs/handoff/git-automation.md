# git-automation

## Цель

Реализовать [ADR-0033](../adr/WARRANT-ADR-0033-git-process.md): git и PR разработки WARRANT — автоматический процесс,
человек только решает («merge #N», waivers в теле spec-PR). Порядок — ADR-0033 п. 14.

## Готовый запрос

```text
Реализация ADR-0033 (поток git-automation), ветки process/<имя> от актуального main, каждая в своём worktree
../SRA-<имя>. Прочитай ADR-0033 целиком, ADR-0031, ADR-0032 п. 3, 4, 6, 10, 11, docs/process/rules.md.
Сначала — разовая чистка слитых веток (п. 13: слитые локальные и на origin удаляются без подтверждения; worktree с
изменениями и неслитое — списком maintainer'у). Затем PR по порядку п. 14, каждый — со своими тестами:
1) хуки п. 9: deny основной сессии и субагентов (git в основном checkout, force push, openspec archive), белый
   список команд в dev-hooks.test.ts; permissions.allow для gh pr merge * --merge (п. 5); BL-22 закрыть;
2) навыки git-start, git-land (+ recovery.md, ci.md), scripts/dev/pr-form.js и шаг CI (п. 10), brief.js: счётчик
   слитых origin/* и «После:» с порядком потоков (п. 12), dev-context.test.ts: «После:», форма docs/drafts/;
   group-done и decision ссылаются на сверку ветки git-start;
3) навыки change-spec-pr, change-impl-pr, change-archive-pr (п. 4), change-coordinate вместо
   docs/process/coordinator.md (п. 7);
4) structure.test.ts, scripts/dev/hygiene.js, навык repo-hygiene, приведение docs/ (п. 13: zip → markdown, имя с
   пробелом), «Карта» CLAUDE.md, rules.md;
5) review-impl, .claude/agents/reviewer.md, scn-coverage.js, npm run test:linux, ловушки в packages/cli/CLAUDE.md
   (п. 6); линза cli-contract и software-architect/orchestration.md (п. 8).
Навыки — по стандарту ADR-0032 п. 6 (до 80 строк), имена — п. 2. Последний PR потока удаляет этот файл и снимает
«После: git-automation» в phase-4.md.
```

## Открытые вопросы

- Нарезку на PR (1–5 готового запроса) сессия может укрупнить или разбить — по объёму, без смены порядка.

## Не забыть

- Squash и rebase в репозитории уже выключены (2026-09-25); `delete_branch_on_merge` оставить `false`.
- Хук п. 9 впервые ограничит и эту сессию: после merge PR 1 коммиты — только в worktree.
- `docs/integrations/` и `lattice/` не трогать (`CLAUDE.md`).
