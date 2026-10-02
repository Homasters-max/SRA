---
id: SEF-INT-00
title: Контракты компонентов SEF — карта
status: proposed
maturity: deferred
version: 0.1.0
---

# Контракты компонентов SEF

Каталог описывает контракты между компонентами SEF, лежащие **вне** kernel WARRANT: LATTICE, канал proposals, SRA поверх LATTICE, JEV. Это **идеи, которые предстоит доработать**: статус `proposed`, maturity `deferred`. Они не обязывают реализацию, но фиксируют границы, чтобы MVP WARRANT их не нарушил.

Форма любой интеграции с WARRANT — [11-integrations](../11-integrations.md). Словарь и инварианты — [01](../01-principles.md), [02](../02-vocabulary.md).

## Документы

| Документ | Тема | Кому нужен |
|---|---|---|
| [01-lattice-contract](01-lattice-contract.md) | Что LATTICE гарантирует потребителям: элементы, identity, оси, relations, read model, snapshot | Все компоненты |
| [02-proposal-contract](02-proposal-contract.md) | Единый канал proposals: envelope, источники, pipeline, результаты, staleness | SRA, JEV, WARRANT, human |
| [03-sra-lattice](03-sra-lattice.md) | SRA как reasoning над LATTICE: что читает, чего не делает, как возвращает outcomes | SRA |
| [04-jev-classifier](04-jev-classifier.md) | JEV как ProposalSource для LATTICE и proposer classification для WARRANT | JEV, LATTICE, WARRANT |
| [05-warrant-lattice](05-warrant-lattice.md) | WARRANT ↔ LATTICE: какие объекты уходят, проекция маркеров, роль authorizer | WARRANT |

Внутреннее устройство LATTICE (объектная модель, Q&A, реестр решений `LD-*`) живёт в отдельной заготовке проекта [lattice/](../../lattice/README.md); здесь — только интерфейс.

**Порядок чтения:** 01 → 02, далее по компоненту.

## Принцип

```text
LATTICE хранит semantic state и валидирует инварианты.
Источники (SRA, JEV, WARRANT, human) читают snapshot и предлагают.
WARRANT разрешает (policy, approval).
LATTICE мутирует и записывает историю.
Evidence фиксирует результат.
Ни один слой не меняет authority другого молча.
```

## Конвенции

- ID документов `SEF-INT-NN`; frontmatter как в WARRANT ([00](../00-readme.md)).
- Примеры — JSON ([ADR-0006](../adr/WARRANT-ADR-0006-json-conventions.md)); enum — UPPER_SNAKE; ключи — snake_case.
- Термины не переводятся: object, edge, grounding, snapshot, proposal.
- Ни один документ здесь не определяет storage, API или schema базы LATTICE. Это контракты смысла, не реализации.

## Происхождение

Переработка трёх черновиков (архив: [2026-09-22-integration-drafts](../archive/2026-09-22-integration-drafts/README.md)):

| Черновик | Куда |
|---|---|
| SRA-LATTICE-CONTRACT | 01 (§2–9, 13), 03 (§3, 6, 10–12) |
| SRA-LATTICE-CONTRACT-ADDENDUM | 02 (§3–5, 9), 01 (§7), 03 (§5, 8) |
| SRA-LATTICE-JEV classifier | 04, 02 (§6–8) |

Что изменено при переносе:

- Три разных описания proposal (addendum, JEV ProposalSource, `proposals[]` в envelope skill) сведены к одному контракту (02).
- Неоднозначное «LATTICE / governing layer» заменено явной цепочкой: источник → WARRANT authorization → LATTICE validation → mutation.
- Reasoning outcomes SRA (`UNKNOWN`, `INCONCLUSIVE`, `CONFLICT`, `DECISION_REQUIRED`, `STALE`) не стали статусами: они спроецированы на result envelope [07 §4](../07-skills.md), где единственный статус — `run_state` ([ADR-0003](../adr/WARRANT-ADR-0003-vocabulary-axes.md)).
- JEV получил вторую, симметричную роль: proposer classification Change для WARRANT ([05 §4](../05-policy.md)) с тем же envelope.
- YAML заменён на JSON; добавлены разделы failure modes, security boundary, versioning, открытые вопросы.

## Открытые вопросы (сводка)

| #   | Вопрос                                                                                                               | Документ     |
| --- | -------------------------------------------------------------------------------------------------------------------- | ------------ |
| I1  | Принимает ли LATTICE внешние stable ID как identity (spike S6) — **proposed ответ: да, как `name` в context `spec`** | 01 §4, 06 D1 |
| I2 | ~~Семантика `contested`~~ — **закрыт**: производное от открытого dispute record (LD-S-07) | 06 §10.2 |
| I3  | ~~Очередь proposals~~ — **закрыт**: `.warrant/proposals/`, вне persistent core LATTICE                               | 06 §10.1     |
| I4  | ~~Snapshot в `context_hash`~~ — **закрыт**: да, как `based_on` (набор версий)                                        | 06 §8.3      |
| I7  | Текст legacy lint `G-C11…G-C16` — нужен только как fixtures в M10, с критического пути снят                          | 06 D7        |
| I5 | **Открыт, блокирует security boundary JEV**: input envelope и локальность запуска. Ограничение входа в 04 §7 — предлагаемое, не доказанное | 04 §7 |
| I6 | **Открыт**: runtime sensor JEV — отдельный контракт SEF↔JEV, не расширение LATTICE/WARRANT | 04 §2 |
