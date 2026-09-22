# Tasks

Потолок: 6 групп (G-8). После каждой группы: `npm test`, `npm run typecheck`, `warrant validate` на репозитории (с группы 4 — без
флагов) зелёные; коммит на группу. Отклонения от spec/design — вопросом к maintainer'у, принятые — в таблицу I-N design.md.

## 1. Норма и зелёный репозиторий (docs, B6, delta spec)

- [x] 1.1 B6: `scanIds` помечает origin `specs | changes | archive`; дубликат — только внутри `specs ∪ changes` или внутри одного archive-каталога; `highestNumber`/`ID_TAKEN` учитывают все. Проверка: unit-тест `scan.test.ts` (specs × archive не дубликат, changes × changes дубликат), SCN-KRN-081; `warrant validate --no-generated` на репозитории `ok: true`. (REQ-KRN-021)
- [x] 1.2 Документы: 13 §2 (golden = snapshot effective policy; exit фазы 2 = `feature`, `chore`, `factory-change`), 13 §5 (waiver, experiment — later), 05 §4 (таблица risk overlays с колонкой Pack; `mutation-score`/`rollback-rehearsed` — overlays `bdd-tdd`/`data` по `match.risk_level`), 06 §4 (`worktree-ready` → `branch-isolated`), 08 §6 (`bugfix`, `refactor`, `experiment` — later). Проверка: grep по старым формулировкам пуст; ссылки в spec delta ведут на актуальные §. (G-1, G-2, G-9, G-12, G-17)
- [x] 1.3 `roles.maintainer` в `.warrant/warrant.json` репозитория; `.warrant/local/openspec/rules.json` получает `context` «Language: Russian…» (пока без удаления из pack — это 4.2). Проверка: `warrant validate --no-generated` зелёный, `fmt --check` чисто. (G-18, G-21)
- [x] 1.4 `openspec validate phase-2-core-sdd --strict` зелёный; delta spec kernel и core-sdd соответствуют design (перечитать после 1.2). Проверка: команда, код 0.

## 2. Данные pack core-sdd

- [x] 2.1 Черновики по одному объекту каждого типа (overlay, profile, gate, check, controller rules) прогнать через `warrant validate` их схемами; выявленные несовместимости схем — вопрос maintainer'у до наполнения. Проверка: отчёт в design I-N, `validate` на черновиках `ok: true`. (REQ-SDD-001)
- [x] 2.2 Overlays `core-default`, `risk-low`, `risk-medium`, `risk-high` в `packs/core-sdd/overlays/`. Проверка: `validate` зелёный; unit-тест resolver на пустой classification даёт SCN-SDD-003; SCN-SDD-009. (REQ-SDD-002, REQ-SDD-006)
- [x] 2.3 Profiles `feature`, `chore`, `factory-change` в `profiles/` по REQ-SDD-003…005 (gates по переходам, approvals, evidence, `match.paths`, `extends`, `capabilities.forbidden`). Проверка: `validate` зелёный; unit-тесты resolver: gates `feature` = 04 §5, `chore` без `adversarial-review`, `factory-change` содержит `factory-golden-passed` и `PRODUCTION_WRITE`. (REQ-SDD-003, REQ-SDD-004, REQ-SDD-005)
- [x] 2.4 Gates (12 файлов) в `gates/` с `level`, `waivable`, `requires_evidence`, `applies_when` по 06 §3–4; checks `openspec-validate`, `tests-passed` в `checks/`; `controller/rules.json` с тремя правилами. Проверка: unit-тест читает каталог и утверждает SCN-SDD-011, SCN-SDD-012; каждый gate, на который ссылается profile/overlay, есть в `provides.gates` (SCN-SDD-002). (REQ-SDD-007)
- [x] 2.5 `sra/skills/specification/adversarial-review/SKILL.md` (frontmatter `name`, `version: 0.1.0`, `description`; семь категорий 06 §7) и `provides.skills: ["specification/adversarial-review@^0.1"]`; `pack.json.provides` перечисляет все файлы 2.2–2.4 в алфавитном порядке. Проверка: `warrant validate --no-generated` на репозитории `ok: true`; `provides` покрывает каждый файл каталога (unit-тест «нет файлов вне provides»). (REQ-SDD-001, REQ-SDD-008)

## 3. Kernel: classify, B1, B2, skills в lock

