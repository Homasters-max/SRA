# WARRANT ADR

Решения, принятые при проектировании самой системы WARRANT.

| ADR | Решение | adr_state |
|---|---|---|
| [0001](WARRANT-ADR-0001-openspec-kernel.md) | OpenSpec — specification lifecycle kernel | ACCEPTED |
| [0002](WARRANT-ADR-0002-kernel-and-packs.md) | Модель Kernel + Packs | ACCEPTED |
| [0003](WARRANT-ADR-0003-vocabulary-axes.md) | Шесть маркеров, раздельные оси статусов | ACCEPTED |
| [0004](WARRANT-ADR-0004-stable-ids.md) | Stable ID через HTML-комментарии | ACCEPTED (S1 закрыт) |
| [0005](WARRANT-ADR-0005-enforcement.md) | Enforcement в CLI и CI | ACCEPTED |
| [0006](WARRANT-ADR-0006-json-conventions.md) | JSON-конвенции, язык, комментарии | ACCEPTED |
| [0007](WARRANT-ADR-0007-mvp-scope.md) | Объём MVP | ACCEPTED |
| [0008](WARRANT-ADR-0008-naming.md) | Название и границы компонентов | ACCEPTED |
| [0009](WARRANT-ADR-0009-change-record-attestation.md) | Change record и attestation: доверенные писатели состояния | ACCEPTED (уточнён 0010) |
| [0010](WARRANT-ADR-0010-trust-by-reference.md) | Доверие по верифицируемой ссылке; CI не пишет в репозиторий; bot-идентичность агента; форж GitHub | ACCEPTED (уточнён 0020) |
| [0011](WARRANT-ADR-0011-pr-topology.md) | Два PR на Change + archive; транзиции record в следующем PR; `warrant archive` | ACCEPTED (уточнён 0020) |
| [0012](WARRANT-ADR-0012-id-allocation.md) | Выдача ID: NNN immutable с MERGED, ULID для EVID/RUN, реестр AREA | ACCEPTED |
| [0013](WARRANT-ADR-0013-mvp-refinement.md) | Уточнение MVP: sample-проект, TypeScript, агент ведёт slice, core-sdd@0.1 = feature/chore/factory-change | ACCEPTED (уточнён 0018, 0020) |
| [0014](WARRANT-ADR-0014-claude-code-enforcement.md) | Enforcement в Claude Code: static deny + `warrant guard`, review как subagent | ACCEPTED (уточнён 0017, 0018, 0020; адаптер `claude` — later) |
| [0015](WARRANT-ADR-0015-openspec-sync-contract.md) | Контракт `warrant sync` с OpenSpec 1.13.1: что генерируется, schema `warrant-sdd`, что WARRANT читает у OpenSpec (S2, остаток S3) | ACCEPTED |
| [0016](WARRANT-ADR-0016-mutation-diff-scope.md) | Mutation score по diff: формула, порог 0.9, эквивалентные мутанты — частичный waiver, evidence `metrics` | ACCEPTED |
| [0017](WARRANT-ADR-0017-check-execution.md) | `execution` в check: машинный замок `exclusive`, `local` allowed / scoped-only / ci-only, `--paths`, guard по `guard_prefixes` | ACCEPTED (уточнён 0020) |
| [0018](WARRANT-ADR-0018-frontend-adapters.md) | Frontend adapters: нейтральный `warrant guard`, три слоя (ACP client, hooks агента, CI), MVP — Codex в ручном режиме (ACP — S1 SEF, ADR-0020) | ACCEPTED (уточнён 0020, 0022, 0023) |
| [0019](WARRANT-ADR-0019-post-edit-hints.md) | Подсказки после правки: `validate --files`, канал, видимый модели, без блокировки | ACCEPTED (уточнён 0022) |
| [0020](WARRANT-ADR-0020-warrant-sef-boundary.md) | Граница WARRANT и SEF: argv-гейты, транспорты `github` и `sef-hub` (proposed), MVP без фабрики | ACCEPTED (уточнён 0021, 0022, 0024) |
| [0021](WARRANT-ADR-0021-archive-immutability.md) | Неизменность архива (`scope-valid`), связи `amends` / `supersedes` в record, `warrant link`, брошенный Change | ACCEPTED |
| [0022](WARRANT-ADR-0022-path-rules.md) | Правила по путям: JSON `rule/1`, `AGENTS.md`, подсказка при правке, Context Pack; guard без Run → `deny` | ACCEPTED |
| [0023](WARRANT-ADR-0023-warrant-dev-frontend.md) | Frontend разработки самого WARRANT: сессии Claude Code без guard, защита — топология PR, review, CI, `validate`; адаптер `claude` — кандидат фазы 4 по S8 | ACCEPTED |
| [0024](WARRANT-ADR-0024-spec-approved-contract.md) | `spec-approved`: контракт `{proposal.md, specs/**}` без `design.md`, gate waivable — правка контракта после approval снимается waiver'ом maintainer'а | ACCEPTED |

Новый ADR: следующий номер, frontmatter как в существующих, строка в этой таблице.
