## ADDED Requirements

### Requirement: Локальный вердикт без записи
<!-- id: REQ-VER-017 -->

`warrant ci --no-record` SHALL выносить вердикт `warrant ci` ([REQ-VER-011](#requirement-команда-ci); это исключение из её
синопсиса `ci [--dry-run]` и безусловной записи evidence) на тех же входах — те же checks, gates, обращения к форжу, `kind`,
`gates`, `deferred[]`, `findings[]`, коды и пути `errors[]`, код выхода — и SHALL NOT оставлять записанного в состоянии
WARRANT. Снимок цели, который не удалось снять до её первой записи, SHALL останавливать команду до этой записи: `INTERNAL`, код 3,
с путём цели, уже записанное — возвращено. Каждая цель `ctx.writes` команды — записи evidence, `manifest.json`, каталоги `raw/` checks в
`<state>/evidence/<change>/`, вместе с тем, что в них пишут запущенные командой checks, — после конца последнего check и до
вывода SHALL вернуться в состояние до первой записи этой командой: созданная — удалена вместе с созданными пустыми каталогами,
изменённая или удалённая — восстановлена побайтно, файл — атомарной записью ([REQ-KRN-036](../kernel/spec.md)); так же при
исключении команды (в том числе `CHECK_TIMEOUT`) и при SIGINT / SIGTERM / SIGHUP (SIGBREAK на Windows), как снимается lock.
Другой процесс, пишущий то же `<state>` во время `--no-record` (`check`, `verify`, `transition`, `run submit` того же
checkout'а), не поддерживается: его запись в цели этой команды откатывается вместе с ней. Файлы, которые команды checks пишут
вне `{out}` (покрытие, сборка, кэши), — не цели `ctx.writes`, требование их не касается. Цель, которую вернуть не удалось,
SHALL попадать в `data.not_restored[]` путём проекта (при сигнале, когда вывода нет, — строкой в stderr на каждую); остальной
вывод от этого не меняется. Записи этого прогона — новые `EVID-<ULID>` на каждый вызов, а `data.evidence[]` и пути записей называют файлы,
которых после команды уже нет; каталог `data.artifact.path` после команды такой же, как до неё. Каждый вывод с `--no-record`, включая ошибки, SHALL нести
`data.no_record: true`. `--no-record` вместе с `--dry-run` — `USAGE`, код 3: `--dry-run` checks не запускает.
`--no-record` при `GITHUB_ACTIONS=true` — `USAGE`, код 3: CI записывает evidence для artifact и `ci fetch`.

#### Scenario: Вердикт без записи
<!-- id: SCN-VER-154 -->
- **WHEN** `warrant ci --no-record` вне GitHub Actions на результате merge impl-PR `add-search` в `VERIFYING`, чей gate `tests-passed`
  требует записи check `tests` с `attestation: ci`; check пишет запись и `raw/`, а в каталоге evidence уже лежат закоммиченные
  записи, manifest и `raw/` прошлого прогона; затем `warrant ci` на той же копии проекта; затем `warrant ci --no-record`, чей
  check превышает свой таймаут
- **THEN** у первых двух одинаковы `data.kind`, `data.gates`, `data.deferred`, коды `data.findings[]` и `errors[]` и код выхода
  (локально — 1, `ATTESTATION_REQUIRED`); у первого `data.no_record: true`, `data.not_restored` пуст, и после него каждый файл
  `.warrant/` побайтно тот же, что до вызова, новых файлов и каталогов там нет; после третьего (`CHECK_TIMEOUT`, код 4) —
  тоже

#### Scenario: Без записи — недопустимые сочетания
<!-- id: SCN-VER-155 -->
- **WHEN** `warrant ci --no-record --dry-run`; `warrant ci --no-record` при `GITHUB_ACTIONS=true`
- **THEN** оба — `errors[0].code` равен `USAGE`, `data.no_record: true`, код 3, ни один файл не изменён

## MODIFIED Requirements

### Requirement: Команда ci fetch
<!-- id: REQ-VER-012 -->

`warrant ci fetch <pr> [--dry-run]` SHALL положить в `<state>/evidence/<change>/` evidence CI слитого impl-PR
([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 14, [ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 4).
`<pr>` — номер или URL pull request этого репозитория.

**Ошибки** (ничего не записано; код — по классу кода, [REQ-KRN-003](../kernel/spec.md): 3, если не назван другой):
- URL другого репозитория — `USAGE`;
- заданный `WARRANT_STATE_DIR` — `USAGE`: записи едут в archive-PR, состояние — в `.warrant`, как у `warrant ci`;
- PR не найден (в том числе репозиторий, невидимый токену: HTTP 404) — `PR_NOT_FOUND`;
- отказ доступа к форжу — `FORGE_ACCESS` с `hint`; форж недоступен — `FORGE_UNAVAILABLE` с `retryable: true`, код 4;
- PR не слит или слит не merge-коммитом (squash, rebase) — `PR_NOT_MERGED`;
- merge-коммита M нет в локальном репозитории — `COMMIT_NOT_FOUND` с `hint` `git fetch`;
- Change — тот, чей record меняет diff `M^1..M`; не ровно один — `TOPOLOGY_VIOLATION`, код 1: класс кода один во всех командах ([REQ-KRN-003](../kernel/spec.md)), как у `warrant ci`;
- record Change на M не в `VERIFYING` (PR — не impl-PR) — `PR_NOT_IMPL` с `hint` про номер impl-PR.

**Кандидаты** — попытки runs этого репозитория с `conclusion: success`, новые первыми; каждая попытка run, а не только
последняя:
- события `pull_request` с head sha, равным M^2;
- события `workflow_dispatch` с ветки по умолчанию, созданные после merge M (восстановление, ADR-0037 п. 4).
Попытка без artifact `evidence-<change>-<attempt>` (истёк) пропускается с причиной в `data.skipped[]`.

**Выбранная попытка** — первая, в чьём artifact есть хотя бы одна запись с `attestation.ref`, равным URL этой попытки (ref без
`/attempts/<n>` — попытка 1), и все такие записи
несут `subject.commit` = M^2 и `subject.tree` = дерево M. Подходящего run нет → `NO_CI_EVIDENCE`, код 3, с `hint` запустить
workflow вручную со входом `merge_commit` = M; ничего не записано.

**Запись.** SHALL записываться побайтно ровно записи выбранной попытки с её `attestation.ref`; их id добавляются в локальный manifest
по правилам [REQ-VER-001](#requirement-хранение-evidence-и-attestation-по-окружению), `manifest.commit` — HEAD, как у любой
локальной записи. `manifest.json` и `raw/` artifact'а SHALL NOT импортироваться. Импорт SHALL идти под lock Change, как `check`:
занятый lock — `BUSY` с `retryable: true`, код 4. Файлы записей пишутся до manifest: прерванный импорт доводит повторный `ci fetch`. Запись с тем же id и тем же содержимым пропускается — повторный `ci fetch` ничего не меняет. Запись с тем же id и
другим содержимым → `EVIDENCE_CONFLICT`; запись, не проходящая схему `evidence/1`, или файл, чьё имя не равно `id`, →
`SCHEMA_VIOLATION` с путём; в обоих случаях код 3, ничего не записано.

**Чужие записи каталога.** Запись `<state>/evidence/<change>/EVID-*.json`, которой нет ни в `manifest.evidence[]` этого Change
в HEAD, ни среди записей выбранной попытки, ни в `evidence[]` переходов record Change рабочего дерева (так запись
`human-approval` перехода `MERGED` — не остаток), — остаток локального `warrant verify` или `warrant ci`. `ci fetch` SHALL
перечислить такие записи в `data.untracked[]` путями проекта в порядке кодовых единиц и SHALL NOT их трогать; при непустом
списке `data.findings[]` SHALL нести элемент `{ code: "EVIDENCE_UNTRACKED", paths[], hint }` (информационный, код выхода не
меняет) с `hint`: не коммитить эти файлы, а удалить их (человек — guard агента удаление записи запрещает) и повторить
`warrant ci fetch`. Manifest в HEAD, которого нет или который не разбирается как `evidence-manifest/1`, считается manifest с
пустым `evidence[]`. Записи попытки — все её
записи с `attestation.ref` попытки, в том числе уже лежащие в каталоге с тем же содержимым. Manifest SHALL перечислять ровно
записи каталога ([REQ-KRN-021](../kernel/spec.md) п. 12) и SHALL переписываться, если записан хоть один файл записи или его
`evidence[]` отличается от записей каталога: повторный `ci fetch` после удаления остатка убирает его из manifest.
`data.untracked[]` есть и под `--dry-run`; вывод с ошибкой его не несёт.

Вывод — `data{ pr, change, merge_commit, tree, run, evidence[], untracked[], findings[], skipped[] }`. `--dry-run` SHALL выбрать run и вывести
`data.dry_run: true` и `data.would_write[]` без записи.

#### Scenario: Run на дереве merge
<!-- id: SCN-VER-086 -->
- **WHEN** impl-PR `add-search` слит merge-коммитом M; у head PR два успешных run: новый — с `subject.tree` ≠ дерево M (`main` сдвинулся), старый — с деревом M
- **THEN** `warrant ci fetch 9` записывает записи старого run, `data.run` — его URL, `data.tree` — дерево M, код 0

#### Scenario: Нет run на дереве merge
<!-- id: SCN-VER-087 -->
- **WHEN** ни один успешный run head PR и ни один run `workflow_dispatch` после merge не несёт `subject.tree`, равный дереву M
- **THEN** `errors[0].code` равен `NO_CI_EVIDENCE`, `hint` называет ручной запуск workflow с `merge_commit` M, ни один файл не изменён, код 3

#### Scenario: PR не слит merge-коммитом
<!-- id: SCN-VER-088 -->
- **WHEN** `warrant ci fetch 9` для PR, слитого squash; или `warrant ci fetch https://github.com/other/repo/pull/9`
- **THEN** `errors[0].code` равен `PR_NOT_MERGED`; для чужого репозитория — `USAGE`; код 3, ни один файл не изменён

#### Scenario: Пробный fetch
<!-- id: SCN-VER-089 -->
- **WHEN** `warrant ci fetch 9 --dry-run` при подходящем run
- **THEN** `data.dry_run: true`, `data.would_write[]` перечисляет файлы записей и manifest, ни один файл не изменён, код 0

#### Scenario: Run восстановления
<!-- id: SCN-VER-096 -->
- **WHEN** runs `pull_request` head PR несут дерево ≠ дерево M, а после merge выполнен `workflow_dispatch` со входом `merge_commit` M (head sha run — tip `main`), чьи записи несут `subject.commit` = M^2 и `subject.tree` = дерево M
- **THEN** `warrant ci fetch 9` выбирает run восстановления, код 0; `warrant ci` на archive-PR подтверждает его без сравнения head sha

#### Scenario: Повторная попытка run
<!-- id: SCN-VER-103 -->
- **WHEN** у head PR один run: попытка 1 — с деревом ≠ дерево M, попытка 2 (Re-run до merge) — с деревом M
- **THEN** `warrant ci fetch 9` записывает записи попытки 2, `data.run` оканчивается на `/attempts/2`, код 0

#### Scenario: fetch не impl-PR
<!-- id: SCN-VER-104 -->
- **WHEN** `warrant ci fetch 7` для слитого spec-PR, чей record Change на M в `SPECIFIED`
- **THEN** `errors[0].code` равен `PR_NOT_IMPL` с `hint`, ни один файл не изменён, код 3

#### Scenario: Повторный fetch
<!-- id: SCN-VER-097 -->
- **WHEN** `warrant ci fetch 9` выполнен второй раз после успешного первого, каталог не менялся
- **THEN** ни один файл не изменён, `data.evidence[]` перечисляет те же id, код 0

#### Scenario: fetch во внешнее состояние
<!-- id: SCN-VER-109 -->
- **WHEN** `warrant ci fetch 9` при заданном `WARRANT_STATE_DIR`
- **THEN** `errors[0].code` равен `USAGE` с `hint` снять переменную, к форжу не было обращений, ни один файл не изменён, код 3

#### Scenario: Остаток локальной записи
<!-- id: SCN-VER-156 -->
- **WHEN** manifest `add-search` в HEAD перечисляет `EVID-A`; в каталоге лежат `EVID-A`, незакоммиченный `EVID-S` от локального `warrant verify`
  и manifest, перезаписанный тем `verify`; выбранная попытка несёт `EVID-B`; затем `EVID-S` удалён и `warrant ci fetch 9` повторён
- **THEN** первый вызов пишет `EVID-B`, `data.untracked[]` равен `[".warrant/evidence/add-search/EVID-S.json"]`, `data.findings[]`
  содержит `EVIDENCE_UNTRACKED` с тем же путём и `hint` об удалении и повторе; запись `human-approval`, на которую ссылается
  переход record, в `untracked[]` не попадает; файл `EVID-S` не изменён, `warrant validate` без находок, код 0; повтор — `data.untracked[]` пуст,
  `manifest.evidence[]` равен `["EVID-A", "EVID-B"]`, `warrant validate` без находок, код 0
