---
id: WARRANT-ADR-0037
title: Фаза 4c — evidence на результате merge с `subject.tree`, `STALE` — причина пред-фильтра, ref подтверждения — слитый PR, `ForgePort` из четырёх методов
adr_state: ACCEPTED
date: 2026-09-26
supersedes: []
amends: [WARRANT-ADR-0034, WARRANT-ADR-0010]
---

## Context

[ADR-0034](WARRANT-ADR-0034-phase-4-frontend.md) п. 9, 12–14 и [ADR-0036](WARRANT-ADR-0036-phase-4b-producers.md) п. 1
отдают Change `phase-4c` CI: `ForgePort`, `warrant ci`, `warrant ci fetch`, `subject.tree` (R-12), specs через archive по
record (R-16). Вход — аудит [2026-09-26-phase-4b](../process/audits/2026-09-26-phase-4b.md) (A-28…A-30, §3.4) и строки
[backlog](../backlog.md) с «Куда» 4c. Нормы ADR-0034 оставили открытыми:

| Факт | Источник |
|---|---|
| `STALE` — `code` находки пред-фильтра с `reason`; реестр `evidence-status` — 4 значения. ADR-0034 п. 12 говорит «evidence `STALE`» | `core/gates/prefilter.ts`, аудит §3.4 |
| `subject.commit` CI-записи должен стать предком `main` после merge (I-97): `transition MERGED` проверяет `isAncestor` и head impl-PR. Синтетический коммит `refs/pull/<N>/merge` предком не станет | `commands/transition.ts#mergedCommit`, `ci.yml` job `evidence` |
| Re-run workflow `pull_request` берёт тот же `GITHUB_SHA`, что исходное событие: Re-run по merge ref не перемерживает со сдвинутым `main` | документация GitHub Actions |
| `ref` перехода `APPROVED` — URL spec-PR; у `MERGED` в 4b `--ref` — URL CI-run, он же правило «evidence одного run» (`assertRunRef`) | `.warrant/changes/*.json`, `commands/transition.ts` |
| PR и review — с одного аккаунта maintainer'а; GitHub не даёт автору одобрить свой PR; bot-идентичности нет | ADR-0010 Context, INV-03 |
| Тесты этого репозитория законно содержат ID фикстурных проектов (`SCN-SRC-…`, в том числе в телах app-тестов); префикс `SRC` есть и в main specs как пример | I-169 (`phase-4b`), `grep` по `packages/cli/test` |

Решения приняты grilling'ом 2026-09-26 (N29–N47, maintainer принял все рекомендации). Продуктовые детали без нормы
(форма `warrant ci`, вердикт impl-PR, проверки archive-PR, выбор run в `ci fetch`, правило путей spec-PR) — строками
design.md Change `phase-4c`.

## Decision

1. **`STALE` — причина пред-фильтра, не статус evidence** (N30). Несовпадение дерева — находка `STALE` с
   `reason: "tree"`; реестр `evidence-status` не меняется. `STALE` — отношение записи к контексту оценки, файл записи
   не меняется ([ADR-0009](WARRANT-ADR-0009-change-record-attestation.md)); «evidence `STALE`» ADR-0034 п. 12 читается так.
2. **`subject` CI-записи на результате merge** (N31). `commit` — head PR, `base_commit` — tip базы, с которым сделан
   merge, `tree` — hash дерева результата merge. Запись с `subject.tree` пред-фильтр допускает, если `commit` равен
   оцениваемому head и дерево merge-коммита этого head равно `tree`; сравнение `base_commit` для неё заменено, как у
   `subject.spec_tree` (ADR-0036 п. 3). На `transition MERGED` дерево — у фактического merge-коммита M (второй родитель —
   head), в самом CI — у checkout'а. Записи без `tree` судятся по-прежнему. I-97 держится.
3. **Результат merge считает сам job** (N32; уточняет ADR-0034 п. 12 «на merge ref»): checkout head, fetch tip базы на
   момент запуска, `git merge --no-ff`; конфликт — ошибка конфигурации (exit 3). Re-run job до merge лечит `STALE`.
4. **Восстановление после merge** (N40): если `main` сдвинулся между прогоном и merge, evidence производит
   `workflow_dispatch` того же job со входом `merge_commit` — checkout M, `subject.commit` = M^2, `tree` = tree(M).
   Head sha такого run — tip ветки запуска, а не M^2, поэтому run восстановления опознаётся по содержимому artifact'а, а не
   по head sha. Автоматического прогона на каждый push в `main` нет.
