# Design: phase-3b

## Context

Код фазы 3 и фиксов ревью (v0.3.1) даёт всё, на что опирается 3b: gate engine — чистая функция `evaluateGates` (`core/gates/verdict.ts`:
пред-фильтр, шаги 06 §3, `applyWaivers` с проверкой `approved_by` ∈ roles после R-2), калькуляторы L0 (`core/gates/l0/*`, таблица по id
gate), controller (`core/controller/{inputs,evaluate}.ts`, fallback `verify-incomplete`), `resolveForProject` → `POLICY_CONFLICT` из
`core/resolve/merge.ts`, запись record (`core/record/write.ts`: матрица 04 §2, `RECORD_FROZEN`), `transition` (`human-approval` по
`--ref --by`, `COMMIT_NOT_MERGED` по R-1), `classify` (`core/classify/*`: floor/proposer/human, `BELOW_FLOOR`), `validate` (1)–(12)
(`core/validate/*`, `core/ids/immutable.ts` для (9)), runner `check` (`core/check/*`). Решения фаз 1–3 (D-1…D-25, P-1…P-20, I-1…I-101) и
нарезка V-1…V-9 ([NEXT-SESSION](../../../docs/NEXT-SESSION.md)) — данность.

Ограничения: kernel-схемы остаются `major = 1` — только добавление необязательных полей и ослабление `required`, не ломающее
существующие файлы; `warrant validate` на репозитории зелёный после каждой группы; ≤ 6 групп, ~30 задач (G-8); версия поставляемого
поднимается первым изменением после `v0.3.1` (R-14, `versions.test.ts`).

## Goals / Non-Goals

**Goals:**
- Норма (main specs после archive) совпадает с кодом по R-1, R-2, R-4, R-5, R-14; открытые находки ревью R-6…R-10, R-13 закрыты кодом и SCN.
- Каждое поле схемы, которое фаза 3 только валидировала и которое не требует `guard`/`sync`/mutation, получает писателя или исполнителя.
- Change проходит P-2 без отступлений: `SPECIFIED` в spec-PR, `APPROVED`/`IMPLEMENTING` первым и `VERIFYING` последним коммитом impl-PR.

**Non-Goals:**
- Изменение алгоритма resolver'а, порядка слоёв, шагов 06 §3 (кроме уточнений R-9 и waiver-предиката).
- Новые kinds evidence и новые parsers; любые hooks; API форджа.

## Decisions

### 1. Один предикат «waiver засчитан» (R-2, R-8)

`core/gates/waivers.ts` (новый): `waiverStatus(waiver, gateDefinition, ctx) → { counts: true } | { counts: false, reason }` с причинами
`state`, `expired`, `approver`, `waivable`, `targets` — ровно порядок проверок `applyWaivers`. `applyWaivers` (шаг 4) и `evidence-complete`
вызывают его; `evidence-complete` дополнительно требует у записи kind'а `evidence_status ∈ {PROVEN, NOT_APPLICABLE}`. Альтернатива —
второй, «мягкий» предикат для извинения kind'а (как в I-99) — отвергнута: R-8 показал, что расхождение двух копий и есть дефект.
Unit-тест I-96 с `review` `NOT_PROVEN` меняет ожидание на `FAIL` (решение R-8).

### 2. `NOT_APPLICABLE` только от check (R-9)

В `verdict.ts` шаг 1: `NOT_APPLICABLE` засчитывается только при `produced_by.type === "check"`; иначе запись участвует как недоказанная
(шаг 5 → `FAIL`) и даёт finding `NOT_APPLICABLE_UNTRUSTED`. Альтернатива «исключить в пред-фильтре как `STALE`» отвергнута: запись не
устарела, а недоверена; `BLOCKED` вместо `FAIL` скрыл бы, что вход есть. Сейчас ни один parser `NOT_APPLICABLE` не производит — меняется
только ветка для рукописных/человеческих записей.

### 3. Controller: `CONTINUE` не маскирует `FAIL`/`BLOCKED` (R-13)

