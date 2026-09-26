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
| `guard_prefixes` | первые токены `run.command` | По ним `warrant guard` отклоняет прямой запуск |

- Замок занят → код `2`, `errors[0].code: "BUSY"` с держателем замка; `--wait` ждёт до `timeout_s` (CI; later).
  Замок мёртвого pid снимается автоматически с записью в журнал Run (later, D-23).
- `warrant check <id> --paths …` запускает `scoped_command`; без значения пути берутся из diff. Evidence
  суженного прогона несёт `limitations: ["scoped: <paths>"]` и исключается пред-фильтром допустимости (§3).
- Для checks с `exclusive` или `local ≠ allowed` guard отвечает `deny` на Bash-команду с совпавшим префиксом
  и подсказывает `warrant check`.

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

### Алгоритм verdict

Сначала **пред-фильтр допустимости evidence** (D-12): запись исключается из рассмотрения с finding `STALE`, если
`subject.commit` / `subject.base_commit` отличаются от текущих (у записи с `subject.spec_tree` вместо них сравнивается
дерево spec Change на оцениваемом коммите, [ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 3); `metrics.threshold` ≠ текущий effective param
([06a §2](06a-evidence.md)); `limitations` содержит `scoped: …` (суженный прогон, [ADR-0017](adr/WARRANT-ADR-0017-check-execution.md));
отпечаток target частичного waiver, применённого check, не совпадает с текущим кодом ([ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md) п. 7).

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

`BLOCKED` ≠ `FAIL` (P-7): нет ни одной допустимой записи нужного kind (не было прогона или все записи исключены
пред-фильтром) → `BLOCKED` с finding `NO_EVIDENCE`, controller отвечает `verify-incomplete`; запись есть, но её статус ≠
требуемому → `FAIL`. L0-gates без `requires_evidence` вычисляет сам CLI; для них `BLOCKED` — только при отсутствии
входа (не git-репозиторий, нет `openspec`).

## 4. Каталог gates

Profiles ссылаются только на ID. Определение gate существует в одном месте — в pack, который его поставляет.

| Gate | Level | Waivable | Pack | Проверяет |
|---|---|---|---|---|
| `spec-valid` | L1 | нет | core-sdd | `openspec validate` проходит |
| `required-artifacts-present` | L0 | нет | core-sdd | Все `artifacts.required` есть |
| `blocking-unknowns-resolved` | L0 | нет | core-sdd | Нет открытых blocking UNKNOWN |
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

В транспорте `sef-hub` `analyze` дополнительно сверяет TASK ↔ sef item (`source_ref`): TASK без item — `MISSING`,
с несколькими items — `AMBIGUOUS` ([ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)).

Пример:

```text
REQ-ING-014: есть в spec; нет task, нет test, нет evidence → UNSATISFIED
```

MVP (фаза 4b, [ADR-0036](adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 2) — `warrant analyze <change> [--base <ref>]` выдаёт
три вида находок; ничего не пишет, код 1 при находке. ID «определён», если объявлен в main specs или в `ADDED` /
`MODIFIED` delta Change и не объявлен в `REMOVED` delta.

| Finding MVP | Условие |
|---|---|
| `UNSATISFIED` `{id, missing[]}` | REQ из `ADDED` / `MODIFIED` delta: `tasks.md` не упоминает ни его, ни один его SCN (`missing` ∋ `task`), или ни один его SCN не встречается в файлах `paths.tests` (`missing` ∋ `test`) |
| `CONFLICT` `{id, path}` | `tasks.md` упоминает неопределённый REQ или SCN (например, `REMOVED`) |
| `ORPHAN` `{id, path}` | Файл `paths.tests`, изменённый в diff `base...HEAD`, упоминает неопределённый SCN |

Без `paths.tests` проверка тестов не выполняется, без diff — `ORPHAN`; каждый пропуск — в `data.skipped[]` с причиной. Gate
`analyze-clean` вычисляется той же функцией на оцениваемом commit: находка → `FAIL`, иначе `PASS`, нет diff → `BLOCKED`
`NO_INPUT` (§4). `MISSING`, `AMBIGUOUS`, `STALE`, связь evidence с REQ через `claim.targets` — после MVP, по failure mode.

Семантическая согласованность (требования противоречат по смыслу, сценарий не соответствует терминологии,
acceptance criterion не наблюдаем, requirement смешивает what и how) — это skill
`specification/consistency` (SRA). Его результат — L2 evidence и findings, не вердикт.

## 6. Traceability

Минимальная цепочка:

```text
Change → REQ → SCN → TASK → code → test → Run → EVID
```

Для data (pack data):

```text
Change → DCT → transformation → dataset → quality check → EVID
```

Traceability MUST строиться из ID и ссылок в artifacts. Матрица — projection, вычисляемая `analyze`;
graph database не требуется.

Связь test → SCN / REQ задаётся тегом или аннотацией в тесте (`@SCN-ING-003`) — формат задаёт pack тестового стека.

## 7. Adversarial review

Схема: **Author → Draft → Reviewer (отдельный Run, отдельный контекст) → Revised**.
Достаточно двух ролей; «совет из 10 моделей» MUST NOT использоваться — это шум.

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

В MVP (фаза 4b) reviewer — отдельный Run `review` ([03 §4](03-architecture.md)): skill `specification/adversarial-review`
исполняет субагент Claude Code `warrant-reviewer` (генерирует `warrant sync`), результат сдаёт `warrant run submit`;
evidence `review` судит gate `adversarial-review` на `SPECIFIED->APPROVED` ([02 §2](02-vocabulary.md)).

## 8. CI — последняя инстанция

- CI MUST заново вычислять все L0/L1 gates для merge.
- Доверие evidence определяется тем, где оно произведено, а не подписью: воспроизводимое (L0/L1) CI пересчитывает,
  невоспроизводимое принимается только с attestation, которую допускает gate ([06a §3](06a-evidence.md)).
- CI MUST блокировать merge при `FAIL`, `BLOCKED` и отсутствии required evidence.