- [x] 3.1 `core/classify/`: чистая функция `classify(input)` по design D-4 (max по порядку enum, монотонность, `from`, `ignored[]`, объединение profiles). Проверка: unit-тесты SCN-KRN-074, SCN-KRN-075, SCN-SDD-006 (match по glob) без git. (REQ-KRN-028)
- [x] 3.2 Команда `warrant classify <change> [--base <ref>] [--paths <file>] [--propose <json>]`: diff через `cross-spawn`, запись record через `writeJsonFile`, `effective_policy` в `data` через `resolveForProject`; `USAGE` без git и без `--paths`. Проверка: e2e `classify.test.ts` — SCN-KRN-073, SCN-KRN-076, SCN-KRN-077 в temp-репозитории с `git init`. (REQ-KRN-028)
- [x] 3.3 B1: `weakenings()` сравнивает `match` overlay (подмножество по ключам) и `extends` profile (надмножество). Проверка: e2e `validate.test.ts` — SCN-KRN-078, SCN-KRN-079, SCN-SDD-010. (REQ-KRN-021)
- [x] 3.4 B2: `loadLocalLayer()` не читает каталоги с `pack.json`; неподключённый — `CONFIG_INVALID`. Проверка: e2e — SCN-KRN-080, `resolve` не видит его overlays. (REQ-KRN-021)
- [x] 3.5 `planSync` пишет `lock.skills` (version из frontmatter, path, `bytesHash`), проверяет диапазон `@^0.1`. Проверка: e2e `sync.test.ts` — SCN-SDD-013; `validate` — SCN-SDD-014. (REQ-SDD-008)

- [x] 3.6 Semantic-правило `validate`: для объектов pack и project-слоя (`profiles`, `overlays`, `gates`, `checks`, `risk_levels`) `id === basename` файла (design Decision 1); находка `SEMANTIC_INVALID` с `path`. Проверка: e2e `validate.test.ts` — файл с чужим `id` даёт код 3; unit-тест каталога core-sdd остаётся зелёным. (REQ-KRN-021)

## 4. sync целиком и переезд репозитория

- [x] 4.1 `planSync`: `context` проекта из `.warrant/local/openspec/rules.json`, `config.yaml` всегда целиком; `--no-generated` удалён из `validate` и `checkLock` (откат I-43). Проверка: e2e `sync.test.ts` SCN-KRN-062 (context после pack через пустую строку), `validate.test.ts` SCN-KRN-082; тест I-43 удалён. (REQ-KRN-025, REQ-KRN-021)
- [x] 4.2 `packs/core-sdd/openspec/rules.json`: `context` нейтральный (одна фраза о WARRANT), язык проекта убран. Проверка: grep «Russian» в `packs/` пуст. (REQ-KRN-025)
- [x] 4.3 Переезд: `warrant sync` в корне репозитория (config.yaml → `warrant-sdd`, lock со skills), `.openspec.yaml` change'а → `schema: warrant-sdd` (I-45), закоммитить сгенерированное. Проверка: `warrant validate` без флагов `ok: true` (SCN-KRN-083); `openspec validate phase-2-core-sdd --strict` зелёный; `openspec status --change phase-2-core-sdd` показывает четыре artifacts. (REQ-KRN-025)
- [x] 4.4 Dogfooding classify: `warrant classify phase-2-core-sdd --base main` → record с `factory-change`, `blast_radius: SYSTEM`; `warrant resolve phase-2-core-sdd` → `risk_level: HIGH`; `warrant status` → `stale: []`, `risk-high` в `sources` (I-57). Проверка: SCN-SDD-008 вручную + вывод в отчёт; record закоммичен. (REQ-SDD-005)

## 5. Golden

- [x] 5.1 Скрипт `scripts/golden-update.js` (`npm run golden:update`): для каждого `packs/core-sdd/golden/<profile>/` копирует во временный проект, `sync`, `resolve --explain`, `status` (fake openspec), пишет `expected/*.json` канонически без volatile-полей. Проверка: запуск создаёт три `expected/` каталога; повторный запуск — без diff. (REQ-SDD-009)
- [x] 5.2 Три golden-проекта `feature`, `chore`, `factory-change` с change record (полная classification по REQ-SDD-003…005) и artifacts. Проверка: `warrant validate` внутри каждого golden `ok: true`. (REQ-SDD-009)
- [x] 5.3 e2e `golden.test.ts`: сравнение с `expected/*` побайтно после канонизации; утверждения SCN-SDD-004, SCN-SDD-005, SCN-SDD-007. Проверка: `npm test` зелёный; SCN-SDD-016 — временное удаление `scope-valid` из `feature.json` ломает два golden (проверить вручную, вернуть). (REQ-SDD-009)

## 6. Выход фазы 2

- [ ] 6.1 Полный прогон: `npm test`, `npm run typecheck`, `npm run build`, `warrant validate` и `warrant fmt --check` на репозитории, `warrant sync --check` `changed: []`; SCN-SDD-001, SCN-SDD-015. Проверка: всё зелёное в одном отчёте.
- [ ] 6.2 `package.json` `0.2.0`, README (команда `classify`, golden), `docs/NEXT-SESSION.md` (состояние, вход в фазу 3: исполнение gates, CI-матрица, B3/B4/B5). Проверка: `warrant --version` печатает `0.2.0`. (G-20)
- [ ] 6.3 PR `feature/phase-2-core-sdd` → `main` с описанием решений I-45…I-N; после merge — tag `v0.2.0`. Проверка: PR открыт, тесты зелёные на ветке.
