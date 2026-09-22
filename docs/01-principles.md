---
id: WARRANT-DOC-01
title: Принципы и инварианты
status: normative
maturity: MVP
version: 0.1.0
---

# 01. Принципы и инварианты

## 1. Назначение

Документ фиксирует **constitution** WARRANT: небольшой набор инвариантов, которые не переопределяются
ни profile, ни pack, ни project config, ни waiver. А также правило выбора абстракции,
защищающее систему от переусложнения.

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

Operation (clarify, analyze, verify, converge) MUST NOT порождать собственный файл
(`clarify.md`, `analysis.md`), если у результата нет самостоятельной долговечной ценности.
Результат operation — это изменение существующего artifact, evidence или запись в Run.

## 5. Где живут правила

Одно правило MUST жить ровно в одном месте:

| Тип | Что содержит | Где |
|---|---|---|
| **Constitution** | Неизменяемые инварианты | этот документ |
| **Policy** | Machine-enforced правила | profiles и gates в packs ([05](05-policy.md)) |
| **Project rules** | Конвенции проекта (язык, стиль, инструменты) | `.warrant/local/openspec/rules.json` → генерируется в `openspec/config.yaml` ([08 §8](08-packs.md)) |
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
