# 02 — процедуры жизненного цикла Change: spec-PR, impl-PR, archive-PR

## Проблема

- `openspec-archive-change` и `openspec-sync-specs` удалены (ADR-0032 п. 8, PR #29): они архивировали мимо
  `warrant archive` и gates `MERGED → ARCHIVED` (ADR-0011 п. 4). Замены-процедуры нет; сейчас держит только строка
  `CLAUDE.md` «Закрыть Change — `warrant archive`, не `openspec archive`».
- **BL-22:** перегенерированный `openspec-apply-change` (профиль custom, PR #30) в конце советует
  `openspec archive "<name>"` (строка 157 навыка). Файл принадлежит OpenSpec (ADR-0015 п. 6), руками не правится.
- Каждый Change проходит три PR (ADR-0011), и последовательность команд повторяется каждый раз. Сейчас она записана
  прозой: [архив NEXT-SESSION](../../archive/2026-09-24-next-session.md) — «Как прошёл 6.5», «Организационное», P-2, P-15,
P-17, I-97; память «Decision workflow» (шаги spec-PR), тексты коммитов прошлых
  Changes. Пять Changes прошли её вручную: `phase-3-verification`, `phase-3b`, `test-levels`, `arch-boundaries`,
  частично `phase-2`.
- Последовательность на практике (`arch-boundaries`, 2026-09-24):

| PR | Шаги |
|---|---|
| spec-PR `spec/<change>` | `warrant classify` по diff spec-PR → `warrant waive` + `--activate --by <login>` для gates без producer'а (образец WAV-2026-003/004) → `verify` → `transition SPECIFIED` → push → `gh pr create`. Merge — акт maintainer'а и `--ref` для `APPROVED` |
| impl-PR `worktree/<change>` | первым коммитом `transition APPROVED --ref <spec-PR> --by <login>` + `IMPLEMENTING` → группы tasks.md по коммиту (`/group-done`) → последним коммитом `transition VERIFYING` → CI: `test` ubuntu + windows, `evidence` (artifact `evidence-<change>`, `WAIT` по `human-approval` — ожидаемо) → merge **только merge commit** |
| archive-PR `archive/<change>` от `main` | найти run CI на impl-head → `gh run download <run> -n evidence-<change>` в `.warrant/evidence/<change>/` → `transition MERGED --ref <run-url> --commit <impl-head> --by <login>` (коммит) → `warrant archive <change>` (коммит) → PR → merge → аннотированный тег `v<версия CLI>` на merge-коммите → push тега → `warrant status`: в `stale[]` только ожидаемое → удалить worktree трёх веток |

## Идея

Процедура на каждый вид PR — навык по стандарту ADR-0032 п. 6. Навык вызывает только `warrant`, `git` и `gh`, норм не
содержит: gates и порядок переходов принуждает сам `warrant transition`. Навык знает только последовательность и места,
где нужно остановиться для человека.

## Вопросы для grilling

❓ **A1 — Объём.** Варианты:
- (a) только `archive-change` — закрывает дыру ADR-0032;
- (b) три навыка `change-spec-pr`, `change-impl-pr`, `change-archive-pr`;
- (c) один `change-pr <вид>`.

➡️ (b): у каждого вида PR свой момент остановки. `openspec-propose` / `apply` (артефакты) и `/group-done` (группы)
остаются.

❓ **A2 — Как найти run и impl-head.** impl-head = второй родитель merge-коммита impl-PR (`git rev-parse <merge>^2`).
Run — `gh run list --workflow ci --branch worktree/<change> --json databaseId,headSha,conclusion`, выбирается тот, где
`headSha` = impl-head и есть artifact `evidence-<change>`. Не нашёлся — остановиться и не брать ближайший.

➡️ Принять. Несовпадение `headSha` — стоп: оно даст `REF_MISMATCH` (R-6).

❓ **A3 — Тег.** Кто: процедура archive-PR после merge. Что: аннотированный `v<версия packages/cli/package.json>` на
merge-коммите archive-PR. Проверки: тега ещё нет; версия выросла относительно прошлого тега (`versions:check`).
Сообщение тега — строка «<change>: archive-PR #N».

➡️ Принять. Бамп версии остаётся первым изменением после релиза (R-14), навык его только проверяет.

❓ **A4 — Один коммит или два в archive-PR.** На практике два: `transition MERGED`, затем `warrant archive`.

➡️ Два: каждый переход record — отдельный коммит, как в impl-PR.

❓ **A5 — Где остановиться для человека.** Merge каждого PR (печатать `gh pr merge <N> --merge`), `--by` (логин
maintainer'а из `roles`), активация waiver (`--activate --by`). Остальное навык делает сам (память «Decision workflow»:
«подумай и реши самостоятельно»).

➡️ Принять.

❓ **A6 — Файл передачи потока.** Последний PR потока удаляет свой `docs/handoff/<поток>.md` (ADR-0032 п. 3). Для Change
последний PR — archive-PR.

➡️ Шаг `change-archive-pr`: удалить файл потока или заменить его файлом следующего.

❓ **A7 — Как нейтрализовать `openspec archive` (BL-22).** Навык OpenSpec советует обход, а строка `CLAUDE.md` — проза.
Варианты:
- (a) хук `PreToolUse` — `deny` на `openspec archive` в Bash и PowerShell, у основной сессии и субагентов, причина —
  «`warrant archive <change>`, навык `change-archive-pr`» (сквозной X3);
- (b) issue в OpenSpec: настраиваемая команда архивации;
- (c) оставить строку `CLAUDE.md`.

➡️ (a) сейчас (механизм вместо прозы, INV-04), (b) — параллельно, без ожидания. `warrant archive` вызывает
`openspec archive` сам, из своего процесса, и хук его не видит.

❓ **A8 — Проверка формы навыков PR.** В `dev-context.test.ts`: навык `change-archive-pr` содержит `warrant archive` и
не содержит `openspec archive`; навыки `change-*` вызывают `warrant transition`, а не пишут record руками.

➡️ Принять первую часть. Вторую (record руками) уже держит `validate` (ADR-0009).

## Вне объёма

- `warrant ci` и `warrant run` (фаза 4) — когда появятся, шаги навыков сократятся до вызова команды.
- Producer'ы `analyze-clean` / `adversarial-review` вместо waivers — фаза 4.
