---
id: WARRANT-DOC-00
title: WARRANT — карта документации
status: informative
maturity: MVP
version: 0.1.0
---

# WARRANT — Specification Governance

**WARRANT** — слой управления спецификациями внутри SEF (Software Factory).
Он отвечает на два вопроса: **что разрешено** и **что доказано**.

WARRANT не пишет спецификации (это OpenSpec), не рассуждает (это SRA) и не хранит смысл объектов (это LATTICE). Он вычисляет политику, открывает и закрывает переходы (gates) и принимает evidence.

> Название: *warrant* — основание, по которому evidence подтверждает claim (модель Тулмина), и разрешение на действие. Обе стороны — ровно функция системы.

## Компоненты SEF

| Компонент | Роль | Отвечает на вопрос |
|---|---|---|
| **SEF** | Software Factory, целое | — |
| **OpenSpec** | specification kernel | Что требуется? |
| **LATTICE** | object substrate | Что это за объект и как он связан? |
| **SRA** | Semantic Reasoning Architecture | Как рассуждать? |
| **WARRANT** | specification governance | Что разрешено и что доказано? |
| **JEV** | classifier | Предлагает; authority нет |

Детали границ — [03-architecture](03-architecture.md).

## Главный принцип

```text
Документы описывают устойчивые контракты.
Packs описывают подключаемые возможности.
Конфигурация описывает композицию, а не поведение.
Resolver вычисляет поведение.
Skills рассуждают.
Checks принуждают.
LATTICE хранит смысл.
Evidence показывает результат.
```

## Карта документов

| Документ | Тема | Слой | Status | Maturity |
|---|---|---|---|---|
| [01-principles](01-principles.md) | Инварианты, правило выбора абстракции | Kernel | normative | MVP |
| [02-vocabulary](02-vocabulary.md) | Маркеры, оси статусов, ID, именование | Kernel | normative | MVP |
| [03-architecture](03-architecture.md) | Границы компонентов, SSOT, layout | Kernel | normative | MVP |
| [04-lifecycle](04-lifecycle.md) | Цикл Change, controller, CLI, enforcement | Kernel | normative | MVP |
| [05-policy](05-policy.md) | Profiles, risk, композиция, waivers | Kernel | normative | MVP |
| [06-verification](06-verification.md) | Checks, gates, уровни L0/L1/L2, analyze | Kernel | normative | MVP |
| [06a-evidence](06a-evidence.md) | Evidence contract, manifest | Kernel | normative | MVP |
| [07-skills](07-skills.md) | Контракт вызова reasoning (SRA) | Kernel | normative | MVP |
| [08-packs](08-packs.md) | Модель pack, конфигурация, lock | Kernel | normative | MVP |
| [09-pack-data](09-pack-data.md) | Data contracts, compatibility, migration | Pack | proposed | later |
| [10-pack-bdd-tdd](10-pack-bdd-tdd.md) | BDD / TDD / mutation | Pack | proposed | later |
| [10-pack-arch](10-pack-arch.md) | ADR, C4, glossary | Pack | proposed | later |
| [10-pack-brownfield](10-pack-brownfield.md) | Legacy, characterization | Pack | proposed | later |
| [10-pack-security](10-pack-security.md) | Security overlays, threat model, security checks | Pack | proposed | later |
| [11-integrations](11-integrations.md) | Форма интеграции; LATTICE, SEF, JEV, SRA | Integration | proposed | deferred |
| [integrations/](integrations/00-readme.md) | Контракты компонентов SEF: LATTICE, proposals, SRA, JEV | Integration | proposed | deferred |
| [../lattice/](../lattice/README.md) | Заготовка отдельного проекта LATTICE: реестр решений, объектная модель, план slice | Component | normative | later |
| [12-evolution](12-evolution.md) | Развитие самой системы, метрики | Kernel | normative | later |
| [13-roadmap](13-roadmap.md) | MVP, фазы, открытые вопросы | — | informative | MVP |
| [backlog](backlog.md) | Реестр долга: открытые пункты и куда они уходят ([ADR-0032](adr/WARRANT-ADR-0032-dev-context.md)) | — | informative | MVP |
| [handoff/](handoff/) | Передача между сессиями разработки — файл на поток; правила процесса — [process/rules.md](process/rules.md) | — | informative | MVP |

