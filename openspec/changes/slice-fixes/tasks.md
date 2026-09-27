# Tasks

После каждой группы должны быть зелёными: `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`,
`npm run versions:check`. Тесты — по уровням (`test:unit`, `test:app`, `test:contract`, `test:e2e`; BL-37). Закрытие — `/group-done`.
Коммит — один на группу, в `worktree/slice-fixes`; после группы — `/group-stats`.

Обозначения: §N — разделы design.md; N-N — решения §1; A-N, BL-N — строки [docs/backlog.md](../../../docs/backlog.md).
Правка ожидаемого значения golden вне задач 1.1 и 2.1 — остановка и строка I-N.

## 1. Bump и швы core/ci (A-31, A-32, A-35, A-36, A-33)

- [x] 1.1 Bump (§7, REQ-SDD-001):
  - CLI `0.8.0`;
  - pack `core-sdd` `0.3.4` с `kernel: ">=0.1 <0.9"`: 7 fixture-packs, `.warrant/warrant.json` `kernel: "0.8"`,
    `warrant.lock.json` репозитория и golden-фикстур.

  Проверка: `npm run versions:check` зелёный; `core-sdd-catalog.test.ts` под новый диапазон.
- [x] 1.2 A-31 (§2): `core/evidence/attestation.ts` — `attestationOf`, `ciRunKey` на `parseCiRef`, `artifactName`; строки
  `helpers`. Через них — семь читателей attestation, `ciRunOf`, запись и чтение artifact'а.

  Проверка:
  - `cs grep '["attestation"]' --fixed --in packages/cli/src` — только владелец;
  - app `transition MERGED`: `…/runs/7` и `…/runs/7/attempts/1` — один run, без `REF_MISMATCH`;
  - SCN-VER-029…035, SCN-VER-050…052 и тесты `ci`, `ci fetch` без правок ожидаемых значений.
- [x] 1.3 A-32 (§2): карта `CONFIRMED_BY` в `core/record/lifecycle.ts`; `REF_REQUIRED_STATES`, `APPROVAL_AT`, `BROUGHT_BY_PR`,
  `pullRequestOf` — через неё.

  Проверка: `cs grep 'SPECIFIED->APPROVED' --in packages/cli/src/core/ci packages/cli/src/commands` — без литералов карты;
  тесты `transition`, `ci` без правок ожидаемых значений.
- [x] 1.4 A-35, A-36 (§2):
  - `recordPath` вместо `recordRel`;
  - `evidenceRel` в `core/evidence/store.ts`;
  - `absolutePath` в `core/fs.ts` для `absoluteOf` ×2;
  - `isMergeKind` в `core/record/lifecycle.ts`;
  - исключение храповика `pr-kind` снято.

  Проверка: `architecture.test.ts` зелёный без исключения `pr-kind`; `cs grep '.warrant/evidence/' --fixed --in
  packages/cli/src/core/ci` — пусто.
- [x] 1.5 A-33 (§2, I-187): удалить `EvaluateOptions.admit`.

  Проверка: `npm run typecheck`; тесты `ci` без правок ожидаемых значений.

## 2. warrant unknown (REQ-KRN-011, REQ-KRN-024, REQ-KRN-034, REQ-KRN-035, REQ-VER-004)

- [x] 2.1 Схема `change-record.1.schema.json` — `resolved_as`, `ref`, `dependentRequired` (§3, REQ-KRN-011). Копия —
  `warrant sync`, golden — `npm run golden:update`.

  Проверка: unit схемы на SCN-KRN-143; SCN-KRN-022, SCN-KRN-023, SCN-KRN-091, SCN-KRN-110 без правок.
- [x] 2.2 `core/unknowns/` и `commands/unknown.ts` — `unknown add`, `unknown resolve`, `--dry-run`, `--help` с примерами (§3,
  REQ-KRN-035, REQ-KRN-034); коды `UNKNOWN_NOT_FOUND`, `UNKNOWN_RESOLVED`; строки рангов `architecture.json`.

  Проверка: app на SCN-KRN-148…153; `architecture.test.ts`, `levels.test.ts` зелёные.
- [x] 2.3 Gate `blocking-unknowns-resolved` — finding `DECISION_WITHOUT_REF` (§3, REQ-VER-004).

  Проверка: app `gate` на SCN-VER-110; SCN-VER-022, SCN-VER-025 без правок.
- [x] 2.4 `hint` у `AREA_UNKNOWN` (`allocate.ts` ×2, `checkAreas`) (§3, REQ-KRN-024, BL-56).

  Проверка: app `id` на SCN-KRN-057 (переписан по delta) и SCN-KRN-144.

## 3. Решения UNKNOWN в warrant ci, A-37, BL-53 (REQ-VER-013, REQ-VER-011)

- [x] 3.1 `ForgePort.comment`, `CommentRef`, `Comment` (`author`, `pullRequest`, `body`); `ForgeGh` — issue comment и review;
  `FakeForge.addComment` (§4).

  Проверка: unit разбора ответов `gh api` на записанных телах; `architecture.test.ts` зелёный.
