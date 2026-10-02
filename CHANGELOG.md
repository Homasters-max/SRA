# Changelog

Релизы CLI WARRANT: тег `v<версия>` репозитория `Homasters-max/SRA`. Раздел — на каждую поднятую версию CLI; рост major или minor CLI или pack требует подразделов «Вердикт» и «Миграция для потребителя» ([ADR-0048](docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3). Держит `npm run versions:check`. История до 0.8.3 — теги и `openspec/changes/archive/`.

## 0.10.1

Patch для LATTICE ([ADR-0056](docs/adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md)): пять исправлений одним тегом, `kernel` 0.10 и диапазоны packs прежние. Каждое изменение обратно совместимо на входах 0.10.0: старые файлы валидны, новых кодов выхода нет, новый переход и флаг необязательны.

### Вердикт

- **guard** (#138, Change `guard-worktree`) — не судья: вердикт `warrant ci` он не меняет.
  - Проект и активный Run события берутся по `cwd` события: ближайший checkout под WARRANT (`.warrant/warrant.json` и `.git`), иначе каталог процесса. Раньше — каталог процесса, и в git worktree, чьи хуки исполняются из основного checkout'а, `write_scope` не защищался.
  - Правка пути другого checkout'а под WARRANT (вложенного worktree, объемлющего основного, соседнего) — вне проекта. При активном Run у проекта события или у того checkout'а — `deny`, путь в reason не называется.
- **`analyze-clean` мягче в одном случае** (#141, Change `analyze-open`): `ORPHAN` не даёт SCN, объявленный в `ADDED` / `MODIFIED` delta другого открытого Change (`openspec/changes/<другой>/`, не архив). Gate на commit читает и `openspec/changes`.
- **Id waiver** (#139, Change `waiver-ulid`): `warrant waive` и `warrant id WAV` выдают `WAV-<ULID>`; `WAV-YYYY-NNN` валиден в схеме, `--activate` и `--revoke`.
- **`warrant ci --no-record`** (#143, Change `ci-local`): тот же вердикт, ничего не записано в состоянии WARRANT; `ci fetch` называет остатки каталога evidence (`data.untracked[]`, находка `EVIDENCE_UNTRACKED`) и переписывает manifest, если он расходится с каталогом.
- **`SPECIFIED -> PROPOSED`** (#142, Change `spec-rework`) — переход назад для Change, ни разу не одобренного. После переделки ref `APPROVED` — spec-PR последнего `SPECIFIED`; record без переделки судится, как прежде.

### Миграция для потребителя

- Pin-Change: `warrant` на машине — CLI тега `v0.10.1` (`npm pack github:Homasters-max/SRA#v0.10.1` вне checkout, `npm i -g`), reusable workflow — `@v0.10.1` с `warrant: v0.10.1`. `kernel` в `warrant.json` остаётся `"0.10"`. После установки — `warrant sync`: копия схемы `waiver/1` в `.warrant/schemas/` и lock обновляются.
- guard в worktree-сессии теперь отказывает правке вне `write_scope` и правке файлов основного checkout'а, пока в worktree активен Run. Править основной checkout — из его сессии.
- Новые waivers — `WAV-<ULID>` (слово активации копирует id из тела PR). CLI 0.10.0 такой файл не читает: не смешивать версии.
- Локальный судья перед PR — `warrant ci --no-record`. Записи из `data.untracked[]` `ci fetch` не коммитить: удалить и повторить `ci fetch`.
- Переделка spec до `APPROVED` — `warrant transition <change> PROPOSED`, затем путь spec-PR заново; `APPROVED --ref` — spec-PR переделки.

## 0.10.0 — 2026-10-01

Minor: версия для LATTICE — `exit-contract` и `guard-recovery` ([ADR-0052](docs/adr/WARRANT-ADR-0052-cycle-1-close.md), [ADR-0053](docs/adr/WARRANT-ADR-0053-guard-recovery.md), [ADR-0055](docs/adr/WARRANT-ADR-0055-release-for-lattice.md)); тег — archive-PR `guard-recovery`, `judge-law` и `code-floor` — 0.11.0. `exit-contract`: класс у каждого кода ошибки, код выхода 4 и `retryable` (WS-06, A-42, A-48). `guard-recovery`: guard не запирает сессию, когда policy не грузится; хуки и субагент исполняют CLI, который закрепил проект (ADR-0053 п. 2–3). Pack `core-sdd` 0.4.1.

### Вердикт

- **Не мягче.** Каждый случай, дававший ненулевой код, даёт ненулевой и теперь.
- **Строже — в одном узком случае, ошибкой окружения, а не правилом судьи.** PR без нового перехода `APPROVED` с решением UNKNOWN при неверном `GITHUB_REPOSITORY` или без `origin`: раньше — находка `DECISION_NOT_VERIFIED`, код 0; теперь — `USAGE`, код 3 (REQ-VER-013, SCN-VER-138). Исправление — задать `GITHUB_REPOSITORY` в форме `<owner>/<repo>`.
- **Коды выхода.** У каждого кода ошибки один класс во всех командах: нарушение — 1, ожидание — 2, конфигурация — 3, сбой инфраструктуры — 4 (`BUSY`, `CHECK_TIMEOUT`, `FORGE_UNAVAILABLE`; элемент `errors[]` несёт `retryable: true`). Код выбирается по приоритету `3 > 1 > 4 > 2 > 0`, а не максимумом.
- **Pack.** `core-sdd` 0.4.1 — только диапазон `kernel` `>=0.1 <0.11`.
- **guard** — не судья: вердикт `warrant ci` он не меняет. При policy, которая не грузится, `warrant guard` больше не отвечает `deny` на всё: правка путей проекта по-прежнему `deny`, а правка `.warrant/warrant.json`, `warrant sync|validate|status|--version`, команды без записи и путь вне проекта проходят (режим восстановления).

### Миграция для потребителя

- **Повторять можно только код 4.** Reusable `warrant.yml` и копия job `warrant` красят job и кодом 4; повтор — решение вызывающего (Re-run), CLI сам не повторяет.
- **Изменённые коды:** `BUSY` 2 → 4 (в `ci fetch` 3 → 4); `CHECK_TIMEOUT` и недоступный форж 3 → 4; `fmt --check`, `sync --check`, `validate --files` с находками 1 → 3; `TOPOLOGY_VIOLATION` в `ci fetch` 3 → 1; сбой check вместе с нарушением PR или `STOP` — 1 вместо 3; `POLICY_CONFLICT` effective policy базы в `warrant ci` 3 → 2; в `warrant ci` gate, оставшийся `BLOCKED` из-за ошибки check, больше не даёт `GATE_NOT_PASSED`; непредвиденное исключение — `INTERNAL`, код 3, вместо аварийного выхода Node с кодом 1 (`warrant guard` — `deny` с кодом 0, `--frontend` — код 2).
- **Новые коды ошибок:** `FORGE_ACCESS` (3) — `gh` не найден, не авторизован (нет токена — выход `gh` 4, HTTP 401) или HTTP 403 без лимита, вместо `FORGE_UNAVAILABLE`; `PACK_VERSION_RANGE` (3) — версия pack вне диапазона `warrant.json`, вместо `CONFIG_INVALID`. Неверный `GITHUB_REPOSITORY` или `origin` не на форже — `USAGE` вместо `FORGE_UNAVAILABLE`.
- **CLI на машине — из тега, не `npm link`:** `npm pack github:Homasters-max/SRA#v0.10.0` вне checkout, затем `npm i -g ./warrant-0.10.0.tgz`; ставит maintainer, вне сессии агента.
- **Порядок перехода — закрепление, затем CLI:** `kernel: "0.10"` и диапазоны packs (`core-sdd` `^0.4.0`: caret `^0.3` не пускает `0.4`), `warrant sync`, затем CLI. С CLI ≥ 0.10 обратный порядок не запирает сессию: отказ guard называет версии CLI, pack, диапазон и выход.
- **Поле `cli`** (необязательно): Node-проект может закрепить CLI локально (`"cli": "node_modules/warrant/packages/cli/dist/bin/warrant.js"`). После `warrant sync` хуки `.claude/settings.json` и субагент `warrant-reviewer` исполняют `node "${CLAUDE_PROJECT_DIR:-.}/<cli>" guard --frontend claude`, а не `warrant` из PATH; нет файла — находка `CLI_NOT_FOUND`. Без `cli` команда хука прежняя. Поле — только с CLI машины ≥ 0.10. После `sync`, изменившего хуки, — перезапуск сессии Claude Code (`FRONTEND_RESTART_REQUIRED`).
- **`PACK_VERSION_RANGE`** встроенного pack называет версию CLI, а `hint` — выход по направлению: поднять диапазон или поставить закреплённый CLI.
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