Решения, принятые при проектировании — [adr/](adr/). Исходные черновики — [archive/2026-09-22-openspec-drafts/](archive/2026-09-22-openspec-drafts/README.md).

**Порядок чтения:** 01 → 02 → 03 → 04 → 05 → 06 → 06a → 07 → 08, далее packs по необходимости.

## Конвенции документов

### Нормативные маркеры

Используются по RFC 2119 / RFC 8174, **только заглавными** и только в нормативном смысле:

| Маркер | Значение |
|---|---|
| **MUST** / **MUST NOT** | Абсолютное требование. Нарушение — дефект реализации. |
| **SHOULD** / **SHOULD NOT** | Отступление допустимо с явным обоснованием. |
| **MAY** | Разрешено, но не требуется. |

### Status и Maturity

Задаются во frontmatter документа. В разделе указываются **только если отличаются** от документа:

```markdown
## Runtime conformance

Status: proposed · Maturity: later
```

| Status | Значение |
|---|---|
| `normative` | Обязательно к исполнению. |
| `informative` | Пояснение, пример, обоснование. Не обязывает. |
| `proposed` | Направление согласовано, детали не утверждены. |

| Maturity | Значение |
|---|---|
| `MVP` | Входит в первую рабочую версию. |
| `later` | Запланировано после MVP. |
| `deferred` | Решение о необходимости не принято. |

### Язык и комментарии

| Где | Язык | Правило |
|---|---|---|
| Документация, specs, tasks, ADR | RU + EN термины | Термины не переводятся (Change, gate, evidence). |
| JSON (config, manifests, evidence) | EN | Комментариев нет. Подсказка — ключ `"$comment"`, только где неочевидно. |
| JSON Schema | EN | `description` у каждого поля — документация и подсказка для LLM. |
| Код, скрипты | EN | Комментарий объясняет «почему», а не «что». |
| HTML-комментарии в specs | — | Только машинные метаданные (`<!-- id: REQ-… -->`). Никакой прозы. |

Подробности — [WARRANT-ADR-0006](adr/WARRANT-ADR-0006-json-conventions.md).

## Глоссарий

| Термин | Определение |
|---|---|
| **Change** | Единица работы. Совпадает с OpenSpec change. |
| **Run** | Одна попытка выполнения операции агентом над Change. Change : Run = 1 : N. |
| **Artifact** | Информация, которую нужно сохранить (proposal, spec, design, ADR, data contract). |
| **Operation** | Повторяемое действие (classify, clarify, analyze, verify, converge). Artifact не создаёт. |
| **Profile** | Декларативный набор требований для класса изменений. |
| **Overlay** | Слой политики (default, project, profile, risk), участвующий в композиции. |
| **Effective Policy** | Вычисленный результат композиции overlays для конкретного Change. Не хранится как SSOT. |
| **Check** | Детерминированная исполняемая проверка. Производит evidence. |
| **Gate** | Правило перехода. Агрегирует evidence в verdict. |
| **Evidence** | Воспроизводимая запись о том, что было продемонстрировано в отношении claim. |
| **Claim** | Утверждение, которое требуется доказать (например, «REQ-ING-001 выполняется»). |
| **Waiver** | Явное временное исключение из gate с владельцем и сроком. |
| **Pack** | Подключаемый модуль: profiles, gates, checks, templates, ссылки на skills. |
| **Kernel** | Неизменяемая часть WARRANT: инварианты, словарь, контракты, resolver, цикл. |
| **Controller** | Детерминированная таблица решений: какая операция следующая. |
| **Context Pack** | Набор контекста, передаваемый агенту в Run. Имеет `context_hash`. |
| **Skill** | Единица reasoning (владелец — SRA). WARRANT задаёт только контракт вызова. |
| **Change record** | Файл `.warrant/changes/<change>.json`: classification, `change_state`, журнал переходов. Пишет только CLI. |
| **Attestation** | Кто ручается за происхождение evidence: `ci`, `human-review`, `signature`, `none`. |
| **Proposal (integration)** | Предложение мутации canonical state другого компонента. Не мутация. Единый envelope для SRA, JEV, WARRANT, human. |
