## ADDED Requirements

### Requirement: Job test репозитория по shard
<!-- id: REQ-VER-015 -->

Workflow `ci.yml` репозитория WARRANT SHALL гонять полный `npm test` (все уровни, ADR-0025 п. 8) на каждом PR: на `ubuntu-latest`
— одним job, на `windows-latest` — двумя параллельными job `vitest --shard` `1/2` и `2/2`, которые вместе покрывают все файлы тестов.
Имена проверок SHALL быть `test (ubuntu-latest)`, `test (windows-latest, 1/2)`, `test (windows-latest, 2/2)`. Typecheck и
`warrant validate` (репозиторий и фикстура) SHALL выполняться один раз на ОС — в job ubuntu и в shard `1/2`. Обязательные проверки
branch protection `main`, если они настроены, обновляет maintainer.

#### Scenario: Windows по shard
<!-- id: SCN-VER-124 -->
- **WHEN** читается `.github/workflows/ci.yml` репозитория
- **THEN** job `test` — matrix `include` из `ubuntu-latest` с пустым `shard` и `windows-latest` с `shard` `1/2` и `2/2`; имя job включает `matrix.shard`; шаг `Test` передаёт `--shard` в `npm test` из `matrix.shard`; шаги `Typecheck` и `warrant validate (repository)` пропускаются в shard `2/2`
