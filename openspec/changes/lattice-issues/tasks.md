# Tasks

После каждой группы должны быть зелёными: `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`,
`npm run versions:check`. Тесты — по уровням (`test:unit`, `test:app`, `test:contract`, `test:e2e`; BL-37). Закрытие — `/group-done`.
Коммит — один на группу, в `worktree/lattice-issues`.

Обозначения: §N — разделы design.md; L-N — решения §1; BL-N, R-N — строки [docs/backlog.md](../../../docs/backlog.md).
Правка ожидаемого значения golden вне задачи 1.1 — остановка и строка I-N.

## 1. Атомарная запись и bump (S-3, L4)

- [x] 1.1 Bump CLI `0.8.2`: `package.json`, `package-lock.json`, `kernel` в `warrant.lock.json` репозитория (`sync`) и трёх
  golden-фикстур pack; pack `core-sdd` не меняется (golden вне его hash, I-59).

  Проверка: `npm run versions:check` зелёный; e2e golden (SCN-SDD-015) — только `kernel` в lock.
- [x] 1.2 `writeFileAtomic` (§2) и `writeJsonFile` через него; указатель `current` (`core/run/lifecycle.ts`) и импорт
  `ci fetch` (`core/evidence/store.ts`) — через него.

  Порядок записи evidence → manifest → record / Run и `hint` находки `validate` (12) — I-203; 5 попыток всего и `BUSY` — I-206.

  Проверка: unit — SCN-KRN-158 (сбой rename оставляет прежний файл, временного файла нет, `BUSY` после 5 попыток); app `run`,
  `ci-fetch` без правок ожидаемых значений.

## 2. Пропущенный тест сценария (S-4, L2)

- [x] 2.1 `core/evidence/parsers/junit.ts` (§3): имена пропущенных `<testcase>`, `skippedScenarios`, статус и limitation;
  ранги — `architecture.test.ts`.

  Проверка: unit `parsers.test.ts` — SCN-VER-118; SCN-VER-040, SCN-VER-117 без правок ожидаемых значений.

## 3. Run (S-3, BL-81, R-32, L5)

- [ ] 3.1 Повтор `run submit` (§4): поиск записи по `produced_by.run`, `data.reused`.

  Проверка: app `run submit` — SCN-ENF-043 (повтор, manifest, `EVIDENCE_CONFLICT`); прочие SCN REQ-ENF-007 без правок
  ожидаемых значений, кроме поля `data.reused`.
- [ ] 3.2 Guard под Run `review` (§4, I-202, I-207): команды без записи, `run finish --state CANCELLED`, `cd` только внутри проекта,
  строгая форма; `SUBMIT_HINT`; удалить ветку R-32.

  Проверка: app `guard` — SCN-ENF-044; SCN-ENF-026 — только текст `hint`.
- [ ] 3.3 `UNCOMMITTED_IN_SCOPE` у `run start` `specify` / `implement` (§4), `data.findings[]` вывода.

  Проверка: app `run start` — SCN-ENF-045; golden вывода `run start` — поле `findings: []`.

## 4. Gate по check (S-2, L6)

- [ ] 4.1 `gate/1` — `requires_evidence[].check` (`packages/cli/schemas/gate.1.schema.json`), копии — `warrant sync`.

  Проверка: unit схем — SCN-KRN-159.
- [ ] 4.2 `evidencePart`, `checksForTransition`, `weakenings` (§5); `CONFIG_INVALID` для `check` на незагруженный check (I-204).

  Проверка: app `gate`, `check` — SCN-VER-119, SCN-VER-123; прочие SCN REQ-VER-003 без правок ожидаемых значений.
- [ ] 4.4 `warrant ci`, правило `ci_evidence` (§5): запись check требования.

  Проверка: app `ci` — SCN-VER-108, вариант с `check` (I-205).
- [ ] 4.3 `validate` — ссылка `check` (§5).

  Проверка: app `validate` — SCN-KRN-156.

## 5. Идентичность (S-1, BL-44, BL-83, L3)

- [ ] 5.1 `WarrantConfig.agents` (`core/config.ts`), `config.test.ts`; `validate` — `identities.agents` ∩ `roles` (§6).

  Проверка: app `validate` — SCN-KRN-157.
- [ ] 5.2 `judgeRefs`, `judgeDecisions` (§6): `SHARED_IDENTITY`, `merged_by = pr.author` при непустом списке, автор-агент.

  Проверка: app `ci` — SCN-VER-120, SCN-VER-121; SCN с `APPROVER_IS_AUTHOR` — плюс находка `SHARED_IDENTITY`.

## 6. Reusable workflow (S-2, BL-51, L7)

- [ ] 6.1 `.github/workflows/warrant.yml` (`workflow_call`) и вызов из `ci.yml` (§7); шаг проверки входа `warrant` (I-208); имя
  проверки в навыках и документах.

  Проверка: unit meta — SCN-VER-122; job `warrant / warrant` этого PR зелёный.

## 7. Документы и закрытие

- [ ] 7.1 Документы (§8): 04 — таблица восстановления (со строкой «запись вне manifest», I-203); 06 §2, §3, §8; `backlog.md` —
  удалить BL-44, BL-51, BL-81, BL-93, R-32; «Куда» BL-57, BL-83.
- [x] 7.2 Waiver `spec-approved` на правку delta spec по I-202…I-208 (ADR-0024 п. 4) — `PROPOSED` в теле impl-PR; активирует
  maintainer по слову в PR.
- [ ] 7.3 Ревью реализации — навык `review-impl`; `transition VERIFYING` последним коммитом impl-PR.
