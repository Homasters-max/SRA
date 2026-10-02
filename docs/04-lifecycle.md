---
id: WARRANT-DOC-04
title: Жизненный цикл, controller и enforcement
status: normative
maturity: MVP
version: 0.1.0
---

# 04. Жизненный цикл, controller и enforcement

## 1. Цикл WARRANT

Весь процесс — один повторяющийся цикл. Profiles не добавляют этапы, они параметризуют цикл.

```text
       ┌──────────────────────────────────────────────────────┐
       ▼                                                      │
   classify ──▶ resolve ──▶ next ──▶ operation ──▶ check ──▶ gate
                                                              │
                                   controller_action ◀────────┘
                            CONTINUE / WAIT / STOP / ESCALATE
```

| Шаг | Кто выполняет | Детерминирован |
|---|---|---|
| classify | CLI (path rules) + proposer (LLM / JEV) + human | итог — да |
| resolve | CLI | да |
| next | CLI (controller) | да |
| operation | агент через skill (SRA) или CLI | зависит от операции |
| check | CLI / CI | да |
| gate | CLI / CI | да |

## 2. Состояния Change

```text
PROPOSED → SPECIFIED → APPROVED → IMPLEMENTING → VERIFYING → MERGED → ARCHIVED
    └────────────── ABANDONED (из любого состояния до MERGED) ──────────────┘
```

Это **не waterfall**. OpenSpec допускает свободное редактирование artifacts: если design оказался неверным, design исправляется, и работа продолжается. Возврат назад (`VERIFYING → IMPLEMENTING`, `IMPLEMENTING → SPECIFIED`, а до одобрения — `SPECIFIED → PROPOSED`, [ADR-0056](adr/WARRANT-ADR-0056-lattice-fixes-0-10-1.md) п. 3) разрешён; переделка spec после `SPECIFIED → PROPOSED` — снова spec-PR, `APPROVED --ref` называет spec-PR переделки; переход вперёд — только через gates, указанные для перехода в effective policy.

После `ARCHIVED` неизменны каталог архива, record и evidence Change; исправление — новый Change с `amends`. `ABANDONED` замораживает record и удаляет каталог Change тем же коммитом ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)).

| Переход | Gates профиля `feature` (core-sdd@0.1) | Где вычисляется |
|---|---|---|
| `PROPOSED → SPECIFIED` | `required-artifacts-present`, `spec-valid`, `ids-valid` | локально |
| `SPECIFIED → APPROVED` | `spec-valid`, `required-artifacts-present`, `ids-valid`, `blocking-unknowns-resolved`, `adversarial-review`, `human-approval` | CI на spec-PR (кроме `human-approval` — branch protection) |
| `APPROVED → IMPLEMENTING` | `branch-isolated` | локально |
| `VERIFYING → MERGED` | `tests-passed`, `scope-valid`, `analyze-clean`, `ids-valid`, `evidence-complete` | CI на impl-PR |
| `MERGED → ARCHIVED` | `spec-valid`, `required-artifacts-present`, `analyze-clean` | `warrant archive` + CI на archive-PR |

Конкретный набор определяет effective policy ([05](05-policy.md)), каталог — [06](06-verification.md). Каждый переход привязан к виду PR ([ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md)).

## 3. Operations

| Operation | Назначение | Исполнитель | Результат |
|---|---|---|---|
| `classify` | Определить profiles и risk | CLI + proposer | classification в Change metadata |
| `clarify` | Найти decision-relevant неопределённости | skill | UNKNOWN / ASSUMPTION / DECISION, правки spec |
| `specify` | Создать / изменить artifacts OpenSpec | skill + OpenSpec | proposal, specs, design, tasks |
| `review` | Adversarial review спецификации или кода | skill (отдельный Run) | findings → L2 evidence |
| `implement` | Реализация одобренной задачи | CLI оркестрирует, skill рассуждает | код, тесты |
| `analyze` | Найти рассогласования spec ↔ design ↔ tasks ↔ tests ↔ code | CLI (+ skill для семантики) | findings |
| `verify` | Запустить checks и вычислить gates | CLI / CI | evidence, verdicts |
| `converge` | Закрыть найденные gaps | skill | правки кода / tasks |
| `archive` | Завершить Change | OpenSpec | обновлённые specs |

### Правила operations

- `analyze` MUST только обнаруживать, классифицировать и сообщать. Он MUST NOT исправлять.
- `converge` MUST NOT менять spec или design, чтобы подогнать их под код. Если код не соответствует spec — это `FAIL`; решение «исправить код» или «изменить spec» принимается явно, изменение spec — отдельная правка с review.
- `implement` — операция CLI: создаёт Run, собирает Context Pack, вызывает skill, запускает checks, собирает evidence. Skill MUST NOT сам решать, что implementation завершена.
- `clarify` задаёт вопрос только если ответ способен изменить spec, design, test, risk или data semantics.

