## MODIFIED Requirements

### Requirement: Reusable workflow job warrant
<!-- id: REQ-VER-014 -->

WARRANT SHALL поставлять job `warrant` ([REQ-VER-011](#requirement-команда-ci)) как reusable workflow
`.github/workflows/warrant.yml` своего репозитория с триггером `workflow_call` ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 7).
Входы: `warrant` — обязательный: тег CLI (`v<semver>`), который устанавливается глобально из tarball этого тега — `npm pack
"github:Homasters-max/SRA#<тег>" --ignore-scripts=false` в каталоге вне checkout вызывающего (временный каталог runner'а: `.npmrc`
проекта не отключает сборку `prepare`), затем `npm i -g` файла tarball (глобальная установка git-зависимости не исполняет
`prepare` и не собирает CLI — BL-52, [ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 7); тега нет, сборка
или реестр npm отказали — шаг установки падает до `warrant ci`, или буквально
`checkout` — CLI из checkout вызывающего, только если checkout — репозиторий WARRANT (`packages/cli/package.json` с именем пакета
CLI; design I-208); другое значение или `checkout` в чужом репозитории SHALL останавливать job до `warrant ci` с ошибкой шага,
называющей допустимые значения; `setup` — команды подготовки проекта (bash, default пусто), выполняемые после
checkout и merge PR в tip базы; `node-version` (default `22`); `openspec-version` (default `1.13.1`); `merge_commit` — merge-коммит
impl-PR для recovery-прогона ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 4, default пусто).
Шаги SHALL быть шагами job `warrant`: checkout head PR (или `merge_commit`) с полной историей, merge в tip базы (кроме recovery),
`setup`, OpenSpec, CLI, `warrant ci` с выводом вне checkout, upload artifact по `data.artifact`. Секретов workflow SHALL NOT
требовать: токен — `github.token` вызывающего; вызывающий SHALL дать job права `contents: read`, `actions: read`,
`pull-requests: read`, `issues: read` (форж `warrant ci`). Тег CLI во входе `warrant` и ref, по которому вызван workflow, выбирает
вызывающий; пример 06 §8 даёт один тег в обоих местах. Workflow `ci.yml` этого репозитория SHALL вызывать job `warrant` через
него с `warrant: checkout` (один источник); проект под WARRANT вызывает его по тегу CLI вместо копии job. Имя проверки в GitHub
становится `warrant / warrant`: обязательные проверки branch protection настраивает maintainer проекта; WARRANT их не требует
(показ настроек форжа — класс C модели угроз, [ADR-0048](../../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2, цикл 1; 06 §8).

#### Scenario: Job warrant из reusable workflow
<!-- id: SCN-VER-122 -->
- **WHEN** читаются `.github/workflows/warrant.yml` и `.github/workflows/ci.yml` репозитория
- **THEN** `warrant.yml` объявляет `workflow_call` со входами `setup`, `node-version`, `openspec-version`, `warrant` (обязательный), `merge_commit`, шаг проверки входа `warrant` до установки CLI и шаг `warrant ci`; для тега CLI ставится `npm pack "github:Homasters-max/SRA#<тег>" --ignore-scripts=false` в каталоге под `$RUNNER_TEMP` и `npm i -g` файла `.tgz`, установки `npm i -g github:` нет; job `warrant` в `ci.yml` — `uses: ./.github/workflows/warrant.yml` с `warrant: checkout`, без собственных `steps`, с правами `contents`, `actions`, `pull-requests`, `issues` на чтение; `merge_commit` передаётся из входа `workflow_dispatch`

## ADDED Requirements

### Requirement: Канарейка поставки
<!-- id: REQ-VER-016 -->

Репозиторий WARRANT SHALL исполнять поставку так, как её получает потребитель ([ADR-0048](../../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 5, WS-02).
До merge: e2e SHALL ставить tarball `npm pack` checkout'а глобально в изолированный префикс и вызывать установленный CLI в
пустом каталоге вне репозитория — зависимости и `dist` приходят только из tarball; вызов SHALL загружать команду (`warrant
validate`), а не только печатать версию. После тега: workflow `.github/workflows/canary.yml` SHALL на push тега `v*` и на
`workflow_dispatch` вызывать reusable workflow того же коммита (`uses: ./.github/workflows/warrant.yml`) с `warrant: ${{
github.ref_name }}` и правами `contents`, `actions`, `pull-requests`, `issues` на чтение, без собственных `steps`; запуск не с
тега `v*` job SHALL пропускать. Тег релиза стоит на merge-коммите archive-PR релиза (шаг тега навыка `change-archive-pr`,
[ADR-0047](../../../../docs/adr/WARRANT-ADR-0047-pr-cycle.md) п. 4): на нём `warrant ci` судит archive-PR, как в его CI. Тег ставит
сессия push'ем — канарейку запускает push; тег, поставленный workflow с `GITHUB_TOKEN`, push-событий не порождает — тот
workflow SHALL запускать `gh workflow run canary.yml --ref <тег>`. Красная канарейка — не evidence и не gate: упал шаг установки
CLI — поставка сломана, patch до потребителя; упал `warrant ci` — суждение на коммите тега, строка backlog.

#### Scenario: Канарейка на теге
<!-- id: SCN-VER-125 -->
- **WHEN** читается `.github/workflows/canary.yml` репозитория
- **THEN** триггеры — `push` с `tags: ["v*"]` и `workflow_dispatch`; единственный job — `if: startsWith(github.ref, 'refs/tags/v')`, `uses: ./.github/workflows/warrant.yml` с `warrant: ${{ github.ref_name }}`, без собственных `steps`, с правами `contents`, `actions`, `pull-requests`, `issues` на чтение

#### Scenario: CLI из tarball вне репозитория
<!-- id: SCN-VER-126 -->
- **WHEN** tarball `npm pack` checkout'а WARRANT установлен `npm i -g --prefix <временный каталог>`, и установленный CLI вызван в пустом временном каталоге: `warrant --version`, затем `warrant validate`
- **THEN** `--version` — код 0 и версия из `package.json` репозитория; `validate` — JSON-ответ `command: "validate"`, `ok: false`, ошибка `CONFIG_MISSING`
