---
id: LATTICE-README
title: LATTICE — стартовая точка проекта
status: informative
maturity: MVP
version: 0.1.0
---

# LATTICE — Object Substrate

**LATTICE** — семантический субстрат SEF: identity, classification, оси состояния, relations, provenance, history durable-объектов. Отвечает на вопрос «что это за объект и как он связан». Не сервис, не агент, domain-neutral.

Эта папка — **самодостаточная заготовка отдельного проекта**. Решение (2026-09-22): выделяется в собственный репозиторий **после** первого vertical slice на объектах OpenSpec. До этого живёт здесь, чтобы разрез интерфейсных контрактов прошёл проверку реальным кейсом.

## Читать в этом порядке

| # | Документ | Что это | Статус |
|---|---|---|---|
| 1 | [docs/00-decision-register](docs/00-decision-register.md) | **Реестр всех принятых решений** `LD-*`. Реализация не может противоречить строкам `ACCEPTED` | normative |
| 2 | [docs/01-object-substrate](docs/01-object-substrate.md) | Полная объектная модель: contexts, identity, оси, relations, REF/SECTION, migration, DoD | исходник, нормативный |
| 3 | [docs/02-architecture-qa](docs/02-architecture-qa.md) | 69 архитектурных вопросов с нормативными ответами: SSOT, mutation, concurrency, storage, self-description | исходник, нормативный |
| 4 | [docs/03-substrate-decisions](docs/03-substrate-decisions.md) | Решения D1–D7 по открытым пунктам substrate, системные дополнения, сверка с Q&A | normative |

Интерфейс с остальным SEF остаётся в SRA и **не копируется** сюда (один owner, INV-06):

| Контракт | Что задаёт |
|---|---|
| [integrations/01-lattice-contract](../docs/integrations/01-lattice-contract.md) | Что потребители (SRA, WARRANT, JEV) вправе предполагать о LATTICE |
| [integrations/02-proposal-contract](../docs/integrations/02-proposal-contract.md) | Единый канал proposals: envelope, pipeline, результаты |
| [integrations/05-warrant-lattice](../docs/integrations/05-warrant-lattice.md) | Адаптер WARRANT: какие объекты уходят, проекция маркеров, authorization |

При выделении в репозиторий LATTICE объявляет реализуемую версию контрактов (`"contracts": { "lattice-contract": "^0.1", "proposal-contract": "^0.1" }`); WARRANT фиксирует её в lock pack `lattice`.

## Что зафиксировано (сводка реестра)

```text
identity        <context>/<name>, два сегмента; внешние stable ID — как name, без mapping
contexts        kernel · lexicon · method · meta · platform · runtime · evidence · spec   (8)
root kinds      concept · thing · event
classification  { root_kind, type, subtype? } — context-owned registry; properties отдельно
оси             acceptance · currency · grounding · epistemic_state — независимы; rejected ⇒ retired (derived);
                contested ⇒ открытый dispute record (derived)
relations       part_of · denotes · cites · depends_on · evolves_from · tests · causes; role — закрытый registry
mutation        один engine, atomic, OCC по expected_version; один примитив на механизм; composite = batch
proposals       все источники authority: none; WARRANT authorizes → LATTICE validates → mutation → history
storage         JSON first, разделённые canonical stores, projections rebuildable, lint read-only
migration       M0–M10 с abort criteria; lossless = равенство legacy view; silent fallback запрещён
```

## Открытые вопросы

| # | Вопрос | Блокирует |
|---|---|---|
| I5 | Input envelope JEV и локальность запуска (владелец JEV) | Security boundary JEV, не LATTICE |
| I6 | Runtime sensor JEV — отдельный контракт SEF↔JEV | Ничего в LATTICE |
| I7 | Текст legacy lint G-C11…G-C16 — только как fixtures | M10 |
| I8 | Факты фабрики (PATTERN, FAILURE, TRAP) — в LATTICE или `.warrant/` | pack lattice, later |
| I9 | Glossary и ADR-индекс как projection LATTICE | pack arch, later |

Ни один не блокирует vertical slice.

## Первый vertical slice

Цель — доказать LATTICE как субстрат для фабрики, а не как абстрактную модель (substrate, «Итог»):

```text
OpenSpec Change → объект spec/CHG-… → requirement spec/REQ-… (part_of) → evidence/TEST-… (tests)
→ mutation через engine → provenance / history → projection → lint PASS → double-build identical
```

Минимум механизмов для slice (substrate D8.5): identity, classification, provenance, edge, history, `acceptance`, `grounding`. `currency` и `epistemic_state` — после.

## Целевая структура репозитория

По образцу WARRANT, чтобы все компоненты SEF читались одинаково:

```text
lattice/
├── README.md                     эта страница
├── NEXT-SESSION.md               что делать в следующей сессии
├── docs/
│   ├── 00-decision-register.md   реестр решений (canonical)
│   ├── 01-object-substrate.md
│   ├── 02-architecture-qa.md
│   ├── 03-substrate-decisions.md
│   └── adr/LATTICE-ADR-NNNN-*.md architecture change records (§65 Q&A) — создаются по мере решений
├── meta/                         данные, не проза (JSON + $schema)
│   ├── invariants.json           I1–I16
│   ├── context-map.json          матрица cross-context relations (D4)
│   ├── lint-rules.json           L-* правила, по одному на инвариант/ось
│   └── migration-rules.json      правила legacy status → оси (D3)
├── <context>/types.json          distributed type registry: platform, lexicon, method, evidence, runtime, spec
└── src/, tests/, golden/         реализация, тесты, golden cases
```

Разработка LATTICE ведётся **через WARRANT** (profile `factory-change`), как только у WARRANT есть MVP. Это первый внешний dogfooding обоих компонентов.

## Конвенции

Те же, что в WARRANT ([00-readme](../docs/00-readme.md)): документы RU с EN-терминами; JSON с `$schema` для машинных файлов; маркеры RFC 2119 заглавными; status / maturity во frontmatter; один объект — один файл.
