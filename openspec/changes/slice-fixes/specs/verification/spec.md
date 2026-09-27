## ADDED Requirements

### Requirement: Решения UNKNOWN в warrant ci
<!-- id: REQ-VER-013 -->

`warrant ci` ([REQ-VER-011](#requirement-команда-ci)) SHALL проверять через форж каждый элемент `unknowns[]` record Change на HEAD
с `blocking: true` и `resolved_as: "decision"` ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 3):
- `ref` — URL комментария pull request этого репозитория: `https://<host>/<owner>/<repo>/pull/<N>#issuecomment-<id>` или
  `…#pullrequestreview-<id>`; другая форма, в том числе `#discussion_r…`, — причина `form`, чужой репозиторий — `repository`;
- комментарий существует, а его автор входит в `roles.maintainer` базы требований (HEAD^1) — причины `missing` и `author`;
- если PR вносит новый переход `APPROVED`, `<N>` SHALL быть номером PR из `ref` этого перехода — spec-PR Change (причина
  `pull_request`).
В PR с новым переходом `APPROVED` нарушение — ошибка `REF_NOT_VERIFIED` с причиной `decision`, деталью и `path`
`.warrant/changes/<change>.json#/unknowns/<i>/ref`, код 1. В остальных видах PR нарушение — информационная находка
`DECISION_NOT_VERIFIED` в `data.findings[]` (решение ещё не судит переход). Недоступный форж — `FORGE_UNAVAILABLE`, как у
остальных ref.

#### Scenario: Решение maintainer'а в spec-PR
<!-- id: SCN-VER-111 -->
- **WHEN** impl-PR вносит переход `APPROVED` с `ref` `https://github.com/o/r/pull/7`, а record содержит blocking UNKNOWN с `resolved_as: "decision"` и `ref` `https://github.com/o/r/pull/7#issuecomment-11`, комментарий которого оставил `kat` из `roles.maintainer` базы
- **THEN** `REF_NOT_VERIFIED` нет, код 0

#### Scenario: Решение не maintainer'а
<!-- id: SCN-VER-112 -->
- **WHEN** тот же impl-PR, но автор комментария `issuecomment-11` — `bob` вне `roles.maintainer` базы
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с причиной `decision`, деталью `author` и `path` `.warrant/changes/add-search.json#/unknowns/0/ref`, код 1

#### Scenario: Решение в чужом PR
<!-- id: SCN-VER-113 -->
- **WHEN** ref решения — `https://github.com/o/r/pull/5#issuecomment-3` (комментарий maintainer'а), а ref перехода `APPROVED` — PR 7; либо ref решения — `https://github.com/o/r/pull/7#discussion_r9`
- **THEN** `REF_NOT_VERIFIED` с причиной `decision` и деталью `pull_request`, во втором случае — `form`, код 1

#### Scenario: Решение в spec-PR до approval
<!-- id: SCN-VER-114 -->
- **WHEN** spec-PR закрывает blocking UNKNOWN решением с `ref` на комментарий `bob` вне `roles.maintainer`
- **THEN** `data.findings[]` содержит `DECISION_NOT_VERIFIED` с деталью `author`, `errors[]` без `REF_NOT_VERIFIED` по решению, код не меняется от этой находки

## MODIFIED Requirements

### Requirement: Вычисляемые L0 gates core-sdd
<!-- id: REQ-VER-004 -->

Gates без `requires_evidence` SHALL вычисляться CLI из состояния проекта: `required-artifacts-present` — каждый artifact
`artifacts.required` effective policy имеет статус `done` по `openspec status --json` (для `chore` со `skip_specs` — `skipped`
засчитывается для `specs`); `ids-valid` — проверка (5) `validate` без находок; `blocking-unknowns-resolved` — в record нет `unknowns[]`
с `blocking: true` без непустого `resolution` (finding `BLOCKING_UNKNOWN`) и нет такого элемента с `resolved_as: "decision"` без
`ref` (finding `DECISION_WITHOUT_REF`; автора решения проверяет `warrant ci`, [REQ-VER-013](#requirement-решения-unknown-в-warrant-ci)); `branch-isolated` — текущая ветка git существует и не равна base (`main`); `evidence-complete` —
для каждого kind из `evidence.required` у Change есть хотя бы одна запись этого kind на любом commit в статусе `PROVEN` или
`NOT_APPLICABLE` (свежесть проверяют gates, читающие этот kind; I-96, R-8), либо на waivable gate, требующий этот kind в
`requires_evidence`, есть waiver этого Change, который засчитывается по правилам [REQ-VER-003](#requirement-команда-gate-и-алгоритм-verdict)
(`ACTIVE`, срок, `approved_by` ∈ roles, без `targets[]`); иначе `FAIL` с finding `EVIDENCE_MISSING` и недостающими kinds;
`spec-approved` — hash дерева `{proposal.md, specs/**}` каталога Change на commit (`subject.commit`) записи `human-approval`, id
которой перечислен в `evidence[]` последнего перехода `APPROVED` record, равен hash того же дерева на оцениваемом commit; `design.md` и
`tasks.md` не входят (V-9, ADR-0024); нет перехода `APPROVED`, такой записи или git → `BLOCKED` с finding `NO_INPUT`; расхождение →
`FAIL` с finding `SPEC_CHANGED_AFTER_APPROVAL` и списком изменённых путей; `scope-valid` — пути diff `base...HEAD` входят в множество, разрешённое
переходу ([ADR-0011](../../../../docs/adr/WARRANT-ADR-0011-pr-topology.md), D-15). Собственное состояние Change — record
`.warrant/changes/<change>.json`, каталог evidence `<state>/evidence/<change>/**`, файлы Run `<state>/runs/<id>.json` с `change`
этого Change и их `<id>.result.json` — SHALL быть разрешено на каждом из трёх переходов и SHALL NOT считаться policy-путём;
состояние других Changes (records, evidence, Runs) SHALL быть запрещено. Сверх собственного состояния: для `SPECIFIED->APPROVED` —
`openspec/changes/<change>/**`; для `VERIFYING->MERGED` — всё, кроме `openspec/specs/**`, `openspec/changes/archive/**` и policy-путей
(`match.paths` profile `factory-change`), если `factory-change` не в profiles; для `MERGED->ARCHIVED` —
`openspec/changes/archive/<date>-<change>/**`, `openspec/specs/**`, `openspec/changes/<change>/**` (удаление). Каждый FAIL SHALL сопровождаться finding с путями или именами, вызвавшими его. `analyze-clean` — находки
[`warrant analyze`](#requirement-команда-analyze) на оцениваемом commit с base перехода: хотя бы одна находка `UNSATISFIED`,
`CONFLICT` или `ORPHAN` → `FAIL` с этими находками; нет находок → `PASS`; diff недоступен (нет git, base не разрешается) → `BLOCKED`
с `NO_INPUT` ([ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 2).

#### Scenario: Impl-PR трогает specs
<!-- id: SCN-VER-019 -->
- **WHEN** `warrant gate add-search --transition VERIFYING->MERGED` при diff, содержащем `openspec/specs/search/spec.md`, profiles `["feature"]`
- **THEN** `gates["scope-valid"]` равен `FAIL`, `findings[]` содержит `SCOPE_VIOLATION` с этим путём

#### Scenario: Archive-PR в своём каталоге
<!-- id: SCN-VER-020 -->
- **WHEN** переход `MERGED->ARCHIVED`, diff содержит `openspec/changes/archive/2026-09-22-add-search/proposal.md`, `openspec/specs/search/spec.md` и удаление `openspec/changes/add-search/**`
- **THEN** `gates["scope-valid"]` равен `PASS`

#### Scenario: factory-change и policy-пути
<!-- id: SCN-VER-021 -->
- **WHEN** diff impl-PR содержит `packs/core-sdd/gates/spec-valid.json`, а profiles record — `["feature"]` без `factory-change`
- **THEN** `gates["scope-valid"]` равен `FAIL` с finding `SCOPE_VIOLATION`; при profiles `["factory-change"]` — `PASS`

#### Scenario: Блокирующий UNKNOWN
<!-- id: SCN-VER-022 -->
- **WHEN** record содержит `unknowns: [{ "id": "UNK-SRC-001", "blocking": true }]` без `resolution`
- **THEN** `gates["blocking-unknowns-resolved"]` равен `FAIL`, finding перечисляет `UNK-SRC-001`

#### Scenario: Ветка не изолирована
<!-- id: SCN-VER-023 -->
- **WHEN** `warrant gate add-search --transition APPROVED->IMPLEMENTING` на ветке `main`
- **THEN** `gates["branch-isolated"]` равен `FAIL`

#### Scenario: evidence-complete не принимает NOT_PROVEN
<!-- id: SCN-VER-045 -->
- **WHEN** `evidence.required` содержит `review`, у Change есть только запись `review` с `evidence_status: "NOT_PROVEN"`, waiver на `adversarial-review` нет
- **THEN** `gates["evidence-complete"]` равен `FAIL`, `findings[]` содержит `EVIDENCE_MISSING` с `review`; при `ACTIVE` waiver на `adversarial-review` от логина из `roles` — `PASS`

#### Scenario: Правка design после approval
<!-- id: SCN-VER-046 -->
- **WHEN** после перехода `APPROVED` (запись `human-approval` на commit A) в impl-PR изменены только `design.md` и `tasks.md` Change, gate `spec-approved` на `VERIFYING->MERGED`
- **THEN** `gates["spec-approved"]` равен `PASS`

#### Scenario: Правка spec после approval
<!-- id: SCN-VER-047 -->
- **WHEN** в той же ситуации изменён `openspec/changes/add-search/specs/search/spec.md`
- **THEN** `gates["spec-approved"]` равен `FAIL`, `findings[]` содержит `SPEC_CHANGED_AFTER_APPROVAL` с этим путём; при `ACTIVE` waiver maintainer'а на `spec-approved` — `WAIVED`

#### Scenario: Нет approval
<!-- id: SCN-VER-048 -->
- **WHEN** record не содержит перехода `APPROVED` с записью `human-approval` в `evidence[]`
- **THEN** `gates["spec-approved"]` равен `BLOCKED`, `findings[]` содержит `NO_INPUT`

#### Scenario: analyze-clean с находкой
<!-- id: SCN-VER-058 -->
- **WHEN** delta spec Change содержит `REQ-SRC-004`, который не упомянут в `tasks.md` ни сам, ни через свои SCN, gate `analyze-clean` на `VERIFYING->MERGED`
- **THEN** `gates["analyze-clean"]` равен `FAIL`, `findings[]` содержит `UNSATISFIED` с `id: "REQ-SRC-004"`

#### Scenario: analyze-clean без находок
<!-- id: SCN-VER-059 -->
- **WHEN** каждый REQ delta упомянут в `tasks.md` и хотя бы один его SCN встречается в файле под `paths.tests`, а тесты diff ссылаются только на определённые SCN
- **THEN** `gates["analyze-clean"]` равен `PASS` без waiver

#### Scenario: Review в spec-PR
<!-- id: SCN-VER-060 -->
- **WHEN** diff spec-PR содержит `openspec/changes/add-search/proposal.md`, запись `.warrant/evidence/add-search/EVID-….json`, файл Run `.warrant/runs/RUN-….json` с `change: "add-search"` и его `.result.json`, gate `scope-valid` на `SPECIFIED->APPROVED`, profiles `["feature"]`
- **THEN** `gates["scope-valid"]` равен `PASS`; файл Run с `change: "other"` в том же diff даёт `FAIL` с `SCOPE_VIOLATION`

#### Scenario: Runs в impl-PR не factory
<!-- id: SCN-VER-061 -->
- **WHEN** diff impl-PR содержит `src/app.py` и файлы Run Change `add-search`, profiles `["feature"]` без `factory-change`, gate `scope-valid` на `VERIFYING->MERGED`
- **THEN** `gates["scope-valid"]` равен `PASS`: файлы Run своего Change не считаются policy-путём `.warrant/**`

#### Scenario: Решение без ref
<!-- id: SCN-VER-110 -->
- **WHEN** record содержит `unknowns: [{ "id": "UNK-SRC-001", "text": "…", "blocking": true, "resolution": "Нет", "resolved_as": "decision" }]` без `ref`
- **THEN** `gates["blocking-unknowns-resolved"]` равен `FAIL` с finding `DECISION_WITHOUT_REF`, перечисляющим `UNK-SRC-001`; с `ref` или с `resolved_as: "fact"` — `PASS`
