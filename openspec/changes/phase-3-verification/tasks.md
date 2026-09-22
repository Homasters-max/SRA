# Tasks

Потолок: 6 групп (G-8). После каждой группы: `npm test`, `npm run typecheck`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`
на репозитории зелёные; коммит на группу в `worktree/phase-3-verification`. Отклонения от spec/design — вопросом к maintainer'у,
принятые — строкой I-N в таблице design.md. Ссылки P-N — решения grilling (NEXT-SESSION), D-N — design.md этого change.

## 1. CI-матрица, backlog, схемы, норма

- [ ] 1.1 `.github/workflows/ci.yml`: матрица `ubuntu-latest` × `windows-latest`, Node 22, `npm ci`, `npm i -g @fission-ai/openspec@1.13.1`, `npm test`, `npm run typecheck`, `npm i -g .`, `warrant validate` в корне и в fixture-проекте `packages/cli/test/fixtures`. Проверка: оба job зелёные на PR; в логе ubuntu ни один тест не `skipped` из-за отсутствия `openspec`. (P-9, D-17)
- [x] 1.2 B4: `bin/warrant.ts` — `process.exitCode` вместо `process.exit`, `stdout.write` с callback; B3: `checkLock` даёт `LOCK_MISMATCH` для pack в lock без записи в `warrant.json`; B5: `yaml-emit.ts` кавычит ключи и значения, читаемые YAML как не-строки. Проверка: e2e SCN-KRN-085 (вывод > 64 KiB в pipe), SCN-KRN-094, SCN-KRN-100. (REQ-KRN-003, REQ-KRN-021, REQ-KRN-025, D-15)
- [x] 1.3 Схемы: `evidence.1` (`metrics`, `subject.base_commit`), `pack.1` (`provides.rules`, `evidence_kinds` строка | объект), `check.1` (`run.scoped_command`, плейсхолдеры `{out}`/`{change}`/`{paths}` через `pattern`, `execution`), `config.1` (`defaults.check_timeout_s`), `waiver.1` (`targets[]`), `change-record.1` (`amends`, `supersedes`), `lock.1` (`skills.*.source`), новая `rule.1.schema.json`; `warrant sync` обновляет копии в `.warrant/schemas/`. Проверка: unit-тесты схем SCN-KRN-084 (только kernel-часть), 086–093, 108, 109; `warrant validate` на репозитории `ok: true`. (REQ-KRN-001, 004, 005, 006, 010, 011, 012, 019, 029)
- [x] 1.4 Pack `core-sdd` `0.2.0`: `kernel: ">=0.1 <0.4"`, `evidence_kinds` с `metrics_schema` для `test-report`/`spec-report` (`packs/core-sdd/evidence/*.metrics.schema.json`), `rules: []`, checks с `execution` и `{change}`, `openspec/rules.json` `rules.design` про `I-N`; `warrant.json` репозитория и golden-фикстур → `"^0.2.0"`; `npm run golden:update`. Проверка: SCN-SDD-017, SCN-SDD-018 unit-тестом каталога; `git diff packs/core-sdd/golden/*/expected` просмотрен и содержит только `sources`/hash. (REQ-SDD-001, REQ-SDD-007)
- [x] 1.5 Документы: ADR-0023 (D-18) + README ADR + `amended_by` в ADR-0018; 12 §7 — строки 1 и 3 удалены; 13 §2 — критерий выхода фазы 3 по P-18, slice — MVP; 04 §7 — сигнатуры `check`/`gate`/`verify`/`transition`/`archive` по P-20, `next` — later; 06 §3 — `BLOCKED` при отсутствии записи (P-7); 06a §3 — attestation по окружению (P-15). Проверка: ссылки из delta specs ведут на существующие §; `git grep "warrant next"` в docs — только строка later. (P-7, P-8, P-12, P-15, P-18, P-20)

## 2. validate и status на новых полях

- [ ] 2.1 `validate` (8) правила `rule/1` из `provides.rules` и `.warrant/local/rules/`: `id === basename`, `RULE_SCOPE`; (10) `LINK_TARGET_INVALID`; (11) семантика waiver (`WAIVER_INVALID`, `WAIVER_EXPIRED` в stderr). Проверка: e2e SCN-KRN-095, 098, 099. (REQ-KRN-021)
- [ ] 2.2 `validate` (9) `ID_IMMUTABLE` относительно `HEAD` для `specs/**` и Changes ≥ `APPROVED` (D-14); без git — пропуск с предупреждением. Проверка: e2e SCN-KRN-096, 097 в temp-репозитории с коммитом. (REQ-KRN-021)
- [ ] 2.3 Двухступенчатая валидация (D-13): нормальная форма `evidence_kinds` в loader, компиляция `metrics_schema`, `PACK_FORM_UNKNOWN`; (12) записи и manifest под `.warrant/evidence/**` по схемам и формам, `kind` объявлен pack'ом, `manifest.evidence[]` = файлы каталога. Проверка: e2e SCN-KRN-084 (pack-часть) на рукописной фикстуре evidence; SCN-KRN-092. (REQ-KRN-001, REQ-KRN-021)
- [ ] 2.4 `status`: `effective_policy.risk_level`, `stale[]` `ABANDONED_DIR_PRESENT` и исключение `CHANGE_DIR_MISSING` для `ABANDONED` (D-22), вычисляемые `amended_by[]`/`superseded_by[]`, `rules{total, unenforced}` в форме без аргумента; `npm run golden:update` (`expected/status.json`). Проверка: e2e SCN-KRN-102, 103, 104; unit `status-stale.test.ts`. (REQ-KRN-027)
- [ ] 2.5 I-52: `planSync` пишет `skills.*.source: "bundled"` и `path` относительно pack для skill вне проекта; `checkLock` проверяет hash по этому пути; golden-локи получают `skills`. Проверка: e2e SCN-KRN-087; `warrant validate` внутри копии каждого golden `ok: true`. (REQ-KRN-005)

## 3. check: evidence, runner, замок

- [ ] 3.1 `core/evidence/`: `store.ts` (`WARRANT_STATE_DIR`, каталог `<state>/evidence/<change>/`, чтение записей), `record.ts` (сборка записи, `context_hash`, `artifacts[]` из `{out}`), `manifest.ts`, `attestation.ts` (D-6, D-7). Проверка: unit-тесты сборки записи и attestation по env; SCN-VER-002 unit'ом. (REQ-VER-001)
- [ ] 3.2 `core/check/`: `placeholders.ts` (`{out}`, `{change}`, `{paths}` → элементы argv, D-2), `runner.ts` (cross-spawn без shell, timeout с kill дерева, D-4), `lock.ts` (`wx`, держатель, освобождение в `finally`/сигналах, D-3). Проверка: unit-тесты плейсхолдеров; e2e SCN-VER-008 (второй процесс держит замок), SCN-VER-009 (timeout 1 с на `node -e "setTimeout(…)"`). (REQ-VER-002)
- [ ] 3.3 Parsers `junit` и `openspec-validate` (D-5) с `metrics` по формам pack. Проверка: unit-тесты на junit с падением/без, `tests=0` → `INCONCLUSIVE`; на JSON `openspec validate` с issues. (REQ-VER-002)
- [ ] 3.4 Команда `warrant check <change> [id...] [--paths] [--base]`: выбор checks по gates следующего перехода, `CHECK_NOT_CONFIGURED`, запись evidence и manifest, `.gitignore` из `warrant init`. Проверка: e2e SCN-VER-001, 003, 004, 005, 006, 007, 010, 011 (fake `openspec`, override `tests-passed` с `node`-скриптом, пишущим junit). (REQ-VER-001, REQ-VER-002, REQ-KRN-023)

## 4. gate, controller, verify

- [ ] 4.1 `core/gates/`: `diff.ts` (base, изменённые пути, `--diff-filter`, ancestry; D-9), `prefilter.ts` (D-12: commit, base, threshold, `scoped:`, waiver `ACTIVE`), `verdict.ts` (алгоритм 06 §3, `BLOCKED/NO_EVIDENCE`, `WAIVED_BY`, `WAIVER_IGNORED`, `ATTESTATION_REQUIRED`). Проверка: unit-тесты verdict на таблице случаев SCN-VER-012…018. (REQ-VER-003)
- [ ] 4.2 Калькуляторы L0 (D-8): `required-artifacts-present`, `ids-valid`, `blocking-unknowns-resolved`, `branch-isolated`, `evidence-complete`, `scope-valid` (множества путей по переходу, D-15), `factory-golden-passed` (`applies_when`), `analyze-clean` → `BLOCKED/NO_INPUT`; чужой gate без калькулятора → `BLOCKED/NO_INPUT`. Проверка: e2e SCN-VER-014, 019, 020, 021, 022, 023 в temp-репозитории. (REQ-VER-004)
- [ ] 4.3 `core/controller/` (D-11) и команда `warrant gate <change> [id...] [--transition] [--base]` с кодом выхода по `controller_action`. Проверка: unit SCN-VER-024, 025, 026; e2e `gate` печатает `gates`, `findings`, `transition`. (REQ-VER-003, REQ-VER-005)
- [ ] 4.4 Команда `warrant verify <change> [--transition] [--base] [--paths]`: check → gate → controller, ошибки checks не прерывают gates, `max` кодов. Проверка: e2e SCN-VER-027, 028. (REQ-VER-006)
- [ ] 4.5 `status.verification` через gate engine без runner'а (D-12 design); golden: fake `openspec validate`, `expected/verify.json`, сравнение в `golden.test.ts`; `golden:update`. Проверка: e2e SCN-KRN-101; SCN-SDD-020; SCN-SDD-015 (двойной прогон без diff). (REQ-KRN-027, REQ-SDD-009)

## 5. transition, archive, classify --set

- [ ] 5.1 `core/record/write.ts`: матрица переходов 04 §2, `appendTransition`, `RECORD_FROZEN` для `ARCHIVED`/`ABANDONED` (в `transition` и `classify`). Проверка: unit-тесты матрицы; e2e SCN-VER-035 (вторая часть). (REQ-VER-007)
- [ ] 5.2 Команда `warrant transition <change> <STATE> [--ref] [--by] [--commit]`: gates перехода → `GATES_NOT_PASSED`; `USAGE` без `--ref` для `APPROVED`/`MERGED`; evidence `human-approval` по `--ref --by` с проверкой роли (`ROLE_REQUIRED`, D-10); `MERGED` на commit evidence, `COMMIT_NOT_MERGED` (D-9); переходы назад без gates; `ABANDONED` удаляет каталог. Проверка: e2e SCN-VER-029…035 в temp-репозитории с ветками и merge. (REQ-VER-007)
- [ ] 5.3 Команда `warrant archive <change>`: `STATE_INVALID`, `openspec validate --strict`, gates `MERGED->ARCHIVED`, `openspec archive --yes --json`, transition `ARCHIVED`. Проверка: e2e SCN-VER-036, 037, 038 (`skipIf(!openspecAvailable())`). (REQ-VER-008)
- [ ] 5.4 `classify --set <dim>=<value> --set profile=<id> --by <login>`: роль из `roles`, `from: human:<login>`, `BELOW_FLOOR`, `ROLE_REQUIRED`. Проверка: unit-тесты `classify()` с источником human; e2e SCN-KRN-105, 106, 107. (REQ-KRN-028)

## 6. Выход фазы 3

- [ ] 6.1 Dogfooding: `.warrant/local/checks/tests-passed.json` (D-17), `.gitignore` `.warrant/evidence/**/raw/`, waivers `WAV-2026-001` (`analyze-clean`), `WAV-2026-002` (`adversarial-review`); `warrant check phase-3-verification` и `warrant verify phase-3-verification` на репозитории. Проверка: SCN-SDD-019; `verify --transition PROPOSED->SPECIFIED` даёт `CONTINUE`; `warrant validate` `ok: true`. (P-16, REQ-SDD-007)
- [ ] 6.2 CI job `evidence` для веток `worktree/*`: `warrant verify <change> --transition VERIFYING->MERGED --base origin/main`, `upload-artifact` `.warrant/evidence/<change>/`, не роняет PR при `WAIT`. Проверка: artifact на impl-PR содержит записи с `attestation.type: "ci"`. (P-15)
- [ ] 6.3 Полный прогон: `npm test`, `typecheck`, `build`, `warrant validate`, `fmt --check`, `sync --check` `changed: []`, `openspec validate phase-3-verification --strict`, `golden:update` `written: []`; CI зелёный на обеих ОС. Проверка: всё в одном отчёте.
- [ ] 6.4 `package.json` `0.3.0`, README (команды `check`, `gate`, `verify`, `transition`, `archive`, `classify --set`, порядок archive-PR с artifact'ом CI), NEXT-SESSION (состояние, вход в `phase-3b`/фазу 4, долг); `warrant --version` печатает `0.3.0`. (P-10)
- [ ] 6.5 Переходы change фазы 3 по P-2/P-18: `transition SPECIFIED` в spec-PR; `APPROVED --ref <review> --by` и `IMPLEMENTING` первым коммитом impl-PR, `VERIFYING` — последним; archive-PR: evidence из artifact'а CI, `transition MERGED --ref <run> --commit <impl-head>`, `warrant archive phase-3-verification`, tag `v0.3.0`. Проверка: `warrant status` репозитория — `stale[]` только у `phase-2-core-sdd`.
