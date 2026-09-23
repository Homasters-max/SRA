# Proposal: phase-3-verification

## Why

После фаз 1–2 WARRANT умеет описывать policy (schemas, packs, `resolve`, `classify`), но не умеет её **исполнять**: gates и checks
core-sdd — только данные, ни один verdict не вычисляется, evidence никто не пишет, `change_state` меняется только руками через
`warrant init change`. Record `phase-2-core-sdd` заархивирован stock `openspec archive` и висит с `ARCHIVED_WITHOUT_TRANSITION`,
потому что `warrant transition` и `warrant archive` не существуют. Одновременно ADR-0016…0022 оставили долг схем и CLI
(NEXT-SESSION «Долг схем и CLI», A–D; решения ревью D-1…D-25): поля `metrics`, `execution`, `targets[]`, `amends`/`supersedes`,
схема `rule/1` есть в документах, но не проходят `validate` (`additionalProperties: false`). WARRANT ни разу не запускался на Linux.

Фаза 3 замыкает цикл `check → gate → verify → transition → archive` на profile `feature` и на самом репозитории, закрывает долг
схем, ставит CI-матрицу. Решения приняты grilling'ом 2026-09-22 (P-1…P-20, [NEXT-SESSION](../../../docs/NEXT-SESSION.md)); объём
резан по правилу «до первого работающего slice важнее замкнуть цикл, чем покрыть весь долг».

## What Changes

- **Схемы kernel** (долг A, B; P-4, P-10, P-11, P-14): `evidence.1` — `metrics`, `subject.base_commit`; `pack.1` — `provides.rules[]`,
  `evidence_kinds` принимает строку или `{ kind, metrics_schema }`; `check.1` — `execution{exclusive, timeout_s, local, guard_prefixes}`,
  `run.scoped_command`, плейсхолдеры `{out}`, `{paths}`, `{change}`; `config.1` — `defaults.check_timeout_s`; `waiver.1` — `targets[]`;
  `change-record.1` — `amends[]`, `supersedes[]`, `from: human:<login>` для profiles; `lock.1` — `skills.*.source`; новая `rule/1`.
  Все правки — добавление необязательных полей, major `1` не меняется. Двухступенчатая валидация pack-форм (D-13): `metrics` по
  `metrics_schema` kind'а, `targets[]` по схеме gate.
- **`validate`** (долг C; P-4, P-16): правила `rule/1` (paths целиком в `openspec/changes/**` — ошибка), stable ID изменён/удалён
  относительно `HEAD` для `specs/**` и Changes ≥ `APPROVED` (D-18), цель `amends`/`supersedes` в допустимом состоянии, семантика
  waiver (gate существует и `waivable`, change существует, `approved_by` ∈ `roles`, срок), evidence и manifest по схемам и pack-формам.
- **`status`** (I-57, D-22, P-8): `risk_level`, verdicts gates следующего перехода, `controller_action`/`next`/`rule`, `stale[]`
  `ABANDONED_DIR_PRESENT` / `DIR_MISSING_WITHOUT_TRANSITION`, вычисляемые `amended_by[]`/`superseded_by[]`, доля правил без `enforced_by`.
- **Новая capability `verification`** (P-3, P-6, P-7, P-15, P-17, P-19, P-20): команды `warrant check`, `gate`, `verify`, `transition`,
  `archive`; evidence-записи и manifest в `.warrant/evidence/<change>/` (raw не коммитится; `WARRANT_STATE_DIR`); attestation по окружению
  (`none` локально, `ci` под GitHub Actions); пред-фильтр допустимости (D-12) и `NOT_APPLICABLE` от check (D-11); алгоритм verdict
  06 §3 с `BLOCKED` при отсутствии записи; controller по `controller/rules.json`; замок `exclusive` в `git-common-dir`, `timeout_s`,
  суженный прогон `--paths`/`scoped_command`, `--base`; `transition` принуждает gates перехода и пишет `human-approval` по `--ref --by`;
  `MERGED` считается на commit evidence, предке HEAD; `ABANDONED` удаляет каталог Change; `archive` оборачивает `openspec archive`.
