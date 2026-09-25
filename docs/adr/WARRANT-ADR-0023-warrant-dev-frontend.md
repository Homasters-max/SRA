---
id: WARRANT-ADR-0023
title: Frontend разработки самого WARRANT — сессии Claude Code без guard; защита — топология PR, review, CI, validate
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: [WARRANT-ADR-0018]
amended_by: [WARRANT-ADR-0034]
---

> Уточнено [ADR-0034](WARRANT-ADR-0034-phase-4-frontend.md): п. 4 исполнен — адаптер `claude` в фазе 4 без ожидания S8. П. 1 действует: guard на
> самом репозитории WARRANT — после пройденного slice MVP (п. 4).

## Context

[12 §7](../12-evolution.md) фиксировал два расхождения нормы и практики на самом репозитории WARRANT:

- **Кто пишет код.** Норма: код в MVP пишет Codex под hooks, сессии Claude — только spec и tasks вместе с человеком
  ([ADR-0018](WARRANT-ADR-0018-frontend-adapters.md) п. 7, [ADR-0020](WARRANT-ADR-0020-warrant-sef-boundary.md) п. 4).
  Практика: фазы 1–2 целиком написаны в Claude Code — координатор и субагенты на группу задач; фаза 3 идёт так же.
- **Топология.** Норма: два PR на Change плюс archive ([ADR-0011](WARRANT-ADR-0011-pr-topology.md)). Практика фаз 1–2:
  одна ветка `feature/<change>`, один merge, CI нет.

Адаптера `codex` ещё нет (фаза 4), spike S8 о hooks Codex не закрыт ([13 §3](../13-roadmap.md)). Держать норму,
которую репозиторий заведомо не исполняет, значит каждой следующей сессии открывать расхождение заново.

## Decision

1. **Код репозитория WARRANT в MVP пишут сессии Claude Code** — координатор и субагенты — без `warrant guard`.
   Hooks и адаптера для них нет; запрет до действия не обещается.
2. **Защита — после действия и вне агента:** топология PR [ADR-0011](WARRANT-ADR-0011-pr-topology.md) (spec-PR →
   impl-PR → archive-PR, одна ветка — один worktree), human review каждого PR, CI-матрица ubuntu + windows
   (`npm test`, `typecheck`, `warrant validate`) и `warrant validate` на репозитории после каждой группы задач.
   Evidence перехода `VERIFYING → MERGED` производит CI (attestation `ci`, [06a §3](../06a-evidence.md)).
3. **Сфера нормы ADR-0018 п. 7 и ADR-0020 п. 4** — проекты под WARRANT и vertical slice MVP ([13 §1](../13-roadmap.md)):
   там код пишет Codex под hooks и CI. Разработка самого WARRANT под эту норму не подпадает.
4. **Адаптер `claude`** — кандидат фазы 4 по итогам spike S8: если hooks Codex окажутся непригодны или сессии Claude
   останутся основным исполнителем, адаптер `claude` переносится из фазы 7. До решения по S8 — later.

## Consequences

- 12 §7: строки «кто пишет код» и «два PR на Change» закрыты — первая этим решением, вторая практикой фазы 3
  (`spec/phase-3-verification` → `worktree/phase-3-verification` → archive-PR) и CI-матрицей.
- ADR-0018 п. 7 не меняется по смыслу для проектов под WARRANT; уточняется его сфера (п. 3).
- Предел INV-07 для репозитория WARRANT виден явно: запись агента вне задачи не предотвращается, а обнаруживается
  на review и в CI.
- Критерий выхода MVP ([13 §2](../13-roadmap.md), фаза 4) не меняется: slice проходит Codex, а не Claude.

## Alternatives

- **Подтянуть практику: код WARRANT пишет Codex уже в фазе 3** — отвергнуто: адаптера `codex` нет до фазы 4, S8 не
  закрыт; Codex без hooks защищён не лучше Claude без hooks, а переход ломает рабочий цикл фаз 1–2.
- **Адаптер `claude` в фазе 3** — отвергнуто: фаза 3 — verification; frontend — фаза 4, и выбор между `claude` и
  `codex` зависит от S8.
- **Оставить расхождение в 12 §7 без ADR** — отвергнуто: 12 §7 требует, чтобы исполненное решение уходило в ADR.
