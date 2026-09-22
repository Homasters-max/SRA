---
id: WARRANT-NEXT
title: WARRANT — следующий шаг: фаза 1 Kernel
status: informative
maturity: MVP
version: 0.1.0
---

# WARRANT — что делать в следующей сессии

Файл передачи контекста. Прочитать первым, затем [00-readme](00-readme.md).

## Состояние на 2026-09-22

- Документы 01–08 отгриллены в MVP-scope. Результат — ADR-0010…0014 ([adr/](adr/README.md)); документы 01–04 приведены в соответствие.
- Спайки: S1 закрыт (ADR-0012 §7, OpenSpec 1.13.1), S3 закрыт (ADR-0009), S4 закрыт (ADR-0013: TypeScript), S5 закрыт (ADR-0014), S6 — proposed через LATTICE. **Открыт только S2**: устройство project-local schema и `config.yaml` в OpenSpec 1.13.1.
- Кода нет. Ни одной JSON Schema `warrant://*` нет.
- Фаза 0 завершена. Следующая — **фаза 1 Kernel** ([13 §2](13-roadmap.md)).

## Что уже решено для фазы 1 (не обсуждать заново)

| Решение | Где |
|---|---|
| Стек: TypeScript на Node; bin `warrant`; не публикуется, `npm i -g <git-tag>` | ADR-0013 |
| Monorepo: `docs/`, `packages/cli/`, `packs/core-sdd/`, `sra/skills/`, `lattice/` | ADR-0013 |
| Команды фазы 1: `init`, `validate`, `fmt`, `id`, `sync`, `resolve`, `status`; JSON-вывод, коды выхода 0/1/2/3 | 04 §7, 13 §2 |
| core-sdd@0.1: profiles `feature`, `chore`, `factory-change`; gates и checks из 06 §4 | ADR-0013, 05, 06 |
| Change record `.warrant/changes/<change>.json`; пишет только CLI | 04 §9, ADR-0009 |
| ID: `PREFIX-AREA-NNN` immutable с MERGED, ULID для EVID/RUN, реестр AREA, `warrant id renumber` | ADR-0012 |
| Доверие по ref, CI не пишет в репозиторий, bot-идентичность агента, forge = GitHub | ADR-0010 |
| Топология: spec-PR, impl-PR, archive-PR; `warrant archive` оборачивает `openspec archive`; gate `branch-isolated` | ADR-0011 |
| Enforcement Claude Code: static deny из `warrant sync` + hook `warrant guard`; reviewer = subagent | ADR-0014 |
| Все машинные файлы — JSON с `$schema` `warrant://<name>/<major>`; `warrant fmt` канонизирует | ADR-0006, 08 §7 |

## Порядок работы

### Шаг 1 — план (одна сессия, без кода)

Использовать skill `superpowers:writing-plans`. Вход — документы; выход — `docs/plans/<date>-phase-1-kernel.md`.
План MUST включать:

1. **S2 как первый пункт плана**: поставить OpenSpec 1.13.1 в sample-проект, изучить `openspec/schemas/<name>/schema.yaml`
   и `config.yaml`, зафиксировать, что генерирует `warrant sync`. Результат — ADR-0015 и закрытие S2 в 13 §3.
2. JSON Schemas kernel в порядке зависимостей: `config`, `pack`, `profile`, `overlay`, `gate`, `check`, `change-record`,
   `evidence`, `evidence-manifest`, `controller-rules`, `risk-floor`, `risk-levels`, `openspec-rules`, `waiver`.
   Каждая — с `description` у каждого поля (подсказка для LLM).
3. Команды в порядке: `validate` → `fmt` → `init` → `id` → `sync` → `resolve --explain` → `status`.
   `resolve` — самая содержательная: композиция overlays по 05 §5 с `POLICY_CONFLICT` и объяснением источников.
4. Pack `core-sdd@0.1`: три profile, overlays `risk-*`, floors, controller rules из 04 §4, templates из 13 §5.
5. Golden cases для `resolve` (12 §2) как тесты: вход classification → ожидаемая effective policy. Минимум:
   `feature-low`, `feature-unknown-risk → MEDIUM + blocking UNKNOWN`, `factory-change`, `policy-conflict → ESCALATE`.
6. Критерий выхода фазы 1 (13 §2): `warrant validate` проходит на core-sdd и на sample-проекте после `warrant init`.

Готовый запрос:

```text
Прочитай docs/NEXT-SESSION.md, затем docs/00-readme.md, 13-roadmap.md, adr/WARRANT-ADR-0006, 0007, 0009–0014,
затем 02, 03, 04, 05, 06, 06a, 08. Используй superpowers:writing-plans и составь план фазы 1 Kernel по разделу
«Шаг 1» из NEXT-SESSION.md. Не пиши код и не создавай packages/ до утверждения плана. Спорные места —
вопросом ко мне, не допущением.
```

### Шаг 2 — исполнение (следующие сессии)

Skill `superpowers:executing-plans` (одна сессия ведёт план с checkpoint'ами) или
`superpowers:subagent-driven-development` (независимые задачи параллельно). TDD обязателен
(`superpowers:test-driven-development`): schemas и `resolve` — чистые функции, тесты пишутся первыми.
Ветка `feature/phase-1-kernel`, коммиты по задачам плана.

### Шаг 3 — не раньше конца фазы 1

Фаза 2 (core-sdd целиком, golden feature/chore), затем 3 (verification, CI) и 4 (Claude Code frontend).
Vertical slice по ADR-0013 — после фазы 4. LATTICE — после slice ([../lattice/NEXT-SESSION.md](../lattice/NEXT-SESSION.md)).

## Чего не делать

- Не реализовывать `check`, `gate`, `verify`, `analyze`, `guard`, `ci` в фазе 1: это фазы 3–4.
- Не добавлять profiles `bugfix`, `refactor`, `experiment`: без failure mode (ADR-0013).
- Не трогать `docs/integrations/`, `lattice/`: не на критическом пути.
- Не изобретать второй формат конфигурации: `warrant.json` — единственная точка (08 §3).
- Изменение любого нормативного документа во время реализации — только через новый ADR, не молча.

## Контекст для агента

SEF (Software Factory): OpenSpec — specification kernel (stock, без форка); WARRANT — governance, этот проект;
LATTICE — субстрат объектов (`../lattice/`); SRA — reasoning (skills); JEV — classifier без authority.
Документы RU с EN-терминами, машинные файлы JSON. Перед большими переписываниями — обсуждать с пользователем.
