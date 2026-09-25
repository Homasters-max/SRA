---
id: WARRANT-ADR-0011
title: Топология PR — два PR на Change, archive отдельно, транзиции в следующем PR
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amended_by: [WARRANT-ADR-0020, WARRANT-ADR-0033, WARRANT-ADR-0034]
---

> Уточнено [ADR-0034](WARRANT-ADR-0034-phase-4-frontend.md): `warrant ci` выводит Change и переход из diff record, а не из имени ветки; правка
> `openspec/specs/**` допустима только вместе с переходом `MERGED → ARCHIVED` (п. 13, R-16). Evidence impl-PR
> считается на merge ref и привязан к дереву результата merge `subject.tree` (п. 12, R-12).

> Уточнено [ADR-0020](WARRANT-ADR-0020-warrant-sef-boundary.md): этот ADR — транспорт `github` абстрактной топологии Change;
> второй транспорт — `sef-hub` (proposed). MVP — `github` без изменений.
>
> Уточнено [ADR-0033](WARRANT-ADR-0033-git-process.md) для разработки самого WARRANT: branch protection на приватном
> репозитории бесплатного плана нет — review принуждает процесс, merge решает человек, а выполняет агент по слову
> «merge #N» в чате (п. 3, Consequences); squash и rebase выключены в настройках репозитория.

## Context

[04 §5](../04-lifecycle.md) говорил «propose / specify → main», [04 §8](../04-lifecycle.md) — «approval фиксируется
через PR review». Одновременно это невозможно: если spec коммитится в `main`, PR для approval нет.
INV-01 (spec раньше implementation) должен быть проверяем в CI, а не только декларирован.
Spike S2 показал, что `openspec archive` не проверяет граф artifacts и архивирует пустой Change с exit 0.

## Decision

1. **Два PR на Change плюс archive.**
   - `spec/<change>` → PR → human review = `SPECIFIED → APPROVED` → merge в `main`.
   - `worktree/<change>` → PR → CI gates → merge = `VERIFYING → MERGED`.
   - `archive/<change>` → маленький PR (или прямой push, если `main` это допускает) = `MERGED → ARCHIVED`.
   INV-01 проверяется механически: impl-PR валиден, только если в base уже есть merged spec-PR с approving review.
2. **Имя ветки = mapping PR → Change.** CI выводит Change из префикса ветки и требует, чтобы diff касался
   ровно одного `.warrant/changes/<change>.json`. Три вида PR → три набора gates.
3. **Транзиции record едут в следующем PR.** Spec-PR несёт `PROPOSED → SPECIFIED`. Impl-PR первым коммитом несёт
   `SPECIFIED → APPROVED` (ref: review в spec-PR) и `APPROVED → IMPLEMENTING`, последним — `→ VERIFYING`.
   Archive-PR несёт `VERIFYING → MERGED` (ref: merge impl-PR + CI run) и `MERGED → ARCHIVED` вместе с результатом
   `openspec archive`. Ни одного коммита в `main` вне PR. Между PR `warrant status` показывает `STALE` — это штатно.
4. **`warrant archive` оборачивает `openspec archive`.** Порядок: `openspec validate <change> --strict --json` →
   gates `MERGED → ARCHIVED` (`spec-valid`, `required-artifacts-present`, `analyze-clean`) → `openspec archive --yes --json`.
   Прямой вызов `openspec archive` агентом запрещён frontend'ом и обнаруживается как `STALE` без транзиции.
5. **«На main» в 04 §5 означает контекст, а не commit target:** ветка создаётся от актуального `main`, чтобы агент
   видел все authoritative specs и другие changes.
6. **Worktree — SHOULD, отдельная ветка — MUST.** Gate `worktree-ready` заменён на `branch-isolated`: CI не видит
   worktree, только ветку.

## Consequences

- `scope-valid` impl-PR запрещает `openspec/specs/**`: правки specs появляются только через archive.
- `human-approval` на spec-PR принуждается branch protection (required review от команды maintainers,
  CODEOWNERS на `openspec/**`); CI-check на spec-PR считает все gates перехода, кроме `human-approval`;
  evidence `human-approval` создаёт локальный CLI после merge из review API.
- Capabilities: `GIT_PUSH` и `OPEN_PR` выдаются Spec author и Implementer, ограниченные ветками
  `spec/<change>` и `worktree/<change>`; `MERGE` и push в `main` — никому. Принуждение — права GitHub App и branch
  protection, hook только дублирует.
- Одна команда для CI — `warrant ci`: выводит Change и переход из ветки, пересчитывает L0 / L1, верифицирует refs,
  печатает JSON, exit 1 при `FAIL`. Workflow — обёртка в 15 строк.

## Alternatives

- **Один PR на всё** — отвергнуто: spec и код одобряются одним махом, INV-01 не проверяем.
- **Spec в main без PR, approval CLI-командой человека** — отвергнуто: неотличимо от действий агента (ADR-0009).
- **Archive внутри impl-PR** — отвергнуто: `scope-valid` пришлось бы доказывать, что правка specs равна результату
  `openspec archive`.
