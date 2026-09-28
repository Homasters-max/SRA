# LATTICE — что делать в следующей сессии

Файл для передачи контекста новой сессии агента. Прочитать первым, затем [README](README.md).

## Состояние на 2026-09-22

- Все решения по LATTICE собраны в [docs/00-decision-register](docs/00-decision-register.md): 79 строк `LD-*`, все `ACCEPTED`, кроме LD-T-08 (JSON вместо YAML, `PROPOSED`).
- Два исходника пользователя ([substrate](docs/01-object-substrate.md), [Q&A](docs/02-architecture-qa.md)) — нормативные; их открытые пункты закрыты в [03-substrate-decisions](docs/03-substrate-decisions.md).
- Интерфейс с SEF — в `../docs/integrations/01, 02, 05`. Сюда не копировать.
- Код не написан. Ни одного JSON-файла `meta/*` и registry ещё нет.
- Выделение в отдельный репозиторий — после vertical slice.

## Шаг 1 — grill-with-docs (рекомендуется)

Да, этот шаг стоит сделать **до** кода. Сейчас решения приняты на уровне документов, и их ещё никто не пытался сломать. Прогон «на прочность» дешевле здесь, чем на M5 миграции.

Что грилить и в каком порядке:

1. **Реестр решений** (`docs/00-decision-register.md`) как единый объект: нет ли пары строк, которые противоречат друг другу; нет ли строки, которую нельзя проверить lint'ом (тогда это не решение, а пожелание).
2. **Vertical slice** (README, раздел «Первый vertical slice»): какие ровно объекты, edges и mutations нужны, что считается «прошёл», какие golden cases.
3. **Разрез интерфейса** (`integrations/01`, `02`): что сломается, если LATTICE переедет в другой репозиторий завтра.

Готовый запрос для новой сессии:

```text
/grilling Прочитай lattice/README.md и lattice/docs/00-decision-register.md. Грили меня по реестру решений
LATTICE и по плану первого vertical slice: ищи противоречия между строками LD-*, решения без проверяемого
критерия, и всё, что помешает выделить LATTICE в отдельный репозиторий после slice. Не предлагай новых
механизмов, пока не докажешь, что существующие оси не справляются (Q&A §66).
```

Результат гриллинга фиксируется так: изменение строки реестра → новая версия реестра плюс `LATTICE-ADR-NNNN` в `docs/adr/`; новый открытый вопрос → в таблицу README.

## Шаг 2 — данные раньше кода

До `src/` создать машинные файлы, потому что они и есть модель (принцип «данные вместо прозы» WARRANT 01 §6):

| Файл | Источник | Решение |
|---|---|---|
| `meta/invariants.json` | Q&A §62 + I16 | LD-G-01 |
| `meta/context-map.json` | 03-substrate-decisions D4 | LD-R-07 |
| `meta/lint-rules.json` | по одному правилу на инвариант / ось | LD-G-04 |
| `meta/migration-rules.json` | substrate §23 + D3 | LD-X-03 |
| `spec/types.json`, `evidence/types.json` | только типы для slice | LD-C-04, LD-K-09 |

Каждый файл — с `$schema` вида `lattice://<name>/1` и `description` у полей (для LLM-правок).

## Шаг 3 — vertical slice

Только после шагов 1–2. Порядок из README. Критерий выхода: lint PASS, double-build byte-identical, reconstruction одного объекта из history проходит, golden case `spec-requirement-with-test` зелёный.

## Чего не делать

- Не реализовывать все оси, все contexts и migration engine до slice (substrate «Итог», LD-B-06).
- Не вводить новый type / relation / context без Architecture Change Record (LD-G-11).
- Не трогать `../docs/integrations/*` из этой папки: это интерфейс, его меняет `factory-change` WARRANT.
- Не закрывать I5 и I6: они принадлежат JEV и SEF, не LATTICE.

## Контекст для агента

Проект SEF (Software Factory): OpenSpec — specification kernel; WARRANT — governance (`../docs/`); LATTICE — этот субстрат; SRA — reasoning (skills); JEV — classifier без authority. Документы RU с EN-терминами, машинные файлы — JSON. Перед большими переписываниями — обсуждать с пользователем.
