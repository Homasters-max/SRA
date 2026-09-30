# Design: agent-merge

## Context

База — `main` после `identities` (CLI 0.8.3, `identities.agents: [homasters]`). Норма — [ADR-0050](../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 2–3 и [ADR-0051](../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) (два раунда grilling 2026-10-01; второй — по review spec RUN-01M3T3553QDJFW06RSZQWEVX25 и аудиту 2026-10-01). Факты кода:

- `judgeRecord` (`core/ci/record.ts:241-304`): у нового перехода, кроме `PROPOSED`, вердикт — из `PASSING_VERDICTS` (:276); `WAIVED` и `NOT_APPLICABLE` ничем не подкреплены; CI-evidence — только у `PASS` (:143).
- Засчитываемость waiver — `waiverStatus` (`core/waivers/status.ts:43-56`), файлы — `readWaivers(root)` (`core/waivers/read.ts:26-40`). `applies_when` и сопоставление waiver с gate спрятаны в `core/gates/verdict.ts` (`baseOutcome` :296-310, `applyWaivers` :385-408) и продублированы в `evidence-complete` (A-39).
- `judgeRefs` (`core/ci/refs.ts:97-200`): `merged_by` ∈ `roleMembers(config, approvalRoles(...))` (:135-139), не агент (:141-144), не автор при непустых agents (:145-148); всё — по базе PR. «Нужен ли человек» решается в четырёх местах по-разному (A-40).
- `judgePaths` (`core/ci/paths.ts:92-98`): вид `none` запрещает только собственное состояние Change и policy-пути; `codeScope(config)` (`core/run/scope.ts:42-45`) строится ниже (:113-114). В `.warrant/warrant.json` SRA нет `paths.src` и `paths.tests`.
- Policy: профили матчат пути (`classify/packs.ts:38-49`), в том числе профили `.warrant/local/**` (`packs/loader.ts:320-462`); отрицания в `match.paths` нет; локальный override не ослабляет pack (`OVERRIDE_WEAKENS`). `feature.json` объявляет approval на `SPECIFIED->APPROVED`; на `VERIFYING->MERGED` approval — только у `risk-high`.
- SRA судит себя кодом из checkout (`warrant: checkout`): archive-PR исполняет код судьи, слитый impl-PR.

## Goals / Non-Goals

**Goals:** impl-PR вне класса путей с приёмкой человеком сливает агент, и судья это засчитывает; PR с путями класса бот слить не может (форж — и impl-, и docs-, и archive-PR); impl-PR класса, слитый ботом, судья ловит в archive-PR (правку путей класса в PR без Change и archive-PR судья не ловит — только форж, класс C); записанный `WAIVED` / `NOT_APPLICABLE` без основания не проходит; код без Change не проходит.

**Non-Goals:** — proposal.

## Decisions

### 1. Решения

| # | Решение |
|---|---|
| D1 | `approvalRoles` не меняется: fallback `maintainer` при пустом `approvals[]` остаётся (ADR-0051 п. 4, меняет букву ADR-0050 п. 2) |
| D2 | Предикат `requiresHuman(policy, transition)` — gate `human-approval` в `policy.gates[transition]` (A-40): один источник для `ci/refs.ts`; остальные три места (A-40) переходят на него в 0.10.0 — строка backlog |
| D3 | Ref `MERGED`: policy (packs, `.warrant/local/**`, конфигурация), `roles`, `approvals[]` и `identities.agents` — из M^1 (checkout M^1 рядом с базой, как `ci/base.ts`), в обеих ветках. Классификация — record Change на M ∪ профили `classify` по packs M^1 из diff `merge-base(M^1, M^2)..M^2`. `requiresHuman` = false — `merged_by` ∈ `roleMembers(M^1)` ∪ `agents(M^1)`, INV-03 не применяется; true — член роли одобрения M^1, не агент, не автор. Fail-closed (`requiresHuman` = true): policy M^1 не вычисляется текущим CLI (packs, lock, `kernel`, профиль вне packs M^1) — роль `roles.maintainer` M^1; record на M несёт `VERIFYING->IMPLEMENTING`. Находка `AGENT_MERGE_CLOSED` с причиной. `APPROVED` — без изменений |
| D4 | WS-03 — правило `verdicts` в `judgeRecord` для каждого нового перехода, кроме `PROPOSED`: `WAIVED` — waiver этого Change на gate, файл базы, при его отсутствии — HEAD; `waiverStatus` на дату прогона (часы — порт `clock`), approvers — `roleMembers` базы, определение — `gateDefinitions(base.loaded)`, причина `waiver`. `NOT_APPLICABLE` — у `MERGED` `appliesTo(definition, diff)` false на diff `merge-base(M^1, M^2)..M^2`, у остальных — наличие `applies_when` (diff вычисления недоступен; остаточный риск, строка backlog); или непустой `requires_evidence`, каждый элемент которого удовлетворён записью `NOT_APPLICABLE` от check (у `MERGED` — CI на M^2); gate без `requires_evidence` основания по evidence не имеет; причина `not_applicable`. M не найден — основание по diff не проверяется (нарушение даёт ref). Evidence не пересчитывается (N44) |
| D5 | Предикаты `appliesTo(definition, diff)` и `countingWaiver(gate, change, waivers, definitions, ctx)` выносятся из `core/gates/verdict.ts` чистыми функциями; `baseOutcome`, `applyWaivers`, `waived` (`evidence-complete`) и D4 зовут их (A-39) |
| D6 | Класс путей ADR-0051 п. 2 в SRA (вместе с корневым `package.json`, `package-lock.json`, `packages/cli/vitest.config.ts`, `**/tsconfig*.json`) — профиль `.warrant/local/profiles/human-acceptance.json` (`warrant://profile/1`): `match.paths` — пути п. 2, `gates: {"VERIFYING->MERGED": ["human-approval"]}`, `approvals: [{role: maintainer, at: VERIFYING->MERGED}]`. Профиль липкий через record, CI требует его по путям diff (`ci/base.ts:97-112`) |
| D7 | `.github/CODEOWNERS` — `@Homasters-max` владелец путей п. 2 (включая сам `CODEOWNERS`); защиту `main` («Require review from Code Owners», обязательная `warrant / warrant`) включает maintainer — задача группы 6. PR с путями класса maintainer сливает сам: auto-merge, включённый ботом, пишет `merged_by` бота; навыки не ставят `--auto` на такие PR |
| D8 | `NO_HUMAN_ACCEPTANCE` — информационная находка `warrant ci`, когда ни один объект policy базы не добавляет `human-approval` на `VERIFYING->MERGED` |
| D9 | `risk-high` 2.0.0: `adversarial-review` на `SPECIFIED->APPROVED`, без `human-approval` и approvals; pack `core-sdd` 0.4.0, `kernel: ">=0.1 <0.10"`; диапазон pack в `.warrant/warrant.json` — `^0.4.0`; SCN-SDD-007, SCN-SDD-010 — по новым текстам |
| D10 | WS-14: вид `none` — `SCOPE_VIOLATION` для файлов в `codeScope(config)` (matcher поднимается выше ветки `none`); без `paths.src` и `paths.tests` — `skipped`. SRA: `paths.src: "packages/cli/src"`, `paths.tests: "packages/cli/test"`. Нормализация `paths.*` в одном месте (A-41) — 0.10.0 |
| D11 | WS-13: `warrant.yml` — шаги `warrant validate` и `warrant sync --check` после установки CLI, до `warrant ci`; пример в шапке — `@v0.9.0` |
| D12 | Версии: CLI 0.9.0, CHANGELOG `## 0.9.0` — «Вердикт» (строже: D4, D10, D11; мягче: D3) и «Миграция для потребителя» (профиль приёмки по образцу D6 и `CODEOWNERS` — иначе `risk-high` больше не зовёт человека, `NO_HUMAN_ACCEPTANCE`; `validate` и `sync --check` в CI зелёные; `paths.src` / `paths.tests` закрывают код без Change); `.warrant/warrant.json` `kernel: "0.9"`; lock и golden — `warrant sync`, `scripts/golden-update.js` |

### 2. Порядок

Версии — первой группой: без них `versions:check` красный на любой правке `src`. Затем policy (D6, D9), предикаты (D5), судья (D3, D4, D8, D10), workflow и `CODEOWNERS` (D7, D11), доки. Этот impl-PR сливает maintainer: diff в классе D6, а база ещё 0.8.3.

### 3. Риски

- **Код судьи из checkout.** Impl-PR с путями класса бот не сольёт (D7); если форж не настроен — merge ботом ловит D3 по M^1, но код, судящий archive-PR, уже слит. Остаточный риск — класс B при не настроенном форже: форж WARRANT не проверяет (класс C).
- **Слит не тем.** Impl-PR класса, слитый ботом, — `REF_NOT_VERIFIED` в archive-PR; восстановление — повтор impl-PR без правок кода, который сливает maintainer (I-225 Change `identities`, SCN в REQ-VER-011).
- **Waiver у потребителя.** Новый waiver с HEAD засчитывается; доверие держит класс путей проекта — `.warrant/waivers/**` в профиле приёмки и `CODEOWNERS` потребителя (миграция), иначе агент кладёт и сливает waiver сам.
- **Fail-closed на честном merge.** Смена pack или `kernel` между M и archive-PR (как у самого `agent-merge`: M^1 — 0.8.3) делает merge агентом непризнанным — impl-PR сливает maintainer; в CHANGELOG.
- **Самослияние (D3).** Агент открывает и сливает impl-PR вне класса. Страховка — merge-вердикт на merge-результате (вид impl, обязательная проверка форжа) и CI-evidence в archive-PR.
- **Потребитель.** После pack 0.4.0 у LATTICE HIGH не зовёт человека, пока нет профиля — `NO_HUMAN_ACCEPTANCE` в каждом прогоне CI, миграция в CHANGELOG.
- **Fix-PR тестов.** С `paths.tests` правка тестов SRA без Change — `SCOPE_VIOLATION` (ADR-0051 п. 8).
- **Waiver на дату прогона.** Waiver, истёкший между переходом и archive-PR, красит archive-PR: срок waiver — не раньше ожидаемого archive-PR (навык `change-spec-pr`).
