---
id: WARRANT-DOC-06A
title: Evidence contract
status: normative
maturity: MVP
version: 0.1.0
---

# 06a. Evidence contract

## 1. Claim и evidence

```text
Test:      "test passed"
Evidence:  claim "customer_id остаётся уникальным после миграции"
           + test_run_id + dataset_version + query + result + timestamp
```

- **Claim** — утверждение, которое нужно доказать. Ссылается на ID (`REQ`, `SCN`, `DCT`, gate).
- **Evidence** — воспроизводимая запись о том, что было продемонстрировано.
- Evidence ≠ test result. Test result — сырьё; evidence связывает его с claim, subject и контекстом.
- Evidence MUST быть воспроизводимым: из записи понятно, что, на чём и чем проверялось.

## 2. Запись evidence

```json
{
  "$schema": "warrant://evidence/1",
  "id": "EVID-000921",
  "claim": { "text": "Ingestion is idempotent", "targets": ["REQ-ING-001", "SCN-ING-003"] },
  "kind": "test-report",
  "level": "L1",
  "evidence_status": "PROVEN",
  "subject": {
    "commit": "abc1234",
    "spec_revision": "openspec/specs/ingestion@abc1234",
    "dataset_snapshot": null
  },
  "produced_by": { "type": "check", "id": "pytest", "version": "1.0.0", "run": "RUN-000417" },
  "attestation": { "type": "ci", "ref": "ci://runs/8812" },
  "context_hash": "sha256:…",
  "effective_policy_hash": "sha256:…",
  "created_at": "2026-09-22T10:00:00Z",
  "artifacts": [{ "uri": "ci://runs/8812/junit.xml", "sha256": "…" }],
  "limitations": []
}
```

| Поле | Правило |
|---|---|
| `kind` | Из каталога kinds, объявленных packs (`test-report`, `schema-diff`, `review`, `human-approval`, …) |
| `level` | L0 / L1 / L2 по источнику |
| `produced_by.type` | `check` (L0/L1), `skill` (L2), `human` |
| `attestation` | Кто ручается за происхождение записи (§3) |
| `limitations` | Что evidence **не** доказывает (scope, выборка, окружение) |
| `metrics` | Необязательно. Числовые результаты check; JSON Schema объявляет pack для своего kind (например, `mutation-report`, [ADR-0016](adr/WARRANT-ADR-0016-mutation-diff-scope.md)) |

Если check сравнивал результат с параметром policy (порог), применённое значение MUST быть записано в `metrics`.
Gate сверяет его с текущим effective param в пред-фильтре допустимости ([06 §3](06-verification.md)); расхождение →
finding `STALE`, evidence исключается.

## 3. Кто создаёт evidence

- Evidence MUST записываться только CLI или CI. Агент MUST NOT писать в `.warrant/evidence/` напрямую.
- Skill MAY **предложить** evidence (результат review); CLI записывает его как `level: L2`, `produced_by.type: skill`.
- Hashes, timestamps, commit SHA MUST вычисляться инфраструктурой, а не LLM.

### Attestation

Решение — [WARRANT-ADR-0009](adr/WARRANT-ADR-0009-change-record-attestation.md). Доверие evidence определяется
тем, **где оно произведено**, а не подписью. Два класса:

| Класс | Примеры | Правило |
|---|---|---|
| Воспроизводимое (L0 / L1) | tests, `analyze`, `openspec validate` | Не подписывается. Локальная запись — черновик, CI пересчитывает и замещает её. |
| Невоспроизводимое | human approval, L2 review, rollback rehearsal, runtime observation | Требует attestation. |

