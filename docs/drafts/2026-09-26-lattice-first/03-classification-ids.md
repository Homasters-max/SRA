# Классификация объектов по LATTICE и схема ID

## Проблема

- Maintainer (2026-09-26): ID должен нести логический смысл и формироваться системно по классификатору LATTICE;
  предложение — `id = <type>-<domainid>-sort-desc([<id>,…])-v001` «или лучше, посмотреть в LATTICE».
- Правила LATTICE (`lattice/docs/03-substrate-decisions.md` D1, `01-object-substrate.md` §12–15, §40, §45, §47 F1):
  - identity — ровно `<context>/<name>`; **ни type, ни root_kind, ни версия в id не входят** (§14.1);
  - `name` MAY нести конвенциональный префикс (`REQ-ING-001`, `INV-4`); lint MUST NOT выводить type из префикса;
    reclassification не меняет `name` (D1);
  - classification `{root_kind, type, subtype}` — context-owned registry, отдельно от identity (§12);
  - `version` — семантическая ревизия, `content_hash` — provenance (§40); путь, строки, хэш — не identity;
  - сбой модели F1 — «classification changes identity».
- WARRANT (ADR-0012): люди набирают `PREFIX-AREA-NNN` (REQ, SCN); сквозные машинные объекты — `PREFIX-<ULID>`
  (`EVID`, `RUN`), без координации, упорядочены по времени.

## Идея

### 1. Что из предложения maintainer'а куда попадает

| Часть предложения | Куда | Почему |
|---|---|---|
| `<type>` | префикс `name` (`ANS`, `QST` …) | читаемость; классификация — отдельно (D1), префикс только «напоминает» |
| `<domainid>` | код домена в `name` (`LCY`) | домен — в зерне группы (Q54): у группы не меняется, поэтому в имени безопасен |
| `sort-desc([<id>,…])` | hash snapshot'а `SN-<hash>` | состав — identity **значения**, не сущности: у группы он меняется (Q47) |
| `-v001` | ссылка `<id>@<version>` | версия не в identity (§14.1, §40); ссылка фиксирует версию там, где нужна |

### 2. Формат

```text
сущность   = <context> "/" <PREFIX> ["-" <DOM>] "-" <ULID>      lexicon/ANS-LCY-01J8ZQ4N7X5K2M9R3T6V8W0Y1A
норма      = <context> "/" <внешний stable ID>                   spec/REQ-KRN-011, lexicon/TERM-waiver
значение   = "SN-" <sha256[0:16]> канонического JSON             SN-3fa29c0d71be44a2
ссылка     = <id> "@" <version>                                   spec/REQ-KRN-011@4
версия     = <целое> (LATTICE) | "h:" <sha256[0:12]> (до LATTICE) lifecycle.cycle@h:9b1e02c4d7aa
posit      = "POS-" <ULID>                                        POS-01J8ZQ5A…
до slice   = "unit:" <домен> "." <slug>                          unit:lifecycle.cycle
```

- **ULID**, не счётчик: группы, вопросы, оценки создаются машиной в разных worktree — без координации (ADR-0012 п. 2);
  ULID несёт время создания и сортируется.
- **Код домена** (`DOM`) — 3 заглавные буквы из реестра доменов, как AREA в ADR-0012 п. 5: `LCY` — `lifecycle`,
  `CLI` — `cli-core` (бывший `kernel`, Q27). Только у типов, зерно которых содержит один домен.
- **Нормы** получают identity без mapping: внешний stable ID становится `name` (D1, «Следствие для WARRANT»).
- **Hash snapshot'а** — от канонического JSON (ADR-0006): одинаковый состав даёт одинаковый hash на любой машине.

### 3. Классификация объектов

