# Proposal: phase-2-core-sdd

## Why

Фаза 1 дала kernel: 18 схем, семь команд, resolver и lock. Но pack `core-sdd@0.1` в `main` — заглушка:
`provides.profiles`, `overlays`, `gates`, `checks`, `controller_rules`, `skills` пусты. Ни одна политика не описана, `resolve` на
реальном Change возвращает пустую policy, `classify` не существует, и репозиторий WARRANT сам ведёт `openspec/config.yaml`
руками под временным флагом `--no-generated` (I-43). Пока pack пуст, нельзя ни проверить фазу 1 на настоящих данных, ни начать
фазу 3 (verification): gates и checks там нечем исполнять.

Фаза 2 наполняет pack `core-sdd` policy-данными, добавляет `warrant classify`, делает `config.yaml` полностью генерируемым и
фиксирует состав effective policy трёх profiles golden-snapshot'ами. Решения приняты grilling'ом 2026-09-22 (G-1…G-21,
[NEXT-SESSION](../../../docs/NEXT-SESSION.md)), там же backlog ревью фазы 1 (B1…B6).

## What Changes

- **Pack `core-sdd@0.1.0` наполняется** (G-2, G-4, G-12, G-13, G-14, G-15, G-17, G-21): overlay `core-default` (пустой `match`),
  profiles `feature`, `chore`, `factory-change`, overlays `risk-low`, `risk-medium`, `risk-high`, gates из [04 §5](../../../docs/04-lifecycle.md)
  плюс `factory-golden-passed` (как данные; исполнение — фаза 3), checks `openspec-validate` и `tests-passed` (формат), `controller/rules.json`
  с тремя правилами, skill-stub `sra/skills/specification/adversarial-review/SKILL.md`, `capabilities.forbidden: ["PRODUCTION_WRITE"]`
  у `factory-change`, approvals роли `maintainer` на `SPECIFIED->APPROVED`. Версия pack остаётся `0.1.0` (G-20).
- **Новая команда `warrant classify <change>`** (G-3, G-11): floor rules по diff (`git diff --name-only <base>...HEAD`, `--base`
  по умолчанию `main`, `--paths <file>` без git), `match.paths` profiles, `--propose <json>` от proposer'а; пишет `classification` в change
  record с источником каждого значения; повторный запуск не понижает записанное. Human-источник и понижение ниже floor — фаза 3.
- **`warrant sync` генерирует `config.yaml` целиком** из `openspec/rules.json` pack'а и `.warrant/local/openspec/rules.json`;
  флаг `--no-generated` удаляется из `validate` (G-5). Репозиторий WARRANT переезжает на schema `warrant-sdd`; «Language: Russian»
  переезжает из pack в `.warrant/local/openspec/rules.json` (G-18).
- **Golden** (G-1, G-10): `packs/core-sdd/golden/<profile>/` — три fixture-проекта с change record и `expected/{resolve.json,status.json}`;
  e2e `golden.test.ts` сравнивает `resolve --explain` и `status` с ожидаемым.
- **Kernel-правки по backlog ревью** (G-7, B1, B2, B6): `OVERRIDE_WEAKENS` при сужении `match` overlay или удалении `extends` profile;
  `CONFIG_INVALID` для каталога pack в `.warrant/local/<id>/`, не подключённого в `warrant.json`; сканер ID не считает
  `openspec/changes/archive/**` вторым объявлением ID, объявленного в `openspec/specs/**`.
- **Документы** (G-1, G-2, G-9, G-12, G-17): roadmap 13 §2 (golden как snapshot; `bugfix` → `chore`, `factory-change`), 13 §5
  (waiver и experiment — later), 05 §4 (чужие gates добавляются overlay'ями своих packs), 06 §4 (`worktree-ready` → `branch-isolated`),
  08 §6 (profiles `bugfix`, `refactor`, `experiment` — later). Нового ADR не требуется: решения уже в ADR-0011 и ADR-0013.
- **Dogfooding** (G-8, G-16): change ведётся через `warrant init change` (сделано) и `warrant classify`; AREA `SDD` добавлена в реестр;
  после каждой группы `warrant validate` без флагов на репозитории зелёный.
- CLI `package.json` `0.1.0 → 0.2.0`, git-tag `v0.2.0` в конце фазы (G-20).

## Capabilities

### New Capabilities
- `core-sdd`: содержимое pack `core-sdd@0.1` — состав profiles, overlays, gates, checks, controller rules, skill и golden-fixtures;
  что `resolve` обязан вернуть для каждого profile и уровня risk.

### Modified Capabilities
- `kernel`: новая команда `warrant classify` (источники classification, floor rules по diff, запись в change record); REQ-KRN-021 (`validate`: удаление `--no-generated`; новые находки `OVERRIDE_WEAKENS` и `CONFIG_INVALID`; ID в archive
  не дубликат), REQ-KRN-025 (`sync`: `config.yaml` генерируется целиком, `context` проекта — из `.warrant/local/openspec/rules.json`).

## Non-Goals

- Исполнение gates и checks, `check`, `gate`, `verify`, `analyze`, `transition`, `archive`, `waive`, `ci` — фаза 3.
- `guard`, static deny, словарь capabilities, содержание skill adversarial review — фаза 4.
- Profiles `bugfix`, `refactor`, `experiment`, templates `waiver.md` и `experiment.md` — по failure mode, вне 0.1.
- Human-источник classification, понижение ниже floor с approval — фаза 3.
- Gates чужих packs (`mutation-score`, `rollback-rehearsed`) в overlays core-sdd — их добавляют packs `bdd-tdd` и `data`.
- Правка kernel-схем `major = 1`: состав полей схем не меняется.
- B3, B4, B5 из backlog ревью: quick fix отдельным PR и фаза 3 соответственно.

## Impact

- `packs/core-sdd/**`: новые каталоги `profiles/`, `overlays/`, `gates/`, `checks/`, `controller/`, `golden/`; `pack.json` `provides`;
  `openspec/rules.json` без языка проекта.
- `sra/skills/specification/adversarial-review/SKILL.md` — новый каталог `sra/`.
- `packages/cli/src`: новая команда `classify` (`commands/classify.ts`, `core/classify/`), правки `core/packs/loader.ts`, `core/ids/scan.ts`,
  `core/sync/plan.ts`, `commands/validate.ts`, `bin/warrant.ts`; тесты e2e `classify`, `golden`, обновление `validate`, `sync`.
- Репозиторий: `openspec/config.yaml` (генерируется, schema `warrant-sdd`), `.warrant/local/openspec/rules.json`, `.warrant/local/areas.json`,
  `.warrant/warrant.json` (`roles.maintainer`), lock, `.warrant/changes/phase-2-core-sdd.json` (classification).
- `docs/`: 05, 06, 08, 13, NEXT-SESSION, README.
- **BREAKING** для пользователей `--no-generated`: флаг исчезает; единственный пользователь — этот репозиторий, переезд в той же фазе.
