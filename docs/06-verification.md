---
id: WARRANT-DOC-06
title: Модель верификации
status: normative
maturity: MVP
version: 0.1.0
---

# 06. Модель верификации

## 1. Уровни

| Уровень | Что | Примеры |
|---|---|---|
| **L0** | Детерминированная policy | Наличие artifacts, валидность конфигурации, scope diff |
| **L1** | Детерминированные tests / checks | Unit, acceptance, data checks, `openspec validate` |
| **L2** | AI review | Adversarial review спецификации, code review |

- L2 MUST NOT отменять `FAIL` на L0 или required `FAIL` на L1 (INV-02).
- L2 — дополнительное evidence, а не замена детерминированной проверки.
- Claim, который можно проверить на L0/L1, MUST NOT считаться `PROVEN` только по L2.

## 2. Check

Check — детерминированная исполняемая проверка. Производит evidence ([06a](06a-evidence.md)).

```json
{
  "$schema": "warrant://check/1",
  "id": "pytest",
  "version": "1.0.0",
  "level": "L1",
  "run": { "command": ["pytest", "--junitxml={out}/junit.xml"] },
  "produces": ["test-report"],
  "parser": "junit"
}
```

- Check MUST быть воспроизводим: одинаковый вход (commit, данные, версии инструментов) → одинаковый результат.
- Check MUST NOT использовать LLM. То, что требует LLM, — skill, а его результат — L2 evidence.
- Проект подключает свои инструменты через `.warrant/local/checks/`.

### Execution

Блок `execution` задаёт, *как* check разрешено запускать ([ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)):

```json
{
  "id": "mutation",
  "run": {
    "command": ["mutmut", "run"],
    "scoped_command": ["mutmut", "run", "{paths}"]
  },
  "execution": {
    "exclusive": true,
    "timeout_s": 3600,
    "local": "scoped-only",
    "max_paths": 5,
    "guard_prefixes": [["mutmut"], ["python", "-m", "mutmut"]]
  }
}
```

| Поле | Default | Правило |
|---|---|---|
| `exclusive` | `false` | Один замок на машину: `$(git rev-parse --git-common-dir)/warrant/check.lock`, общий для процессов и worktree |
| `timeout_s` | `defaults.check_timeout_s`, иначе `1800` | По истечении check прерывается, замок освобождается |
| `local` | `allowed` | `scoped-only` — локально только `--paths`; `ci-only` — локально никакой (later, D-23) |
| `max_paths` | — | Больше путей в `--paths` → код `3` (later, D-23) |
| `guard_prefixes` | первые токены `run.command` до флага или плейсхолдера; у интерпретатора (`node`, `deno`, `bun`, `python`, `python3`, `ruby`) — плюс флаги режима (слова с `-` без `=` и `{`), сверяемые в любом порядке ([ADR-0042](adr/WARRANT-ADR-0042-lattice-fixes.md) п. 3) | По ним `warrant guard` отклоняет прямой запуск; явные префиксы — строго по словам |

- Замок занят → код `2`, `errors[0].code: "BUSY"` с держателем замка; `--wait` ждёт до `timeout_s` (CI; later). Замок мёртвого pid снимается автоматически с записью в журнал Run (later, D-23).
- `warrant check <id> --paths …` запускает `scoped_command`; без значения пути берутся из diff. Evidence суженного прогона несёт `limitations: ["scoped: <paths>"]` и исключается пред-фильтром допустимости (§3).
- Для checks с `exclusive` или `local ≠ allowed` guard отвечает `deny` на Bash-команду с совпавшим префиксом и подсказывает `warrant check`.

### Тест сценария

