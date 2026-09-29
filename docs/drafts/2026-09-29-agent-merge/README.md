# Merge агентом и приёмка человеком — индекс черновиков (2026-09-29)

Обязательства судьи, policy и контракта CLI, когда Change проводит агент под своей идентичностью (`homasters`, WS-04). Решения maintainer'а 2026-09-29; вход ADR-0050. Черновики — не норма.

## Уже решено (не гриллить)

- [01-obligations](01-obligations.md) — О-1…О-5: spec одобряет человек; merge impl-PR агентом, где policy не требует человека; класс путей с приёмкой человеком; код 4 / `retryable` в 0.9.0; ревью без attestation — не evidence; следствия для ADR-0049.

## Файлы

- [01-obligations](01-obligations.md) — решения, факты, следствия.

## Порядок grilling

1. Нет: записать ADR-0050 по [01-obligations](01-obligations.md); тот же PR удаляет папку (ADR-0033 п. 12).

## Сквозные вопросы

- WARRANT пассивен: исполнитель Change — внешний потребитель публичного контракта CLI, не часть WARRANT и не pack `core-sdd`.
- Поток — `stabilization` ([docs/handoff/stabilization.md](../../handoff/stabilization.md)).

## Проверенные факты (2026-09-29)

- `core/ci/refs.ts:129-146`, `core/roles.ts:42` — ref `APPROVED` / `MERGED` только от члена роли одобрения, fallback — `maintainer`.
- `gh` в Claude Code — бот `homasters` (`GH_TOKEN`, scopes `repo`, `workflow`), collaborator `write`; spec-PR #106 (`identities`) ждёт merge maintainer'а.
