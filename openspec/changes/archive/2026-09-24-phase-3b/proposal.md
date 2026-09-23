# Proposal: phase-3b

## Why

Фаза 3 замкнула цикл `check → gate → verify → transition → archive`, но оставила вторую очередь P-4: поля `amends`/`supersedes`,
`waiver`, `execution.local` проходят `validate`, однако ни одна команда их не пишет и не исполняет; gate `spec-approved` (D-3) не
существует, поэтому impl-PR может менять одобренный контракт без следа; понижение risk ниже floor невозможно вовсе (P-5 отложил
форму approval). Ревью фазы 3 (R-1…R-16) исправило ядро быстрыми фиксами (R-1, R-2, R-4, R-14) **без** правки main specs — норма
отстаёт от кода; открытые находки R-6…R-10, R-13 оставляют дыры в gate engine и controller. I-77 ломает archive любого Change с
`REMOVED`. Процедуры сессии (`/decision`, `/group-done`, `/next-session`) выпали вместе с `agent-session-guide` и держатся прозой.

Change закрывает этот долг, не заходя в фазу 4: всё, что требует `guard`, `sync` (`AGENTS.md`), `ci` или producer'а mutation,
вынесено (решения V-1…V-9, [NEXT-SESSION](../../../docs/NEXT-SESSION.md)). Это же первый change, который проходит топологию P-2
без отступлений.

## What Changes

- **Delta под фиксы ревью** (код уже в `main`, v0.3.1): REQ-VER-002 — junit без выполненного теста → `INCONCLUSIVE` (R-4);
  REQ-VER-003 — waiver засчитывается, только если `approved_by` ∈ roles (R-2); REQ-VER-007 — commit `MERGED` обязан быть head
  impl-PR, fast-forward → `COMMIT_NOT_MERGED` (R-1); REQ-SDD-001 — версия pack `0.3.x`, patch по R-14; REQ-SDD-007 —
  `accepts_attestation: ["ci"]` у `tests-passed`, `factory-golden-passed` (R-5).
- **Gate engine и controller** (R-6…R-10, R-13): `transition MERGED` сверяет `--ref` с `attestation.ref` CI-записей
  (`REF_MISMATCH`); kind из `evidence.required`, который не читает ни один gate, — конфликт policy `EVIDENCE_KIND_UNGATED`;
  `evidence-complete` засчитывает только `PROVEN`/`NOT_APPLICABLE` и waiver на waivable gate без `targets[]`; `NOT_APPLICABLE`
  засчитывается только от `produced_by.type: "check"`; запись `human-approval` несёт `limitations: ["ref not verified …"]`;
  правило controller'а не может дать `CONTINUE` при худшем verdict `FAIL`/`BLOCKED` (`CONTROLLER_RULE_IGNORED`).
- **Новые команды**: `warrant link <change> --amends|--supersedes <target>` (до `APPROVED`, ADR-0021 п. 9);
  `warrant waive` — создать `PROPOSED`, `activate --by`, `revoke --by` (05 §7; без `targets[]`).
- **Gate `spec-approved`** (D-3, V-9): hash `{proposal.md, specs/**}` Change на commit записи `human-approval` перехода
  `APPROVED` ↔ на оцениваемом commit; `VERIFYING->MERGED`, overlay `core-default`, `waivable: true` — правка контракта после
  approval снимается waiver'ом maintainer'а. Норма — ADR-0024 (amends ADR-0020 п. 9, 06 §4).