- [x] 3.2 `parseCommentUrl`, `core/ci/decisions.ts` — `judgeDecisions`, `RefReason` `decision`, находка
  `DECISION_NOT_VERIFIED`; вызов из `judgePullRequest` (§4, REQ-VER-013); деталь `pull_request` — и по PR комментария из ответа
  форжа (I-189).

  Проверка: app `ci` на SCN-VER-111…115; прежние SCN-VER `ci` без правок.
- [x] 3.3 Контракт `forge.contract.test.ts` — комментарий maintainer'а и review в spec-PR `slice-fixes` (§4).

  Проверка: `test:contract` зелёный на настоящем GitHub; `comment` несуществующего id — `null`.
- [x] 3.4 A-37: `test/app/helpers/ci.ts` (`advance`, `pullRequest`, `artifactOf`), `codes` e2e — из `helpers/synced.ts`; строки
  `test_helpers`.

  Проверка: `cs dups` по тестам `ci` — без копий; тесты `ci`, `ci fetch`, e2e без правок ожидаемых значений.
- [x] 3.5 BL-53: `WorkflowRun.workflowPath`, hints восстановления и help `ci fetch` без литерала `ci.yml` (§4).

  Проверка: app `ci fetch` (`NO_CI_EVIDENCE`) и archive-PR — hint называет workflow run; `cs grep 'ci.yml' --fixed --in
  packages/cli/src` — пусто.
- [x] 3.6 `.github/workflows/ci.yml`: `permissions` += `issues: read` (§4).

  Проверка: CI impl-PR зелёный.
- [x] 3.7 `RECORD_MISMATCH` с причиной `unknowns`: при record базы в `SPECIFIED` и дальше элемент `unknowns[]` базы не удалён и
  не ослаблен (I-188, REQ-VER-011).

  Проверка: app `ci` на SCN-VER-116; прежние SCN-VER `ci` без правок.

## 4. write_scope implement (REQ-ENF-002)

- [x] 4.1 `writeScopeOf("implement")` += `design.md`, `specs/**` Change (§5).

  Проверка: app `run` на SCN-ENF-036; ожидания `write_scope` в `run.test.ts`, `guard.test.ts`, `frontend-claude.contract.test.ts`,
  `frontend-lifecycle.test.ts` — по delta; SCN-ENF-004…008, SCN-ENF-011 без других правок.

## 5. Мелкие правки (REQ-KRN-028, REQ-KRN-034, REQ-ENF-004)

- [x] 5.1 BL-60: проверка `--propose` по порядку измерений и profiles; запись `classify` через `writeRecord` (§6).

  Проверка: app `classify` на SCN-KRN-145; SCN-KRN-073…077, SCN-KRN-105…107, SCN-KRN-116, SCN-KRN-117, SCN-KRN-138 без правок.
- [x] 5.2 BL-58: `GitPort.upstreamAhead`, отказ `BASE_BEHIND_UPSTREAM` (§6); upstream не разрешается — проверка пропускается (I-192).

  Проверка: контракт `GitPort` на временном репозитории с upstream; app `classify` на SCN-KRN-146.
- [x] 5.3 BL-64: `ClockPort.localToday`, `archivePlan` по локальной дате (§6).

  Проверка: unit в дочернем процессе с `TZ=Etc/GMT-3`; app `archive --dry-run` на SCN-KRN-137, SCN-KRN-147.
- [x] 5.4 BL-61: `defaultPrefix` с `-m <модуль>` (§6).

  Проверка: app `guard` на SCN-ENF-037; SCN-ENF-013 без правок.
- [x] 5.5 BL-56: `humanOnly` и hint `deny` policy-пути без операции записи (§6); состояние, которое пишет CLI, — hint с его
  командами (I-190).

  Проверка: app `guard` на SCN-ENF-038, SCN-ENF-039; SCN-ENF-011, SCN-ENF-012 без правок.

## 6. Навыки, документы, сквозная проверка

- [ ] 6.1 Навыки `change-spec-pr` (blocking UNKNOWN и решение) и `change-impl-pr` (правка spec в Run `implement`, ADR-0024 п. 4)
  (§7).

  Проверка: `dev-context.test.ts`.
- [ ] 6.2 Документы (§7):
  - 02 §1 — blocking UNKNOWN закрывает только DECISION с ref; `warrant unknown` — до `APPROVED`;
  - 04 §10 — `warrant unknown`;
  - 06 §4 — `blocking-unknowns-resolved`;
  - `backlog.md` — закрыть A-31…A-33, A-36, A-37, BL-53, BL-59…BL-61, BL-63, BL-64; сузить A-35, BL-56, BL-58; строка
    «ключи объектных литералов в проверке `enum`» (A-32); BL-67 закрыть, строка F-8 — коллизия `UNK` id records параллельных
    веток (I-193).

  Проверка: `dev-context.test.ts`, `hygiene.js` без битых ссылок.
- [ ] 6.3 `warrant analyze slice-fixes` на ветке impl-PR — без находок.

  Проверка: код 0; иначе правка `tasks.md` или тестов, а не waiver.
