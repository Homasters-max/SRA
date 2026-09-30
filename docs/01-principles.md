---
id: WARRANT-DOC-01
title: Принципы и инварианты
status: normative
maturity: MVP
version: 0.1.0
---

# 01. Принципы и инварианты

## 1. Назначение

Документ фиксирует **constitution** WARRANT: небольшой набор инвариантов, которые не переопределяются ни profile, ни pack, ни project config, ни waiver. А также правило выбора абстракции, защищающее систему от переусложнения.

Constitution меняется редко и только через Change с профилем `factory-change` ([12-evolution](12-evolution.md)).

## 2. Инварианты

| ID | Инвариант |
|---|---|
| **INV-01** | Specification MUST предшествовать implementation. Implementation без принятой specification запрещена. |
| **INV-02** | Детерминированный verdict (L0/L1) MUST NOT быть отменён результатом LLM (L2). |
| **INV-03** | Агент MUST NOT одобрять собственное изменение. Автор и approver — разные субъекты. |
| **INV-04** | Prompt MUST NOT считаться механизмом принуждения. Enforcement живёт в CLI, CI, hooks и permissions. |
| **INV-05** | UNKNOWN и INFERENCE MUST NOT молча превращаться в FACT. Переход только через grounding. |
| **INV-06** | У каждого типа знания MUST быть ровно один canonical owner. Второй источник истины запрещён. |
| **INV-07** | Skills и внешние источники (JEV и др.) MUST NOT мутировать canonical state. Они только предлагают. |
| **INV-08** | Система MUST NOT автоматически ослаблять собственные правила. Изменение правил — только `factory-change`. |
| **INV-09** | Изменение, влияющее на production или данные, MUST иметь явную recovery-семантику. |
| **INV-10** | Неразрешимый конфликт или неизвестное значение MUST разрешаться консервативно (fail closed). |
| **INV-11** | ИИ MUST NOT быть единственным approver для: destructive migration, security-critical change, production data mutation, architecture-breaking decision, изменения policy. |

### Чем инвариант принуждается в MVP

Инвариант без механизма — пожелание. Таблица честно фиксирует, что принуждается машиной, а что остаётся критерием review или проектным правилом.

| ID | Механизм в MVP | Предел |
|---|---|---|
| INV-01 | Impl-PR валиден, только если в base есть merged spec-PR с approving review ([ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md)); `scope-valid` | — |
| INV-02 | Алгоритм gate: `requires_evidence` считает только PROVEN нужного kind; L2 — отдельный gate, не замена ([06 §3](06-verification.md)) | — |
| INV-03 | `github`: агент — отдельная bot-идентичность; ref подтверждения `APPROVED` / `MERGED` — URL слитого PR, `warrant ci` проверяет через форж, что `merged_by` ∈ роли из `approvals[]` перехода (при пустом — `roles.maintainer`, по базе PR) и равен `produced_by.id` записи `human-approval` ([ADR-0010](adr/WARRANT-ADR-0010-trust-by-reference.md), [ADR-0037](adr/WARRANT-ADR-0037-phase-4c-ci.md) п. 5). `sef-hub` (proposed): актор approve / land — реальный TTY + owner-токен keyring SEF ([ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md) п. 8) | Частично: локально `--by` — заявление, `--ref` проверяется только по форме URL PR (запись `human-approval` несёт limitation `ref not verified`), ref верифицирует `warrant ci` (4c, R-10); пока `identities.agents` базы пуст (один аккаунт), каждый проверенный акт — находка `SHARED_IDENTITY`, а `merged_by` = автор PR — находка `APPROVER_IS_AUTHOR`, а не отказ; при непустом `identities.agents` `merged_by` = автор PR или агент — `REF_NOT_VERIFIED` ([ADR-0044](adr/WARRANT-ADR-0044-lattice-issues.md) п. 3, [06 §8](06-verification.md)); исключение — merge impl-PR без `human-approval` в policy его базы: это не акт одобрения, его держат gates merge-результата ([ADR-0051](adr/WARRANT-ADR-0051-agent-merge-first.md) п. 4). Требует идентичности агента — машинного пользователя (создаёт maintainer, [ADR-0049](adr/WARRANT-ADR-0049-flow.md) п. 3, WS-04); в `sef-hub` — механизм SEF |
| INV-04 | Сам является правилом о механизмах; см. [04 §6](04-lifecycle.md) | — |
| INV-05 | Только для `UNKNOWN`: gate `blocking-unknowns-resolved` читает Change record. Маркеры в прозе — критерий L2-review, машиной не проверяются | Частично |
| INV-06 | Проектное правило; `warrant validate` ловит только дубли ID объектов конфигурации | Design-time |
| INV-07 | `write_scope` в Run + `warrant guard` в hooks агента (MVP) + наблюдение ACP client (S1 SEF, [ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md), [ADR-0020](adr/WARRANT-ADR-0020-warrant-sef-boundary.md)); подделка без ref не проходит CI | Shell не закрывается полностью; без hooks — обнаружение после действия (в MVP — finding `FRONTEND_HOOKS_INACTIVE` на `verify`) |
| INV-08 | Policy-пути → profile `factory-change` → `human-approval` на merge | — |
| INV-09 | Не принуждается в MVP: нет pack `data` | Later |
| INV-10 | Resolver и gate-алгоритм: неизвестное → `MEDIUM`/`FAIL`/`ESCALATE` | — |
| INV-11 | Только класс «изменение policy» (через INV-08); остальные классы — packs `data`, `security`, `arch` | Later |