| `attestation.type` | Кто ручается | `ref` |
|---|---|---|
| `ci` | Запись создана CLI внутри CI-запуска | id запуска |
| `human-review` | Человек через PR review / approval API | URL review |
| `signature` | Подпись зарегистрированного ключа (`warrant.json` → `trusted_signers`) | id подписи |
| `sef-approval` | Владелец через `sef work approve` (транспорт `sef-hub`, proposed, [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)) | `sef://<project>/approval/<work>-r<N>@<commit>` |
| `sef-gate` | Гейт SEF в контейнере гейтов (транспорт `sef-hub`, proposed) | `sef://<project>/attempt/<id>/gate/<gate-id>` |
| `none` | Локальный запуск CLI | — |

- Gate объявляет допустимые типы: `"accepts_attestation": ["ci", "human-review"]`. По умолчанию `none` не засчитывается
  для gates перехода `VERIFYING → MERGED` (INV-10).
- L2 review для risk `HIGH` MUST выполняться отдельным Run в CI (attestation `ci`); для `MEDIUM` MAY выполняться локально
  с записью `"limitations": ["produced locally, unattested"]`.
- Ключи подписи MUST NOT выдаваться агентам: агент, подписывающий собственное evidence, нарушает INV-03. Ключи — у CI и людей.
- `signature` — Maturity: later (кандидат: keyless signing, Sigstore / gitsign) для runtime и data evidence, произведённого вне CI.

## 4. Статусы

| `evidence_status` | Значение |
|---|---|
| `PROVEN` | Claim продемонстрирован в заявленном scope |
| `NOT_PROVEN` | Проверка выполнена, claim не подтверждён |
| `INCONCLUSIVE` | Проверка выполнена, результат не позволяет сделать вывод |
| `NOT_APPLICABLE` | Claim к данному Change не относится (по правилу, не по мнению) |

Бинарный PASS/FAIL для evidence не используется: это создаёт ложное ощущение завершённости.

### Достаточность

«Test passed» не всегда доказывает «migration safe». Детерминированная часть достаточности — `requires_evidence`
в gate (какие kinds нужны). Семантическая часть (покрывает ли evidence claim по scope, observed vs inferred,
пробелы покрытия) — skill `semantic/evidence-reasoning` (SRA); его результат — L2 finding.

## 5. Evidence manifest

Один manifest на Change: `.warrant/evidence/<change>/manifest.json`.

```json
{
  "$schema": "warrant://evidence-manifest/1",
  "change": "add-customer-search",
  "commit": "abc1234",
  "versions": {
    "warrant": "0.1.0",
    "openspec": "1.13.2",
    "lock_hash": "sha256:…",
    "effective_policy_hash": "sha256:…"
  },
  "runs": ["RUN-000415", "RUN-000417"],
  "evidence": ["EVID-000919", "EVID-000921"],
  "gates": {
    "tests-passed": "PASS",
    "evidence-complete": "PASS",
    "reconciliation-passed": "NOT_APPLICABLE"
  }
}
```

### Хранение

- `manifest.json` и записи evidence MUST коммититься (они маленькие).
- Тяжёлые raw-артефакты (логи, отчёты, дампы) SHOULD храниться в CI artifacts и ссылаться по `uri` + `sha256`.
- `.warrant/runs/` MAY храниться вне git (CI storage), если manifest содержит ссылки на Run.

## 6. Context hash

`context_hash` отвечает: на каком именно контексте агент принимал решение.

```text
canonical JSON { change, specs, ADR, glossary, relevant code refs, effective_policy_hash, skill@version }
→ SHA-256
```

- Canonical JSON: сортированные ключи, UTF-8, без пробелов (RFC 8785 JCS).
- Код и файлы входят как `path + sha256`, а не содержимым.

## 7. Runtime evidence

Status: proposed · Maturity: later

После исполнения (release, data run) runtime-наблюдения MAY становиться evidence для Change:
input/output version, schema version, row counts, quality results, errors, checksums.
Runtime observation подтверждает или опровергает claim и MAY порождать новый Change.
Детали — [09-pack-data](09-pack-data.md), [12-evolution](12-evolution.md).