`evaluateController` при совпадении правила с `action: "CONTINUE"` и `gate_verdict ∈ {FAIL, BLOCKED}` пропускает его, добавляет finding
`CONTROLLER_RULE_IGNORED` и продолжает сопоставление; findings controller'а — новый выход функции, `gate`/`verify`/`status` дописывают их
в `data.findings[]`. Альтернативы: статический запрет в `validate` — `when` сравнивает произвольные входы, доказать непересечение с
`FAIL`/`BLOCKED` нельзя без интерпретатора; kernel fallback до правил проекта — ломает правило `gate-failed` pack'а (оно само даёт `WAIT`).

### 4. `EVIDENCE_KIND_UNGATED` как конфликт policy (R-7)

После merge слоёв `core/resolve/merge.ts` строит множество kinds из `requires_evidence` всех gates всех переходов effective policy
(определения gates — из загруженных packs, с override'ами) и для каждого kind из `evidence.required` вне множества добавляет элемент
конфликта `{ code: "EVIDENCE_KIND_UNGATED", kind }`. Существующий путь `POLICY_CONFLICT` → controller `ESCALATE` не меняется.
Альтернатива — проверка `validate` по всем комбинациям profiles × risk — отвергнута: перебор большой, а конфликт реален только для
конкретной classification. Golden и репозиторий: у core-sdd каждый required kind читается gate'ом — `hash` effective policy не меняется.

### 5. `transition MERGED`: `REF_MISMATCH` и limitation `human-approval` (R-6, R-10)

После выбора записей, на которых вынесены verdicts `VERIFYING->MERGED` (они уже в `transition.evidence[]`), каждая с
`attestation.type === "ci"` сверяется с `--ref` строковым равенством после нормализации завершающего `/`; расхождение → `REF_MISMATCH`
(код 3, список EVID) до записи record. Запись `human-approval` получает `limitations: ["ref not verified (phase 4: warrant ci)"]`;
переиспользование записи (I-92) сравнивает login и ref, limitations не мешают пред-фильтру (он ищет только `scoped:`). Альтернатива «ref
только у свежейшей записи» отвергнута: смешение run'ов и есть R-6.

### 6. Gate `spec-approved` (D-3, V-9)

`core/gates/l0/spec-approved.ts`: из record — последний переход `to: "APPROVED"`, из его `evidence[]` — запись kind `human-approval`
(по id из store), её `subject.commit` = A; оцениваемый commit B (HEAD или commit `MERGED`). Дерево — `git ls-tree -r <sha> --
openspec/changes/<change>/proposal.md openspec/changes/<change>/specs` (пары path → blob sha); сравнение множеств пар A и B, разница —
`SPEC_CHANGED_AFTER_APPROVAL` с путями. Hash blob'ов git достаточен: сравнивается одно дерево в двух commit'ах, канонизация не нужна.
Нет перехода/записи/git → `BLOCKED/NO_INPUT`. На `MERGED->ARCHIVED` gate не стоит (каталог перемещается). Gate — L0 без
`requires_evidence`, `waivable: true`: правка контракта после approval — осознанное решение maintainer'а через `warrant waive` с reason
`I-N` (V-9). Нормативно фиксируется ADR-0024 (amends ADR-0020 п. 9: состав дерева без `design.md`; `waivable`). Альтернативы — повторный
`APPROVED` из `IMPLEMENTING` (ломает `scope-valid` `SPECIFIED->APPROVED` на diff с кодом) и `waivable: false` (запрет уточнений spec в
impl-PR, которых в фазе 3 было четыре) — отвергнуты в V-9.

### 7. `execution.local` (ADR-0017 п. 4)

Runner до запуска команды: `local === "scoped-only"` ∧ attestation окружения `none` ∧ нет `--paths` → `CHECK_LOCAL_FORBIDDEN` (код 3,
ничего не запущено, замок не берётся). Attestation определяется той же функцией `core/evidence/attestation.ts`, что и запись, — одно
определение «локально». `verify` трактует ошибку как прочие ошибки check (REQ-VER-006). `ci-only`, `guard_prefixes` — не исполняются
(later / фаза 4); схема их по-прежнему принимает.

### 8. `warrant link` и `warrant waive` — писатели через общие модули

`commands/link.ts`: чтение record, проверка состояния (`PROPOSED`/`SPECIFIED`), цели — та же функция, что проверка (10) `validate`
(`core/validate/links.ts` отдаёт предикат допустимости цели), запись через `core/record/write.ts` (`RECORD_FROZEN` из общей заморозки).
`commands/waive.ts`: три режима по флагам (`--activate`, `--revoke` взаимоисключающие; без них — создание); следующий `WAV-<год>-NNN`
— новый `core/ids/waiver-id.ts` (скан имён `.warrant/waivers/*.json`), gate и `waivable` — из загруженных packs, роль — `roles.maintainer`.
Файлы — `writeJsonFile`. Подкоманды (`waive activate`) отвергнуты: позиционное `activate` неотличимо от имени Change.

### 9. Схемы: `ref` у значения risk и `approved_by` у `PROPOSED`

`change-record.1`: у каждого `risk_entry_*` необязательный `ref` (`$ref` URL из `common.1`) + `if { from: human:* } else { not: { required: [ref] } }`.
`waiver.1`: `approved_by` удаляется из `required`, добавляется `if { waiver_state ≠ PROPOSED } then { required: [approved_by] }`. Оба —
ослабление/уточнение без поломки существующих файлов; `sync` обновляет копии `.warrant/schemas/`. Проверка (11) `validate` сверяет
`approved_by` с roles только если поле задано.

### 10. `classify` ниже floor

`core/classify`: human-значение ниже floor с `ref` не попадает в `belowFloor`, а побеждает floor по этому измерению; при последующих
запусках значение из record с `from: human:*` и `ref` считается «одобренным понижением» и так же побеждает floor (в `data.ignored` —
`approved-below-floor`), пока новый `--set` этого измерения его не заменит. Роль — из `approvals[]` перехода `SPECIFIED->APPROVED`
effective policy (как `transition`, I-92), состояние record — `PROPOSED`/`SPECIFIED`. Альтернатива — отдельная evidence
`human-approval` на понижение — отвергнута (V-4): classification не gate, а вторая запись approval смешалась бы с записью перехода
`APPROVED` в `evidence-complete` и `spec-approved`.

### 11. `validate`: I-77 и `ID_DANGLING`

I-77: `checkImmutableIds` получает множество «ID, снятых архивом»: для каждого каталога `openspec/changes/archive/<dir>/`, отсутствующего
в `HEAD` (`git ls-tree`), читаются delta `specs/**/spec.md`, заголовки под `## REMOVED Requirements`; для этих заголовков в версии
`openspec/specs/<cap>/spec.md` из `HEAD` берутся ID требования и его сценариев — их исчезновение не нарушение. Проверка (13):
`core/validate/dangling.ts` — регулярное выражение ID по тексту `tasks.md` активных Changes и файлов под `paths.tests` (рекурсивно, текстовые
файлы до 1 MiB, пропуск бинарных по NUL-байту), множество объявленных — из уже вычисленного `scanIds` (specs, changes, archive).
Репозиторий WARRANT `paths.tests` не задаёт: тесты содержат синтетические ID фикстур (`REQ-KRN-200`, `REQ-ZZZ-001`), проверка шла бы по ним.

### 12. Процедуры `.claude/commands/`

`decision.md` — найти активный Change по ветке (`spec/|worktree/|archive/<change>`), взять максимальный `I-N` по всем design.md (активный и
архивы), дописать строку в таблицу «Решения по ходу реализации»; `group-done.md` — проверка ветки и worktree, `npm run typecheck`,
`npm test`, `warrant validate`, `warrant fmt --check`, `warrant sync --check`, `npm run versions:check`, галочки группы N в tasks.md,
коммит; `next-session.md` — обновить разделы «Состояние», «Долг», «Готовый запрос», таблицу «Процессные правила». Ни одного правила о
форме: каждая процедура вызывает проверки, которые уже держат правило (таблица «Процессные правила → чем держатся»).

### 13. Версии и порядок

Задача 2.1 поднимает CLI `0.4.0`, pack `core-sdd` `0.3.0` (`kernel: ">=0.1 <0.5"`), `.warrant/warrant.json` `kernel: "0.4"` и
`packs.core-sdd.version: "^0.3.0"` (репозиторий и golden-фикстуры), `npm run golden:update` — до любого другого изменения
поставляемого (R-14). Порядок групп: 1 (без кода) → 2 → 3 → 4 → 5 → 6; 4 зависит от 3 (схемы), 5 — от 2 (предикат waiver, версия pack).

### 14. Dogfooding

Profiles и risk — `warrant classify phase-3b` по diff spec-PR (floor `.warrant/**` → `SYSTEM`, `factory-change`). Waivers
`WAV-2026-003` (`analyze-clean`) и `WAV-2026-004` (`adversarial-review`) кладутся файлами в spec-PR (V-8): `warrant waive` появится
только в impl-PR, а `adversarial-review` стоит на `SPECIFIED->APPROVED`. Если impl-PR уточнит delta specs — waiver на `spec-approved`
создаётся `warrant waive` и активируется maintainer'ом (первое реальное использование команды).

## Risks / Trade-offs

- [ADR-0024 меняет D-3 (ADR-0020 п. 9) — норму, одобренную ревью] → отдельный ADR с `amends`, D-3 в NEXT-SESSION помечается «уточнено V-9».
- [`spec-approved` `waivable: true` превращает gate в «сигнал + waiver»] → waiver требует `approved_by` ∈ `roles.maintainer` и reason; finding
  перечисляет изменённые файлы, reviewer impl-PR их видит.
- [`EVIDENCE_KIND_UNGATED` может сломать проект, где kind требуется «на будущее»] → внешних проектов нет; сообщение называет kind.
- [I-77 по заголовкам требований: переименование + REMOVED в одном change] → `RENAMED` OpenSpec сохраняет ID под новым заголовком; при
  расхождении — ложный `ID_IMMUTABLE`, то есть fail-closed.
- [`paths.tests` в проектах с синтетическими ID в тестах] → проверка включается только явным `paths.tests`; репозиторий WARRANT его не задаёт.
- [R-6 ломает archive-PR, если evidence собрано из двух run'ов] → это и есть цель; README описывает: artifact одного run'а.

## Migration Plan

1. Spec-PR: artifacts, record, waivers `WAV-2026-003/004`, NEXT-SESSION (V-1…V-9); `transition SPECIFIED`.
2. Impl-PR: первым коммитом `APPROVED --ref <review spec-PR> --by` и `IMPLEMENTING`; группы 1–6; последним — `VERIFYING`.
3. Archive-PR: evidence из artifact'а CI, `transition MERGED --ref <run> --commit <impl-head>`, `warrant archive phase-3b`, tag `v0.4.0`.
4. Откат: `git revert` группы; новые поля схем необязательны, команды `link`/`waive` ничего не пишут без вызова.

## Решения по ходу реализации

| # | Решение | Где |
|---|---|---|
| I-102 | `WAIVER_IGNORED.reason` — ровно имена REQ-VER-003: `not-waivable` переименован в `waivable`; не-`ACTIVE` waiver на gate теперь даёт finding с `reason: "state"` (раньше молча пропускался) | 2.2, `core/gates/waivers.ts` |
| I-103 | Пред-фильтр (`metrics.waivers[]` → waiver `ACTIVE`) использует тот же предикат `waiverStatus`: запись, ссылающаяся на waiver с `targets[]` или на невэйвабельный gate, исключается как `STALE`. Фаза 5 (D-10, частичные waivers) пересматривает это место — `metrics.waivers` предназначен именно для waivers с `targets[]` | 2.2, `core/gates/prefilter.ts` |
| I-104 | Controller-rules project-слоя раньше только проверялись схемой и не загружались; `loadLocalLayer` теперь загружает `.warrant/local/**` `warrant://controller-rules/1` как правила pack `local`, они применяются после правил всех packs (SCN-VER-049 требует `.warrant/local/controller/rules.json`) | 2.4, `core/packs/loader.ts` |
| I-105 | `REF_MISMATCH` проверяется после прохождения gates (`GATES_NOT_PASSED` приоритетнее); запись `ci` без `attestation.ref` — несовпадение | 2.6, `commands/transition.ts` |
| I-106 | Конфликт artifacts и `EVIDENCE_KIND_UNGATED` в одной policy — один `POLICY_CONFLICT` с обоими элементами `items[]`; fixture pack `policy` тестов получил gate `reconciliation-checked` (его kind требовался без gate) | 2.5, `core/resolve/*`, `test/fixtures/packs/policy` |
| I-107 | Условия схем записаны в форме, которую принимает strict-режим ajv: `change-record.1` — `else.properties.ref: false`; `waiver.1` — `else` объявляет `approved_by` перед `required`. Waiver без `approved_by` не в `PROPOSED` даёт `SCHEMA_VIOLATION` по `/approved_by` и второй по корню (`if`); `ref` — inline `format: uri`, как `transitions[].ref` (URL-определения в `common.1` нет) | 3.1, `packages/cli/schemas/{change-record,waiver}.1.schema.json` |
| I-108 | `ID_DANGLING`: `path` — файл, строка и ID — в `message` (`<ID> (line N)`), как у `ID_FORMAT`/`ID_PLACEMENT`; лимиты 1 MiB и NUL-байт — только для `paths.tests`, `tasks.md` читается всегда. I-77: заголовки сравниваются после trim и схлопывания пробелов, исключение — только для `openspec/specs/<cap>/spec.md` той же capability, что delta | 3.3, 3.4, `core/validate/dangling.ts`, `core/ids/immutable.ts` |
| I-109 | Номер waiver выдаёт существующий `allocateWaiver` (`core/ids/allocate.ts`, им пользуется `warrant id WAV`), а не новый `core/ids/waiver-id.ts`; он учитывает и id внутри файлов, и имена `WAV-<год>-NNN.json` | 4.2, `core/ids/allocate.ts` |
| I-110 | `waive --revoke` waiver'а в `PROPOSED` записывает `approved_by: "human:<login>"` отзывающего maintainer'а (схема требует `approved_by` во всех состояниях, кроме `PROPOSED`): `approved_by` — человек, принявший решение по waiver (активация или отказ); отзыв `ACTIVE` сохраняет прежнего approver'а | 4.2, `commands/waive.ts` |
| I-111 | `classify --ref` принимается при хотя бы одном `--set` измерения risk (не только ниже floor), без него — `USAGE`; `ref` пишется на все значения risk этого вызова, проверки состояния и роли — при любом `--ref`; роли approval — из effective policy classification до вызова (при конфликте policy — `maintainer`) | 4.3, `core/classify/*`, `commands/classify.ts` |
| I-112 | Одобренное понижение вытесняет только floor (текущий и значение record с источником `floor:*`); значение proposer'а или human из record не понижается (`below-record`); новый `--set` измерения без `--ref` снимает одобрение, повторное понижение ниже floor — снова `BELOW_FLOOR` | 4.3, `core/classify/index.ts` |
| I-113 | `link --remove` не проверяет цель (снять ставшую недопустимой связь можно); пустой список удаляет ключ `amends`/`supersedes`; ссылка Change на самого себя — `LINK_TARGET_INVALID` | 4.1, `commands/link.ts` |
| I-114 | `waive --owner` — строго `human:<login>` (REQ-KRN-031), хотя схема допускает любую непустую строку (пример 05 §7 — команда); `--activate`/`--revoke` не проверяют заморозку Change (spec не требует) | 4.2, `commands/waive.ts` |
| I-115 | `spec-approved`: при нескольких записях `human-approval` в `evidence[]` последнего перехода `APPROVED` берётся новейшая по id (все на commit перехода); сравниваются только blob sha дерева контракта (смена mode или submodule — не изменение контракта); `signals.contract` собирается, только если `spec-approved` среди оцениваемых gates | 5.2, `core/gates/l0/spec-approved.ts`, `commands/gate.ts` |
| I-116 | `execution.local: "scoped-only"` локально отказывает (`CHECK_LOCAL_FORBIDDEN`) и когда `--paths` заданы, но у check нет `run.scoped_command`: иначе I-80 выполнил бы полный `run.command`, то есть локальный полный прогон, который `scoped-only` запрещает (решение координатора; субагент предлагал полный прогон с предупреждением) | 5.3, `commands/check.ts` |
