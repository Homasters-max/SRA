## ADDED Requirements

### Requirement: Job test репозитория по shard
<!-- id: REQ-VER-015 -->

Workflow `ci.yml` репозитория WARRANT SHALL на каждом PR гонять все файлы тестов всех уровней (ADR-0025 п. 8) в matrix job `test`
со `strategy.fail-fast: false`: на `ubuntu-latest` — одним job без `--shard`, на `windows-latest` — двумя параллельными job
`vitest --shard` `1/2` и `2/2`, вместе покрывающими все файлы. Имена проверок SHALL быть ровно `test (ubuntu-latest)`,
`test (windows-latest, 1/2)`, `test (windows-latest, 2/2)`. Typecheck, установка CLI из checkout и `warrant validate` (репозиторий
и фикстура) SHALL выполняться один раз на ОС — в job ubuntu и в shard `1/2`. Job `test` — сигнал разработки, не evidence: gate
`tests-passed` получает evidence от полного `npm test`, который check `tests-passed` запускает в job `warrant`
([REQ-VER-011](#requirement-команда-ci)); shard его не сужают. Обязательные проверки branch protection `main` — настройка репозитория
вне WARRANT (REQ-VER-014): при смене имён проверок их обновляет maintainer.

#### Scenario: Windows по shard
<!-- id: SCN-VER-124 -->
- **WHEN** читается `.github/workflows/ci.yml` репозитория
- **THEN** job `test` — `strategy.fail-fast: false`, matrix `include` ровно из `ubuntu-latest` с пустым `shard`, `windows-latest` с `shard` `1/2` и `windows-latest` с `shard` `2/2`; имя job — `test (${{ matrix.os }})` с `, <shard>` только при непустом `shard`; шаг `Test` передаёт `--shard=<shard>` в `npm test` только при непустом `shard`; шаги `Typecheck`, `Install warrant from the checkout`, `warrant validate (repository)` и `warrant validate (fixture project)` пропускаются в shard `2/2`