- **`execution.local`** (ADR-0017 п. 4): `scoped-only` — локально только суженный прогон; `CHECK_LOCAL_FORBIDDEN`.
- **`classify` ниже floor** (P-5, V-4): `--set <dim>=<v> --by <login> --ref <url>`, только до `APPROVED`; значение хранит `ref`.
- **`validate`**: I-77 (удаление ID delta'ой `REMOVED` в коммите archive); проверка (13) висячие REQ/SCN в `tasks.md` активных
  Changes и в `paths.tests` → `ID_DANGLING` (ADR-0019 п. 1d).
- **Схемы**: `change-record.1` — `ref` у значения risk; `waiver.1` — `approved_by` обязателен, кроме `PROPOSED`.
- **Процедуры** `.claude/commands/{decision,group-done,next-session}.md` (решение «Процессные правила»; правил в них нет).
- **Документы**: ADR-0024; 04 §9 приводится к ADR-0010 (I-93); 01 INV-03 — статус «Частично» (R-10); 13 §2 — строки фаз 3, 4, 5
  по нарезке V-1; 05 §7 — `approved_by` у `PROPOSED`; 04 §7 — `link`, `waive` MVP; NEXT-SESSION, README.
- Pack `core-sdd` `0.2.1 → 0.3.0` (`kernel: ">=0.1 <0.5"`), CLI `0.3.1 → 0.4.0`, tag `v0.4.0` после archive-PR (V-7).

## Capabilities

### New Capabilities
- (нет)

### Modified Capabilities
- `kernel`: REQ-KRN-011 (`ref` значения risk), REQ-KRN-019 (`approved_by` у `PROPOSED`), REQ-KRN-021 (`validate`: I-77, (11) для
  `PROPOSED`, (13) `ID_DANGLING`), REQ-KRN-026 (`EVIDENCE_KIND_UNGATED`), REQ-KRN-028 (понижение ниже floor); новые REQ — команды
  `link` и `waive`.
- `verification`: REQ-VER-002 (R-4, `execution.local`), REQ-VER-003 (R-2, R-9), REQ-VER-004 (R-8, `spec-approved`), REQ-VER-005 (R-13),
  REQ-VER-006 (`CHECK_LOCAL_FORBIDDEN` не прерывает gates), REQ-VER-007 (R-1, R-6, R-10).
- `core-sdd`: REQ-SDD-001 (версия `0.3.x`, gate `spec-approved`), REQ-SDD-002 (`spec-approved` в `core-default`), REQ-SDD-007
  (`waivable` `spec-approved`, `accepts_attestation` R-5).

## Non-Goals

- Поведение `waiver.targets[]` (D-10) и проверка (f) pragma mutation — фаза 5, pack `bdd-tdd` (V-1): нет producer'а, форма target не
  объявлена, инструмент — spike S7. Waiver с `targets[]` по-прежнему `WAIVER_IGNORED`/`PACK_FORM_UNKNOWN`.
- `guard_prefixes`, `validate --files`, `AGENTS.md` побайтно, `analyze` — фаза 4 (V-1).
- `guard`, `run`, `ci`, `sync` для `.codex/hooks.json`; верификация `--ref` через API форджа — фаза 4 (R-10 фиксирует предел).
- R-11 (smoke на Linux) — отложено maintainer'ом; R-12 — фаза 4 / настройка GitHub; I-90, I-59, I-64 — по failure mode.
- Отдельная команда approval, `--force`, флаг связи при `init change`; profiles `bugfix`/`refactor`/`experiment`.

## Impact

- `packages/cli/src`: новые `commands/{link,waive}.ts`, `core/gates/l0/spec-approved.ts`, `core/validate/dangling.ts`; правки
  `core/gates/{verdict,prefilter}.ts`, `core/gates/l0/evidence-complete.ts`, `core/controller/evaluate.ts`, `core/resolve/merge.ts`,
  `core/check/*` (`local`), `core/classify/*`, `core/ids/immutable.ts`, `core/validate/waivers.ts`, `commands/{transition,check,verify,
  classify,validate}.ts`, `bin/warrant.ts`; unit + e2e.
- `packages/cli/schemas/{change-record,waiver}.1.schema.json` (+ копии в `.warrant/schemas/`).
- `packs/core-sdd`: `pack.json` (`0.3.0`, `kernel`), `gates/spec-approved.json`, `overlays/core-default.json`; lock, golden
  (`golden:update`).
- `.claude/commands/` — три процедуры; `.warrant/waivers/WAV-2026-003.json`, `WAV-2026-004.json` (V-8); record и evidence `phase-3b`.
- `docs/`: ADR-0024, README ADR, amended_by в ADR-0020, 01, 04 §7/§9, 05 §7, 06 §4, 13 §2, NEXT-SESSION; корневой README.
- **BREAKING**: `warrant.json` проектов на `^0.2.0` не принимает pack `0.3.0` — репозиторий и golden переходят на `^0.3.0`;
  внешних пользователей нет (ADR-0013). Проект с record, где kind `evidence.required` не читает ни один gate, получит
  `POLICY_CONFLICT` — у core-sdd таких нет.
