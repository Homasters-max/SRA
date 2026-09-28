---
id: WARRANT-ADR-0038
title: PR не задаёт требований к себе — закон и судья `warrant ci` из базы, исполняемое из PR — policy-пути
adr_state: ACCEPTED
date: 2026-09-26
supersedes: []
amends: [WARRANT-ADR-0037, WARRANT-ADR-0010]
---

## Context

Семь раундов review spec Change `phase-4c` (design.md «Review spec») закрывали по одному случаю одной причины — PR сам поставляет часть требований, по которым его судит `warrant ci`:

| Раунд | Находка | Что поставлял PR |
|---|---|---|
| 2, F-7 | workflow из PR подменяет producer evidence CI | исполнителя суждения |
| 5, F-2 | `roles` и `approvals[]` для ref и waivers | подтверждающего |
| 6, F-1 | классификация record ослаблена в impl-PR | набор gates своего merge |
| 7, F-1 | новый `MERGED` с пустыми `gates` или без записей `ci` | требования к переходу |
| 7, F-2 | policy-пути, `paths.*`, `risk_level` из HEAD | закон правил путей |
| 7, F-4 | CLI job ставится из checkout PR (`npm i -g .`) | судью |

Число находок по раундам: 29, 19, 12, 11, 8, 8, 9 — точечные правки не сходятся. Факты платформы: run `pull_request` исполняет workflow из самого PR; branch protection и `pull_request_target` вне MVP (proposal `phase-4c`, Non-Goals). Profile `factory-change` уже держит пути фабрики этого репозитория (`packages/cli/schemas/**`, `sra/skills/**`, `.github/workflows/**`), каждый Change репозитория WARRANT — `risk_level: HIGH` с `human-approval` на `MERGED`. Из 58 последних PR без Change только 2 (ранние, фаза 2) правили `packages/cli/src`.

## Decision

1. **Требования к PR — из базы.** Всё, из чего `warrant ci` выводит требования к PR, SHALL читаться из дерева HEAD^1 (tip базы, уже принятого в `main`), одним контекстом базы: policy-пути (`match.paths` profiles), `paths.src`, `paths.tests`, `roles`, `approvals[]`, effective policy и классификация по путям diff. PR предъявляет только предмет суждения — record, evidence, код, документы. Прежние частные правила (`roles` из HEAD^1, классификация не слабее базы) — случаи этого пункта. Встроенный pack (`source: bundled`) приходит с CLI и из дерева HEAD^1 не берётся (полная загрузка packs базы ломала бы каждый bump по диапазону `kernel`): pack базы опознаётся по `hash` в `warrant.lock.json` HEAD^1. Совпал — встроенный pack и есть pack базы; разошёлся или его нет в lock базы — PR меняет закон: в impl-PR классификация обязана содержать `factory-change`, в остальных PR это нарушение.
2. **Требования к новому `MERGED` — из политики базы, а не из record.** В archive-PR база — `main` после merge impl-PR, то есть закон, по которому вычислен `MERGED`: `effective_policy_hash` перехода равен hash effective policy базы для его классификации, а каждый gate `PASS`, чьи evidence производят checks, опирается на запись `ci`. Verdicts по-прежнему не пересчитываются (N44): из базы выводится, что требуется, а не что получилось.
3. **Исполняемое из PR — policy-пути `factory-change`.** То, что GitHub исполняет из checkout PR и что взять из базы нельзя или дорого, входит в `match.paths` profile `factory-change`: `.github/workflows/**` (N49) и в репозитории WARRANT — судья `packages/cli/src/**`, `packages/cli/package.json`. Правка судьи видна классификацией по базе (п. 1) и требует gates `factory-change` и `human-approval`; PR без Change его не трогает.

## Consequences

- Delta specs `phase-4c` правятся в impl-PR по [ADR-0024](WARRANT-ADR-0024-spec-approved-contract.md) п. 4 (строки I-171…I-176, waiver на `spec-approved`), без восьмого раунда review: REQ-VER-011 — база требований, правило `MERGED`, классификация по путям diff; REQ-VER-012 — MINOR седьмого review; REQ-SDD-005 — пути судьи.
- `warrant ci` строит контекст базы из `worktreeAt(HEAD^1)` на каждом PR, а не только для повтора archive.
- ADR-0037 п. 3 не меняется: job по-прежнему ставит CLI из checkout результата merge.
- ADR-0010 п. 1: «CI не доверяет содержимому PR» распространяется на требования к PR.
- Остаточный риск (proposal `phase-4c`, Non-Goals): зависимости корневого `package-lock.json` и workflow PR без Change — глаза maintainer'а до branch protection.
- Навык `change-spec-pr`: review `PROVEN` с MAJOR — строка backlog и решение в impl-PR по ADR-0024 п. 4, а не новый раунд.

## Alternatives

- **Судья из базы** (CLI собирается из HEAD^1, на `workflow_dispatch` — из M) — отвергнуто: каждый PR, меняющий правила фабрики (диапазон `kernel`, новый kind check), получал бы красный CI и сливался бы на красном; для 4c нужен разовый обход (в базе нет `warrant ci`); workflow из PR всё равно обходит такую изоляцию.
- **Только остаточный риск в Non-Goals** — отвергнуто: F-1 и F-2 закрываются дёшево из уже нужного `worktreeAt(HEAD^1)`, а судья без policy-пути правится любым `feature` Change.
- **Новый раунд review на каждую правку spec** — отвергнуто: правка `specs/**` делает запись review `STALE` (`spec_tree`), раунды не сходятся (Context).