## 3. Правило выбора абстракции

Перед добавлением любой новой сущности задаются вопросы **по порядку**. Первый положительный ответ определяет форму:

```text
1. Можно использовать штатный механизм OpenSpec?  → использовать его
2. Это новое правило?                              → Policy (profile / gate)
3. Это детерминированная проверка?                 → Check
4. Это повторяемое действие?                       → Operation
5. Это новый тип durable knowledge?                → Artifact
6. Это reasoning, который нельзя сделать кодом?    → Skill (SRA)
7. Это другой dependency graph артефактов?         → OpenSpec schema
```

Если ни один ответ не подходит — новая абстракция, скорее всего, **не нужна**.

Следствия:

- Если можно реализовать как policy — MUST NOT создавать schema.
- Если можно реализовать как check — MUST NOT создавать skill.
- Если можно реализовать как operation — MUST NOT создавать artifact.
- Если можно реализовать как profile — MUST NOT создавать новый workflow.
- Если можно скомбинировать существующие skills — MUST NOT создавать новый skill.

## 4. Artifact vs Operation

```text
Artifact  = информация, которую нужно сохранить
Operation = действие, которое можно повторить
```

Operation (clarify, analyze, verify, converge) MUST NOT порождать собственный файл (`clarify.md`, `analysis.md`), если у результата нет самостоятельной долговечной ценности. Результат operation — это изменение существующего artifact, evidence или запись в Run.

## 5. Где живут правила

Одно правило MUST жить ровно в одном месте:

| Тип | Что содержит | Где |
|---|---|---|
| **Constitution** | Неизменяемые инварианты | этот документ |
| **Policy** | Machine-enforced правила | profiles и gates в packs ([05](05-policy.md)) |
| **Project rules** | Конвенции проекта (язык, стиль, инструменты) | `.warrant/local/openspec/rules.json` → генерируется в `openspec/config.yaml` ([08 §8](08-packs.md)) |
| **Path rules** | Правила агенту для файлов по путям (кода, тестов) | `rules/` pack и `.warrant/local/rules/` → `AGENTS.md`, hints guard, Context Pack ([ADR-0022](adr/WARRANT-ADR-0022-path-rules.md)) |
| **ADR** | Конкретные архитектурные решения | каталог ADR проекта |
| **Spec** | Требуемое поведение | `openspec/specs/` |
| **Skill** | Способ выполнения reasoning | SRA |

Не помещать в constitution: «use pytest», «snake_case», «use DuckDB» — это project rules.

## 6. Принципы проектирования

- **Делать правильный процесс проще неправильного.** WARRANT не пытается быть самым умным компонентом.
- **Минимум собственных примитивов.** Всё остальное — композиция: OpenSpec, profiles, gates, checks, evidence, operations.
- **Stock first.** OpenSpec используется без форка: project-local schema + config + packs.
- **Данные вместо прозы.** Поведение задаётся JSON-конфигурацией packs, а не текстом документов.
- **Добавлять по фактическим failure modes.** Новая возможность требует реального gap, подтверждённого evidence.
- **Прозрачность решений.** Любое вычисленное требование MUST быть объяснимо: из какого overlay и почему.