## 4. Controller

Controller — **таблица решений**, а не workflow engine. Правила упорядочены; срабатывает первое подходящее. Таблица поставляется pack'ом (базовая — `core-sdd`) и расширяется другими packs.

```json
{
  "$schema": "warrant://controller-rules/1",
  "rules": [
    { "id": "policy-conflict",      "when": { "policy_conflict": true },            "action": "ESCALATE" },
    { "id": "gate-failed-hard",     "when": { "gate_verdict": "FAIL", "gate_waivable": false }, "action": "STOP" },
    { "id": "gate-failed-waivable", "when": { "gate_verdict": "FAIL", "gate_waivable": true },  "action": "WAIT" },
    { "id": "blocking-unknown",     "when": { "blocking_unknowns": ">0" },          "action": "WAIT", "next": "clarify" },
    { "id": "missing-artifact",     "when": { "missing_required_artifacts": ">0" }, "action": "CONTINUE", "next": "specify" },
    { "id": "approval-pending",     "when": { "pending_approvals": ">0" },          "action": "WAIT" },
    { "id": "impl-incomplete",      "when": { "open_tasks": ">0" },                 "action": "CONTINUE", "next": "implement" },
    { "id": "awaiting-attestation", "when": { "gates_awaiting_attestation": ">0" }, "action": "WAIT" },
    { "id": "verify-incomplete",    "when": { "unevaluated_gates": ">0" },          "action": "CONTINUE", "next": "verify" },
    { "id": "gaps",                 "when": { "analyze_findings": ">0" },           "action": "CONTINUE", "next": "converge" },
    { "id": "done",                 "when": {},                                     "action": "CONTINUE", "next": "archive" }
  ]
}
```

Определения входов (вычисляет CLI, все — из record, effective policy и evidence):

| Вход | Значение |
|---|---|
| `pending_approvals` | Gates с evidence kind `human-approval` без валидного evidence |
| `gates_awaiting_attestation` | Gates, чей `accepts_attestation` не содержит `none`, при отсутствии evidence с допустимой attestation (ждём CI или review; локальный `verify` их не закроет) |
| `unevaluated_gates` | Gates перехода с verdict `BLOCKED` или ещё не вычисленные, кроме двух категорий выше |

`gate-failed-waivable` даёт `WAIT`, а не проваливается до `done`: человек либо чинит причину, либо оформляет waiver.

Controller MUST быть чистой функцией: одинаковое состояние Change + effective policy → одинаковый результат.

### Quality loop

```text
SPEC → IMPLEMENT → VERIFY → ANALYZE → converged? ── yes → MERGE → ARCHIVE
                      ▲                    │
                      └──── CONVERGE ◀─ no ┘
```

## 5. Git discipline

Status: normative · Maturity: MVP

Топология Change имеет два транспорта ([ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)): `github` (MVP, ниже) и `sef-hub` (со срезом S1 SEF, proposed: `sef work approve` → попытка → `landing`; archive — `landing` после последнего TASK).

Транспорт `github` — [WARRANT-ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md). Два PR на Change плюс archive:

```text
propose / specify  → ветка spec/<change> от актуального main → PR → human review → merge   (SPECIFIED → APPROVED)
implement          → ветка worktree/<change> (worktree SHOULD) → PR → CI gates → merge      (VERIFYING → MERGED)
archive            → warrant ci fetch, warrant archive → ветка archive/<change> → PR → merge                  (MERGED → ARCHIVED)
```