- **`classify`** (P-5): human-источник `--set <dim>=<value> --set profile=<id> --by <login>`; понижение ниже floor → `BELOW_FLOOR`.
- **Pack `core-sdd` → `0.2.0`** (P-10): `kernel: ">=0.1 <0.4"`, `evidence_kinds` с `metrics_schema` там, где есть форма, `execution` у
  checks, `openspec-validate` с `{change}` и `{out}`; golden получают `expected/verify.json` для `PROPOSED->SPECIFIED` (G-1, P-18);
  `rules.design` получает пункт про `I-N` (план «Карта агента»).
- **CI-матрица** `ubuntu-latest` + `windows-latest`, Node 22, `openspec@1.13.1`; workflow impl-PR выгружает evidence artifact'ом (P-9, P-15).
- **Backlog и долг**: B3 (`LOCK_MISMATCH` для pack, удалённого из `warrant.json`), B4 (`process.exitCode`), B5 (ключи `null`/`true`/`false`
  в YAML), I-52 (`source: bundled` у skill), I-57, I-59 (без изменений, подтверждено), I-64 (без изменений).
- **Документы**: ADR-0023 «Frontend разработки самого WARRANT» (P-12, `amends: [ADR-0018]`); 12 §7 — строки 1 и 3 закрыты; 13 §2 —
  критерий выхода фазы 3 по P-18, slice — критерий MVP; 04 §7 — сигнатуры `check`/`gate`/`verify` по P-20, `next` — later;
  06 §3 — `BLOCKED` при отсутствии записи (P-7); 06a §3 — attestation по окружению (P-15); 08 §3 — `defaults.check_timeout_s` уже есть;
  NEXT-SESSION, README. Правка нормы 06/06a — уточнение ранее принятых ADR-0016/0017 и решений D-11/D-12, нового ADR не требует;
  ADR-0023 — единственный новый ADR.
- **Dogfooding** (P-2, P-16, P-18): change ведётся по топологии ADR-0011 (`spec/` → `worktree/` → `archive/`); `analyze-clean` и
  `adversarial-review` закрыты двумя waiver-файлами maintainer'а до фазы 4; change проходит `PROPOSED → … → ARCHIVED` только через
  `warrant transition` / `warrant archive`.
- CLI `0.2.0 → 0.3.0`, tag `v0.3.0` на выходе (P-10).

## Capabilities

### New Capabilities
- `verification`: исполнение policy — команды `check`, `gate`, `verify`, `transition`, `archive`; хранение evidence и manifest;
  attestation по окружению; алгоритм verdict, пред-фильтр допустимости, controller; замок и суженный прогон check.

### Modified Capabilities
- `kernel`: REQ-KRN-001 (исключение D-13 для pack-форм), REQ-KRN-004 (`defaults`), REQ-KRN-005 (`skills.*.source`), REQ-KRN-006
  (`provides.rules`, форма `evidence_kinds`), REQ-KRN-010 (`execution`, `scoped_command`, плейсхолдеры), REQ-KRN-011 (`amends`,
  `supersedes`, `human:<login>`), REQ-KRN-012 (`metrics`, `base_commit`), REQ-KRN-019 (`targets[]`), REQ-KRN-021 (`validate`: правила,
  stable ID vs `HEAD`, цели связей, waiver, evidence, B3), REQ-KRN-027 (`status`: `risk_level`, verdicts, controller, stale D-22,
  обратные ссылки, доля правил), REQ-KRN-028 (`classify --set --by`); новый REQ — схема `rule/1`; REQ-KRN-003 (B4: код выхода без
  обрезания stdout) и REQ-KRN-025 (B5: ключи YAML в кавычках).
