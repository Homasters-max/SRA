# Proposal: release-path

## Why

Reusable workflow `warrant.yml` при `warrant: v<tag>` ставит CLI голой командой `npm i -g github:Homasters-max/SRA#<tag>` (`warrant.yml:95,140`). Глобальная установка git-зависимости не исполняет `prepare`, поэтому у внешнего проекта нет `dist` и `commander`, и `warrant ci` не стартует (WS-01, регресс BL-52 против ADR-0040 п. 7). Ни один тест этого не видит: `ci.yml` SRA вызывает workflow с `warrant: checkout`, SCN-VER-122 доказан чтением YAML (WS-02). LATTICE из-за этого держит копию job по waiver WAV-2026-002, который истекает 2026-10-13. Цикл 0 фазы стабилизации — [ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 5.

Проверено 2026-09-29 на машине maintainer'а:
- `npm pack "github:Homasters-max/SRA#v0.8.2"` собирает tarball с `dist` за 28 с;
- `npm i -g --prefix <tmp> <tgz>` из этого tarball даёт рабочий `warrant --version` в пустом каталоге.

## What Changes

- `warrant.yml`: CLI для тега ставится двумя шагами — `npm pack "github:Homasters-max/SRA#<tag>"` в `$RUNNER_TEMP` → `npm i -g <tgz>` (ADR-0040 п. 7). `checkout` не меняется.
- Канарейка `.github/workflows/canary.yml`: на push тега `v*` и `workflow_dispatch` вызывает `./.github/workflows/warrant.yml` того же коммита с `warrant: <тег>`. Сломанная поставка краснеет до потребителя.
- e2e: tarball из checkout ставится в изолированный префикс и отвечает `warrant --version` в пустом каталоге — поставка до merge.
- `docs/06 §8` — та же форма установки; REQ-VER-014 — форма установки и branch protection репозитория (R-44).
- `CHANGELOG.md` и проверка в `versions:check` ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3). `warrant.yml` входит в содержимое CLI: его берут по тегу.
- **Версии:** CLI `0.8.3` — patch: вердикт, схемы, JSON и exit-коды не меняются. Pack и skill — без изменений.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `verification`:
  - REQ-VER-014 — установка CLI из тега через tarball, branch protection репозитория; SCN-VER-122 уточнён;
  - REQ-VER-016 — канарейка поставки; SCN-VER-125, SCN-VER-126.

## Non-Goals

- **Автотег workflow'ом** (ADR-0047 п. 4, WS-09) — отдельный Change, чтобы срок 2026-10-13 не зависел от объёма.
- **`identities.agents`** (WS-04) — отдельный Change, ждёт аккаунт бота.
- **Fixture-репозиторий канарейки** — BL-102, по failure mode.
- **Tarball как asset релиза** — `npm pack` из тега в job достаточно; asset — по failure mode.

## Impact

- `.github/workflows/warrant.yml` — шаги «Check the input warrant» и «Install warrant».
- `.github/workflows/canary.yml` — новый.
- `packages/cli/test/unit/meta/workflows.test.ts` — SCN-VER-122, SCN-VER-125.
- `packages/cli/test/e2e/install-tarball.test.ts` — SCN-VER-126.
- `scripts/versions-lib.js`, `packages/cli/test/e2e/versions.test.ts` — CHANGELOG и `warrant.yml` в CLI.
- `CHANGELOG.md` — новый; `packages/cli/test/unit/meta/structure.test.ts` — белый список корня.
- `package.json`, `package-lock.json` — версия `0.8.3`; `warrant sync` и golden — если версия CLI в них видна.
- `docs/06-verification.md` §8.
