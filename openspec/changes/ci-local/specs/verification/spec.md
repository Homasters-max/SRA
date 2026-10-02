## ADDED Requirements

### Requirement: Локальный вердикт без записи
<!-- id: REQ-VER-017 -->

`warrant ci --no-record` SHALL выносить тот же вердикт, что `warrant ci` ([REQ-VER-011](#requirement-команда-ci)) на тех же
входах: те же checks, gates, обращения к форжу, `data` (плюс `data.no_record: true`), `errors[]` и код выхода — и SHALL NOT
оставлять записанного: каждый файл и каталог, который команда записала, создала или удалила (записи evidence, `manifest.json`,
`raw/` checks), к её концу SHALL быть возвращён в состояние до вызова — и при исключении, и при SIGINT / SIGTERM / SIGHUP (SIGBREAK
на Windows), как снимается lock. Так владелец PR судит результат merge с
`origin/main` локально, не оставляя в worktree файлов, которые потом попадут в archive-PR ([#143](https://github.com/Homasters-max/SRA/issues/143)).
`--no-record` вместе с `--dry-run` — `USAGE`, код 3: `--dry-run` checks не запускает. Возврат, который не удался, SHALL
называться строкой в stderr с путём, не меняя вердикта и кода выхода.

#### Scenario: Вердикт без записи
<!-- id: SCN-VER-154 -->
- **WHEN** `warrant ci --no-record` на результате merge impl-PR `add-search` в `VERIFYING`, чьи checks пишут записи evidence и
  `raw/`, а в каталоге evidence уже лежат закоммиченный manifest и `raw/` прошлого прогона
- **THEN** `data` (без `no_record`), `errors[]` и код выхода равны выводу `warrant ci` на той же копии проекта; `data.no_record`
  равен `true`; после вызова каждый файл проекта побайтно тот же, что до него, новых файлов и каталогов нет

#### Scenario: Без записи и пробный прогон
<!-- id: SCN-VER-155 -->
- **WHEN** `warrant ci --no-record --dry-run`
- **THEN** `errors[0].code` равен `USAGE`, код 3, ни один файл не изменён

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
локальной записи. `manifest.evidence[]` после импорта SHALL быть объединением `evidence[]` manifest этого Change в HEAD (нет его
в HEAD — пусто) и id импортированных записей: запись, которая лежит в каталоге, но не закоммичена в manifest HEAD и не
импортирована (остаток локального `warrant verify` или `warrant ci`), в manifest не попадает, и сам файл `ci fetch` не трогает. `manifest.json` и `raw/` artifact'а SHALL NOT импортироваться. Импорт SHALL идти под lock Change, как `check`:
занятый lock — `BUSY` с `retryable: true`, код 4. Файлы записей пишутся до manifest: прерванный импорт доводит повторный `ci fetch`. Запись с тем же id и тем же содержимым пропускается — повторный `ci fetch` ничего не меняет. Запись с тем же id и
другим содержимым → `EVIDENCE_CONFLICT`; запись, не проходящая схему `evidence/1`, или файл, чьё имя не равно `id`, →
`SCHEMA_VIOLATION` с путём; в обоих случаях код 3, ничего не записано.

Вывод — `data{ pr, change, merge_commit, tree, run, evidence[], skipped[] }`. `--dry-run` SHALL выбрать run и вывести
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
- **WHEN** `warrant ci fetch 9` выполнен второй раз после успешного первого
- **THEN** ни один файл не изменён, `data.evidence[]` перечисляет те же id, код 0

#### Scenario: fetch во внешнее состояние
<!-- id: SCN-VER-109 -->
- **WHEN** `warrant ci fetch 9` при заданном `WARRANT_STATE_DIR`
- **THEN** `errors[0].code` равен `USAGE` с `hint` снять переменную, к форжу не было обращений, ни один файл не изменён, код 3

#### Scenario: Остаток локальной записи
<!-- id: SCN-VER-156 -->
- **WHEN** manifest `add-search` в HEAD перечисляет `EVID-A`; в каталоге лежат незакоммиченный `EVID-S` от локального `warrant verify`
  и manifest, перезаписанный тем `verify` с `EVID-A` и `EVID-S`; выбранная попытка несёт `EVID-B`
- **THEN** `warrant ci fetch 9` пишет `EVID-B`, `manifest.evidence[]` равен `["EVID-A", "EVID-B"]`, файл `EVID-S` не изменён, код 0
