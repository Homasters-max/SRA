# Changelog

Релизы CLI WARRANT: тег `v<версия>` репозитория `Homasters-max/SRA`. Раздел — на каждую поднятую версию CLI; рост major или minor CLI или pack требует подразделов «Вердикт» и «Миграция для потребителя» ([ADR-0048](docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3). Держит `npm run versions:check`. История до 0.8.3 — теги и `openspec/changes/archive/`.

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