- `core-sdd`: REQ-SDD-001 (pack `0.2.0`, `evidence_kinds` с `metrics_schema`, `kernel`-диапазон), REQ-SDD-007 (checks с `execution`
  и плейсхолдерами; `rules.design` про `I-N`), REQ-SDD-009 (golden `expected/verify.json`).

## Non-Goals

- `guard`, `run start|submit|finish`, `ci`, `sync-state`, `analyze`, `sync` для `AGENTS.md`/`.codex/hooks.json`, схемы `run/1` и
  `skill-result/1`, `validate --files` — фаза 4.
- `link` (`--amends`/`--supersedes`), поведение `targets[]` частичного waiver, `warrant waive`, `warrant next`, gate `spec-approved`,
  исполнение `execution.local`/`guard_prefixes`, понижение risk ниже floor, проверки `validate` (d) висячие REQ/SCN и (f) pragma
  mutation, `AGENTS.md` побайтно — change `phase-3b` или фаза 4/5 по NEXT-SESSION «Нарезка». Поля схем при этом добавляются сейчас.
- `--wait`, авто-снятие замка мёртвого pid, `local: "ci-only"`, `max_paths` — later по failure mode (D-23).
- Ретроспективные transitions для `phase-2-core-sdd` (P-13); change `agent-session-guide` (P-1).
- Vertical slice на sample-проекте — критерий MVP после фазы 4 (ADR-0013), не критерий этой фазы.
- Profiles `bugfix`, `refactor`, `experiment`; правка нормативных документов сверх перечисленных уточнений.

## Impact

- `packages/cli/schemas/`: `evidence.1`, `pack.1`, `check.1`, `config.1`, `waiver.1`, `change-record.1`, `lock.1` — новые
  необязательные поля; новый `rule.1.schema.json`; копии в `.warrant/schemas/` (через `sync`).
- `packages/cli/src`: новые `commands/{check,gate,verify,transition,archive}.ts`, `core/evidence/` (записи, manifest, parsers `junit`,
  `openspec-validate`, attestation), `core/gates/` (verdict, пред-фильтр, L0-gates), `core/controller/`, `core/check/` (runner, замок,
  timeout, плейсхолдеры); правки `commands/{validate,status,classify}.ts`, `core/schemas/semantic.ts`, `core/sync/plan.ts`,
  `core/packs/hash.ts` (B3), `core/openspec/yaml-emit.ts` (B5), `bin/warrant.ts` (B4); тесты unit + e2e на каждую команду; golden.
- `packs/core-sdd`: `pack.json` (`0.2.0`, `kernel`, `evidence_kinds`), `checks/*.json` (`execution`, плейсхолдеры), `openspec/rules.json`
  (`design`), `golden/*/expected/verify.json`; `packContentHash` меняется → `golden:update`, lock репозитория и фикстур.
- `.github/workflows/ci.yml` — новый; `scripts/golden-lib.js` — fake `openspec validate`.
- Репозиторий: `.warrant/warrant.json` (`defaults.check_timeout_s` не обязателен), `.warrant/local/checks/tests-passed.json`
  (override с командой vitest junit), `.warrant/waivers/WAV-2026-001.json`, `WAV-2026-002.json`, `.warrant/evidence/phase-3-verification/`,
  `.gitignore` (`.warrant/evidence/**/raw/`), `.warrant/local/areas.json` (`VER`), lock.
- `docs/`: ADR-0023, README ADR, 04 §7, 06 §3, 06a §3, 12 §7, 13 §2, NEXT-SESSION, корневой README.
- **BREAKING**: нет. Pack `0.2.0` остаётся в диапазоне `^0.1.0`? — нет: `^0.1.0` не включает `0.2.0`; `warrant.json` репозитория и
  golden-фикстур переходят на `"version": "^0.2.0"` в той же группе, что и bump pack; внешних пользователей нет (ADR-0013).
