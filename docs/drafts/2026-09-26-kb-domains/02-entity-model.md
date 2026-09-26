# Модель сущностей — на контракте LATTICE, с простым переходом

## Проблема

- Unit хранит ссылки вида `путь:строки ID` и `путь#Символ`. Строки уплывают при правке документа, символ может
  исчезнуть — unit тихо врёт.
- Связи норм (ADR `amends` / `supersedes`, REQ ↔ SCN ↔ тесты, I-N, BL, A) не собраны: агент восстанавливает их grep'ом.
- Словарь домена написан субагентом, а не выведен из `docs/02-vocabulary.md` — два источника терминов.
- LATTICE — компонент SEF, который будет классифицировать все сущности (maintainer, 2026-09-26), и его контракт уже
  записан: [01-lattice-contract](../../integrations/01-lattice-contract.md) (identity `<context>/<name>`, внешние ID —
  как `name`; classification `root_kind · context · type · subtype · properties · state axes`; оси `grounding`
  (`declared` · `derived` · `observed` · `inferred`) и `epistemic_state` (`settled` · `contested` · `unresolved`);
  relation types — словарь LATTICE, новые — только через proposal; read model `sef://lattice-read-model/1`: `snapshot`,
  `objects`, `relations`, `history`); [05-warrant-lattice](../../integrations/05-warrant-lattice.md) §1 (объекты:
  REQ, SCN, DCT, ADR, TERM, DECISION, Change; не объекты: EVID — edge `evidences`, Run, TASK, WAV, record; LATTICE
  хранит идентичность и связи, текст остаётся в OpenSpec). Статус контракта — `proposed`, `deferred`.

## Идея

Своя модель не изобретается: локальный слой пишется **в форме read model LATTICE**, пока LATTICE нет, и заменяется
его read model, когда он появится.

| Наше | В терминах LATTICE | Сейчас | После подключения LATTICE |
|---|---|---|---|
| домен (`lifecycle`, `kernel`) | `context` | имя домена | context LATTICE |
| сущность (REQ, SCN, ADR, TERM, Change) | object, id `<context>/<name>`, `name` = внешний ID | `objects.json` — сканер (`<!-- id: -->`, frontmatter ADR, `02-vocabulary`) | read model LATTICE |
| пункт ADR, I-N, BL, A, gate, check, код ошибки, схема `warrant://x/N`, символ кода, тест | object или attribute — по тесту на object (01 §3) | вопрос grilling | решение LATTICE |
| связи (`implements`, `supersedes`, `introduced_by`, `evidences`, …) | relations из словаря LATTICE | `relations.json` — только известные типы | read model; новые типы — proposal |
| unit (title, summary, aliases) | **projection** (не object: смысл, выведенный LLM) | `<domain>.json`, ссылки — только ID объектов | projection над read model |
| `status: conflict` | `epistemic_state: contested` → `RecordDispute` | `CONFLICTS-*.md` | proposal в LATTICE |
| summary, написанный субагентом | `grounding: inferred` (`actor: llm`, run) | поле провенанса unit | до подтверждения — `inferred` |
| глоссарий | TERM objects; glossary — projection LATTICE (10-pack-arch §3) | из `02-vocabulary`, id `TERM-<slug>` | read model |
| версия контракта | `snapshot.registry_versions` + версия объекта (DCT, схема) | версии CLI / pack / схем | snapshot |

Путь, строки и хэш — label и provenance, не identity (01 §4): резолвер вычисляет их при загрузке, `stale` — ID не
найден или `cs` не нашёл символ.

## Вопросы для grilling

1. Писать ли локальный слой строго в форме `sef://lattice-read-model/1` (objects / relations / snapshot)? Рекомендация:
   да — переход станет заменой источника, а не миграцией.
2. Context: домен = context LATTICE? Совпадают ли наши 7 доменов с context'ами из `lattice/docs`? Рекомендация:
   сверить с `lattice/docs/03-substrate-decisions.md` (читать, не править) до выбора имён доменов.
3. Unit — projection (не object). Где хранить его provenance (`grounding: inferred`, run нарезки) и когда он
   становится `declared`? Рекомендация: `inferred` до ревью maintainer'ом; «settled» не присваивает сам поиск.
4. Что из «пункт ADR, I-N, BL, A, gate, check, код ошибки, схема, символ, тест» — object, а что attribute? Рекомендация:
   по тесту 01 §3; символ кода и тест — не objects (у них нет истории в LATTICE), связь `implements` / `tests` — через
   REQ / SCN.
5. Relation types: какие из нужных нам (`implements`, `tests`, `supersedes`, `amends`, `uses-term`, `in-context`)
   есть в словаре LATTICE? Рекомендация: брать только существующие; недостающие — список proposals, не локальные типы.
6. Глоссарий: `02-vocabulary` → TERM objects, словарь домена для Jev — выборка по context? Рекомендация: да.
7. Противоречия нарезки → `contested` через `RecordDispute` сейчас (вручную, файлом) или только после LATTICE?
   Рекомендация: файл сейчас в форме proposal (02-proposal-contract), отправка — после LATTICE.

## Вне объёма

- Правка `docs/integrations/` и `lattice/` (CLAUDE.md) — только чтение.
- Storage и API LATTICE (01 §11); SQL и второй формат (ADR-0006).
- Граф кода — graft / `cs`; домен хранит только якорь символа.
