# Changelog

Релизы CLI WARRANT: тег `v<версия>` репозитория `Homasters-max/SRA`. Раздел — на каждую поднятую версию CLI; рост major или minor CLI или pack требует подразделов «Вердикт» и «Миграция для потребителя» ([ADR-0048](docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3). Держит `npm run versions:check`. История до 0.8.3 — теги и `openspec/changes/archive/`.

## 0.10.0 — не выпущена

Minor: версия для LATTICE — `exit-contract` и `guard-recovery` ([ADR-0052](docs/adr/WARRANT-ADR-0052-cycle-1-close.md), [ADR-0053](docs/adr/WARRANT-ADR-0053-guard-recovery.md), [ADR-0055](docs/adr/WARRANT-ADR-0055-release-for-lattice.md)); тег — archive-PR `guard-recovery`, `judge-law` и `code-floor` — 0.11.0. `exit-contract`: класс у каждого кода ошибки, код выхода 4 и `retryable` (WS-06, A-42, A-48). Pack `core-sdd` 0.4.1.

### Вердикт

- **Не мягче.** Каждый случай, дававший ненулевой код, даёт ненулевой и теперь.
- **Строже — в одном узком случае, ошибкой окружения, а не правилом судьи.** PR без нового перехода `APPROVED` с решением UNKNOWN при неверном `GITHUB_REPOSITORY` или без `origin`: раньше — находка `DECISION_NOT_VERIFIED`, код 0; теперь — `USAGE`, код 3 (REQ-VER-013, SCN-VER-138). Исправление — задать `GITHUB_REPOSITORY` в форме `<owner>/<repo>`.
- **Коды выхода.** У каждого кода ошибки один класс во всех командах: нарушение — 1, ожидание — 2, конфигурация — 3, сбой инфраструктуры — 4 (`BUSY`, `CHECK_TIMEOUT`, `FORGE_UNAVAILABLE`; элемент `errors[]` несёт `retryable: true`). Код выбирается по приоритету `3 > 1 > 4 > 2 > 0`, а не максимумом.
- **Pack.** `core-sdd` 0.4.1 — только диапазон `kernel` `>=0.1 <0.11`.

### Миграция для потребителя

- **Повторять можно только код 4.** Reusable `warrant.yml` и копия job `warrant` красят job и кодом 4; повтор — решение вызывающего (Re-run), CLI сам не повторяет.
- **Изменённые коды:** `BUSY` 2 → 4 (в `ci fetch` 3 → 4); `CHECK_TIMEOUT` и недоступный форж 3 → 4; `fmt --check`, `sync --check`, `validate --files` с находками 1 → 3; `TOPOLOGY_VIOLATION` в `ci fetch` 3 → 1; сбой check вместе с нарушением PR или `STOP` — 1 вместо 3; `POLICY_CONFLICT` effective policy базы в `warrant ci` 3 → 2; в `warrant ci` gate, оставшийся `BLOCKED` из-за ошибки check, больше не даёт `GATE_NOT_PASSED`; непредвиденное исключение — `INTERNAL`, код 3, вместо аварийного выхода Node с кодом 1 (`warrant guard` — `deny` с кодом 0, `--frontend` — код 2).
- **Новые коды ошибок:** `FORGE_ACCESS` (3) — `gh` не найден, не авторизован (нет токена — выход `gh` 4, HTTP 401) или HTTP 403 без лимита, вместо `FORGE_UNAVAILABLE`; `PACK_VERSION_RANGE` (3) — версия pack вне диапазона `warrant.json`, вместо `CONFIG_INVALID`. Неверный `GITHUB_REPOSITORY` или `origin` не на форже — `USAGE` вместо `FORGE_UNAVAILABLE`.
- Пин — после тега `v0.10.0`: `.warrant/warrant.json` — `kernel: "0.10"`, затем `warrant sync` (lock несёт `kernel`); навык `warrant-upgrade`.

## 0.9.0 — 2026-10-01

Minor: impl-PR может сливать агент там, где policy не требует человека ([ADR-0050](docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 2–3, [ADR-0051](docs/adr/WARRANT-ADR-0051-agent-merge-first.md)). Pack `core-sdd` 0.4.0.

### Вердикт

- **Строже.** `warrant ci` проверяет основание записанных `WAIVED` (засчитываемый waiver на дату прогона) и `NOT_APPLICABLE` (`applies_when` на diff impl-PR или записи `NOT_APPLICABLE` от check) — `RECORD_MISMATCH` `waiver` / `not_applicable` (WS-03). PR без Change с правкой `paths.src` или `paths.tests` — `SCOPE_VIOLATION` (WS-14). Reusable workflow `warrant.yml` выполняет `warrant validate` и `warrant sync --check` до `warrant ci` (WS-13).
- **Мягче.** Ref `MERGED` засчитывает merge impl-PR членом `roles` или агентом из `identities.agents`, в том числе автором PR, если effective policy базы impl-PR не требует `human-approval` на `VERIFYING->MERGED`, а реализация влита одним impl-PR. Иначе — как раньше (fail-closed, находка `AGENT_MERGE_CLOSED`).
- **Pack.** `risk-high` 2.0.0 больше не добавляет `human-approval` и approval на `VERIFYING->MERGED`: приёмку человеком задаёт профиль путей проекта. Без него `warrant ci` выдаёт находку `NO_HUMAN_ACCEPTANCE`.

### Миграция для потребителя

- **Профиль приёмки человеком.** Иначе HIGH больше не зовёт человека. Положить `.warrant/local/profiles/human-acceptance.json` (`warrant://profile/1`): `match.paths` — код, чья правка меняет проверку (policy `.warrant/warrant.json`, `.warrant/local/**`, `.warrant/waivers/**`, workflows, защита агента), `gates: {"VERIFYING->MERGED": ["human-approval"]}`, `approvals: [{"role": "maintainer", "at": "VERIFYING->MERGED"}]`. Образец — `.warrant/local/profiles/human-acceptance.json` репозитория WARRANT.
- **Форж.** `.github/CODEOWNERS` на те же пути и в защите основной ветки — «Require review from Code Owners» и обязательная проверка `warrant / warrant`: бот не сольёт PR с этими путями. PR этих путей maintainer сливает сам — auto-merge, включённый ботом, пишет `merged_by` бота.
- **`paths.src` и `paths.tests`** в `.warrant/warrant.json`: без них WS-14 не действует; с ними правка кода и тестов без Change краснеет.
- **`validate` и `sync --check`** должны быть зелёными до перехода: дрейф сгенерированных файлов и lock теперь красит job `warrant`.
- **Смена pack или `kernel`** между merge impl-PR и archive-PR закрывает merge агентом (fail-closed): такой impl-PR сливает maintainer.
- Пин: `uses: Homasters-max/SRA/.github/workflows/warrant.yml@v0.9.0` с `warrant: v0.9.0`; `.warrant/warrant.json` — `kernel: "0.9"`, `core-sdd` — `^0.4.0`; затем `warrant sync`.

## 0.8.3 — 2026-09-29

Patch: вердикт, схемы, JSON и коды выхода не меняются.

- **Установка CLI из тега в reusable workflow `warrant.yml` исправлена** (WS-01). `warrant: v<tag>` ставил CLI командой `npm i -g github:…#<tag>`, у которой нет `dist` и зависимостей. Теперь — tarball тега: `npm pack` вне checkout, затем `npm i -g <tgz>`. С `v0.8.2` и раньше reusable workflow у внешнего проекта не запускал `warrant ci`.
- **Канарейка поставки** `.github/workflows/canary.yml`: на теге `v*` вызывает поставляемый `warrant.yml` с CLI этого тега (REQ-VER-016).
- Миграция для проекта на копии job `warrant`:
  - заменить копию на `uses: Homasters-max/SRA/.github/workflows/warrant.yml@v0.8.3` с `warrant: v0.8.3` ([06 §8](docs/06-verification.md));
  - обновить имя обязательной проверки на `warrant / warrant`.
