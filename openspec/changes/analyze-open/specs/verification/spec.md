## MODIFIED Requirements

### Requirement: Команда analyze
<!-- id: REQ-VER-010 -->

`warrant analyze <change> [--base <ref>]` SHALL детерминированно сверить delta specs, `tasks.md` и тесты Change по ID и ссылкам
([06 §5](../../../../docs/06-verification.md), [ADR-0036](../../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 2) и SHALL NOT ничего записывать. Каталог Change —
`openspec/changes/<change>/`, а если его нет — каталог архива с именем ровно `<YYYY-MM-DD>-<change>`, при нескольких — с последней
датой (BL-43: `analyze-clean` на
`MERGED->ARCHIVED` вычисляется и после `openspec archive`). Входы: требования delta specs Change
по секциям `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` с их REQ и SCN; REQ и SCN main specs `openspec/specs/**`; текст
`tasks.md` каталога Change; файлы под `paths.tests`; пути diff `base...HEAD` (base — как у gate `scope-valid`); REQ и SCN
секций `ADDED` и `MODIFIED` delta specs других открытых Change — каждого каталога `openspec/changes/<другой>/`, кроме
`archive/` и каталога самого Change, независимо от record. Все входы читаются из одного дерева: рабочего дерева у команды,
оцениваемого commit у gate `analyze-clean`. Запись в `openspec/changes/`, которая не каталог, каталог без `specs/` и delta,
которая не разбирается, ID не дают и в `data.skipped[]` не попадают.
ID «определён», если он объявлен в main specs или в `ADDED` / `MODIFIED` delta и не объявлен в `REMOVED` delta. Находки:
- `UNSATISFIED` `{ id, missing[] }` — REQ из `ADDED` или `MODIFIED`, если `tasks.md` не упоминает ни его, ни один его SCN
  (`missing` ∋ `task`), или ни один его SCN не встречается ни в одном файле под `paths.tests` (`missing` ∋ `test`; REQ без SCN —
  тоже `test`);
- `CONFLICT` `{ id, path }` — `tasks.md` упоминает REQ или SCN, который не определён;
- `ORPHAN` `{ id, path }` — файл под `paths.tests`, изменённый в diff и не удалённый, упоминает SCN, который не определён и
  не объявлен в delta другого открытого Change (даже если delta самого Change его удаляет в `REMOVED`). Так тест Change, чей
  impl-PR слит раньше archive-PR, не держит `analyze-clean` чужого Change: его SCN объявлены в delta, пока archive-PR не
  перенёс их в main specs.

Без `paths.tests` проверка тестов в `UNSATISFIED` и `ORPHAN` не выполняется; без diff (нет git, base не разрешается) не
выполняется `ORPHAN`; каждый пропуск SHALL попадать в `data.skipped[]` с причиной. Вывод —
`data{ change, findings[], counts{ UNSATISFIED, CONFLICT, ORPHAN }, skipped[] }`, находки отсортированы по коду и id; код выхода 1
при хотя бы одной находке, иначе 0; Change нет ни в `openspec/changes/`, ни в архиве → `CHANGE_NOT_FOUND` с `hint`, код 3.
Находки `MISSING`, `AMBIGUOUS`, `STALE` SHALL NOT выдаваться этой версией команды.

#### Scenario: REQ без задачи
<!-- id: SCN-VER-062 -->
- **WHEN** delta `ADDED` содержит `REQ-SRC-004` со `SCN-SRC-010`, `tests/test_search.py` упоминает `SCN-SRC-010`, а `tasks.md` не упоминает ни одного из них
- **THEN** `warrant analyze add-search` даёт `UNSATISFIED` с `id: "REQ-SRC-004"` и `missing: ["task"]`, код 1, ни один файл не изменён

#### Scenario: REQ без теста
<!-- id: SCN-VER-063 -->
- **WHEN** `tasks.md` упоминает `REQ-SRC-004`, но `SCN-SRC-010` нет ни в одном файле под `paths.tests`
- **THEN** находка `UNSATISFIED` с `missing: ["test"]`

#### Scenario: Задача на удалённое требование
<!-- id: SCN-VER-064 -->
- **WHEN** delta `REMOVED` содержит `REQ-SRC-002`, а `tasks.md` упоминает `REQ-SRC-002`
- **THEN** находка `CONFLICT` с `id: "REQ-SRC-002"` и `path: "openspec/changes/add-search/tasks.md"`

#### Scenario: Тег неизвестного сценария
<!-- id: SCN-VER-065 -->
- **WHEN** `tests/test_search.py` изменён в diff и упоминает `SCN-SRC-099`, которого нет ни в main specs, ни в delta; неизменённый `tests/test_old.py` упоминает `SCN-SRC-098`
- **THEN** одна находка `ORPHAN` с `id: "SCN-SRC-099"` и `path: "tests/test_search.py"`

#### Scenario: Согласованный Change
<!-- id: SCN-VER-066 -->
- **WHEN** каждый REQ delta упомянут в `tasks.md` и покрыт тестом через SCN, тесты diff ссылаются только на определённые SCN
- **THEN** `data.findings` пуст, все `counts` равны 0, код 0

#### Scenario: Без git
<!-- id: SCN-VER-067 -->
- **WHEN** `warrant analyze add-search` в каталоге, который не является git-репозиторием
- **THEN** `data.skipped[]` содержит `ORPHAN` с причиной, `UNSATISFIED` и `CONFLICT` вычислены

#### Scenario: Архивированный Change
<!-- id: SCN-VER-072 -->
- **WHEN** после `warrant archive add-search` каталог Change перенесён в `openspec/changes/archive/2026-09-26-add-search/`, и вызван `warrant gate add-search --transition MERGED->ARCHIVED`
- **THEN** `analyze` читает delta specs и `tasks.md` из каталога архива, `gates["analyze-clean"]` равен `PASS` (не `BLOCKED` с `NO_INPUT`); если `tasks.md` архива упоминает удалённое требование, находка `CONFLICT` указывает путь `tasks.md` в архиве и gate — `FAIL`

#### Scenario: SCN другого открытого Change
<!-- id: SCN-VER-152 -->
- **WHEN** `tests/test_store.py` изменён в diff и упоминает `SCN-STO-001`, которого нет ни в main specs, ни в delta `add-search`,
  а delta `openspec/changes/add-store/specs/` объявляет его в `ADDED`; тот же файл упоминает `SCN-STO-009`, объявленный только
  в delta `openspec/changes/archive/2026-09-01-old-store/specs/`
- **THEN** `warrant analyze add-search` даёт одну находку `ORPHAN` с `id: "SCN-STO-009"` и `path: "tests/test_store.py"`,
  `counts.ORPHAN` равен 1, код 1; `SCN-STO-001` находкой не является

#### Scenario: Gate на commit со слитым чужим impl-PR
<!-- id: SCN-VER-153 -->
- **WHEN** на оцениваемом commit тест `tests/test_store.py` из diff упоминает только `SCN-STO-001`, объявленный в delta
  открытого Change `add-store`, а `add-search` в `MERGED`; вызван `warrant gate add-search --transition MERGED->ARCHIVED`
- **THEN** `gates["analyze-clean"]` равен `PASS`; если `add-store` на этом commit уже в архиве, а `SCN-STO-001` нет в main
  specs, — `FAIL` с находкой `ORPHAN`
