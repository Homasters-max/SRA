# Design: agent-merge

## Context

База — `main` после `identities` (CLI 0.8.3, `identities.agents: [homasters]`). Норма — [ADR-0050](../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 2–3 и [ADR-0051](../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md). Факты кода:

- `judgeRecord` (`core/ci/record.ts:241-304`): у нового перехода, кроме `PROPOSED`, проверяются только наличие `effective_policy_hash` (:272) и вердикт из `PASSING_VERDICTS` (:276; `core/gates/types.ts:25`). Hash и набор gates с policy базы сверяет только `mergedRules` у `MERGED` (:130-134, `else if` прячет расхождение набора за неверным hash); CI-evidence — только у `PASS` (:143).
- Засчитываемость waiver — один предикат `waiverStatus` (`core/waivers/status.ts:43-56`: `ACTIVE`, срок, `approved_by` в roles, `waivable`, без `targets[]`); файлы — `readWaivers(root)` (`core/waivers/read.ts:26-40`). `applies_when` вычисляет `baseOutcome` (`core/gates/verdict.ts:296-310`) по `signals.diff`.
- `judgeRefs` (`core/ci/refs.ts:97-200`): `merged_by` ∈ `roleMembers(config, approvalRoles(policy, transition))` (:135-139), не агент (:141-144), не автор при непустых agents (:145-148). `approvalRoles` без `approvals[]` откатывается к `maintainer` (`core/roles.ts:44`); его зовут ещё `transition/approval.ts:36` и `commands/classify.ts:110`. Ни один pack не объявляет approval на `SPECIFIED->APPROVED` — одобрение spec держит fallback.
- `judgePaths` (`core/ci/paths.ts:92-98`): вид `none` запрещает только собственное состояние Change и policy-пути; `codeScope(config)` (`core/run/scope.ts:42-45`) там не применяется.
- Policy: профили матчат пути (`classify/packs.ts:38-49`), в том числе профили слоя `.warrant/local/**` (`packs/loader.ts:320-462`); overlay по путям не матчит (`schemas/overlay.1.schema.json`). Локальный override не ослабляет pack (`OVERRIDE_WEAKENS`, SCN-SDD-010) — снять `human-approval` с `risk-high` можно только в pack.
- `warrant.yml` — шаги без `validate` и `sync --check`; путь `.github/workflows/warrant.yml` — компонент CLI для `versions:check` (`scripts/versions-lib.js:36`).

## Goals / Non-Goals

**Goals:** impl-PR вне класса путей с приёмкой человеком сливает агент, и судья это засчитывает; записанный вердикт нельзя подделать `WAIVED` / `NOT_APPLICABLE` или чужой policy; код без Change не проходит.

**Non-Goals:** — proposal.

## Decisions

### 1. Решения

| # | Решение |
|---|---|
| D1 | `approvalRoles` не меняется: fallback `maintainer` при пустом `approvals[]` остаётся (одобрение spec держит он — ADR-0050 п. 1). Цель ADR-0050 п. 2, третий пункт («нет роли» вместо fallback) достигается D2: исключение для агента срабатывает по отсутствию gate `human-approval`, а не по пустым `approvals[]`; «нет роли» при gate `human-approval` без approvals запер бы merge для всех. Отступление от буквы ADR-0050 — вопрос maintainer'у в теле spec-PR |
| D2 | Ref `MERGED` без gate `human-approval` в effective policy перехода: `merged_by` ∈ `roleMembers(config)` (любая роль) ∪ `identities.agents` базы; INV-03 (`merged_by` = автор) не применяется — merge не акт одобрения, его держат gates merge-результата impl-PR (вид impl) и CI-evidence (`ci_evidence`). С gate — как сейчас |
| D3 | WS-03 — правило `verdicts` в `judgeRecord` для каждого нового перехода, кроме `PROPOSED`: (а) `effective_policy_hash` = hash policy базы для `classification` HEAD и набор gates = gates перехода этой policy — причина `policy` (для `MERGED` — существующий `mergedRules`, `else if` заменяется двумя проверками); (б) `WAIVED` — `waiverStatus(...).counts` хотя бы у одного waiver этого Change на этот gate из `.warrant/waivers/` базы и HEAD, `today` = дата `at` перехода, approvers — `roleMembers` базы, определение gate — `gateDefinitions(base.loaded)` — причина `waiver`; (в) `NOT_APPLICABLE` — у определения gate есть `applies_when`, и `baseOutcome` на diff перехода даёт `NOT_APPLICABLE` — причина `not_applicable`. Evidence не пересчитывается (N44): проверяется допустимость записанного вердикта |
| D4 | Diff перехода для D3 (в): у `MERGED` — diff merge-коммита M impl-PR (`M^1..M`, M — из правила ref `MERGED`); у остальных — diff судимого PR (база..HEAD), как у `judgePaths`. Git — через порт адаптера (ADR-0025) |
| D5 | Класс путей ADR-0050 п. 3 в SRA — профиль `.warrant/local/profiles/human-acceptance.json` (`warrant://profile/1`): `match.paths` — `packages/cli/src/core/ci/**`, `packages/cli/src/core/gates/**`, `packs/**`, `.warrant/warrant.json`, `.warrant/warrant.lock.json`, `.warrant/local/**`, `.warrant/waivers/**` (policy без состояния Change: `match.paths` не знает отрицания), `.claude/**`, `**/AGENTS.md`, `CLAUDE.md`, `scripts/dev/*-hook.js`, `.github/workflows/**`; `gates: {"VERIFYING->MERGED": ["human-approval"]}`, `approvals: [{role: maintainer, at: VERIFYING->MERGED}]`. Профиль липкий через record, CI требует его по путям diff (`ci/base.ts:97-112`). |
| D6 | `risk-high` 2.0.0: `adversarial-review` на `SPECIFIED->APPROVED`, без `human-approval` и `approvals` (ослабление — major overlay); pack `core-sdd` 0.4.0, `kernel: ">=0.1 <0.10"`. SCN-SDD-010 — пример ослабления меняется на снятие `adversarial-review` |
| D7 | WS-14: вид `none` — `SCOPE_VIOLATION` для файлов в `codeScope(config)`; без `paths.src` и `paths.tests` — `skipped` как у вида spec |
| D8 | WS-13: `warrant.yml` — шаги `warrant validate` и `warrant sync --check` после установки CLI, до `warrant ci`; красный шаг — job красный. Пример в шапке — `@v0.9.0` |
| D9 | Версии: CLI 0.9.0 (`package.json`), CHANGELOG `## 0.9.0` с «Вердикт» (строже: D3, D7, D8; мягче: D2) и «Миграция для потребителя» (профиль приёмки по образцу D5 — иначе `risk-high` больше не зовёт человека; `validate` и `sync --check` в CI должны быть зелёными); `.warrant/warrant.json` `kernel: "0.9"`; lock и golden — `warrant sync`, `scripts/golden-update.js` |

### 2. Порядок

Группа версий первой: без неё `versions:check` красный на любой правке `src`. Затем pack и профиль, потом судья (D1–D4, D7), workflow. Этот impl-PR сливает maintainer: diff в классе D5, а база ещё 0.8.3.

### 3. Риски

- **D2 и самослияние.** Агент открывает и сливает impl-PR сам. Страховка — вид impl пересчитывает merge-вердикт на merge-результате, archive-PR сверяет CI-evidence; правки, меняющие проверку, — класс D5. Остаточный риск — класс B (обнаружение), ADR-0048 п. 2.
- **D3 на старых record.** Судятся только новые переходы PR — история не перепроверяется.
- **D8 у потребителя.** `validate` может покраснеть у проекта с дрейфом — миграция в CHANGELOG.
