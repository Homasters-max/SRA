# Tasks

Потолок: 6 групп (G-8). После каждой группы: `npm test`, `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`,
`npm run versions:check` на репозитории зелёные; коммит на группу в `worktree/phase-3b`. Отклонения от spec/design — вопросом к maintainer'у,
принятые — строкой I-N (с I-102) в таблице design.md. V-N — решения нарезки (NEXT-SESSION), §N — разделы design.md.

## 1. Процедуры и документы (без кода)

- [ ] 1.1 `.claude/commands/decision.md`, `group-done.md`, `next-session.md` по design §12: только шаги процедуры и вызовы существующих проверок, ни одного правила. Проверка: `/decision` на этой ветке предлагает `I-102`; `grep` по трём файлам не находит формулировок правил из `openspec/config.yaml` и таблицы правил `rule/1` NEXT-SESSION; `warrant validate` (проверка (6) по `.claude/**`) `ok: true`.
- [ ] 1.2 ADR-0024 «spec-approved: контракт без design.md, waivable» (`amends: [WARRANT-ADR-0020]`), `amended_by` и заметка в ADR-0020, README ADR, 06 §4 (строка `spec-approved`: состав дерева, `waivable: true`). Проверка: ссылки ADR ↔ README симметричны; `git grep "design.md, specs"` в docs указывает только на ADR-0020 с заметкой. (REQ-VER-004, REQ-SDD-007; V-9)
- [ ] 1.3 04 §9 приведён к ADR-0010 (I-93: вместо «`cli:local` невалиден» — «валидность `APPROVED`/`MERGED` — по верифицируемому `ref`; до `warrant ci` ref не верифицируется, запись несёт limitation»); 01 INV-03 — статус «Частично» с пояснением (R-10в); 05 §7 — `approved_by` обязателен кроме `PROPOSED`; 04 §7 — `warrant link`, `warrant waive` MVP. Проверка: `git grep "невалидна"` в 04 не находит старой фразы; ссылки на ADR-0010/ADR-0024 существуют. (REQ-KRN-019, REQ-KRN-031, REQ-VER-007)
- [ ] 1.4 13 §2: строка фазы 3 без `analyze` и `warrant link`, новая строка «3b» по V-1 (состав, критерий выхода — P-2 без отступлений); фаза 4 — `analyze`, `AGENTS.md` побайтно, `guard_prefixes`; фаза 5 — `targets[]` (D-10), pragma (f); «adversarial review» фазы 5 → фаза 4 (D-5). Проверка: каждое вынесенное V-1 место названо ровно в одной фазе.

## 2. Версии, gate engine, controller

- [ ] 2.1 Bump по design §13: CLI `0.4.0` (`package.json`, `packages/cli/package.json`), pack `core-sdd` `0.3.0` с `kernel: ">=0.1 <0.5"`, `.warrant/warrant.json` `kernel: "0.4"` и `^0.3.0`, `warrant.json` golden-фикстур `^0.3.0`; `warrant sync`, `npm run golden:update`. Проверка: `npm run versions:check` зелёный; `git diff packs/core-sdd/golden/*/expected` содержит только `sources`/hash. (REQ-SDD-001, SCN-SDD-021)
- [ ] 2.2 Общий предикат waiver (design §1) для шага 4 и `evidence-complete`; `evidence-complete` засчитывает только `PROVEN`/`NOT_APPLICABLE` (R-8); unit-тест I-96 с `review` `NOT_PROVEN` → `FAIL`. Проверка: unit SCN-VER-043, SCN-VER-045; все прежние тесты verdict зелёные. (REQ-VER-003, REQ-VER-004)
- [ ] 2.3 R-9: `NOT_APPLICABLE` только от `produced_by.type: "check"`, иначе `FAIL` + `NOT_APPLICABLE_UNTRUSTED` (design §2). Проверка: unit SCN-VER-044. (REQ-VER-003)
- [ ] 2.4 R-13: controller пропускает `CONTINUE` при `FAIL`/`BLOCKED`, finding `CONTROLLER_RULE_IGNORED` в `gate`/`verify`/`status` (design §3). Проверка: unit + e2e SCN-VER-049 с `.warrant/local/controller/rules.json`. (REQ-VER-005)
- [ ] 2.5 R-7: `EVIDENCE_KIND_UNGATED` в `POLICY_CONFLICT` resolver'а (design §4). Проверка: e2e SCN-KRN-115; `resolve` трёх golden и репозитория — `hash` не изменился. (REQ-KRN-026)
- [ ] 2.6 R-6, R-10: `transition MERGED` — `REF_MISMATCH`; запись `human-approval` с `limitations: ["ref not verified (phase 4: warrant ci)"]`; SCN R-1 (ранний commit, fast-forward) — e2e, если ещё нет. Проверка: e2e SCN-VER-031, SCN-VER-050, SCN-VER-051, SCN-VER-052 в temp-репозитории с merge-коммитом. (REQ-VER-007)

## 3. Схемы и validate