| Объект | Context | Root kind | Type | Префикс | Пример |
|---|---|---|---|---|---|
| норма: требование, сценарий, решение | `spec` | concept | `requirement` · `scenario` · `decision` | внешний | `spec/REQ-KRN-011` |
| ADR | `spec` | concept | `decision` | внешний | `spec/ADR-0012` (D1) |
| термин | `lexicon` | concept | `term` | `TERM` | `lexicon/TERM-waiver` |
| вопрос | `lexicon` | concept | `question` (§4, §10) | `QST` | `lexicon/QST-LCY-01J8…` |
| группа-ответ | `lexicon` | concept | `answer` | `ANS` | `lexicon/ANS-LCY-01J8…` |
| набор ответов | `lexicon` | concept | `answer-set` | `ASET` | `lexicon/ASET-01J8…` (без домена) |
| оценка | `evidence` | event | `measurement` (§9) | `MEA` | `evidence/MEA-LCY-01J8…` |
| вердикт | `evidence` | event | `observation` (§9) | `OBS` | `evidence/OBS-LCY-01J8…` |
| вызов поиска | `runtime` | event | `execution` (§8) | `EXE` | `runtime/EXE-01J8…` |
| сессия агента | `runtime` | event | `session` (§8) | `SES` | `runtime/SES-<id сессии>` |
| snapshot | — (значение) | — | `answer` · `answer-set` · `pool` | `SN` | `SN-3fa29c0d71be44a2` |
| posit, assertion | — (ledger, §45) | — | — | `POS` | `POS-01J8…` |
| unit | — (projection, `grounding: inferred`) | — | — | `unit:` | `unit:lifecycle.cycle` |
| домен, тип, роль, правило | реестр потребителя | — | — | имя / `L-KB-NN` | `lifecycle` / `LCY`, `answer`, `member`, `L-KB-01` |

Почему группа-ответ в `lexicon`: ответ — это смысл вопроса (вопрос — тип `lexicon`, §4); связи из `lexicon` к нормам
разрешены матрицей D4 (`denotes`: `lexicon → spec`, `platform`, `method`).

### 4. Связи — проверка по матрице D4

| Связь | Family | Source → target | D4 |
|---|---|---|---|
| вопрос → группа-ответ (mapping) | `denotes` | `lexicon → lexicon` | ✓ внутри context |
| группа-ответ → норма (членство) | `denotes`, `role: member` | `lexicon → spec` / `platform` / `method` / `lexicon` | ✓ |
| группа-ответ → источник в `evidence` | `cites`, `role: member` | `lexicon → evidence` | ✓ `* → evidence` |
| ответ → набор ответов | `part_of` | `lexicon → lexicon` | ✓ внутри context |
| группа → вердикт (основание доверия) | `cites` | `lexicon → evidence` | ✓ |
| вопрос → оценка | `cites` | `lexicon → evidence` | ✓ |
| вызов → оценка | `causes` | `runtime → evidence`, оба `event` | ✓ |
| группа-ответ, новая семантика | `evolves_from` | `lexicon → lexicon` | ✓ (только внутри context) |

Баллы оценки по кандидатам — меры (posit'ы значения, Q53), не связи: `evidence → spec` разрешено D4 только для
`tests`, а оценка ничего не тестирует.

## Вопросы для grilling

1. **Схема ID** (п. 2): `<context>/<PREFIX>[-<DOM>]-<ULID>` для сущностей, `SN-<hash>` для snapshot'ов, версия —
   только в ссылке `@`. Рекомендация: да — смысл читается из ID, правила LATTICE D1 и ADR-0012 соблюдены.
2. **Классификация** (п. 3): вопрос, группа-ответ, набор ответов — `lexicon`; оценка, вердикт — `evidence`; вызов,
   сессия — `runtime`. Рекомендация: да; новый context не нужен (§3: context — только при доказанных языке,
   invariants, lifecycle).
3. **Членство** — `denotes` с `role: member` (к нормам), `cites` (к `evidence`), `part_of` (группа в группе).
   Рекомендация: да; `role: member` — proposal в registry ролей LATTICE, не локальный тип (закрытый registry).
4. **Домен в LATTICE**: сейчас — значение реестра kb-search (код, имя, источники). Рекомендация: так и оставить до
   slice; станет ли домен объектом LATTICE (projection spec) — вопрос потока `lattice`.
5. **Коды доменов** — `LCY` (`lifecycle`), `CLI` (`cli-core`); реестр — рядом с доменами (01 п. 2). Рекомендация: да.

## Вне объёма

- ID WARRANT (ADR-0012) не меняются.
- Registry ролей и типов LATTICE — через proposals после slice.
