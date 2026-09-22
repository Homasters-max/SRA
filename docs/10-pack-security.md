---
id: WARRANT-DOC-10-SECURITY
title: Pack security — overlays, threat model, security checks
status: proposed
maturity: later
version: 0.1.0
---

# 10. Pack `security`

Security — **не profile** ([05 §2](05-policy.md)). Это измерение `security_impact` и overlay, который усиливает policy
любого profile. Pack не добавляет этапов в цикл ([04 §1](04-lifecycle.md)): threat review — это artifact плюс gates.

## 1. Состав

По правилу выбора абстракции [01 §3](01-principles.md):

| Вопрос | Что поставляет pack |
|---|---|
| Новое правило | overlays `security-medium.json`, `security-high.json` с `match` по `security_impact` ([05 §4](05-policy.md)); floor rules для `**/crypto/**`, `**/secrets/**`, `**/permissions/**` |
| Детерминированная проверка | checks: secret scan, dependency audit, SAST. Инструменты — проектные (`.warrant/local/checks/`); pack задаёт gate и evidence kinds |
| Новый тип знания | template `threat-model` |
| Reasoning | skills SRA: `security/threat-modeling`, `code-review/security` (отдельный Run, [07 §6](07-skills.md)) |

## 2. Overlays

| `security_impact` | Дополнительно к effective policy |
|---|---|
| `MEDIUM` | artifact `threat-model` (required); gate `security-checks-passed`; gate `threat-review` |
| `HIGH` | всё из `MEDIUM`; approval роли `security-owner` на merge (gate `security-approval`); `PRODUCTION_WRITE` forbidden явно |

Approval человека при `HIGH` — прямое следствие INV-11: ИИ не может быть единственным approver security-critical change.

## 3. Gates

| Gate | Level | Waivable | Проверяет |
|---|---|---|---|
| `security-checks-passed` | L1 | нет | Secret scan, dependency audit, SAST без findings выше порога `params.severity_threshold` |
| `threat-review` | L2 | да | Threat model рассмотрен reviewer'ом; blocking findings закрыты |
| `security-approval` | L0 | нет | Approval роли `security-owner`; attestation `human-review` |

Evidence kinds: `sast-report`, `dependency-audit`, `secret-scan`, `threat-review`.

## 4. Threat model

Template отвечает на: assets · trust boundaries · entry points · threats · mitigations. Каждая mitigation
MUST ссылаться на REQ или SCN, иначе `analyze` даёт `ORPHAN`. Abuse-сценарии (authorization, invalid input)
записываются как обычные OpenSpec Scenario с SCN ID; второго формата сценариев нет ([10-pack-bdd-tdd](10-pack-bdd-tdd.md)).

## 5. Golden

Golden case `failed-security-check` ([12 §2](12-evolution.md)) принадлежит этому pack:

```text
Given: change touches **/auth/**; secret scan finds a credential
Then:  gate security-checks-passed = FAIL; controller_action = STOP
```

## 6. Открытые вопросы

- Порог severity по умолчанию и формат нормализации отчётов разных SAST-инструментов в один evidence kind.
- Нужен ли отдельный capability `NETWORK` для implementer при `HIGH`, или это остаётся уровнем frontend.
