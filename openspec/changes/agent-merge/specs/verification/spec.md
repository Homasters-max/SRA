## MODIFIED Requirements

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
- gate с вердиктом `WAIVED` нового перехода SHALL иметь хотя бы один waiver этого Change на этот gate (версия — по файлу, id WAV) — файл `.warrant/waivers/<WAV>.json`
  базы, а если в базе такого файла нет, то HEAD (новый waiver лежит на пути класса приёмки человеком, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 2) —
  засчитываемый по правилу waiver [REQ-VER-003](#requirement-команда-gate-и-алгоритм-verdict) на дату прогона `warrant ci` (UTC):
  `ACTIVE`, срок не истёк, `approved_by` в `roles` базы, gate `waivable` по определению базы, без `targets[]` (причина
  `waiver`; [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 5);
- gate с вердиктом `NOT_APPLICABLE` нового перехода SHALL иметь основание, как у REQ-VER-003, — одно из двух (иначе причина
  `not_applicable`):
  - в определении базы есть `applies_when`; у `MERGED` он SHALL быть не выполнен на diff `merge-base(M^1, M^2)..M^2` (M — из
    правила ref ниже; M не найден — diff не проверяется, нарушение даёт правило ref `merge_commit`); у остальных переходов diff их
    вычисления судье недоступен — достаточно наличия `applies_when` (остаточный риск, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 5);
  - `requires_evidence` определения базы непуст, и каждый его элемент удовлетворён (kind, а у элемента с `check` —
    `produced_by.id`) записью из `evidence[]` перехода с `evidence_status: "NOT_APPLICABLE"` и `produced_by.type: "check"`, у
    `MERGED` — ещё с `attestation.type: "ci"` и `subject.commit` M^2 (как правило `ci_evidence`). Gate без `requires_evidence`
    основания по evidence не имеет;
- у нового перехода `MERGED` `effective_policy_hash` равен hash effective policy, вычисленной по базе для `classification` на
  HEAD (причина `policy`); для каждого gate `PASS` этого перехода, чьи `requires_evidence` содержат kind, который производят
  checks перехода `VERIFYING->MERGED`, `evidence[]` содержит запись этого kind с `attestation.type: "ci"`, а у элемента с `check` —
  запись этого check (`produced_by.id`; [ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 6) (причина
  `ci_evidence`, [ADR-0038](../../../../docs/adr/WARRANT-ADR-0038-pr-judged-by-base.md) п. 2).
Требования к переходам выводятся из базы, а verdicts ни одного перехода record, в том числе новых, `warrant ci` заново
SHALL NOT вычислять; проверка основания записанных `WAIVED` и `NOT_APPLICABLE` (выше) — не вычисление: она читает файлы waiver и записи evidence, но не пересчитывает verdict. Доверие к ним держат другие проверки
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md), N44 уточнён review spec):
- ref подтверждений (ниже): maintainer слил spec-PR до `APPROVED` и impl-PR до `MERGED` (без gate `human-approval` — член `roles` или агент);
- merge-вердикт impl-PR, пересчитанный из evidence своего run;
- проверка CI-evidence по ссылке на archive-PR.
У `ARCHIVED` и `ABANDONED` ref нет: их держат локальный `warrant`, повтор archive для `openspec/specs/**` и merge PR — остаточный риск MVP; archive-PR сливает агент: состояние Change держат повтор archive и CI-evidence ref `MERGED`, правку путей класса приёмки в нём — только форж (`CODEOWNERS`, класс C).

**Ref.** `ref` нового перехода `APPROVED` или `MERGED` SHALL верифицироваться через API форджа
([ADR-0037](../../../../docs/adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 5):
- pull request этого репозитория, слит, `merged_by` входит в `roles[<role>]` для роли из `approvals[]` перехода в effective policy
  Change, а при пустом `approvals[]` — в `roles.maintainer`; `roles` и `approvals[]` — из базы требований: иначе PR вписал бы
  себе подтверждающего. Для ref `MERGED` `roles`, `approvals[]`, `identities.agents` и policy (packs, `.warrant/local/**`,
  конфигурация) берутся из M^1 — базы impl-PR, а не archive-PR: impl-PR, слитый агентом, не снимет с себя приёмку и не впишет себе
  роль. Классификация для этой policy — `classification` record Change на M, дополненная профилями, которые `classify` по packs
  M^1 выводит из diff `merge-base(M^1, M^2)..M^2`. Если effective policy по M^1 не содержит gate `human-approval` на
  `VERIFYING->MERGED`, `merged_by` SHALL входить в любую роль `roles` M^1 или в `identities.agents` M^1 ([ADR-0050](../../../../docs/adr/WARRANT-ADR-0050-agent-merge.md) п. 2, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md)
  п. 4): merge не акт одобрения, его держат merge-вердикт impl-PR и CI-evidence. Исключения нет (fail-closed), если policy по M^1
  содержит `human-approval`, если она не вычисляется текущим CLI (packs, lock, `kernel`, профиль `classification`, которого нет в
  packs M^1) или если record Change на M^1 есть и его `change_state` дальше `SPECIFIED` (реализация влита не одним impl-PR M —
  diff M не несёт кода прежних PR). Без вычисленной policy роль одобрения — `roles.maintainer` конфигурации M^1. Когда исключение
  закрыто не gate `human-approval`, а одной из двух других причин, вывод SHALL содержать информационную находку
  `{ code: "AGENT_MERGE_CLOSED", message }` с причиной — при любом исходе ref. Impl-PR, слитый не членом нужной роли,
  восстанавливается повтором impl-PR без правок кода (`VERIFYING->IMPLEMENTING->VERIFYING`), который сливает член роли одобрения;
- для `APPROVED` — merge-коммит PR лежит на first-parent линии HEAD^1 и вносит в record этого Change переход `SPECIFIED`;
- для `MERGED` — merge-коммит PR равен M, а head PR — второму родителю M. M — merge-коммит на first-parent линии HEAD^1, чей
  второй родитель равен общему `subject.commit` записей `attestation.type: "ci"` из `evidence[]` перехода; у них разные
  `subject.commit` — причина `merge_commit`. Таких записей нет (policy базы их не требует, правило `ci_evidence`) — M —
  merge-коммит PR из ref, если он лежит на first-parent линии HEAD^1 и вносит в record этого Change переход `VERIFYING`;
- если среди `evidence[]` перехода есть запись `human-approval`, её `produced_by.id` равен `merged_by`; нет такой записи
  (gate `human-approval` не требовался) — проверка не выполняется.
Иначе `REF_NOT_VERIFIED` с причиной (`repository`, `merged`, `merged_by`, `change`, `merge_commit`, `by`); причину `decision` даёт
проверка решений UNKNOWN ([REQ-VER-013](#requirement-решения-unknown-в-warrant-ci)). Идентичности агентов — логины
`identities.agents[].login` базы требований, для ref `MERGED` — M^1 ([ADR-0044](../../../../docs/adr/WARRANT-ADR-0044-lattice-issues.md) п. 3). Если список
пуст, каждый ref без нарушения SHALL давать информационную находку `{ code: "SHARED_IDENTITY", message }` в `data.findings[]`
(акт maintainer'а не отличить от акта агента под тем же аккаунтом; ref с `REF_NOT_VERIFIED` находки не даёт), а `merged_by`,
равный автору PR, — информационную находку `APPROVER_IS_AUTHOR`, не нарушение. Если список непуст, `merged_by`, равный автору PR
(INV-03) или входящий в `identities.agents` (для ref `MERGED` — M^1), SHALL быть `REF_NOT_VERIFIED` с причиной `merged_by`, кроме ref `MERGED`, к которому применено исключение (выше); находки `APPROVER_IS_AUTHOR` и
`SHARED_IDENTITY` не выдаются. Если ни один объект policy базы (packs и `.warrant/local/**`) не добавляет gate `human-approval` на `VERIFYING->MERGED`, вывод SHALL содержать информационную находку `{ code: "NO_HUMAN_ACCEPTANCE", message }` в `data.findings[]`: merge impl-PR агентом не ограничен ни одним путём ([ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 4).

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
- **none**: diff SHALL NOT трогать `openspec/changes/**`, `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**`,
  policy-пути, `paths.src` и `paths.tests` (код без Change, [ADR-0049](../../../../docs/adr/WARRANT-ADR-0049-flow.md) п. 7, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 8), иначе `SCOPE_VIOLATION`; без
  `paths.src` и `paths.tests` — запись в `skipped[]`.

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
- **WHEN** при `paths.src: "src"` diff PR содержит новый record `add-search` в `PROPOSED`, `openspec/changes/add-search/proposal.md`, запись review `.warrant/evidence/add-search/EVID-….json`, файл Run Change, `docs/adr/0042.md` и `src/app.py`
- **THEN** `data.kind` равен `spec`, `errors[]` содержит `SCOPE_VIOLATION` только с путём `src/app.py`, код 1; без `src/app.py` — код 0

#### Scenario: specs вне archive-PR
<!-- id: SCN-VER-074 -->
- **WHEN** diff PR без record ни одного Change содержит `openspec/specs/search/spec.md`
- **THEN** `data.kind` равен `none`, `errors[]` содержит `SCOPE_VIOLATION` с этим путём, код 1

#### Scenario: Вердикт impl-PR
<!-- id: SCN-VER-075 -->
- **WHEN** `warrant ci` под GitHub Actions на результате merge impl-PR Change `add-search` в `VERIFYING`, чья effective policy даёт `human-approval` на `VERIFYING->MERGED` (профиль приёмки), checks проходят, gate `human-approval` перехода `VERIFYING->MERGED` без evidence
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
- **THEN** `errors[]` содержит `REF_NOT_VERIFIED` с причиной `merged_by`, код 1; если слил maintainer, он же автор PR, а `identities.agents` базы пуст, — `REF_NOT_VERIFIED` нет, а `data.findings[]` содержит `APPROVER_IS_AUTHOR` и `SHARED_IDENTITY` (код выхода задают остальные правила, SCN-VER-090)

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
- **WHEN** честный archive-PR `add-search` дополнительно меняет `src/app.py` при `paths.src: "src"`
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
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `ci_evidence`; для пустого `gates` — с причиной `policy`; gate `PASS` перехода `MERGED` требует `{ kind: "test-report", check: "dev-check" }`, а `evidence[]` перехода несёт CI-запись `test-report` только от `tests-passed` — тоже `RECORD_MISMATCH` с причиной `ci_evidence` (design I-205); код 1

#### Scenario: Решение UNKNOWN не ослабляется
<!-- id: SCN-VER-116 -->
- **WHEN** record базы impl-PR в `SPECIFIED` содержит blocking `UNK-SRC-004`, закрытый решением с `ref`, а на HEAD этот элемент удалён; либо на HEAD у него `blocking: false`; либо `resolved_as: "fact"`
- **THEN** `errors[]` содержит `RECORD_MISMATCH` с причиной `unknowns` и `UNK-SRC-004`, код 1; открытый в базе blocking `UNK-SRC-005`, закрытый на HEAD решением с `ref`, `RECORD_MISMATCH` не даёт (его `ref` судит REQ-VER-013)

#### Scenario: Общий аккаунт и самослияние
<!-- id: SCN-VER-120 -->
- **WHEN** impl-PR вносит переход `APPROVED` с `ref` spec-PR, который слил `kat` из `roles.maintainer`, он же автор PR; `identities.agents` базы пуст
- **THEN** `REF_NOT_VERIFIED` нет, `data.findings[]` содержит `SHARED_IDENTITY` и `APPROVER_IS_AUTHOR`; при `identities.agents` базы `[{ "login": "warrant-agent[bot]" }]` — `REF_NOT_VERIFIED` с причиной `merged_by`, код 1, находок `SHARED_IDENTITY` и `APPROVER_IS_AUTHOR` нет; spec-PR открыл `warrant-agent[bot]`, слил `kat` — нет ни `REF_NOT_VERIFIED`, ни этих находок; слил `warrant-agent[bot]` — `REF_NOT_VERIFIED` с причиной `merged_by`

#### Scenario: WAIVED без засчитываемого waiver
<!-- id: SCN-VER-127 -->
- **WHEN** archive-PR вносит переход `MERGED` с `tests-passed: WAIVED`, а waiver этого Change на `tests-passed` в базе `REVOKED` и на HEAD `ACTIVE`, либо его нет ни в базе, ни на HEAD, либо его срок раньше даты прогона
- **THEN** `RECORD_MISMATCH` с причиной `waiver`, код 1; waiver `ACTIVE` в базе, одобренный логином из `roles` базы, со сроком не раньше даты прогона, при `waivable: true` gate — правило не нарушено

#### Scenario: NOT_APPLICABLE без основания
<!-- id: SCN-VER-128 -->
- **WHEN** переход `MERGED` записывает `NOT_APPLICABLE` gate с `applies_when.changed_paths: ["packages/cli/src/**"]`, diff `merge-base(M^1, M^2)..M^2` правит `packages/cli/src/a.ts`, а у записи evidence gate `evidence_status: "PROVEN"`
- **THEN** `RECORD_MISMATCH` с причиной `not_applicable`, код 1; тот же переход, где каждый элемент `requires_evidence` gate удовлетворён CI-записью `NOT_APPLICABLE` от check на M^2, — правило не нарушено; `scope-valid: NOT_APPLICABLE` (без `applies_when` и без `requires_evidence`) — `not_applicable`

#### Scenario: Реализация не одним impl-PR
<!-- id: SCN-VER-135 -->
- **WHEN** PR1 с кодом класса и record в `IMPLEMENTING` слит в `main`; impl-PR M несёт только `IMPLEMENTING->VERIFYING`, его слил `homasters`; record Change на M^1 — `IMPLEMENTING`, effective policy по M^1 не содержит `human-approval`
- **THEN** `REF_NOT_VERIFIED` с причиной `merged_by` и находка `AGENT_MERGE_CLOSED`, код 1; тот же PR, слитый членом `roles.maintainer` M^1 (не автором PR), — ref верифицирован, находка `AGENT_MERGE_CLOSED` есть, код 0; в SCN-VER-131 находки нет

#### Scenario: Impl-PR снял с себя приёмку
<!-- id: SCN-VER-129 -->
- **WHEN** impl-PR, слитый `homasters` из `identities.agents`, правит `packages/cli/src/core/ci/refs.ts`, сузил `match.paths` профиля приёмки в `.warrant/local/**` и убрал профиль из record; archive-PR вносит `MERGED` с его `ref`. Либо тот же impl-PR перенёс `homasters` из `identities.agents` в `roles.maintainer`
- **THEN** `REF_NOT_VERIFIED` с причиной `merged_by`, код 1: `classify` по packs M^1 выводит профиль приёмки из diff impl-PR, а `roles` и agents берутся из M^1

#### Scenario: Impl-PR слил агент без human-approval
<!-- id: SCN-VER-130 -->
- **WHEN** archive-PR вносит `MERGED` с `ref` impl-PR, который открыл и слил `homasters` из `identities.agents` M^1, а effective policy по M^1 не содержит `human-approval` на `VERIFYING->MERGED`
- **THEN** ref верифицирован: нет `REF_NOT_VERIFIED`, нет находок `SHARED_IDENTITY` и `APPROVER_IS_AUTHOR`, код 0; тот же PR, слитый логином вне `roles` и `identities.agents` M^1, — `REF_NOT_VERIFIED` с причиной `merged_by`, код 1

#### Scenario: Impl-PR слил агент при human-approval
<!-- id: SCN-VER-131 -->
- **WHEN** тот же archive-PR, но effective policy по M^1 содержит `human-approval` на `VERIFYING->MERGED` (профиль приёмки по путям diff)
- **THEN** `REF_NOT_VERIFIED` с причиной `merged_by`, код 1

#### Scenario: Spec-PR слил агент
<!-- id: SCN-VER-132 -->
- **WHEN** impl-PR вносит `APPROVED` с `ref` spec-PR, который слил `homasters` из `identities.agents` базы; `approvals[]` перехода `SPECIFIED->APPROVED` пуст
- **THEN** `REF_NOT_VERIFIED` с причиной `merged_by`, код 1: одобрение spec — член `roles.maintainer`

#### Scenario: Код без Change
<!-- id: SCN-VER-133 -->
- **WHEN** PR без Change (вид none) правит `src/a.ts` при `paths.src: "src"`
- **THEN** `SCOPE_VIOLATION` с путём `src/a.ts`, код 1; без `paths.src` и `paths.tests` — запись в `skipped[]`, нарушения нет, код 0

#### Scenario: Проект без приёмки человеком
<!-- id: SCN-VER-134 -->
- **WHEN** `warrant ci` в проекте, где ни pack, ни `.warrant/local/**` не дают `human-approval` на `VERIFYING->MERGED`
- **THEN** `data.findings[]` содержит `NO_HUMAN_ACCEPTANCE`; находка информационная, код выхода она не меняет

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
`setup`, OpenSpec, CLI, `warrant validate` и `warrant sync --check` (красный шаг — красный job: дрейф сгенерированных файлов и lock против `warrant.json`; согласованную правку с перегенерацией держит защита форжа, [ADR-0051](../../../../docs/adr/WARRANT-ADR-0051-agent-merge-first.md) п. 3, 7), `warrant ci` с выводом вне checkout, upload artifact по `data.artifact`. Секретов workflow SHALL NOT
требовать: токен — `github.token` вызывающего; вызывающий SHALL дать job права `contents: read`, `actions: read`,
`pull-requests: read`, `issues: read` (форж `warrant ci`). Тег CLI во входе `warrant` и ref, по которому вызван workflow, выбирает
вызывающий; пример 06 §8 даёт один тег в обоих местах. Workflow `ci.yml` этого репозитория SHALL вызывать job `warrant` через
него с `warrant: checkout` (один источник); проект под WARRANT вызывает его по тегу CLI вместо копии job. Имя проверки в GitHub
становится `warrant / warrant`: обязательные проверки branch protection настраивает maintainer проекта; WARRANT их не требует
(показ настроек форжа — класс C модели угроз, [ADR-0048](../../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2, цикл 1; 06 §8).

#### Scenario: Job warrant из reusable workflow
<!-- id: SCN-VER-122 -->
- **WHEN** читаются `.github/workflows/warrant.yml` и `.github/workflows/ci.yml` репозитория
- **THEN** `warrant.yml` объявляет `workflow_call` со входами `setup`, `node-version`, `openspec-version`, `warrant` (обязательный), `merge_commit`, шаг проверки входа `warrant` до установки CLI, шаги `warrant validate` и `warrant sync --check` после установки CLI и до шага `warrant ci`; для тега CLI ставится `npm pack "github:Homasters-max/SRA#<тег>" --ignore-scripts=false` в каталоге под `$RUNNER_TEMP` и `npm i -g` файла `.tgz`, установки `npm i -g github:` нет; job `warrant` в `ci.yml` — `uses: ./.github/workflows/warrant.yml` с `warrant: checkout`, без собственных `steps`, с правами `contents`, `actions`, `pull-requests`, `issues` на чтение; `merge_commit` передаётся из входа `workflow_dispatch`