- [ ] 3.1 `change-record.1`: `ref` у значений risk только при `from: human:*`; `waiver.1`: `approved_by` обязателен кроме `PROPOSED` (design §9); `warrant sync` обновляет `.warrant/schemas/`. Проверка: unit схем SCN-KRN-110, SCN-KRN-111; прежние SCN-KRN-022, 023, 038, 039, 093 зелёные. (REQ-KRN-011, REQ-KRN-019)
- [ ] 3.2 `validate` (11): `approved_by` сверяется с roles только если задан; `PROPOSED` waiver без него валиден и не влияет на gates. Проверка: e2e SCN-KRN-099 и waiver `PROPOSED` без `approved_by` → `ok: true`. (REQ-KRN-021)
- [ ] 3.3 I-77: `ID_IMMUTABLE` не срабатывает для требований, снятых `## REMOVED Requirements` архивной delta, появившейся в рабочем дереве (design §11). Проверка: e2e SCN-KRN-112 в temp-репозитории (оба случая). (REQ-KRN-021)
- [ ] 3.4 Проверка (13) `ID_DANGLING` по `tasks.md` активных Changes и `paths.tests` (design §11). Проверка: e2e SCN-KRN-113, SCN-KRN-114; `warrant validate` на репозитории `ok: true` (ни одной висячей ссылки в `tasks.md` `phase-3b`). (REQ-KRN-021)

## 4. Команды link, waive, classify ниже floor

- [ ] 4.1 `warrant link <change> --amends|--supersedes <target> [--remove]` (design §8), регистрация в `bin/warrant.ts`, справка. Проверка: e2e SCN-KRN-118, SCN-KRN-119, SCN-KRN-120; `status` цели показывает `amended_by[]`. (REQ-KRN-030)
- [ ] 4.2 `warrant waive` — создание `PROPOSED` с `WAV-<год>-NNN`, `--activate`, `--revoke` (design §8). Проверка: e2e SCN-KRN-121, SCN-KRN-122, SCN-KRN-123, SCN-KRN-124; файлы канонические, `warrant validate` `ok: true` после каждого шага. (REQ-KRN-031)
- [ ] 4.3 `classify --set <dim>=<v> --by --ref` ниже floor до `APPROVED`, сохранение при повторном запуске, `approved-below-floor` (design §10). Проверка: unit `classify()` + e2e SCN-KRN-106, SCN-KRN-116, SCN-KRN-117. (REQ-KRN-028)
- [ ] 4.4 README: команды `link`, `waive`, `classify --ref`; раздел archive-PR — artifact одного CI run'а (R-6). Проверка: примеры команд из README выполняются в temp-проекте e2e-тестом или вручную с выводом в отчёте группы.

## 5. spec-approved и execution.local

- [ ] 5.1 Pack: `gates/spec-approved.json` (L0, `waivable: true`), `provides.gates`, `overlays/core-default.json` `VERIFYING->MERGED`; `npm run golden:update`. Проверка: SCN-SDD-011, SCN-SDD-022, SCN-SDD-023 unit-тестом каталога; `warrant validate` `ok: true`. (REQ-SDD-001, REQ-SDD-002, REQ-SDD-007)
- [ ] 5.2 Калькулятор `spec-approved` (design §6) в таблице L0. Проверка: e2e SCN-VER-046, SCN-VER-047 (включая `WAIVED` по waiver из 4.2), SCN-VER-048 в temp-репозитории с переходом `APPROVED` и записью `human-approval`. (REQ-VER-004)
- [ ] 5.3 `execution.local: "scoped-only"` в runner и `verify` (design §7), `CHECK_LOCAL_FORBIDDEN` в `errors.ts`. Проверка: e2e SCN-VER-041, SCN-VER-042; SCN-VER-040 (R-4) e2e, если покрыт только unit'ом. (REQ-VER-002, REQ-VER-006)

## 6. Выход phase-3b

- [ ] 6.1 Полный прогон: `npm test`, `typecheck`, `build`, `warrant validate`, `fmt --check`, `sync --check` `changed: []`, `openspec validate phase-3b --strict`, `golden:update` `written: []`, `versions:check`; CI зелёный на ubuntu и windows. Проверка: всё в одном отчёте.
- [ ] 6.2 `warrant verify phase-3b --transition VERIFYING->MERGED` локально: `spec-approved` `PASS` (или `WAIVED` по waiver, созданному `warrant waive` и активированному maintainer'ом, если delta specs уточнялись); `evidence-complete` `PASS`. Проверка: вывод в отчёте; `WAIT` только по attestation `ci` и `human-approval`.
- [ ] 6.3 NEXT-SESSION: состояние после phase-3b, долг (V-1 → фазы 4/5), вход в фазу 4, таблица «Процессные правила» (строки `/decision`, `/group-done`, `/next-session`); `warrant --version` печатает `0.4.0`. Проверка: `/next-session` выполнена по своей процедуре.
- [ ] 6.4 Переходы по P-2: `APPROVED --ref <review spec-PR> --by` и `IMPLEMENTING` — первым коммитом impl-PR, `VERIFYING` — последним; archive-PR: evidence из artifact'а одного CI run'а, `transition MERGED --ref <run> --commit <impl-head>`, `warrant archive phase-3b`, tag `v0.4.0`. Проверка: `warrant status` репозитория — `stale[]` только у `phase-2-core-sdd`; record `phase-3b` содержит все переходы `PROPOSED → … → ARCHIVED`.
