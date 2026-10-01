# Tasks

После каждой группы зелёные:
- `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`);
- `npm run typecheck`;
- тесты группы.

Коммит — один на группу, в ветке `worktree/judge-law`. Пути — от `packages/cli/src`, тесты — `packages/cli/test`.

## 1. Разбор видов и «нужен человек» (D7, D8)

- [ ] 1.1 `core/packs/objects.ts`: `requirementsOf` и тип `Requirement` переносятся из `core/gates/verdict.ts`; новая `producedKinds(check)`. Все места разбора `requires_evidence` и `produces` из design D7 зовут их. Строки `helpers` в `test/unit/meta/architecture.json` (A-34). Поведение не меняется.
- [ ] 1.2 `core/roles.ts`: `humanEvidence(requirement)`. `commands/transition.ts` (`forward`) зовёт `requiresHuman`. `transitionFed` и `controllerInputs` зовут `humanEvidence` (A-40). Строка `helpers`, unit `gates/predicates` дополнен.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts architecture predicates check transition controller ci resolve overrides`; полный `npm test`.

## 2. Основание `NOT_APPLICABLE` по evidence (D5)

- [ ] 2.1 `core/gates/predicates.ts` получает:
  - перенесённые из `verdict.ts`: `fromCheck`, `satisfies`, `freshest`, `attestationAccepted`;
  - новые: `chosenRecord`, `notApplicableByEvidence`.

  `evidencePart` зовёт новые предикаты. `verdictsRule` (`core/ci/record.ts`) зовёт `notApplicableByEvidence` с правилом приёма судьи для `MERGED`. `byCheck` удалён; строки `helpers` добавлены (REQ-VER-011 «Record», REQ-VER-003).
- [ ] 2.2 Тесты:
  - SCN-VER-144 — `app/commands/ci.test.ts`, describe D4 `agent-merge`;
  - unit `notApplicableByEvidence`: свежайшая запись, приём attestation, элемент с `check`;
  - SCN-VER-127 и SCN-VER-128 — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts predicates verdict gate ci`.

## 3. Ref перехода одним шагом (D6)

- [ ] 3.1 `core/ci/refs.ts`:
  - `pullOfRef`, `transitionRefs`;
  - `memoForge` ставят `judgePullRequest` (`core/ci/judge.ts`) и `ci fetch`;
  - `judgeRefs`, `verdictsRule`, `verifyCiEvidence`, `judgeDecisions` получают результат `transitionRefs`;
  - `fetch.ts` и разбор комментария в `decisions.ts` зовут `pullOfRef`;
  - `mergedPullOf`, `mergeOfMerged`, `approvedPr`, замыкание `defaultBranch` удалены (A-47).
- [ ] 3.2 Тест: один `pullRequest` форжа на PR за прогон archive-PR — счётчик фейкового форжа в `ci.test.ts`. Тесты ref, решений UNKNOWN и `ci fetch` — зелёные.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts ci fetch decisions refs`.

## 4. Закон на коммите и R-45 (D1, D4)

- [ ] 4.1 `core/ci/law.ts`: `lawAt` по D1. `mergeLaw` (`core/ci/merge.ts`) — на `lawAt`. `MergeLaw.config` необязателен; без него `mergedByLaw` берёт `roles.maintainer` и `identities.agents` базы (REQ-VER-011 «Ref»).
- [ ] 4.2 Тесты в describe D3 `ci.test.ts`:
  - SCN-VER-145: `warrant.json` M^1 не JSON, затем его нет; слил агент — код 1, слил maintainer — код 0;
  - fail-closed по `kernel` M^1 и по профилю `classification`, которого нет в packs M^1 (R-45).

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts ci merge`.

## 5. Окно законов (D2, D3)

- [ ] 5.1 `core/ports/git.ts` и `adapters/git.ts` — `boundary(base, head)`; contract-тест адаптера git. `core/ci/law.ts` — `lawWindow` по D2.
- [ ] 5.2 Правило закона перехода в `judgeRecord` (`core/ci/record.ts`) по D3. Находка `LAW_NOT_COMPUTED`. Из `mergedRules` удалены сверка hash и `gates` с `basePolicy` (REQ-VER-011 «Record»).
- [ ] 5.3 Тесты `ci.test.ts`:
  - SCN-VER-140, SCN-VER-141, SCN-VER-142, SCN-VER-143, SCN-VER-146, SCN-VER-147;
  - дедупликация по дереву входов закона: коммит `main` только с `packages/cli/src/**` worktree не создаёт;
  - коммит окна вне checkout — `USAGE`, код 3;
  - прежние тесты причины `policy` у `MERGED` переведены на окно.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts ci git law`; полный `npm test`.

## 6. `guard` и `run submit` (D9, D10)

- [ ] 6.1 `bin/warrant.ts`: `run` с переводом исключения. Action `guard` без `--frontend` переводит исключение в `runGuardCrash`, функция перевода — в `commands/guard.ts` (REQ-ENF-004, REQ-KRN-003, R-46). Тест: исключение runner'а `guard` даёт `deny`, код 0; фаза `post` даёт `allow`.
- [ ] 6.2 SCN-ENF-047: `run submit` при `BUSY` записи файла Run — код 4, `retryable: true`, Run активен; повтор того же envelope — `data.reused: true`, код 0 (REQ-ENF-007, BL-105).

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts guard bin run`.

## 7. Документы

- [ ] 7.1 `CHANGELOG.md`, `## 0.10.0 — не выпущена` — по D11.
- [ ] 7.2 `docs/backlog.md`:
  - закрыты WS-03, A-34, A-40, A-45, A-47, R-45, R-46, BL-105 — Change `judge-law`;
  - новая строка — основание `applies_when` у переходов, кроме `MERGED` (остаточный риск, proposal Non-Goals).

  Проверка: `node scripts/dev/check.js`; `npx vitest run --config packages/cli/vitest.config.ts dev-context`.
