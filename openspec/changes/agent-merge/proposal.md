# Proposal: agent-merge

## Why

На каждый Change сейчас два нажатия maintainer'а: merge spec-PR и merge impl-PR. [ADR-0050](../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 2 разрешает агенту сливать impl-PR там, где policy не требует `human-approval`. Но судья пока пропускает дыры, при которых merge агентом снимал бы обнаружение (п. 6):

- WS-03 (S1): у записанных переходов `WAIVED` и `NOT_APPLICABLE` принимаются на слово, а у `APPROVED`, `SPECIFIED`, `ARCHIVED` hash policy и состав gates не сверяются с базой (`core/ci/record.ts:271-282`, `:143`);
- WS-13: `.claude/**` и `AGENTS.md` не в policy-путях, а `validate` / `sync --check` судья не выполняет;
- WS-14: PR без Change с правкой `paths.src` проходит `warrant ci` (`core/ci/paths.ts:92-98`).

Кроме того, приёмку человеком policy задаёт одним способом — `human-approval` у всего `risk-high`, а почти любой Change SRA попадает в HIGH. [ADR-0051](../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) (grilling 2026-10-01) выносит merge агентом первым, в 0.9.0.

## What Changes

- **Судья, ref `MERGED`** (ADR-0050 п. 2): если effective policy перехода `VERIFYING->MERGED` не содержит `human-approval`, merge impl-PR членом `roles` базы или агентом из `identities.agents` засчитывается, в том числе когда `merged_by` — автор PR. Содержит — как сейчас: только член роли одобрения, не агент, не автор. Роль одобрения `SPECIFIED->APPROVED` без `approvals[]` — по-прежнему `maintainer` (ADR-0050 п. 1).
- **Судья, записанные вердикты** (WS-03, ADR-0051 п. 2): у каждого нового перехода, кроме `PROPOSED`, `effective_policy_hash` и набор gates равны policy базы; `WAIVED` — есть засчитываемый waiver этого Change на gate; `NOT_APPLICABLE` — `applies_when` gate не выполнен на diff перехода. Evidence заново не вычисляется (N44).
- **Судья, PR без Change** (WS-14): правка `paths.src` или `paths.tests` — `SCOPE_VIOLATION`.
- **Reusable workflow** (WS-13): `warrant validate` и `warrant sync --check` до `warrant ci`.
- **Pack `core-sdd`**: `risk-high` без `human-approval` и approval на `VERIFYING->MERGED` (ADR-0050 п. 3 «заменяет»).
- **Policy SRA**: локальный профиль `.warrant/local/profiles/human-acceptance.json` — пути класса ADR-0050 п. 3 (код судьи, policy, защита агента, workflow) добавляют `human-approval` на `VERIFYING->MERGED`.
- **Версии:** CLI 0.9.0 (minor: судья строже, CHANGELOG — «Вердикт», «Миграция для потребителя»); pack `core-sdd` 0.4.0, `risk-high` 2.0.0, диапазон `kernel` `>=0.1 <0.10`; lock и golden — перегенерация.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification` — REQ-VER-011 (запись, ref, пути вида none), REQ-VER-014 (шаги reusable workflow).
- `core-sdd` — REQ-SDD-006 (`risk-high`).

## Non-Goals

- **Один gate engine для `transition` и судьи** (кандидат 1 разбора 2026-09-29) — позже, строка backlog (ADR-0051 п. 2).
- **Код выхода 4 и `retryable`** (WS-06), **WS-15**, **A-34** — 0.10.0 (ADR-0051 п. 1).
- **Профиль приёмки у потребителя** (LATTICE) — его сессия; миграция — в CHANGELOG.
- **Навыки merge** (`change-impl-pr`, `git-land`, `fast-mode`: impl-PR вне класса п. 3 сливает сессия) — archive-PR этого Change.

## Impact

- `packages/cli/src/core/ci/record.ts`, `core/ci/refs.ts`, `core/ci/paths.ts` и тесты `packages/cli/test/**`.
- `.github/workflows/warrant.yml`.
- `packs/core-sdd/overlays/risk-high.json`, `packs/core-sdd/pack.json`, `packs/core-sdd/golden/**`.
- `.warrant/local/profiles/human-acceptance.json`, `.warrant/warrant.json`, `.warrant/warrant.lock.json`.
- `package.json`, `CHANGELOG.md`.
- `openspec/changes/agent-merge/specs/verification/spec.md`, `openspec/changes/agent-merge/specs/core-sdd/spec.md`.
