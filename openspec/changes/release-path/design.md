# Design: release-path

## Context

База — `main` после PR #101, #102 (ADR-0048, ADR-0049). Change не трогает `packages/cli/src`: только workflow, тесты, dev-скрипт версий и документы — архитектурный аудит не нужен.

Что уже есть:
- `warrant.yml`, шаг «Check the input warrant» пишет `package=github:Homasters-max/SRA#<tag>` или `package=.`; шаг «Install warrant» — `npm i -g "$WARRANT_PACKAGE"`;
- `ci.yml` вызывает его с `warrant: checkout` — форма тега в SRA не исполняется;
- `package-contents.test.ts` проверяет список файлов `npm pack --dry-run`, но не установку;
- `versions-lib.js` (R-14): CLI — `packages/cli/src`, `schemas`, `packages/cli/package.json`, `scripts/build.js`, поставляемые поля `package.json`.

Проверено 2026-09-29: `npm pack "github:Homasters-max/SRA#v0.8.2"` — 28 с, tarball с `dist`; `npm i -g --prefix <tmp> <tgz> --prefer-offline` — 11 с; `warrant --version` в пустом каталоге — `0.8.2`.

Нормы: ADR-0040 п. 7 (форма установки), ADR-0048 п. 3 (CHANGELOG), п. 5 (состав Change), ADR-0025 (e2e — процессы с причиной, 60 с на тест).

## Goals / Non-Goals

**Goals:**
- `warrant: v<tag>` ставит рабочий CLI у внешнего проекта;
- сломанная поставка краснеет до потребителя: до merge — e2e tarball, после тега — канарейка.

**Non-Goals:** — proposal, раздел Non-Goals.

## Decisions

### 1. Решения

| # | Решение |
|---|---|
| D1 | Шаг «Check the input warrant» пишет `kind=tag` и `tag=<tag>` или `kind=checkout`. Шаг «Install warrant»: для тега — `mkdir "$RUNNER_TEMP/warrant-pack" && cd` туда (вне checkout: `.npmrc` проекта не действует), `npm pack "github:Homasters-max/SRA#$TAG" --ignore-scripts=false` (явный флаг перекрывает `ignore-scripts` из user-конфигурации, которую мог выставить `setup`), затем `npm i -g ./*.tgz`; для `checkout` — `npm i -g .`, как раньше. Отказ `npm pack` / `npm i` — шаг красный до `warrant ci`, лог npm называет тег |
| D2 | Канарейка вызывает `./.github/workflows/warrant.yml`: на push тега и на `workflow_dispatch --ref <тег>` это файл того же коммита, то есть поставляемый workflow. `uses:` не принимает выражений, поэтому `…/warrant.yml@${{ tag }}` невозможен. Job — `if: startsWith(github.ref, 'refs/tags/v')`: запуск с ветки пропускается, а не краснеет на входе |
| D3 | Тег релиза стоит на merge-коммите archive-PR (шаг 6 `change-archive-pr`; так же — будущий автотег, ADR-0047 п. 4). На нём событие не `pull_request`, шаг merge пропускается, `warrant ci` судит двухродительский коммит как archive-PR — как в CI самого archive-PR. Теги v0.8.0–v0.8.2 стоят так же (проверяется в archive-PR, A-1 review). Сигнал разводится по шагам: красная установка — поставка сломана, patch; красный `warrant ci` — строка backlog. Первый прогон — тег `v0.8.3` в archive-PR этого Change |
| D4 | До merge поставку исполняет e2e SCN-VER-126: `npm pack --ignore-scripts` checkout'а (сборку делает `npm test` до vitest), `npm i -g --prefix <tmp> --prefer-offline`, в пустом каталоге `warrant --version` и `warrant validate` — последний загружает команду, её модули `dist` и зависимости (`--version` читает только `package.json`, устаревший `dist` он не поймал бы). Форму `github:#tag` e2e не исполняет — нужен тег; её держит канарейка. Замер: установка 11 с, предел e2e — 60 с |
| D5 | ADR-0048 п. 5: «SCN-VER-122 переводится на канарейку; текстовая проверка YAML остаётся дешёвой, но не доказательством». Намерение — доказательство поставки исполнением, а не чтением. Прогон workflow — не test-report, и SCN им не доказывается, поэтому доказательство поставки переходит к исполняемым SCN-VER-126 (до merge) и SCN-VER-125 с прогоном канарейки (после тега); SCN-VER-122 остаётся дешёвой проверкой структуры YAML, как ADR и разрешает. Отступления от ADR нет |
| D6 | `CHANGELOG.md` в корне: раздел `## <версия CLI> — <дата>`. Если версия CLI выросла с тега, раздел есть. Если выросли major или minor CLI или любого pack — в разделе есть `### Вердикт` и `### Миграция для потребителя`. Иначе ошибка `versions:check`, компонент `changelog` |
| D7 | `.github/workflows/warrant.yml` — содержимое CLI в `versions-lib.js`: потребитель берёт его по тегу (`uses: …@v<tag>`), правка без bump не выйдет |
| D8 | R-44 закрывается здесь: REQ-VER-014 правится этим Change, фраза «в этом репозитории branch protection вне MVP» устарела. Новая — «WARRANT их не требует»; показ настроек форжа — класс C модели угроз (ADR-0048 п. 2), цикл 1 |
| D9 | Исполнитель `workflow_dispatch` канарейки: до автотега тег ставит сессия push'ем — канарейку запускает push; Change автотега (ADR-0047 п. 4) SHALL звать `gh workflow run canary.yml --ref <тег>` — строка WS-09 |

### 2. Группы

1. Установка из тега (D1, D4, D8): `warrant.yml`; `workflows.test.ts` SCN-VER-122; e2e `install-tarball.test.ts` SCN-VER-126; `docs/06 §8`.
2. Канарейка (D2, D3): `canary.yml`; `workflows.test.ts` SCN-VER-125.
3. CHANGELOG и версия (D6, D7): `CHANGELOG.md`, `versions-lib.js`, `versions.test.ts`, `structure.test.ts`, `0.8.3`, `warrant sync`, golden.

## Risks / Trade-offs

- **e2e с `npm i` зависит от реестра npm.** `--prefer-offline` берёт кэш `npm ci` job'а; сбой сети — инфраструктура, повтор run.
- **Канарейка на теге судит коммит тега** (D3). Если `warrant ci` на push-событии поведёт себя иначе, чем на archive-PR, канарейка покраснеет не по поставке. Первый прогон — в archive-PR; расхождение — строка backlog.
