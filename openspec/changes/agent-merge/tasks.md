# Tasks

После группы должны быть зелёными: `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`), `npm run typecheck` и тесты группы. Коммит — один на группу, в `worktree/agent-merge`.

## 1. Версии 0.9.0 (D12)

- [x] 1.1 `package.json` — `0.9.0`; `CHANGELOG.md` — `## 0.9.0` с разделами «Вердикт» и «Миграция для потребителя» по D12; `.warrant/warrant.json` — `kernel: "0.9"`, диапазон `core-sdd` — `^0.4.0`.
- [x] 1.2 Pack `core-sdd` 0.4.0, `kernel: ">=0.1 <0.10"`; `warrant sync` (lock), `scripts/golden-update.js` (golden `chore`, `factory-change`, `feature`).

  Проверка: `node scripts/dev/check.js`.

## 2. Policy: `risk-high`, профиль приёмки, пути кода (D6, D9, D10)

- [x] 2.1 `packs/core-sdd/overlays/risk-high.json` 2.0.0 — без `human-approval` и `approvals`; тесты SCN-SDD-007, SCN-SDD-009, SCN-SDD-010, SCN-SDD-028; golden — перегенерация.
- [x] 2.2 `.warrant/local/profiles/human-acceptance.json` по D6; `.warrant/warrant.json` — `paths.src`, `paths.tests` по D10; `warrant validate`.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts core-sdd golden`.

## 3. Предикаты gate engine (D2, D5)

- [x] 3.1 `core/gates`: `appliesTo`, `countingWaiver` — чистые функции; `baseOutcome`, `applyWaivers`, `waived` (`evidence-complete`) зовут их; поведение `gate` и `transition` не меняется.
- [x] 3.2 `requiresHuman(policy, transition)` рядом с `approvalRoles` (`core/roles.ts`).

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts gates verdict evidence-complete`.

## 4. Судья (D3, D4, D8, D10)

- [x] 4.1 `core/ci/refs.ts` по D3 (policy, `roles`, agents — M^1); fail-closed и `AGENT_MERGE_CLOSED`; тесты SCN-VER-129, SCN-VER-130, SCN-VER-131, SCN-VER-132, SCN-VER-135.
- [x] 4.2 `core/ci/record.ts`: правило `verdicts` по D4; тесты SCN-VER-127, SCN-VER-128.
- [x] 4.3 Находка `NO_HUMAN_ACCEPTANCE` по D8; тест SCN-VER-134.
- [x] 4.4 `core/ci/paths.ts`: вид `none` по D10; тест SCN-VER-133.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts ci`.

## 5. Workflow, форж, доки (D7, D11)

- [x] 5.1 `.github/workflows/warrant.yml` — шаги D11; тест SCN-VER-122 по новому тексту REQ-VER-014.
- [x] 5.2 `.github/CODEOWNERS` по D7.
- [x] 5.3 Доки: `docs/05-policy.md` §4 (`risk-high`), `docs/06-*.md` §8 (форж — предотвращение, судья — обнаружение), `docs/01-*.md` INV-03 (merge без `human-approval` — не одобрение).

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts workflow`; `node scripts/dev/check.js`.

## 6. 👤 Maintainer: защита `main` (D7)

- [ ] 6.1 До archive-PR: в защите `main` — «Require review from Code Owners» и обязательная проверка `warrant / warrant`. Сессия даёт путь в настройках GitHub; сама не включает.
