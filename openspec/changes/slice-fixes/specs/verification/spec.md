## ADDED Requirements

### Requirement: Решения UNKNOWN в warrant ci
<!-- id: REQ-VER-013 -->

`warrant ci` ([REQ-VER-011](#requirement-команда-ci)) SHALL проверять через форж каждый элемент `unknowns[]` record Change на HEAD
с `blocking: true` и `resolved_as: "decision"` ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 3). Деталь нарушения:
- `form` — `ref` не URL комментария pull request вида `https://<host>/<owner>/<repo>/pull/<N>#issuecomment-<id>` или
  `…#pullrequestreview-<id>` (в том числе `#discussion_r…`);
- `repository` — `<owner>/<repo>` не репозиторий форжа;
- `missing` — комментария нет;
- `author` — автор комментария не входит в `roles.maintainer` базы требований (HEAD^1);
- `text` — текст комментария не содержит id этого UNKNOWN;
- `pull_request` — комментарий по ответу форжа принадлежит не PR `<N>` из `ref` (id комментария уникален в репозитории, а не в PR);
  либо PR вносит новый переход `APPROVED`, а `<N>` не номер PR из `ref` этого перехода (spec-PR Change).
В PR с новым переходом `APPROVED` нарушение SHALL быть ошибкой `REF_NOT_VERIFIED`: `message` начинается с
`unknowns/<i> (<UNK>) ref <URL>: decision: <деталь>`, `path` — `.warrant/changes/<change>.json#/unknowns/<i>/ref`, код 1;
недоступный форж — `FORGE_UNAVAILABLE`, как у ref переходов. В остальных видах PR решение ещё не судит переход: нарушение и
недоступный форж (деталь `forge`) SHALL быть находкой `{ code: "DECISION_NOT_VERIFIED", message }` в `data.findings[]` с тем же
началом `message`, код выхода от неё не меняется. Причина `decision` и находка вместо `FORGE_UNAVAILABLE` — исключения из списка причин
`REF_NOT_VERIFIED` и кода 3 недоступного форжа [REQ-VER-011](#requirement-команда-ci), названные и там.

#### Scenario: Решение maintainer'а в spec-PR
<!-- id: SCN-VER-111 -->
- **WHEN** impl-PR вносит переход `APPROVED` с `ref` `https://github.com/o/r/pull/7`, а record содержит blocking `UNK-SRC-004` с `resolved_as: "decision"` и `ref` `https://github.com/o/r/pull/7#issuecomment-11`; комментарий оставил `kat` из `roles.maintainer` базы, его текст содержит `UNK-SRC-004`
- **THEN** `REF_NOT_VERIFIED` нет, код 0

#### Scenario: Решение не maintainer'а или не о том
<!-- id: SCN-VER-112 -->
- **WHEN** тот же impl-PR, но автор комментария `issuecomment-11` — `bob` вне `roles.maintainer` базы; либо автор `kat`, а текст не содержит `UNK-SRC-004`
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с `message`, начинающимся с `unknowns/0 (UNK-SRC-004) ref https://github.com/o/r/pull/7#issuecomment-11: decision: author` (во втором случае — `decision: text`), `path` `.warrant/changes/add-search.json#/unknowns/0/ref`, код 1

#### Scenario: Решение в чужом PR или не комментарий
<!-- id: SCN-VER-113 -->
- **WHEN** ref решения — `https://github.com/o/r/pull/5#issuecomment-3` (комментарий `kat` с id UNKNOWN), а ref перехода `APPROVED` — PR 7; либо ref решения — `https://github.com/o/r/pull/7#issuecomment-3`, а форж отвечает, что этот комментарий оставлен в PR 5; либо ref решения — `https://github.com/o/r/pull/7#discussion_r9`
- **THEN** в первых двух случаях `REF_NOT_VERIFIED` с деталью `decision: pull_request`, в третьем — `decision: form`, код 1

#### Scenario: Нет комментария или чужой репозиторий
<!-- id: SCN-VER-115 -->
- **WHEN** форж отвечает, что комментария `issuecomment-11` нет; либо ref решения — `https://github.com/x/y/pull/7#issuecomment-11` при репозитории `o/r`
- **THEN** `REF_NOT_VERIFIED` с деталью `decision: missing`, во втором случае — `decision: repository`, код 1

#### Scenario: Решение в spec-PR до approval
<!-- id: SCN-VER-114 -->
- **WHEN** spec-PR закрывает blocking UNKNOWN решением с `ref` на комментарий `bob` вне `roles.maintainer`; либо форж недоступен
- **THEN** `data.findings[]` содержит `{ code: "DECISION_NOT_VERIFIED" }` с `message`, содержащим `decision: author` (во втором случае — `decision: forge`), `errors[]` без `REF_NOT_VERIFIED` и `FORGE_UNAVAILABLE` по решению, код не меняется от этой находки

## MODIFIED Requirements

### Requirement: Вычисляемые L0 gates core-sdd
<!-- id: REQ-VER-004 -->

Gates без `requires_evidence` SHALL вычисляться CLI из состояния проекта: `required-artifacts-present` — каждый artifact
`artifacts.required` effective policy имеет статус `done` по `openspec status --json` (для `chore` со `skip_specs` — `skipped`
засчитывается для `specs`); `ids-valid` — проверка (5) `validate` без находок; `blocking-unknowns-resolved` — в record нет элемента `unknowns[]`
с `blocking: true` без непустого `resolution` (finding `BLOCKING_UNKNOWN`) и нет blocking-элемента с непустым `resolution`,
но без `resolved_as: "decision"` и `ref` (finding `DECISION_WITHOUT_REF`; blocking UNKNOWN закрывает только решение
maintainer'а, автора проверяет `warrant ci`, [REQ-VER-013](#requirement-решения-unknown-в-warrant-ci)); не-blocking элементы gate
не судит; `branch-isolated` — текущая ветка git существует и не равна base (`main`); `evidence-complete` —
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

#### Scenario: Blocking без решения
<!-- id: SCN-VER-110 -->
- **WHEN** record содержит `unknowns: [{ "id": "UNK-SRC-001", "text": "…", "blocking": true, "resolution": "Нет", "resolved_as": "decision" }]` без `ref`, либо тот же элемент с `resolved_as: "fact"`
- **THEN** `gates["blocking-unknowns-resolved"]` равен `FAIL` с finding `DECISION_WITHOUT_REF`, перечисляющим `UNK-SRC-001`; с `resolved_as: "decision"` и `ref` — `PASS`; не-blocking элемент с `resolved_as: "fact"` без `ref` — `PASS`

### Requirement: Команда ci
<!-- id: REQ-VER-011 -->

`warrant ci [--dry-run]` SHALL выносить вердикт pull request в CI и SHALL NOT коммитить и пушить
([ADR-0010](../../../../docs/adr/WARRANT-ADR-0010-trust-by-reference.md) п. 1). HEAD SHALL быть результатом merge — merge-коммитом
ровно с двумя родителями: первый — tip базы, второй — head PR ([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 3);
иначе `USAGE` с `hint`, код 3. `warrant ci` SHALL работать с состоянием в `.warrant`: заданный `WARRANT_STATE_DIR` — `USAGE`,
код 3. Diff — `HEAD^1..HEAD`. Репозиторий форжа — `GITHUB_REPOSITORY`, иначе из URL remote `origin`
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 6).

**База требований.** Всё, из чего `warrant ci` выводит требования к PR, SHALL читаться из packs и `warrant.json` дерева HEAD^1
(базы), а не из PR ([ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md) п. 1): policy-пути (`match.paths`
profile `factory-change`), `paths.src`, `paths.tests`, `roles`, `approvals[]`, effective policy и классификация по путям diff.
PR предъявляет только предмет суждения. Встроенный pack (`source: bundled`) приходит с CLI: pack базы — тот, чей `hash`
записан в `warrant.lock.json` HEAD^1. Встроенный pack, которого lock базы не содержит с этим `hash`, — закон, изменённый самим
PR: в виде impl `classification.profiles` на HEAD SHALL содержать `factory-change` (`RECORD_MISMATCH`, причина `classification`),
в остальных видах — `SCOPE_VIOLATION` с путём `.warrant/warrant.lock.json`.

**Change и вид PR.** Change SHALL выводиться из records `.warrant/changes/*.json`, изменённых или удалённых в diff, а не из имени
ветки ([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 13):
- больше одного такого record — `TOPOLOGY_VIOLATION` с именами;
- удалённый record — `RECORD_MISMATCH`.
`data.kind` — по `change_state` record на HEAD:
- `spec` — `PROPOSED`, `SPECIFIED`;
- `impl` — `APPROVED`, `IMPLEMENTING`, `VERIFYING`;
- `archive` — `MERGED`, `ARCHIVED`;
- `abandon` — `ABANDONED`;
- `none` — без record в diff.

**Record.** Новые переходы — те, которых нет в record базы. SHALL выполняться, иначе `RECORD_MISMATCH` с переходом и причиной:
- `transitions[]` record на HEAD начинается с `transitions[]` record базы, а `change_state` равен `to` последнего перехода;
- новые переходы идут допустимой цепочкой состояний ([04 §2](../../../../docs/04-lifecycle.md)) от `change_state` базы, а без
  record в базе — начиная с `PROPOSED`;
- у каждого нового перехода вперёд, кроме `PROPOSED`, есть `effective_policy_hash`, а все значения `gates` — `PASS`, `WAIVED` или
  `NOT_APPLICABLE`;
- каждый id его `evidence[]` — файл `.warrant/evidence/<change>/<id>.json` на HEAD, валидный по `evidence/1`;
- record, замороженный в базе (`ARCHIVED`, `ABANDONED`), в diff не меняется;
- при `change_state` record базы `SPECIFIED` и дальше каждый элемент `unknowns[]` базы остаётся на HEAD с тем же `id` и не
  ослабевает ([ADR-0040](../../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md) п. 3): `blocking: true` остаётся `true`, непустой
  `resolution` — непустым, заданные `resolved_as` и `ref` не удаляются и `resolved_as` не меняется, а blocking-элемент, закрытый
  на HEAD, несёт `resolved_as: "decision"` — его `ref` судит [REQ-VER-013](#requirement-решения-unknown-в-warrant-ci); иначе PR
  снял бы `WAIT` без maintainer'а, ведь verdict gate `blocking-unknowns-resolved` `warrant ci` не пересчитывает (причина
  `unknowns` с id UNKNOWN);
- в видах impl, archive и abandon `classification` на HEAD не слабее базы: `profiles` — надмножество профилей record базы и
  профилей, которые `classify` по packs базы выводит из путей diff PR; `risk_level` effective policy по packs базы — не ниже,
  чем у record базы; иначе PR снял бы с себя gates своего merge (причина `classification`);
- у нового перехода `MERGED` `effective_policy_hash` равен hash effective policy, вычисленной по базе для `classification` на
  HEAD (причина `policy`); для каждого gate `PASS` этого перехода, чьи `requires_evidence` содержат kind, который производят
  checks перехода `VERIFYING->MERGED`, `evidence[]` содержит запись этого kind с `attestation.type: "ci"` (причина
  `ci_evidence`, [ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md) п. 2).
Требования к переходам выводятся из базы, а verdicts ни одного перехода record, в том числе новых, `warrant ci` заново
SHALL NOT вычислять. Доверие к ним держат другие проверки
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md), N44 уточнён review spec):
- ref подтверждений (ниже): maintainer слил spec-PR до `APPROVED` и impl-PR до `MERGED`;
- merge-вердикт impl-PR, пересчитанный из evidence своего run;
- проверка CI-evidence по ссылке на archive-PR.
У `ARCHIVED` и `ABANDONED` ref нет: их держат локальный `warrant`, повтор archive для `openspec/specs/**` и merge PR
maintainer'ом — остаточный риск MVP.

**Ref.** `ref` нового перехода `APPROVED` или `MERGED` SHALL верифицироваться через API форджа
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 5):
- pull request этого репозитория, слит, `merged_by` входит в `roles[<role>]` для роли из `approvals[]` перехода в effective policy
  Change, а при пустом `approvals[]` — в `roles.maintainer`; `roles` и `approvals[]` — из базы требований: иначе PR вписал бы
  себе подтверждающего;
- для `APPROVED` — merge-коммит PR лежит на first-parent линии HEAD^1 и вносит в record этого Change переход `SPECIFIED`;
- для `MERGED` — merge-коммит PR равен M, а head PR — второму родителю M. M — merge-коммит на first-parent линии HEAD^1, чей
  второй родитель равен общему `subject.commit` записей `attestation.type: "ci"` из `evidence[]` перехода; у них разные
  `subject.commit` — причина `merge_commit`. Таких записей нет (policy базы их не требует, правило `ci_evidence`) — M —
  merge-коммит PR из ref, если он лежит на first-parent линии HEAD^1 и вносит в record этого Change переход `VERIFYING`;
- если среди `evidence[]` перехода есть запись `human-approval`, её `produced_by.id` равен `merged_by`; нет такой записи
  (gate `human-approval` не требовался) — проверка не выполняется.
Иначе `REF_NOT_VERIFIED` с причиной (`repository`, `merged`, `merged_by`, `change`, `merge_commit`, `by`); причину `decision` даёт
проверка решений UNKNOWN ([REQ-VER-013](#requirement-решения-unknown-в-warrant-ci)). Если `merged_by`
равен автору PR — это информационная находка `APPROVER_IS_AUTHOR` в `data.findings[]`, а не нарушение.

**Пути.** Собственное состояние Change ([REQ-VER-004](#requirement-вычисляемые-l0-gates-core-sdd)) SHALL быть разрешено во всех
видах. `openspec/specs/**` в diff SHALL быть допустим только в archive-PR с новым переходом `ARCHIVED` и равенством повтору
archive (ниже), иначе `SCOPE_VIOLATION` (R-16). Правила путей судят PR целиком и не зависят от gate `scope-valid`: тот
судит diff своего перехода и пересчитывается вместе с ним.

**Правила по виду.**
- **spec**: diff SHALL NOT трогать `paths.src`, `paths.tests`, каталоги `openspec/changes/<другой>/**`, состояние других Changes и
  policy-пути (`match.paths` profile `factory-change`) вне собственного состояния и waivers этого Change
  (`.warrant/waivers/*.json` с `change` этого Change — spec-PR их и активирует, ADR-0033 п. 4), иначе `SCOPE_VIOLATION` с путями. Без
  `paths.src` и `paths.tests` проверка кода SHALL пропускаться с причиной в `data.skipped[]`. Остальные пути (документы)
  разрешены. Gates `SPECIFIED->APPROVED` SHALL вычисляться на оцениваемом commit HEAD^2 с base `merge-base(HEAD^1, HEAD^2)`
  и выводиться без влияния на код выхода.
- **impl**: оцениваемый commit — HEAD^2, base — `merge-base(HEAD^1, HEAD^2)`, дерево результата merge — дерево HEAD.
  - SHALL выполнить checks перехода `VERIFYING->MERGED` на рабочем дереве HEAD при любом `change_state`, записать evidence
    ([REQ-VER-001](#requirement-хранение-evidence-и-attestation-по-окружению)) в `<state>/evidence/<change>/` рабочей копии и
    вывести `data.artifact{ name: "evidence-<change>-<attempt>", path }` — каталог, который workflow загружает artifact'ом
    (`<attempt>` — `GITHUB_RUN_ATTEMPT`, без него `1`);
  - SHALL вычислить gates перехода; записи kinds, которые производят checks перехода `VERIFYING->MERGED`, засчитываются только
    с `attestation.ref` текущей попытки run (ADR-0010 п. 3: L1 — только из evidence этого запуска), записи прочих kinds — по
    REQ-VER-003; закоммиченные записи этих kinds от других run не засчитываются;
  - каждый gate `FAIL` или `BLOCKED` — нарушение `GATE_NOT_PASSED` с id gate и verdict. Исключение — gate, чьи
    `requires_evidence` состоят только из kinds, которые пишет сам `warrant transition` (`human-approval`): он попадает в
    `data.deferred[]`;
  - вне GitHub Actions «текущий run» — этот вызов: его записи несут `attestation.type: "none"`, и gates L1 перехода дают
    `BLOCKED` с `ATTESTATION_REQUIRED` (REQ-VER-003), код 1 — ожидаемый исход локальной отладки;
  - approver'ы waivers (`approved_by` ∈ `roles`, REQ-VER-003) — по `roles` базы требований; правка `roles` в diff —
    информационная находка `ROLES_CHANGED`;
  - `change_state` не `VERIFYING` — нарушение `CHANGE_NOT_VERIFYING`;
  - ошибки checks (`CHECK_TIMEOUT`, `BUSY`, `CHECK_NOT_CONFIGURED`, `CHECK_LOCAL_FORBIDDEN`) — в `errors[]`, код выхода 3, как
    в [REQ-VER-006](#requirement-команда-verify);
  - `FRONTEND_HOOKS_INACTIVE` ([REQ-VER-009](#requirement-живость-hooks)) — в `data.findings[]` без влияния на код выхода.
- **archive**:
  - пути — как у spec-PR, плюс `openspec/specs/**` по общему правилу и каталог архива `openspec/changes/archive/<date>-<change>/**`;
  - каждая запись `evidence[]` нового перехода `MERGED` с `attestation.type: "ci"` SHALL нести `subject.commit` = M^2 и
    `subject.tree` = дерево M (M — как в правиле ref) и SHALL быть проверена
    через API форджа: попытка run из `attestation.ref` принадлежит репозиторию и имеет `conclusion: success`; у run события
    `pull_request` head sha равен `subject.commit`; run события `workflow_dispatch` запущен с ветки по умолчанию; других событий
    нет;
  - каждая закоммиченная запись с этим `attestation.ref` SHALL побайтно совпадать с файлом из artifact
    `evidence-<change>-<attempt>` этой попытки (ref без `/attempts/<n>` — попытка 1);
  - иначе, в том числе когда artifact истёк, — `EVIDENCE_NOT_VERIFIED` с причиной;
  - при новом переходе `ARCHIVED` diff `openspec/specs/**` SHALL совпадать с результатом `openspec archive <change>` на копии
    дерева HEAD^1, иначе `SPECS_NOT_ARCHIVED` с путями; archive-PR только с `MERGED` повтора не требует, а `openspec/specs/**`
    в его diff — `SCOPE_VIOLATION` по общему правилу. Повтор идёт той же проверкой версии OpenSpec, что `warrant archive`; сбой `openspec` или
    его версия вне диапазона — код 3 с выводом.
- **abandon**: diff SHALL содержать только собственное состояние Change и удаление `openspec/changes/<change>/**`, иначе
  `SCOPE_VIOLATION`.
- **none**: diff SHALL NOT трогать `openspec/changes/**`, `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**` и
  policy-пути, иначе `SCOPE_VIOLATION`.

**Вывод** — `data{ kind, change?, transitions[]{ to, at, ref? }, gates?, deferred[]?, findings[], skipped[], evidence[]?,
artifact?, dry_run?, would_write[]? }`; `transitions[]` — новые переходы; `evidence[]` — id записей, которые записал вид impl
или проверил через форж вид archive.

**Код выхода:**
- 0 — нарушений нет;
- 1 — хотя бы одно нарушение PR: коды выше, включая `TOPOLOGY_VIOLATION`, в `errors[]` с `hint`;
- 3 — ошибка конфигурации, `USAGE`, ошибка check или `openspec`, форж недоступен или не авторизован (`FORGE_UNAVAILABLE` с
  `hint` про `gh auth login` или `GH_TOKEN`); исключение — проверка решений UNKNOWN в PR без
  нового перехода `APPROVED`: недоступный форж там — находка `DECISION_NOT_VERIFIED` (REQ-VER-013).

`--dry-run` — только план (в отличие от [REQ-KRN-034](../kernel/spec.md)): SHALL вывести `data.dry_run: true`, вид PR, Change,
checks и `data.would_write[]` без запуска checks и без обращения к форжу.

#### Scenario: spec-PR трогает код
<!-- id: SCN-VER-073 -->
- **WHEN** при `paths.src: ["src/**"]` diff PR содержит новый record `add-search` в `PROPOSED`, `openspec/changes/add-search/proposal.md`, запись review `.warrant/evidence/add-search/EVID-….json`, файл Run Change, `docs/adr/0042.md` и `src/app.py`
- **THEN** `data.kind` равен `spec`, `errors[]` содержит `SCOPE_VIOLATION` только с путём `src/app.py`, код 1; без `src/app.py` — код 0

#### Scenario: specs вне archive-PR
<!-- id: SCN-VER-074 -->
- **WHEN** diff PR без record ни одного Change содержит `openspec/specs/search/spec.md`
- **THEN** `data.kind` равен `none`, `errors[]` содержит `SCOPE_VIOLATION` с этим путём, код 1

#### Scenario: Вердикт impl-PR
<!-- id: SCN-VER-075 -->
- **WHEN** `warrant ci` под GitHub Actions на результате merge impl-PR Change `add-search` с `risk_level: HIGH` в `VERIFYING`, checks проходят, gate `human-approval` перехода `VERIFYING->MERGED` без evidence
- **THEN** `data.kind` равен `impl`, записи evidence лежат в `.warrant/evidence/add-search/` рабочей копии с `attestation.type: "ci"`, `subject.commit` равным HEAD^2 и `subject.tree`, `data.artifact.name` равен `evidence-add-search-1` (без `GITHUB_RUN_ATTEMPT`; при `GITHUB_RUN_ATTEMPT=2` — `evidence-add-search-2`), `data.deferred[]` содержит `human-approval`, код 0; ни один commit не создан

#### Scenario: impl-PR с упавшим gate
<!-- id: SCN-VER-076 -->
- **WHEN** в той же ситуации junit содержит падение
- **THEN** `gates["tests-passed"]` равен `FAIL`, `errors[]` содержит `GATE_NOT_PASSED` с `tests-passed`, код 1

#### Scenario: Два Change в одном PR
<!-- id: SCN-VER-077 -->
- **WHEN** diff PR меняет records `add-search` и `fix-login`
- **THEN** `errors[0].code` равен `TOPOLOGY_VIOLATION` с обоими именами, checks не выполнялись, код 1

#### Scenario: Переход записан мимо gates
<!-- id: SCN-VER-078 -->
- **WHEN** record на HEAD содержит новый переход `SPECIFIED`, чей `evidence[]` называет `EVID-…` без файла в `.warrant/evidence/add-search/`, или переход `SPECIFIED` сразу после `PROPOSED` базы без `effective_policy_hash`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с переходом и причиной, код 1

#### Scenario: Подменённая запись CI
<!-- id: SCN-VER-079 -->
- **WHEN** на archive-PR запись `ci` перехода `MERGED` отличается от файла в artifact run `attestation.ref` одним полем `evidence_status`
- **THEN** `errors[]` содержит `EVIDENCE_NOT_VERIFIED` с id записи и причиной, код 1

#### Scenario: specs не результат archive
<!-- id: SCN-VER-080 -->
- **WHEN** archive-PR `add-search` содержит в `openspec/specs/search/spec.md` строку, которой нет в результате `openspec archive add-search` на дереве первого родителя
- **THEN** `errors[]` содержит `SPECS_NOT_ARCHIVED` с этим путём, код 1

#### Scenario: Подтверждение не maintainer'ом
<!-- id: SCN-VER-081 -->
- **WHEN** новый переход `APPROVED` несёт `ref` spec-PR этого Change, который слил логин вне `roles.maintainer`
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с причиной `merged_by`, код 1; если слил maintainer, он же автор PR, — `REF_NOT_VERIFIED` нет, а `data.findings[]` содержит `APPROVER_IS_AUTHOR` (код выхода задают остальные правила, SCN-VER-090)

#### Scenario: Живость hooks в отчёте ci
<!-- id: SCN-VER-082 -->
- **WHEN** impl-PR меняет `src/app.py` без события `post` в Runs Change, остальное проходит
- **THEN** `data.findings[]` содержит `FRONTEND_HOOKS_INACTIVE` с `src/app.py`, код 0

#### Scenario: HEAD не результат merge
<!-- id: SCN-VER-083 -->
- **WHEN** `warrant ci` вызван при HEAD с одним родителем или с тремя (octopus)
- **THEN** `errors[0].code` равен `USAGE`, `hint` описывает merge head PR в tip базы, код 3

#### Scenario: Форж недоступен
<!-- id: SCN-VER-084 -->
- **WHEN** archive-PR требует проверки run, а `gh` не авторизован
- **THEN** `errors[0].code` равен `FORGE_UNAVAILABLE` с `hint` про `gh auth login` или `GH_TOKEN`, код 3

#### Scenario: Пробный ci
<!-- id: SCN-VER-085 -->
- **WHEN** `warrant ci --dry-run` на результате merge impl-PR
- **THEN** `data.dry_run: true`, `data.kind` равен `impl`, `data.would_write[]` перечисляет каталог evidence Change, checks не запускались, к форжу не было обращений, код 0

#### Scenario: Первый коммит impl-PR с двумя переходами
<!-- id: SCN-VER-090 -->
- **WHEN** impl-PR вносит одним коммитом переходы `APPROVED` (ref — слитый maintainer'ом spec-PR этого Change) и `IMPLEMENTING`, в CI ветки нет (detached HEAD)
- **THEN** `errors[]` не содержит `RECORD_MISMATCH` и `REF_NOT_VERIFIED` (структура record и ref `APPROVED` в порядке), но содержит `CHANGE_NOT_VERIFYING`, код 1: impl-PR до `VERIFYING` не готов к merge

#### Scenario: Честный archive-PR
<!-- id: SCN-VER-091 -->
- **WHEN** archive-PR `add-search` содержит новые переходы `MERGED` (ref — impl-PR, слитый merge-коммитом M) и `ARCHIVED`, записи `ci`, положенные `ci fetch` из run с деревом M, и `openspec/specs/**`, равные повтору archive
- **THEN** `data.kind` равен `archive`; M найден по `subject.commit` записей `ci`, их `subject.tree` равен дереву M, ref `MERGED` — PR с merge-коммитом M, попытка run и artifact подтверждены, `errors` пуст, код 0

#### Scenario: specs в abandon-PR
<!-- id: SCN-VER-092 -->
- **WHEN** abandon-PR `add-search` кроме record и удаления `openspec/changes/add-search/**` меняет `openspec/specs/search/spec.md`
- **THEN** `data.kind` равен `abandon`, `errors[]` содержит `SCOPE_VIOLATION` с этим путём, код 1

#### Scenario: ref чужого PR
<!-- id: SCN-VER-093 -->
- **WHEN** новый переход `MERGED` несёт `ref` слитого PR, чей merge-коммит не равен M, найденному по записям `ci` его `evidence[]`
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с причиной `merge_commit`, код 1

#### Scenario: policy-путь без Change
<!-- id: SCN-VER-094 -->
- **WHEN** diff PR без record ни одного Change содержит `packs/core-sdd/gates/spec-valid.json` и `openspec/changes/add-search/tasks.md`
- **THEN** `data.kind` равен `none`, `errors[]` содержит `SCOPE_VIOLATION` с обоими путями, код 1

#### Scenario: Check не уложился в timeout
<!-- id: SCN-VER-095 -->
- **WHEN** на impl-PR check `tests-passed` прерван по `execution.timeout_s`
- **THEN** `errors[]` содержит `CHECK_TIMEOUT`, `gates["tests-passed"]` равен `BLOCKED`, код 3

#### Scenario: Чужой run в impl-PR не засчитывается
<!-- id: SCN-VER-098 -->
- **WHEN** в impl-PR закоммичена запись `test-report` `PROVEN` с `attestation.type: "ci"` другого run, `subject.commit` = HEAD^2 и более поздним `created_at`, а прогон текущей попытки даёт `NOT_PROVEN`
- **THEN** `gates["tests-passed"]` равен `FAIL` по записи текущей попытки, `errors[]` содержит `GATE_NOT_PASSED`, код 1

#### Scenario: Waiver своего Change в spec-PR
<!-- id: SCN-VER-099 -->
- **WHEN** diff spec-PR `add-search` кроме артефактов и record содержит `.warrant/waivers/WAV-2026-020.json` с `change: "add-search"` и `.warrant/waivers/WAV-2026-021.json` с `change: "fix-login"`
- **THEN** `errors[]` содержит `SCOPE_VIOLATION` только с путём `WAV-2026-021.json`, код 1

#### Scenario: Код в archive-PR
<!-- id: SCN-VER-100 -->
- **WHEN** честный archive-PR `add-search` дополнительно меняет `src/app.py` при `paths.src: ["src/**"]`
- **THEN** `errors[]` содержит `SCOPE_VIOLATION` с `src/app.py`, код 1

#### Scenario: Ослабленная классификация в impl-PR
<!-- id: SCN-VER-105 -->
- **WHEN** impl-PR `add-search` убирает `factory-change` из `classification.profiles` record, который в базе содержит `chore` и `factory-change`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `classification`, код 1

#### Scenario: archive-PR только с MERGED
<!-- id: SCN-VER-106 -->
- **WHEN** честный archive-PR `add-search` (как SCN-VER-091) вносит только переход `MERGED` (архивация — следующим PR) и не меняет `openspec/specs/**`
- **THEN** `data.kind` равен `archive`, повтор `openspec archive` не выполняется, `SPECS_NOT_ARCHIVED` нет, код 0

#### Scenario: Попытка run вне ветки по умолчанию
<!-- id: SCN-VER-102 -->
- **WHEN** запись `ci` перехода `MERGED` сделана run `workflow_dispatch`, запущенным с ветки `feature/x`
- **THEN** `errors[]` содержит `EVIDENCE_NOT_VERIFIED` с причиной `branch`, код 1

#### Scenario: PR сужает policy-пути
<!-- id: SCN-VER-107 -->
- **WHEN** impl-PR `add-search` с `classification.profiles` `["feature"]` убирает `packs/**` из `match.paths` profile `factory-change` в `packs/core-sdd/profiles/factory-change.json`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `classification` и профилем `factory-change`, выведенным по packs базы, код 1

#### Scenario: MERGED без CI-evidence
<!-- id: SCN-VER-108 -->
- **WHEN** честный archive-PR `add-search` вносит переход `MERGED` с `gates["tests-passed"]` `PASS`, чей `evidence[]` не содержит записей `ci`; либо `MERGED` с пустым `gates`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `ci_evidence`; для пустого `gates` — с причиной `policy`; код 1

#### Scenario: Решение UNKNOWN не ослабляется
<!-- id: SCN-VER-116 -->
- **WHEN** record базы impl-PR в `SPECIFIED` содержит blocking `UNK-SRC-004`, закрытый решением с `ref`, а на HEAD этот элемент удалён; либо на HEAD у него `blocking: false`; либо `resolved_as: "fact"`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `unknowns` и `UNK-SRC-004`, код 1; открытый в базе blocking `UNK-SRC-005`, закрытый на HEAD решением с `ref`, `RECORD_MISMATCH` не даёт (его `ref` судит REQ-VER-013)