5. **Ref подтверждения — URL слитого PR** (N36, N42; уточняет ADR-0010 п. 2). `human-approval` на `APPROVED` несёт URL
   spec-PR, на `MERGED` — URL impl-PR; `warrant ci` через `ForgePort` проверяет: PR слит, `merged_by` входит в роль из `approvals[]`
   перехода (при пустом `approvals[]` — `roles.maintainer`). `merged_by = pr.author` — информационная находка `APPROVER_IS_AUTHOR`, не отказ: это проверяемый
   факт форжа при одном аккаунте. Условие «`review.author ≠ pr.author`» возвращается с bot-идентичностью
   ([ADR-0010](WARRANT-ADR-0010-trust-by-reference.md) п. 4). `transition MERGED --ref` — URL impl-PR; CI-run выводится
   из допущенных CI-записей (`attestation.ref`), правило «evidence одного run» проверяется по записям, без флага;
   `--commit` — head.
6. **`ForgePort` — четыре метода** (N43; уточняет ADR-0034 п. 9): `pullRequest`, `workflowRun`, `listRuns`,
   `downloadArtifact`. `reviews` не используется и не вводится (ADR-0025: методы только используемые). `owner/repo` —
   из `GITHUB_REPOSITORY` или URL `origin`, токен — через `gh`; ключа `forge` в `warrant.json` нет (N45).
7. **I-169 закрыт статус-кво** (N38): у репозитория WARRANT нет `paths.tests`; покрытие SCN держит dev-скрипт
   `scn-coverage.js` (BL-25, BL-26), тестовую половину `analyze` проверяет slice. Продуктовое правило `analyze`
   остаётся языконезависимым: разбор названий тестов и маркеры игнорирования не вводятся.

## Consequences

- ADR-0034: п. 9 — без `reviews`; п. 12 — merge считает job, восстановление — `workflow_dispatch`; п. 14 — `ci fetch`
  выбирает run по совпадению `subject.tree` с деревом M. Остальные пункты не меняются.
- ADR-0010 п. 2: для `human-approval` в MVP «автор ≠ автор PR» — информационная находка, а не отказ; INV-03
  ([01](../01-principles.md)) уточняется в Change 4c. П. 1, 3, 5 не меняются.
- Спецификация (Change `phase-4c`): [06](../06-verification.md) §3 — правило `tree` пред-фильтра; [06a](../06a-evidence.md)
  — поле `subject.tree`; [04](../04-lifecycle.md) §6 — `warrant ci` выводит Change и переход из record; delta specs
  `verification` (пред-фильтр, `transition MERGED` — BREAKING форма `--ref` и смысл `REF_MISMATCH`, `warrant ci`, `ci fetch`),
  `kernel` (`subject.tree`, REQ-KRN-033 — BL-40), `core-sdd` (SCN-SDD-001 — BL-26). Схема `evidence/1` — `subject.tree` (минорная
  правка).
- Review spec `phase-4c` (N48, N49): `attestation.ref` CI — URL попытки run (`…/actions/runs/<id>/attempts/<n>`, формат ref
  ADR-0010 Consequences дополняется попыткой): Re-run — отдельная попытка со своим artifact; pack `core-sdd` — `.github/workflows/**`
  в `match.paths` profile `factory-change` (run `pull_request` исполняет workflow из PR); waivers своего Change разрешены в spec-PR.
- `ci.yml`: job `warrant` на всех PR вместо `evidence` на `worktree/*`; шаги «Change of the branch» и «Main specs only
  through an archive-PR» удаляются; `permissions: actions: read`; `workflow_dispatch` со входом `merge_commit`.
- Навык `change-archive-pr`: шаг `warrant ci fetch <pr>` вместо ручного переноса artifact'а.
- [backlog](../backlog.md): I-169 удалена; BL-44 — полное INV-03 с bot-идентичностью.

## Alternatives

- **`STALE` — пятый статус evidence** — отвергнуто: статус выносит producer о содержании; `STALE` пришлось бы
  дописывать в записи задним числом.
- **`subject.commit` — синтетический merge-коммит** — отвергнуто: ломает I-97, связь записи с PR теряется.
- **Checkout `refs/pull/<N>/merge`** (норма ADR-0034 п. 12) — отвергнуто: Re-run не перемерживает, лечит только push в
  ветку; зависит от фоновой пересборки merge ref GitHub. Редкое расхождение merge job'а и GitHub ловит сверка дерева на
  `MERGED`.
- **Evidence на каждый push в `main`** — отвергнуто: удваивает CI ради исключения. **Без восстановления** (revert и
  повторный PR) — отвергнуто: цена несоразмерна сдвигу `main`.
- **Проверять только CI-refs, `human-approval` без проверки** — отвергнуто: оставляет R-10 открытым при доступном факте
  `merged_by`. **Строго `review.author ≠ pr.author`** — отвергнуто: невыполнимо при одном аккаунте, ломает dogfooding.
- **`--ref` у `MERGED` — URL CI-run** (как в 4b) — отвергнуто: run уже записан в `attestation.ref`, а ref подтверждения
  у `APPROVED` и `MERGED` разный по смыслу без причины.
- **I-169: исключить каталоги фикстур из `paths.tests`** — не помогает: ID фикстур и в телах тестов. **Игнорировать
  чужие префиксы** — не помогает: `SRC` есть в main specs. **ID только в названиях тестов** — разбор зависит от языка
  тестов.