Вердикт каждого PR выносит `warrant ci` в CI (§6, §7): impl-PR — на результате merge с tip базы, так что evidence судит то, что вливается в `main` (R-12); `main` сдвинулся до merge — Re-run job, после merge — run восстановления `workflow_dispatch` на merge-коммите ([ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 3, 4).

- Ветка spec MUST создаваться от актуального `main`: агент должен видеть все authoritative specs и другие changes. «На main» означает контекст, а не commit target.
- Implementation MUST выполняться в отдельной ветке `worktree/<change>`; отдельный git worktree — SHOULD. Gate `branch-isolated` проверяет ветку, потому что CI не видит worktree.
- Impl-PR валиден, только если в base есть merged spec-PR с approving review — так INV-01 проверяется машиной.
- Merge MUST проходить через CI, который заново вычисляет gates; ни одного коммита в `main` вне PR.
- Транзиции record едут в *следующем* PR ([§9](#9-change-record)); между PR `warrant status` показывает `STALE` штатно.
- `openspec archive` MUST вызываться только через `warrant archive`: OpenSpec сам не проверяет граф artifacts и архивирует пустой Change (spike S2).
- Отказ от Change — ветка `abandon/<change>`: `warrant transition … ABANDONED` и удаление каталога одним коммитом → PR ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md) п. 8).
- Archive и abandon — только PR: судья на push в `main` не запускается ([ADR-0052](adr/WARRANT-ADR-0052-cycle-1-close.md) п. 7).

## 6. Enforcement

Prompt не является enforcement (INV-04). Принуждение распределено по слоям:

| Слой | Что принуждает | Maturity |
|---|---|---|
| **CLI** `warrant` | Разрешает переходы состояний, пишет record, evidence и runs | MVP |
| **CI** `warrant ci` | Выносит вердикт PR на результате merge: вид PR и Change — по record в diff, а не по ветке; требования — из базы (HEAD^1, [ADR-0038](adr/WARRANT-ADR-0038-pr-judged-by-base.md)); структура record, refs `APPROVED` / `MERGED` через форж, правила путей (`openspec/specs/**` — только результат archive, R-16); impl-PR — checks `VERIFYING->MERGED` и evidence с `subject.tree`; archive-PR — CI-evidence по ссылке ([ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md)). С 0.9.0 — основание записанных `WAIVED` / `NOT_APPLICABLE` и merge impl-PR агентом по policy его базы ([ADR-0051](adr/WARRANT-ADR-0051-agent-merge-first.md)). Не пишет в репозиторий ([ADR-0010](adr/WARRANT-ADR-0010-trust-by-reference.md)) | MVP (4c); красный job — сигнал «не сливать»: branch protection на приватном репозитории без GitHub Pro недоступна |
| **Форж** (GitHub) | Bot-идентичность агента без права merge; branch protection на `main`; required review | MVP |
| **ACP client** (диспетчер SEF, [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)) | Наблюдает `tool_call`, `validate --files` после правки, `session/cancel` при записи вне `write_scope`, проверка живости hooks ([ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md)) | S1 SEF; в MVP нет |
| **Hook** `warrant guard --frontend <name>` | `pre`: отказ вне `write_scope` (и непустого `scope`) активного Run и на прямой запуск тяжёлых checks по `guard_prefixes` ([ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)); без активного Run — `deny` для `paths.src`, `paths.tests`, `openspec/changes/**` и policy-путей ([ADR-0022](adr/WARRANT-ADR-0022-path-rules.md) п. 7); при активном Run `review` — `deny` любой правки и любой shell-команды, кроме `warrant run submit`, команд без записи (`warrant status`, `warrant gate`, `warrant … --help`, `git status | log | diff | show`, `cd` внутри проекта) и отмены `warrant run finish --state CANCELLED` ([ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md), [ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 5); сбой — `deny` (fail-closed); `post` (всегда `allow`): находки `validate --files` по изменённому файлу ([ADR-0019](adr/WARRANT-ADR-0019-post-edit-hints.md)) и текст ещё не показанных в Run правил по путям, без Run — находки и подсказка `run start`; решение — `allow` или `deny`, каждое событие при активном Run — в `guard_events[]`. Без `--frontend` — нормализованное событие ([ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md) п. 2) и конверт, код 0 при любом решении | MVP: адаптер `claude` ([ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md)), в том числе хук во frontmatter субагента `warrant-reviewer` (4b); `codex` — до S1 SEF; `opencode` — later |
| **Static deny** frontend'а | `permissions.deny` в `.claude/settings.json` ([ADR-0014](adr/WARRANT-ADR-0014-claude-code-enforcement.md) п. 1), генерируется `warrant sync` при `frontends ∋ claude`: `Edit(/…)` на `.warrant/changes/**`, `.warrant/evidence/**`, `.warrant/runs/**`, `openspec/specs/**`, `openspec/config.yaml`, `openspec/schemas/**` (якорь `/` — корень проекта; `Edit(…)` покрывает и `Write`, записи `Write(…)` Claude Code не применяет — зонд Claude Code 2.1.263) и `Bash(git push origin main:*)`, `Bash(gh pr merge:*)`, `Bash(openspec archive:*)` | MVP (адаптер `claude`) |

WARRANT **agent-agnostic**: вся логика в CLI, который общается JSON. Frontends — адаптеры, которые переводят родной формат агента в нормализованное событие `warrant guard` и обратно ([ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md)). В MVP реализацию ведёт Claude Code в ручном режиме под hooks — адаптер `claude`, только локальный режим ([ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md), [ADR-0014](adr/WARRANT-ADR-0014-claude-code-enforcement.md)); слой ACP — диспетчер SEF со среза S1 ([ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)); адаптер `codex` — до среза S1. Hooks внутри агента — ускорение, а не гарантия: запрет до действия, если они загружены; дальше ACP и CI.

Известный предел: deny на `Edit` / `Write` не мешает записи через shell. Гарантия — не hook, а CI: запись без верифицируемого ref не проходит `warrant ci`.

### Capabilities

| Capability | Spec author | Implementer | Verifier | Принуждение в MVP |
|---|---|---|---|---|
| `READ_REPO`, `READ_SPEC`, `READ_EVIDENCE` | ✓ | ✓ | ✓ | informative: чтение не ограничивается |
| `WRITE_SPEC` | ✓ | — | — | `write_scope` Run + hook `warrant guard`; static deny `openspec/specs/**` — адаптер `claude` ([ADR-0014](adr/WARRANT-ADR-0014-claude-code-enforcement.md) п. 1) |
| `WRITE_CODE` | — | ✓ | — | `write_scope` Run |
| `RUN_TEST` | — | ✓ | ✓ | — |
| `RUN_DATA_CHECK` | — | — | ✓ | pack `data`, later |
| `GIT_COMMIT` | ✓ | ✓ | — | — |
| `GIT_PUSH` (только `spec/<change>`, `worktree/<change>`) | ✓ | ✓ | — | права GitHub App + hook |
| `OPEN_PR` | ✓ | ✓ | — | права GitHub App |
| `MERGE`, push в `main`, `PRODUCTION_WRITE` | — | — | — | branch protection; у бота нет права merge |

Роли и capabilities — часть policy; profile MAY запрещать capabilities, но MUST NOT разрешать то, что запрещено вышестоящим overlay ([05](05-policy.md)). `MERGE` и `PRODUCTION_WRITE` агентам не выдаются.

## 7. CLI

Все команды MUST поддерживать JSON-вывод (по умолчанию для не-TTY). Контракт ответа:

```json
{
  "command": "verify",
  "ok": true,
  "change": "add-customer-search",
  "data": { "controller_action": "CONTINUE", "next": "implement", "rule": "impl-incomplete" },
  "errors": []
}
```

| Команда | Назначение | Maturity |
|---|---|---|
| `warrant init [--frontend claude]` | Инициализировать `.warrant/`, mapping схем для редакторов; `--frontend claude` — `frontends: ["claude"]` в `warrant.json` и `.claude/settings.json` через `sync`. Bootstrap-Change без policy gates | MVP |
| `warrant init change <name>` | `openspec new change --schema warrant-sdd --json` + record в `PROPOSED`; отказ при повторном имени | MVP |
| `warrant status [change]` | Состояние Change, effective policy, verdicts, `STALE`, следующая операция | MVP |
| `warrant classify <change> [--propose <json>] [--set <dim>=<v> … --by <login> [--ref <url>]]` | Классификация: path rules + proposal агента + human overrides; `--set … --by` — значение человека из роли approval; ниже floor — только с `--ref` и только до `APPROVED` ([05 §4](05-policy.md)) | MVP |
| `warrant resolve <change> [--explain]` | Вычислить effective policy с происхождением каждого требования | MVP |
| `warrant next <change>` | Отдельной команды нет: ответ controller (`controller_action`, `next`, `rule`) печатают `verify` и `status` | later |
| `warrant run start <change> --operation specify\|implement\|review [--scope <globs>] [--task <label>] [--dry-run]` | Создать Run (`specify` ⇐ `PROPOSED`, `implement` ⇐ `IMPLEMENTING`, `review` ⇐ `PROPOSED` с пустым `write_scope` и `spec_tree`), записать `current`; JSON — Context Pack: `write_scope[]`, `scope[]`, `rules[]` (пересекающие итоговый scope, [ADR-0022](adr/WARRANT-ADR-0022-path-rules.md); у `review` — пусто), `items[]`, `context_hash` ([03 §4](03-architecture.md)); второй активный — `RUN_ACTIVE`; `review` при незакоммиченных `proposal.md` / `specs/**` Change — `SPEC_UNCOMMITTED`; `specify` / `implement` при незакоммиченных файлах внутри `write_scope` — находка `UNCOMMITTED_IN_SCOPE` с путями в `data.findings[]`, Run стартует ([ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 5) | MVP (4a; `review` — 4b) |
| `warrant run finish [--state SUCCEEDED\|FAILED\|CANCELLED] [--dry-run]` | Закрыть активный Run (`run_state`, `finished_at`), удалить `current`; без активного — `RUN_NOT_ACTIVE` | MVP (4a) |
| `warrant run submit [--file <path>] [--dry-run]` | Принять envelope `skill-result/1` ([07 §4](07-skills.md)) из файла или stdin для активного Run `review`: envelope — в `<state>/runs/<RUN>.result.json`, evidence `review` (`attestation: none`, `limitations`, `subject.spec_tree`; статус — по находкам `BLOCKER`, [02 §2](02-vocabulary.md)), Run закрыт с `run_state` envelope; JSON — `data{run, change, evidence, evidence_status, findings{BLOCKER, MAJOR, MINOR, INFO}}`, код 0 при любом статусе; без активного Run — `RUN_NOT_ACTIVE`, Run не `review` — `STATE_INVALID`, envelope не по схеме, чужой `run` или не skill review pack'а — `SKILL_RESULT_INVALID` с JSON Pointer; повтор после обрыва — запись с `produced_by.run` этого Run переиспользуется (`data.reused: true`), другой envelope — `EVIDENCE_CONFLICT` («Восстановление Run») | MVP (4b) |
| `warrant guard [--frontend <name>]` | `pre` — разрешить / отклонить по `write_scope` и тяжёлым checks ([ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)); `post` — hints ([ADR-0019](adr/WARRANT-ADR-0019-post-edit-hints.md)); без `--frontend` — нормализованное событие и конверт `data{decision, reason?, hints[]}` ([ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md)); `--frontend claude` — родной вход и ответ хука Claude Code (`deny` — `permissionDecision: "deny"`, hints `post` — `additionalContext`, `allow` `pre` — пустой ответ), код 0; неразборчивый вход — код 2 и stderr (§6) | MVP (адаптер `claude`) |
| `warrant unknown add <change> --area <AREA> --text <вопрос> [--blocking] [--dry-run]`, `warrant unknown resolve <change> <UNK> --as decision\|fact\|assumption --text <ответ> [--ref <url>] [--replace] [--dry-run]` | Записать UNKNOWN в `unknowns[]` record (`UNK-<AREA>-NNN` — следующий номер по spec, Changes и records; `AREA_UNKNOWN` с `hint`) и закрыть его: `resolution`, `resolved_as`, `ref`, перехода не пишет. Blocking — только `--as decision` с `--ref` на комментарий maintainer'а в PR, текст которого содержит id UNKNOWN (иначе `USAGE`; автора, текст и PR проверяет `warrant ci`); `fact` / `assumption` — для не-blocking, `assumptions[]` не дополняют; закрытый — `UNKNOWN_RESOLVED`, переписать — `--replace`; нет элемента — `UNKNOWN_NOT_FOUND`. Только в `PROPOSED` / `SPECIFIED`, иначе `STATE_INVALID` (вопрос реализации — строка `I-N` в `design.md`). JSON — `data{change, unknown, open_blocking[]}` ([02 §1](02-vocabulary.md), [ADR-0040](adr/WARRANT-ADR-0040-slice-fixes.md) п. 2) | MVP (0.8) |
| `warrant assumption add` | Записать ASSUMPTION без UNKNOWN; пока ASSUMPTION пишется только `unknown resolve --as assumption` (BL-66) | later |
| `warrant check <change> [id...] [--paths …] [--base <ref>]` | Запустить check(s) gates перехода, записать evidence; `--paths` — суженный прогон ([ADR-0017](adr/WARRANT-ADR-0017-check-execution.md)); `--wait` — ждать замок `exclusive` — later | MVP |
| `warrant gate <change> [id...] [--transition <FROM->TO>] [--base <ref>]` | Вычислить verdict(s) по записанному evidence и ответ controller; checks не запускает | MVP |
| `warrant verify <change> [--transition <FROM->TO>] [--base <ref>] [--paths …]` | `check` + `gate` + controller для всех требований effective policy перехода | MVP |
| `warrant analyze <change> [--base <ref>]` | Детерминированный анализ согласованности delta specs, `tasks.md` и тестов (`paths.tests`) по ID — находки `UNSATISFIED`, `CONFLICT`, `ORPHAN` ([06 §5](06-verification.md)); ничего не пишет; JSON — `data{change, findings[], counts, skipped[]}`, код 1 при находке, иначе 0; та же функция вычисляет gate `analyze-clean` | MVP (4b) |
| `warrant transition <change> <state> [--ref <url>] [--by <login>] [--commit <sha>]` | Записать переход, если gates перехода в `PASS` / `WAIVED` / `NOT_APPLICABLE`; `APPROVED` / `MERGED` только с `--ref` — URL pull request (spec-PR для `APPROVED`, impl-PR для `MERGED`; локально — по форме, через форж — `warrant ci`); `--by` — человек из роли approval; `MERGED`: оцениваемый commit — `--commit` или commit самой свежей записи evidence, head влитого impl-PR; записи CI — одного run по `attestation.ref` (иначе `REF_MISMATCH`), запись с `subject.tree` судится деревом merge-коммита ([ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 5); переходы назад — без gates; `ABANDONED` удаляет каталог Change ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)) | MVP |
| `warrant link <change> --amends\|--supersedes <target> [--remove]` | Связь с исправляемым (`MERGED` / `ARCHIVED`) или заменяемым (`ABANDONED`) Change; `--remove` — снять связь; только в `PROPOSED` / `SPECIFIED` ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)) | MVP |
| `warrant sync-state <change>` | Прочитать форж (review, merge, CI run) и записать соответствующие переходы с refs | MVP |
| `warrant archive <change>` | Только из `MERGED`: `openspec validate --strict` → gates `MERGED → ARCHIVED` → `openspec archive --yes --json` → переход `ARCHIVED` | MVP |
| `warrant ci [--dry-run]` | Вердикт PR в CI (§6): HEAD — результат merge (родители — tip базы и head PR), иначе `USAGE`; `WARRANT_STATE_DIR` — `USAGE`; Change и `data.kind` (`spec`, `impl`, `archive`, `abandon`, `none`) — по record в diff `HEAD^1..HEAD`, два Change — `TOPOLOGY_VIOLATION`; нарушения — `RECORD_MISMATCH` (в том числе причина `unknowns`: PR после `SPECIFIED` удалил или ослабил элемент `unknowns[]` record базы), `REF_NOT_VERIFIED` (в том числе причина `decision`: ref решения blocking UNKNOWN в PR с новым `APPROVED`; причина `merged_by` при непустом `identities.agents` базы — `merged_by` равен автору PR или агенту, [ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 3), `SCOPE_VIOLATION`, `GATE_NOT_PASSED`, `CHANGE_NOT_VERIFYING`, `EVIDENCE_NOT_VERIFIED`, `SPECS_NOT_ARCHIVED`; находки `APPROVER_IS_AUTHOR` (при пустом `identities.agents` базы), `SHARED_IDENTITY` (там же, на каждый проверенный акт, [06 §8](06-verification.md)), `ROLES_CHANGED`, `FRONTEND_HOOKS_INACTIVE`, `DECISION_NOT_VERIFIED` (ref решения UNKNOWN в PR без нового `APPROVED`, [ADR-0040](adr/WARRANT-ADR-0040-slice-fixes.md) п. 3) — в `data.findings[]`; impl-PR пишет evidence в рабочую копию и выводит `data.artifact{ name: "evidence-<change>-<attempt>", path }` для upload; `--dry-run` — вид, Change и план checks без checks и форжа. JSON — `data{kind, change?, transitions[], gates?, deferred[]?, findings[], skipped[], evidence[]?, artifact?}` | MVP (4c) |
| `warrant ci fetch <pr> [--dry-run]` | Шаг archive-PR: evidence CI слитого impl-PR в `<state>/evidence/<change>/` — попытка run (`pull_request` на head M^2 или `workflow_dispatch` после merge), чьи записи несут `subject.commit` = M^2 и `subject.tree` = дерево M; только `EVID-*.json` побайтно, `manifest.json` и `raw/` artifact'а — нет; повтор идемпотентен; ошибки — `PR_NOT_FOUND`, `PR_NOT_MERGED`, `PR_NOT_IMPL`, `COMMIT_NOT_FOUND`, `NO_CI_EVIDENCE` (`hint` — `gh workflow run <файл workflow run head PR> -f merge_commit=<M>`), `EVIDENCE_CONFLICT`, `SCHEMA_VIOLATION`, `BUSY`; `--dry-run` — выбранный run и `data.would_write[]`. JSON — `data{pr, change, merge_commit, tree, run, evidence[], skipped[]}` | MVP (4c) |
| `warrant id <prefix> <area>`, `warrant id renumber <old> <new>` | Выдать stable ID; перенумеровать до `MERGED` при коллизии | MVP |
| `warrant validate [--files <paths>]` | Конфигурация, packs, JSON Schema, IDs, сгенерированные YAML, отсутствие токенов; `--files` — только проверки одного файла ([ADR-0019](adr/WARRANT-ADR-0019-post-edit-hints.md)) | MVP |
| `warrant fmt` | Привести JSON к каноническому виду | MVP |
| `warrant sync` | Сгенерировать `openspec/config.yaml`, schema, свои записи `.claude/settings.json` (MVP; `.codex/hooks.json` — с адаптером `codex`, [ADR-0034](adr/WARRANT-ADR-0034-phase-4-frontend.md)), `AGENTS.md` ([ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)), файл субагента `.claude/agents/warrant-reviewer.md` при `frontends ∋ claude` (4b) из packs; обновить lock. Нет skill review (`specification/adversarial-review`) в lock при `frontends ∋ claude` — находка `REVIEWER_SKILL_MISSING` с `hint` в `data.findings[]` (по умолчанию пустом), код 0; прежний файл субагента с маркером удаляется, `--check` — `GENERATED_DRIFT` (4c). Записанный `sync` или `init` файл, который Claude Code читает при старте сессии (`.claude/agents/**`, `.claude/settings.json`, `AGENTS.md`), — находка `FRONTEND_RESTART_REQUIRED` с `path` и `hint` перезапустить сессию, код 0; `--check` её не даёт ([ADR-0042](adr/WARRANT-ADR-0042-lattice-fixes.md) п. 5) | MVP |
| `warrant waive <change> <gate> --reason … --risk … --control … --owner … --expires …`, `warrant waive --activate <WAV> --by <login>`, `warrant waive --revoke <WAV> --by <login>` | Создать waiver в `PROPOSED` (агент MAY); активировать / отозвать — человек из `roles.maintainer`; только waivable gate, без `targets[]` ([05 §7](05-policy.md)) | MVP (было: later, [ADR-0013](adr/WARRANT-ADR-0013-mvp-refinement.md)) |

Коды выхода (REQ-KRN-003, [ADR-0052](adr/WARRANT-ADR-0052-cycle-1-close.md) п. 2): у каждого кода ошибки один класс во всех командах — `1` нарушение правила (нарушения PR `warrant ci`), `2` ожидание действия (`GATES_NOT_PASSED`, `POLICY_CONFLICT`), `3` конфигурация, вход, невалидный или расходящийся с каноном и генерацией файл, отказ доступа к форжу (`FORGE_ACCESS`), сбой `git` или `openspec`, `INTERNAL`, `4` сбой инфраструктуры, повтор может пройти (`BUSY`, `CHECK_TIMEOUT`, `FORGE_UNAVAILABLE`; элемент `errors[]` несёт `retryable: true`). Действие controller — `CONTINUE` `0`, `STOP` `1`, `WAIT` / `ESCALATE` `2` — входит в код `gate`, `verify`, `transition` и `archive`; находки `analyze` — `1`. Код — старший по приоритету `3` > `1` > `4` > `2` > `0`; повторять вызов имеет смысл только при `4`. Переход по умолчанию у `check`, `gate`, `verify` — следующий вперёд от `change_state`. `check` — `0`, если evidence записано (в том числе `NOT_PROVEN`). `ci` — `0` без нарушений, `1` при нарушении PR (`WAIT` controller'а тоже нарушение: у CI нет «подожди»); gate, оставшийся `BLOCKED` из-за ошибки check, `GATE_NOT_PASSED` не даёт — код выбирает ошибка check. `ci fetch` — ничего не записано при любой ошибке. `fmt --check`, `sync --check`, `validate`, `validate --files` с находками — `3`. `warrant guard` — вне таблицы: решение — `0`, `--frontend` — коды протокола frontend (REQ-ENF-004, REQ-ENF-005).

### Восстановление Run

Возобновления упавшего Run нет: у Run нет точки сохранения, которой можно доверять; отмена и новый Run дешевле ([ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 5). Каждый файл состояния CLI пишет атомарно — временный файл того же каталога, затем rename (п. 4), запись из нескольких файлов — в порядке «записи evidence → `manifest.json` → record или Run». Обрыв оставляет:

| Точка обрыва | Что на диске | Что делать |
|---|---|---|
| `run start` до `current` | Run `RUNNING` без указателя | ничего: Run не активен; файл — мусор, `warrant status` его не показывает |
| Run `RUNNING`, исполнитель упал | Run и `current` | `warrant run finish --state CANCELLED` (или `FAILED`), затем новый `run start`; под Run `review` guard эту отмену пропускает |
| `run submit` после evidence, до Run | evidence, Run `RUNNING` | повторить `warrant run submit --file <тот же файл>`: запись с `produced_by.run` этого Run переиспользуется (`data.reused: true`), другой envelope — `EVIDENCE_CONFLICT` |
| запись evidence до `manifest.json` (`check`, `transition` с `human-approval`, `ci fetch`, `run submit`) | запись вне `manifest.evidence[]`, находка `warrant validate` | следующая запись evidence Change (`warrant verify`) пересобирает manifest из каталога; `run submit` — повтор (строка выше) |
| замок остался после `kill -9` | `<state>/runs/<id>.lock` или `current.lock` | удалить файл, если процесса нет (hint `BUSY`) |
| временный файл записи | `.*.tmp` рядом с JSON | удалить; прежний JSON цел, `validate` временные файлы не читает |

## 8. Human approval

Approval — gate `human-approval` с evidence вида `human`. Минимальные точки:

- переход `SPECIFIED → APPROVED` для risk ≥ medium;
- merge для классов из INV-11;
- любой waiver;
- понижение risk ниже вычисленного floor.

В MVP approval фиксируется через PR review; CLI читает его как evidence с attestation `human-review` ([06a §3](06a-evidence.md)).

## 9. Change record

Status: normative · Maturity: MVP · Решение — [WARRANT-ADR-0009](adr/WARRANT-ADR-0009-change-record-attestation.md)

Governance-состояние Change (classification, risk, `change_state`) принадлежит WARRANT, а не OpenSpec (INV-06, [03 §2](03-architecture.md)). Оно хранится в `.warrant/changes/<change>.json`. Имя файла — ID Change без даты ([02 §3](02-vocabulary.md)), поэтому archive OpenSpec его не меняет.

```json
{
  "$schema": "warrant://change-record/1",
  "change": "add-customer-search",
  "change_state": "APPROVED",
  "classification": {
    "profiles": ["feature"],
    "risk": {
      "data_loss":       { "value": "NONE",   "from": "proposer:llm" },
      "reversibility":   { "value": "EASY",   "from": "proposer:llm" },
      "blast_radius":    { "value": "LOCAL",  "from": "floor" },
      "security_impact": { "value": "MEDIUM", "from": "floor" },
      "compatibility":   { "value": "COMPATIBLE", "from": "human:<login>" }
    },
    "risk_level": "MEDIUM"
  },
  "transitions": [
    { "to": "SPECIFIED", "at": "2026-09-22T09:00:00Z", "by": "cli:local", "effective_policy_hash": "sha256:…" },
    { "to": "APPROVED",  "at": "2026-09-22T11:00:00Z", "by": "ci:run/8812", "effective_policy_hash": "sha256:…",
      "gates": { "spec-valid": "PASS", "human-approval": "PASS" }, "evidence": ["EVID-000919"] }
  ]
}
```

Правила:

- Запись MUST выполняться только CLI. Агент и skills MUST NOT редактировать файл напрямую (как для evidence, [06a §3](06a-evidence.md)).
- Файл MUST коммититься: один Change — один файл, diff читаем, конфликтов нет.
- Каждое значение classification MUST хранить источник (`floor`, `proposer:*`, `human:*`), чтобы `resolve --explain` был воспроизводим ([05 §4](05-policy.md)).
- Переход вперёд MUST записываться вместе с verdicts gates перехода и ссылками на evidence. Валидность перехода в `APPROVED` и `MERGED` определяет верифицируемый `ref` (URL review, CI run, merge), а не писатель записи ([ADR-0010](adr/WARRANT-ADR-0010-trust-by-reference.md) п. 2): `by: "cli:local"` — кто записал, не основание доверия. До `warrant ci` (фаза 4) `ref` не верифицируется: `--ref` проверяется только как http(s) URL, `--by` — заявление, и запись `human-approval` несёт `limitations: ["ref not verified (phase 4: warrant ci)"]` (REQ-VER-007). (Было: «Переход в `APPROVED` и `MERGED` MUST опираться на evidence с attestation `human-review` или `ci`; запись, сделанная `cli:local`, для этих состояний невалидна» — заменено ADR-0010, I-93.)
- `ABANDONED` и `APPROVED` ниоткуда не выводятся и MUST быть записаны явно. Остальные состояния также записываются, но `warrant status` MUST сверять запись с производными сигналами (наличие artifacts, worktree, merge в git, каталог archive) и сообщать `STALE`, если они расходятся. Запись — акт перехода; вычисление — проверка, что акт всё ещё соответствует реальности.
- Файл — не второй source спецификации: он не содержит ни требований, ни tasks ([03 §8](03-architecture.md)).
- Необязательные `amends[]` (цель в `MERGED` / `ARCHIVED`) и `supersedes[]` (цель в `ABANDONED`) пишет `warrant link`; обратные `amended_by[]` / `superseded_by[]` не хранятся — их вычисляют `status` и `analyze`. После `ARCHIVED` или `ABANDONED` файл неизменен ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)). `status` сверяет `ABANDONED` с каталогом: `ABANDONED_DIR_PRESENT`, `DIR_MISSING_WITHOUT_TRANSITION` (D-22).
