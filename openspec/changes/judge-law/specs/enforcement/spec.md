## MODIFIED Requirements

### Requirement: Команда run submit
<!-- id: REQ-ENF-007 -->

`warrant run submit [--file <path>] [--dry-run]` SHALL принять envelope `warrant://skill-result/1` из файла или, без `--file`, из
stdin для активного Run операции `review` ([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 10). Без
активного Run → `RUN_NOT_ACTIVE`; Run другой операции → `STATE_INVALID` с `hint` `warrant run finish`; envelope не проходит схему,
его `run` не равен id активного Run или `skill` не называет skill review pack'а с версией из диапазона pack →
`SKILL_RESULT_INVALID` с JSON Pointer и `data.received{ bytes, root, keys[] }` — длина полученного текста в байтах UTF-8 (после
снятия BOM), тип корня JSON (`object`, `array`, `string`, `number`, `boolean`, `null` или `not-json`) и ключи верхнего уровня
объекта в порядке code units (иначе пусто), без значений ([ADR-0042](../../../../docs/adr/WARRANT-ADR-0042-lattice-fixes.md) п. 4);
относительный `--file` SHALL разрешаться от корня проекта, файл, который не читается (нет, каталог, нет прав), — `USAGE` с `path`
и `hint` без `data.received`; пустой или пробельный файл и такой же stdin — `USAGE`; `data.received` SHALL нести каждый
`SKILL_RESULT_INVALID`, в том числе несовпадение `run` и `skill` (design I-199);
каждая ошибка SHALL нести `hint`, код выхода — по классу её кода ([REQ-KRN-003](../kernel/spec.md)): ошибки выше — код 3, ничего не записано. Иначе команда SHALL:
записать envelope в канонической форме в `<state>/runs/<RUN-id>.result.json` (коммитится вместе с Run); записать evidence
([REQ-VER-001](../verification/spec.md)) `kind: "review"`, `level: "L2"`, `produced_by{ type: "skill", id, version, run }`,
`attestation{ type: "none" }`, `limitations` `produced locally, unattested` и `same model family as author`,
`subject{ commit: HEAD, spec_revision, spec_tree }` со `spec_tree` из Run и без `base_commit`, `metrics` — число находок по каждой
`severity`, `artifacts[]` — файл envelope с `sha256`; `evidence_status` — `PROVEN`, если `run_state: SUCCEEDED` и нет находки
`BLOCKER`; `NOT_PROVEN`, если есть `BLOCKER`; `INCONCLUSIVE` при `FAILED` или `CANCELLED`
([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 4); завершить Run: `run_state` из envelope,
`finished_at`, id записи в `evidence[]`, `skill`, `model` из `provenance`, удалить `current`. Файлы SHALL писаться одним планом атомарной записи ([REQ-KRN-036](../kernel/spec.md)) в порядке: результат, запись evidence, `manifest.json`, файл Run, затем удаление `current`. Сбой записи любого из них — ошибка записи по REQ-KRN-036 (`BUSY`, код 4, `retryable: true`, или иная ошибка записи, код 3) с `hint`: файлы, записанные раньше по этому порядку, остаются, `current` не удаляется, Run остаётся активным, и повтор с тем же envelope завершает Run: запись evidence уже есть — по правилу повтора ниже (`data.reused: true`), нет — как первая сдача. Сбой удаления `current` после записанного файла Run — ошибка записи с кодом 3 и `hint` удалить `current` (не `BUSY`: повтор сдачи его не исправит), но сдача уже состоялась: Run завершён, evidence записано; `current`, называющий Run не в `RUNNING`, Run активным не делает — повтор даёт `RUN_NOT_ACTIVE`, а `warrant run start` разрешён. Если запись `kind: "review"` с
`produced_by.run`, равным id активного Run, уже есть (прежняя сдача оборвалась до записи Run;
[ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 5), команда SHALL сравнить sha256 канонической формы нового
envelope с `artifacts[0].sha256` записи: равны — переиспользовать id записи без новой и без перезаписи записи, дописать id в
`manifest.evidence[]`, если его там нет, записать результат, завершить Run по `run_state` envelope и вывести `evidence_status` и
`findings` записи и `data.reused: true`; различаются — `EVIDENCE_CONFLICT` с `path` записи и `hint` сдать тот же envelope или
отменить Run (`warrant run finish --state CANCELLED`), код 3, ничего не записано. Без такой записи — `data.reused: false`.
`--dry-run` при повторе SHALL выводить `data.reused: true` и `would_write[]` без файла записи evidence. Вывод —
`data{ run, change, evidence, evidence_status, findings{ BLOCKER, MAJOR, MINOR, INFO }, reused }`, код 0 при любом `evidence_status`.

#### Scenario: Review без блокеров
<!-- id: SCN-ENF-030 -->
- **WHEN** при активном Run `review` Change `add-search` `warrant run submit` получает на stdin envelope `SUCCEEDED` с одним finding `MAJOR`
- **THEN** появляется запись `kind: "review"` с `evidence_status: "PROVEN"`, `subject.spec_tree` из Run, `metrics.MAJOR: 1` и `artifacts[0].uri` — `<state>/runs/<RUN-id>.result.json`; Run — `SUCCEEDED` с id записи в `evidence[]`, `current` удалён, код 0

#### Scenario: Блокер
<!-- id: SCN-ENF-031 -->
- **WHEN** envelope `SUCCEEDED` содержит finding `BLOCKER`
- **THEN** запись имеет `evidence_status: "NOT_PROVEN"`, `data.findings.BLOCKER` равен 1, код 0

#### Scenario: Review не завершился
<!-- id: SCN-ENF-032 -->
- **WHEN** envelope имеет `run_state: "FAILED"`
- **THEN** запись имеет `evidence_status: "INCONCLUSIVE"`, Run — `FAILED`

#### Scenario: Чужой Run
<!-- id: SCN-ENF-033 -->
- **WHEN** `run` envelope не равен id активного Run
- **THEN** `errors[0].code` равен `SKILL_RESULT_INVALID` с путём `/run`, записи evidence нет, Run в `RUNNING`, код 3

#### Scenario: Submit не review
<!-- id: SCN-ENF-034 -->
- **WHEN** `warrant run submit` при активном Run `implement`
- **THEN** `errors[0].code` равен `STATE_INVALID`, `hint` содержит `warrant run finish`, код 3

#### Scenario: Пробный submit
<!-- id: SCN-ENF-035 -->
- **WHEN** `warrant run submit --file result.json --dry-run` с валидным envelope
- **THEN** `data.dry_run: true`, `data.would_write[]` перечисляет файл envelope, запись evidence, manifest, файл Run и `current`; ни один файл не изменён

#### Scenario: Что получено
<!-- id: SCN-ENF-042 -->
- **WHEN** `warrant run submit` получает на stdin `{"$schema":"warrant://skill-result/1","run":"RUN-…","findings":[]}`, затем текст `not json`
- **THEN** оба — `SKILL_RESULT_INVALID`, код 3; первое — `data.received` с `root: "object"`, `keys: ["$schema", "findings", "run"]` и `bytes` — длиной входа в UTF-8; второе — `root: "not-json"`, `keys: []`; значения полей envelope в выводе не повторяются; `--file` на несуществующий путь — `USAGE` с `path`, без `data.received`; `--file` на файл из пробелов — `USAGE`; envelope с чужим `run` (SCN-ENF-033) — `data.received` с `root: "object"`

#### Scenario: Повтор после обрыва
<!-- id: SCN-ENF-043 -->
- **WHEN** при активном Run `review` `RUN-1` в каталоге evidence Change уже есть запись `kind: "review"` с `produced_by.run: "RUN-1"`, которой нет в `manifest.evidence[]` (сдача оборвалась до manifest), и `warrant run submit --file envelope.json` вызван снова с тем же envelope; затем — с envelope, у которого другой `findings[]`
- **THEN** в первом случае новой записи нет, `data.evidence` — id прежней, `data.reused` равен `true`, `manifest.evidence[]` содержит этот id, Run завершён с ним в `evidence[]` один раз, `current` удалён, код 0; во втором — `EVIDENCE_CONFLICT`, код 3, ничего не записано, Run остаётся активным; первая сдача без такой записи — `data.reused: false`

#### Scenario: Сдача при занятом файле Run
<!-- id: SCN-ENF-047 -->
- **WHEN** при активном Run `review` `warrant run submit --file envelope.json` получает валидный envelope, а атомарную запись файла Run держит другой процесс
- **THEN** `errors[0].code` равен `BUSY` с `hint` и `retryable: true`, код 4, Run остаётся активным (`current` не удалён); повтор `warrant run submit --file envelope.json` с тем же envelope после освобождения файла — код 0, `data.reused: true`, Run завершён