Тест, который доказывает сценарий, несёт id SCN в своём имени — ссылку формата `SCN-<AREA>-NNN` ([ADR-0012](adr/WARRANT-ADR-0012-id-allocation.md)): `it("SCN-VER-117 …")`. Имя попадает в атрибут `name` элемента `<testcase>` отчёта JUnit, и parser `junit` его читает ([ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 2). Упоминание id только в теле файла теста засчитывает `analyze` (§5, L0), но не parser.

- Пропущенный testcase (`<skipped>`, в том числе `todo`), в имени которого есть ссылка на SCN, делает запись `NOT_PROVEN` с limitation `junit: skipped SCN-…` (id через запятую, в порядке появления, без повторов), даже если остальные тесты прошли: тест сценария нельзя выключить `skip` / `todo` незаметно для gate.
- Статус parser'а `junit`, первое совпадение: падение или ошибка → `NOT_PROVEN`; пропущенный тест сценария → `NOT_PROVEN`; все тесты пропущены (`tests − skipped ≤ 0`) → `INCONCLUSIVE` (R-4, для отчётов без таких имён); иначе `PROVEN`.
- Честный пропуск (платформа, окружение) снимается waiver'ом или тестом без SCN в имени, который зовёт сценарий на своей ОС.

## 3. Gate

Gate — правило перехода; агрегирует evidence в `gate_verdict`.

```json
{
  "$schema": "warrant://gate/1",
  "id": "tests-passed",
  "version": "1.0.0",
  "level": "L1",
  "applies_when": { "changed_paths": ["src/**", "tests/**"] },
  "requires_evidence": [{ "kind": "test-report", "status": "PROVEN" }],
  "waivable": false
}
```

### Требование к check

Элемент `requires_evidence[]` MAY нести `check` — id check ([ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 6). Такое требование закрывает только самая свежая допустимая запись kind'а с `produced_by.type: "check"` и `produced_by.id`, равным `check`; записи других producers того же kind его не закрывают и не маскируют, а `NO_EVIDENCE` называет check. Без `check` — самая свежая запись kind'а, как прежде. Проект со своей проверкой объявляет check в `.warrant/local/checks/` и gate в `.warrant/local/`:

```json
"requires_evidence": [{ "kind": "test-report", "status": "PROVEN", "check": "dev-check" }]
```

- `check` называет загруженный check, чей `produces` (с учётом override) содержит `kind`; иначе `warrant validate` — `CONFIG_INVALID` с `path` `…#/requires_evidence/<i>/check`, а `check` без `id`, `verify` и `warrant ci` — та же ошибка, код 3, до запуска checks.
- Checks перехода (`check` без `id`, `verify`, `warrant ci`): для требования с `check` — только этот check, без `check` — все checks, чьи `produces` содержат `kind`; объединение по id. Правило `ci_evidence` `warrant ci` для требования с `check` ждёт CI-запись этого check.
- Check, упавший в этом `verify` (не дал evidence, REQ-VER-006), лишает gate входа (`BLOCKED` с `NO_INPUT`), только если питает его требование: для требования с `check` — только падение этого check (I-211 Change `lattice-issues`). Иначе упавший `tests-passed` маскировал бы требование с `check: "dev-check"`.
- Override gate: добавить `check` — усиление; снять или сменить — ослабление, `OVERRIDE_WEAKENS` ([05](05-policy.md)).

### Алгоритм verdict

Сначала **пред-фильтр допустимости evidence** (D-12): запись исключается из рассмотрения с finding `STALE`, если `subject.commit` / `subject.base_commit` отличаются от текущих (у записи с `subject.spec_tree` вместо них сравнивается дерево spec Change на оцениваемом коммите, [ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 3; у CI-записи с `subject.tree` вместо `base_commit` сравнивается дерево результата merge — в `warrant ci` impl-PR дерево HEAD, иначе дерево merge-коммита M на first-parent линии HEAD, чей второй родитель — оцениваемый commit; несовпадение или M нет — `STALE` с `reason: "tree"`, [ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 1–2); `metrics.threshold` ≠ текущий effective param ([06a §2](06a-evidence.md)); `limitations` содержит `scoped: …` (суженный прогон, [ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)); отпечаток target частичного waiver, применённого check, не совпадает с текущим кодом ([ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md) п. 7).

Затем по порядку, первое совпадение — результат:

```text
1. applies_when не выполнено, или все requires_evidence
   имеют статус NOT_APPLICABLE от детерминированного check → NOT_APPLICABLE
2. предпосылки отсутствуют (нет Run, нет входа) или
   нет ни одной допустимой записи требуемого kind         → BLOCKED
3. все requires_evidence со статусом PROVEN               → PASS
4. есть ACTIVE waiver и gate waivable                     → WAIVED
5. иначе                                                  → FAIL
```

`NOT_APPLICABLE` ≠ `PASS`: он позволяет пройти profile без ложного waiver, но отображается отдельно.

`BLOCKED` ≠ `FAIL` (P-7): нет ни одной допустимой записи нужного kind (не было прогона или все записи исключены пред-фильтром) → `BLOCKED` с finding `NO_EVIDENCE`, controller отвечает `verify-incomplete`; запись есть, но её статус ≠ требуемому → `FAIL`. L0-gates без `requires_evidence` вычисляет сам CLI; для них `BLOCKED` — только при отсутствии входа (не git-репозиторий, нет `openspec`).

## 4. Каталог gates

Profiles ссылаются только на ID. Определение gate существует в одном месте — в pack, который его поставляет.

| Gate | Level | Waivable | Pack | Проверяет |
|---|---|---|---|---|
| `spec-valid` | L1 | нет | core-sdd | `openspec validate` проходит |
| `required-artifacts-present` | L0 | нет | core-sdd | Все `artifacts.required` есть |
| `blocking-unknowns-resolved` | L0 | нет | core-sdd | Нет открытых blocking UNKNOWN (`BLOCKING_UNKNOWN`) и нет blocking UNKNOWN, закрытого не решением с `ref` — `resolved_as: "decision"` и URL комментария maintainer'а (`DECISION_WITHOUT_REF`: ответ записан, доказательства нет; `FAIL`, но не `WAIT clarify`); не-blocking не судит; автора, текст и PR комментария проверяет `warrant ci` (`REF_NOT_VERIFIED` с причиной `decision` в PR с новым `APPROVED`, иначе находка `DECISION_NOT_VERIFIED`; [02 §1](02-vocabulary.md), [ADR-0040](adr/WARRANT-ADR-0040-slice-fixes.md) п. 2, 3) |
| `ids-valid` | L0 | нет | core-sdd | ID уникальны, формат верен, не переиспользованы |
| `branch-isolated` | L0 | да | core-sdd | Implementation на отдельной ветке ([ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md)) |
| `tests-passed` | L1 | нет | core-sdd | Required tests проходят |
| `scope-valid` | L0 | нет | core-sdd | Diff затрагивает только разрешённые пути; архив, record и evidence архивных Changes — только `factory-change`; archive-PR — только свой каталог архива и `specs/**` ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md), D-15) |
| `analyze-clean` | L0 | да | core-sdd | Нет `UNSATISFIED`, `CONFLICT`, `ORPHAN` |
| `evidence-complete` | L0 | нет | core-sdd | Все `evidence.required` присутствуют |
| `human-approval` | L0 | нет | core-sdd | Approval от человека с нужной ролью |
| `adversarial-review` | L2 | да | core-sdd | Review выполнен, blocking findings закрыты |
| `bdd-passed` | L1 | нет | bdd-tdd | Acceptance scenarios проходят |
| `red-first` | L1 | да | bdd-tdd | Тест падал до реализации |
| `mutation-score` | L1 | да | bdd-tdd | Score мутантов внутри diff ≥ порога ([ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md)) |
| `adr-present` | L0 | да | arch | ADR существует при durable decision |
| `contract-compatible` | L1 | нет | data | Compatibility check пройден или bump версии |
| `migration-verified` | L1 | нет | data | Миграция прогнана на тестовых данных |
| `reconciliation-passed` | L1 | да | data | Source ↔ target сверка |
| `rollback-rehearsed` | L1 | да | data | Rollback выполнен на production-like snapshot |
| `factory-golden-passed` | L1 | нет | core-sdd | Golden changes WARRANT проходят ([12](12-evolution.md)) |
| `spec-approved` | L0 | да | core-sdd | Дерево `{proposal.md, specs/**}` Change на оцениваемом коммите совпадает с деревом на коммите записи `human-approval` последнего перехода `APPROVED`; `design.md` и `tasks.md` исключены (журнал реализации); правка контракта после approval — waiver maintainer'а; оба транспорта ([ADR-0024](adr/WARRANT-ADR-0024-spec-approved-contract.md), [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md) п. 9; было по D-3: дерево с `design.md`, не waivable) |

## 5. Analyze

`warrant analyze` — детерминированный анализ согласованности по ID и ссылкам.

| Finding | Значение |
|---|---|
| `CONFLICT` | Два artifacts противоречат по структуре (например, task ссылается на удалённый REQ) |
| `MISSING` | Требуемый artifact / связь отсутствует |
| `UNSATISFIED` | REQ без task, test или evidence |
| `ORPHAN` | Test / task / code без связи с REQ |
| `AMBIGUOUS` | Одна ссылка указывает на несколько объектов |
| `STALE` | Evidence получено на commit / spec revision / base / effective param, отличном от текущего; target частичного waiver не совпадает с текущим кодом |

В транспорте `sef-hub` `analyze` дополнительно сверяет TASK ↔ sef item (`source_ref`): TASK без item — `MISSING`, с несколькими items — `AMBIGUOUS` ([ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)).

Пример:

```text
REQ-ING-014: есть в spec; нет task, нет test, нет evidence → UNSATISFIED
```

MVP (фаза 4b, [ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 2) — `warrant analyze <change> [--base <ref>]` выдаёт три вида находок; ничего не пишет, код 1 при находке. ID «определён», если объявлен в main specs или в `ADDED` / `MODIFIED` delta Change и не объявлен в `REMOVED` delta.

| Finding MVP | Условие |
|---|---|
| `UNSATISFIED` `{id, missing[]}` | REQ из `ADDED` / `MODIFIED` delta: `tasks.md` не упоминает ни его, ни один его SCN (`missing` ∋ `task`), или ни один его SCN не встречается в файлах `paths.tests` (`missing` ∋ `test`) |
| `CONFLICT` `{id, path}` | `tasks.md` упоминает неопределённый REQ или SCN (например, `REMOVED`) |
| `ORPHAN` `{id, path}` | Файл `paths.tests`, изменённый в diff `base...HEAD`, упоминает неопределённый SCN |

Без `paths.tests` проверка тестов не выполняется, без diff — `ORPHAN`; каждый пропуск — в `data.skipped[]` с причиной. Gate `analyze-clean` вычисляется той же функцией на оцениваемом commit: находка → `FAIL`, иначе `PASS`, нет diff → `BLOCKED` `NO_INPUT` (§4). `MISSING`, `AMBIGUOUS`, `STALE`, связь evidence с REQ через `claim.targets` — после MVP, по failure mode.

Семантическая согласованность (требования противоречат по смыслу, сценарий не соответствует терминологии, acceptance criterion не наблюдаем, requirement смешивает what и how) — это skill `specification/consistency` (SRA). Его результат — L2 evidence и findings, не вердикт.

## 6. Traceability

Минимальная цепочка:

```text
Change → REQ → SCN → TASK → code → test → Run → EVID
```

Для data (pack data):

```text
Change → DCT → transformation → dataset → quality check → EVID
```

Traceability MUST строиться из ID и ссылок в artifacts. Матрица — projection, вычисляемая `analyze`; graph database не требуется.

Связь test → SCN / REQ задаётся тегом или аннотацией в тесте (`@SCN-ING-003`) — формат задаёт pack тестового стека; для отчёта JUnit id SCN стоит в имени теста (§2, «Тест сценария»).

## 7. Adversarial review

Схема: **Author → Draft → Reviewer (отдельный Run, отдельный контекст) → Revised**. Достаточно двух ролей; «совет из 10 моделей» MUST NOT использоваться — это шум.

Reviewer ищет:

| Категория | Примеры |
|---|---|
| Ambiguity | «quick response», «appropriate error», «normally», «should support» |
| Missing boundaries | empty, null, duplicate, invalid, timeout, partial failure, concurrency, retry |
| Missing actors | user, system, service, administrator, external source |
| Missing error behavior | что происходит при отказе зависимости |
| Hidden assumptions | порядок, уникальность, транзакционность |
| Contradictions | «ID уникален» vs «несколько клиентов с одним ID» |
| Implementation leakage | «создать Redis cache», если это не бизнес-требование |

Каждый finding имеет `severity`; blocking findings MUST быть закрыты до `APPROVED`.

В MVP (фаза 4b) reviewer — отдельный Run `review` ([03 §4](03-architecture.md)): skill `specification/adversarial-review` исполняет субагент Claude Code `warrant-reviewer` (генерирует `warrant sync`), результат сдаёт `warrant run submit`; evidence `review` судит gate `adversarial-review` на `SPECIFIED->APPROVED` ([02 §2](02-vocabulary.md)).

Сдача — файлом ([ADR-0042](adr/WARRANT-ADR-0042-lattice-fixes.md) п. 4): субагент записывает envelope инструментом `Write` в `<RUN-id>.envelope.json` scratchpad сессии во временном каталоге ОС (нет scratchpad — прямо во временный каталог), затем из корня проекта выполняет `warrant run submit --file <путь> --dry-run` и ту же команду без `--dry-run`. Под Run `review` guard разрешает запись только во временный каталог ОС вне проекта: файл проекта — `deny`, путь вне проекта и временного каталога — `deny` с hint, называющим каталог. Envelope не по схеме — `SKILL_RESULT_INVALID` с `data.received{ bytes, root, keys }` (размер, тип корня, ключи верхнего уровня; значения не выводятся).

## 8. CI — последняя инстанция

- CI MUST заново вычислять все L0/L1 gates для merge.
- Доверие evidence определяется тем, где оно произведено, а не подписью: воспроизводимое (L0/L1) CI пересчитывает, невоспроизводимое принимается только с attestation, которую допускает gate ([06a §3](06a-evidence.md)).
- CI MUST блокировать merge при `FAIL`, `BLOCKED` и отсутствии required evidence.
- `warrant ci` ([04 §7](04-lifecycle.md)) считает checks `VERIFYING->MERGED` на результате merge, который строит сам job (tip базы на момент запуска + head PR): CI-запись несёт `subject.commit` — head PR и `subject.tree` — дерево результата merge, так что evidence судит то, что вливается в `main` (R-12). Сдвиг `main` до merge — `STALE` `tree`, лечится Re-run job; после merge — run `workflow_dispatch` на merge-коммите ([ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 3, 4). В MVP красный job — сигнал maintainer'у: branch protection вне MVP.

### Угроза «общий аккаунт»

Агент и maintainer под одним аккаунтом форжа неразличимы: решение blocking UNKNOWN комментарием, merge и `human-approval`, сделанные агентом, `warrant ci` иначе засчитал бы как акты maintainer'а ([ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 3, реализует [ADR-0010](adr/WARRANT-ADR-0010-trust-by-reference.md) п. 4 со стороны CLI).

- Идентичность агента — GitHub App. App и его установку создаёт maintainer; логин App (`…[bot]`) — в `identities.agents[].login` `.warrant/warrant.json`. Токен установки живёт только в окружении агента, `gh` на машине агента авторизован только App'ом: токен человека агенту недоступен. **WARRANT этого не проверяет** — это граница доверия проекта.
- `warrant validate`: логин и в `identities.agents`, и в любой роли `roles` — `CONFIG_INVALID` (роли не содержат ботов).
- Пока `identities.agents` базы пуст: каждый проверенный акт (решение UNKNOWN, ref `APPROVED` / `MERGED` с `merged_by`) — информационная находка `SHARED_IDENTITY` в `data.findings[]`, код выхода от неё не меняется; `merged_by` = автор PR — ещё находка `APPROVER_IS_AUTHOR`. Шум осознанный: он и есть сигнал завести App.
- Когда `identities.agents` непуст: `merged_by` = автор PR или агент — `REF_NOT_VERIFIED` с причиной `merged_by`; автор решения UNKNOWN из `identities.agents` — деталь `author`.
- Активация waiver (`--by`) — локальная запись, форж её не видит; проверка исполнителя — вне этой угрозы (BL-75).

### Job `warrant` — reusable workflow

WARRANT поставляет job `warrant` как reusable workflow `.github/workflows/warrant.yml` (`on: workflow_call`) в своём репозитории ([ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 7). Проект вызывает его по тегу CLI и копии не держит; `ci.yml` этого репозитория вызывает тот же workflow с `warrant: checkout` — источник один.

| Вход | Default | Что |
|---|---|---|
| `warrant` | обязателен | Источник CLI: тег `v<semver>` — `npm i -g github:Homasters-max/SRA#<тег>`; `checkout` — CLI из checkout, только в репозитории WARRANT; иное — шаг проверки входа падает до установки чего-либо и называет допустимые значения |
| `setup` | `""` | Команды подготовки проекта (bash): зависимости и инструменты checks; после checkout и merge |
| `node-version` | `22` | Версия Node.js |
| `openspec-version` | `1.13.1` | Версия OpenSpec |
| `merge_commit` | `""` | Merge-коммит impl-PR для recovery-прогона (`ci fetch`, [ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 4) |

Вызов проектом (`.github/workflows/ci.yml` проекта):

```yaml
on:
  pull_request:
  workflow_dispatch:
    inputs:
      merge_commit:
        required: true
        type: string

jobs:
  warrant:
    name: warrant
    if: github.event_name == 'pull_request' || github.event_name == 'workflow_dispatch'
    permissions:
      contents: read
      actions: read
      pull-requests: read
      issues: read
    uses: Homasters-max/SRA/.github/workflows/warrant.yml@v0.8.2
    with:
      warrant: v0.8.2
      setup: npm ci
      merge_commit: ${{ inputs.merge_commit || '' }}
```

- Тег в `uses` и вход `warrant` — один и тот же тег CLI; подъём версии — правка обеих строк.
- Права — `read` на `contents`, `actions`, `pull-requests`, `issues`: форж `warrant ci` читает PR, runs, artifacts и комментарии через `gh` с `github.token` вызывающего. Секретов workflow не несёт.
- Имя проверки в GitHub — `warrant / warrant` (job вызывающего / job workflow). Проект с обязательной проверкой в branch protection обновляет её имя сам.
- `workflow_dispatch` с `merge_commit` нужен recovery-прогону: подсказка `NO_CI_EVIDENCE` `warrant ci fetch` называет файл workflow run'а head PR (`gh workflow run <файл> -f merge_commit=<M>`).

Job `warrant` судит Changes. Проверки PR без Change (kind `none`: документы, контекст разработки, тесты проекта) — отдельный job проекта в его workflow, как job `test` в этом репозитории. Прогона на каждый push в `main` job `warrant` не делает ([ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 4).
