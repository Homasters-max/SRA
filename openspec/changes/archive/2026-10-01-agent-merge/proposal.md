# Proposal: agent-merge

## Why

На каждый Change сейчас два нажатия maintainer'а: merge spec-PR и merge impl-PR. [ADR-0050](../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 2 разрешает агенту сливать impl-PR там, где policy не требует `human-approval`. Но судья пока пропускает дыры, при которых merge агентом снимал бы обнаружение (п. 6):

- WS-03 (S1): у записанных переходов `WAIVED` и `NOT_APPLICABLE` принимаются на слово, а у `APPROVED`, `SPECIFIED`, `ARCHIVED` hash policy и состав gates не сверяются с базой (`core/ci/record.ts:271-282`, `:143`);
- WS-13: `.claude/**` и `AGENTS.md` не в policy-путях, а `validate` / `sync --check` судья не выполняет;
- WS-14: PR без Change с правкой `paths.src` проходит `warrant ci` (`core/ci/paths.ts:92-98`).

Кроме того, приёмку человеком policy задаёт одним способом — `human-approval` у всего `risk-high`, а почти любой Change SRA попадает в HIGH. [ADR-0051](../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) (grilling 2026-10-01) выносит merge агентом первым, в 0.9.0.

## What Changes

- **Класс путей с приёмкой человеком в SRA** ([ADR-0051](../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 2): весь CLI, policy, защита агента, форж — локальный профиль `.warrant/local/profiles/human-acceptance.json` с `human-approval` на `VERIFYING->MERGED`.
- **Предотвращение — форж** (п. 3): `.github/CODEOWNERS` и защита `main` (настраивает maintainer) — бот не сольёт PR с путями класса.
- **Судья, ref `MERGED`** (п. 4): без `human-approval` в policy M^1 (база impl-PR) merge членом `roles` или агентом засчитывается, в том числе автором PR; требования — из M^1, не из базы archive-PR. Fallback `maintainer` у `APPROVED` остаётся. Находка `NO_HUMAN_ACCEPTANCE` — у проекта без приёмки человеком.
- **Судья, записанные вердикты** (WS-03, п. 5): `WAIVED` — засчитываемый waiver (файл базы, срок на дату прогона); `NOT_APPLICABLE` — `applies_when` не выполнен на diff перехода или записи evidence `NOT_APPLICABLE` от check. Evidence не пересчитывается (N44). Предикаты `appliesTo`, `countingWaiver`, `requiresHuman` — из gate engine (A-39, A-40).
- **Судья, PR без Change** (WS-14, п. 8): правка `paths.src` или `paths.tests` — `SCOPE_VIOLATION`; SRA задаёт `paths.src`, `paths.tests`.
- **Reusable workflow** (WS-13, п. 7): `warrant validate` и `warrant sync --check` до `warrant ci`.
- **Pack `core-sdd` 0.4.0** (п. 6): `risk-high` 2.0.0 без `human-approval` и approvals.
- **Версии:** CLI 0.9.0 (minor, CHANGELOG — «Вердикт», «Миграция для потребителя»); pack 0.4.0, `kernel` `>=0.1 <0.10`; lock и golden — перегенерация.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification` — REQ-VER-011 (записанные вердикты, ref `MERGED` агента, `NO_HUMAN_ACCEPTANCE`, пути вида none), REQ-VER-014 (шаги reusable workflow).
- `core-sdd` — REQ-SDD-005 (SCN-SDD-007), REQ-SDD-006 (`risk-high`, профиль приёмки).

## Non-Goals

- **Один gate engine для `transition` и судьи**, сверка hash policy у `APPROVED`, `SPECIFIED`, `ARCHIVED`, `requiresHuman` в остальных трёх местах (A-40), нормализация `paths.*` (A-41) — 0.10.0 (ADR-0051 п. 1, 5).
- **Код выхода 4 и `retryable`** (WS-06), **WS-15**, **A-34** — 0.10.0 (ADR-0051 п. 1).
- **Профиль приёмки у потребителя** (LATTICE) — его сессия; миграция — в CHANGELOG.
- **Навыки merge** (`change-impl-pr`, `git-land`, `fast-mode`: impl-PR вне класса п. 3 сливает сессия) — archive-PR этого Change.

## Impact

- `packages/cli/src/core/ci/record.ts`, `core/ci/refs.ts`, `core/ci/paths.ts`, `core/gates/**`, `core/roles.ts` и тесты `packages/cli/test/**`.
- `.github/workflows/warrant.yml`, `.github/CODEOWNERS`.
- `docs/05-policy.md`, `docs/06-*.md`, `docs/01-*.md` — `risk-high`, форж и судья, INV-03.
- `packs/core-sdd/overlays/risk-high.json`, `packs/core-sdd/pack.json`, `packs/core-sdd/golden/**`.
- `.warrant/local/profiles/human-acceptance.json`, `.warrant/warrant.json`, `.warrant/warrant.lock.json`.
- `package.json`, `CHANGELOG.md`.
- `openspec/changes/agent-merge/specs/verification/spec.md`, `openspec/changes/agent-merge/specs/core-sdd/spec.md`.
