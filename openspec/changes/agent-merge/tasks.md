# Tasks

После группы должны быть зелёными: `node scripts/dev/check.js` (`sync --check`, `validate`, `fmt --check`, `versions:check`), `npm run typecheck` и тесты группы. Коммит — один на группу, в `worktree/agent-merge`.

## 1. Версии 0.9.0 (D9)

- [ ] 1.1 `package.json` — `0.9.0`; `CHANGELOG.md` — `## 0.9.0` с разделами «Вердикт» и «Миграция для потребителя» по D9; `.warrant/warrant.json` — `kernel: "0.9"`.
- [ ] 1.2 Pack `core-sdd` 0.4.0, `kernel: ">=0.1 <0.10"`; `warrant sync` (lock), `scripts/golden-update.js` (golden `chore`, `factory-change`, `feature`).

  Проверка: `node scripts/dev/check.js`.

## 2. Policy: `risk-high` и профиль приёмки (D5, D6)

- [ ] 2.1 `packs/core-sdd/overlays/risk-high.json` 2.0.0 — без `human-approval` и `approvals`; тест SCN-SDD-009, SCN-SDD-010 по новому тексту REQ-SDD-006; golden — перегенерация.
- [ ] 2.2 `.warrant/local/profiles/human-acceptance.json` по D5; `warrant validate`; `warrant resolve` для Change с путём `packages/cli/src/core/ci/**` содержит `human-approval` на `VERIFYING->MERGED`, с путём `docs/**` — нет.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts core-sdd golden`.

## 3. Ref `MERGED` агента (D1, D2)

- [ ] 3.1 `core/ci/refs.ts` по D2; тесты SCN-VER-130 (агент слил impl-PR без `human-approval` — ref засчитан, автор = `merged_by`), SCN-VER-131 (с `human-approval` — `REF_NOT_VERIFIED` `merged_by`), SCN-VER-132 (spec-PR слит агентом — `REF_NOT_VERIFIED` `merged_by`).

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts refs`.

## 4. Записанные вердикты (D3, D4)

- [ ] 4.1 `core/ci/record.ts`: правило `verdicts` по D3 (а)–(в); diff перехода по D4 через порт git.
- [ ] 4.2 Тесты SCN-VER-127 (`WAIVED` без засчитываемого waiver — `RECORD_MISMATCH` `waiver`; с `ACTIVE` waiver — зелёный), SCN-VER-128 (`NOT_APPLICABLE` при выполненном `applies_when` — `not_applicable`), SCN-VER-129 (`APPROVED` с hash не базы — `policy`).

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts record ci`.

## 5. PR без Change и workflow (D7, D8)

- [ ] 5.1 `core/ci/paths.ts`: вид `none` по D7; тест SCN-VER-133.
- [ ] 5.2 `.github/workflows/warrant.yml` — шаги D8; тест SCN-VER-122 по новому тексту REQ-VER-014.

  Проверка: `npx vitest run --config packages/cli/vitest.config.ts paths workflow`.
