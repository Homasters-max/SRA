# Восстановление — справочник навыков `git-start` и `git-land`

Главное правило: **история не переписывается после того, как SHA попал в evidence, `--commit` record или PR** ([ADR-0033](../../../docs/adr/WARRANT-ADR-0033-git-process.md) п. 3). Force push делает только maintainer вручную (хук `git-hook.js`). Сначала — безопасная версия команды; опасная — только если безопасной нет, и с путём назад.

| Что случилось | Что делать |
|---|---|
| Коммит ушёл не в ту ветку, ветка **не опубликована** | в своей ветке `git cherry-pick <sha>`; в чужой — `git reset --keep HEAD~1` (не `--hard`: `--keep` не трогает незакоммиченное) |
| Коммит ушёл не в ту ветку, ветка **опубликована** | в своей ветке `git cherry-pick <sha>`; в чужой — `git revert <sha>` отдельным коммитом, историю не переписывать |
| Коммит в основном checkout `main` | хук его не пустит; если всё же случился — `git branch <новая> HEAD`, затем `git reset --keep origin/main`, работу продолжить в worktree новой ветки |
| Потерян коммит (reset, удалённая ветка) | `git reflog` → `git branch <имя> <sha>`; удалённая слитая ветка — её коммиты уже в `main`, PR в GitHub — «Restore branch» |
| Конфликт `docs/handoff/*` | файл потока пишет только его ветка: взять версию своей ветки для своего потока, `main` — для чужих |
| Конфликт `docs/backlog.md` | не возникает при дописывании строк — `merge=union` (ADR-0047 п. 5); одинаковый новый номер ловит `dev-context.test.ts` и называет следующий свободный — свою строку перенумеровать в merge-коммите |
| Конфликт версий: `package.json`, `package-lock.json`, `warrant.lock.json` (репозиторий, golden) | `git checkout --theirs <файлы>`; `npm run versions:check` требует bump — `npm version <x.y.z> --no-git-tag-version`; затем `node packages/cli/dist/bin/warrant.js sync`, `npm run golden:update`, `node scripts/dev/check.js` (ADR-0047 п. 6) |
| Конфликт номеров `I-N` в design.md | свой номер — следующий после занятого в `main` (навык `decision`), ссылки на него в коммите и tasks.md поправить |
| Ветка отстала от `main` | в worktree `git fetch && git merge origin/main` (merge-коммит допустим в ветке; rebase опубликованной — нет) |
| `worktree remove` отказал | `git -C ../SRA-<имя> status --short` — изменения закоммитить или показать maintainer'у; `--force` не использовать |
| `branch -d` — «not fully merged» | ветка не слита: `git log main..<ветка>` — показать; `-D` только по решению maintainer'а |
| Impl-PR с `human-approval` слит ботом (кнопка PR-панели Claude Desktop, `--auto` сессии): судья отказывает ref `MERGED` — `merged_by` не из `roles.maintainer` | revert merge-коммита не помогает: судья отказывает укороченной записи Change. Путь по lifecycle (I-225 Change `identities`): новый impl-PR без правок кода — `transition VERIFYING->IMPLEMENTING`, затем `IMPLEMENTING->VERIFYING`; его сливает maintainer на GitHub, `MERGED --ref` — этот PR; evidence `ci fetch` первого PR не записывается. Spec-PR, слитый ботом, — путь не проверен: стоп и отчёт maintainer'у |
| Текст коммита испорчен оболочкой (последний, не опубликован) | `git commit --amend -F <файл>`; опубликован — оставить, исправление — в теле PR |
