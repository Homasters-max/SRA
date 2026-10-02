## MODIFIED Requirements

### Requirement: Живость hooks
<!-- id: REQ-VER-009 -->

CLI SHALL вычислять для Change finding `FRONTEND_HOOKS_INACTIVE`
([ADR-0018](../../../../docs/adr/WARRANT-ADR-0018-frontend-adapters.md) п. 5, D-14): пути diff Change, кроме удалённых (base — как у gate
`scope-valid`), под `paths.src` ∪ `paths.tests` ∪ каталоги `paths.data` ([REQ-KRN-037](../kernel/spec.md)), ни один Run Change (`<state>/runs/*.json` с `change` этого Change) для которых
не содержит события `phase: "post"` с этим путём в `paths[]`. Finding — `{ code: "FRONTEND_HOOKS_INACTIVE", paths[], more }`:
не больше 10 путей по порядку, `more` — число остальных. `warrant status` SHALL добавлять его в `verification.findings[]` Change в состоянии
`IMPLEMENTING` и дальше; `warrant verify` и `warrant gate` — в `data.findings[]` для перехода `VERIFYING->MERGED`. Finding SHALL
NOT менять verdict, `controller_action` и код выхода: правки человека без hooks легитимны. Без `paths.src`, `paths.tests` и
`paths.data` finding не вычисляется.

#### Scenario: Правка без hooks
<!-- id: SCN-VER-053 -->
- **WHEN** Change в `VERIFYING` меняет `src/app.py`, а ни в одном Run Change нет события `post` с `src/app.py`
- **THEN** `warrant verify add-search --transition VERIFYING->MERGED` содержит в `data.findings[]` `FRONTEND_HOOKS_INACTIVE` с `paths: ["src/app.py"]`, а verdicts и код выхода те же, что без него

#### Scenario: Все правки под hooks
<!-- id: SCN-VER-054 -->
- **WHEN** каждый путь diff под `paths.src` и `paths.tests` есть в событии `post` одного из Runs Change, а `docs/notes.md` изменён без события
- **THEN** `FRONTEND_HOOKS_INACTIVE` отсутствует в `warrant status add-search` и в отчёте `verify`

#### Scenario: Много путей
<!-- id: SCN-VER-055 -->
- **WHEN** без событий guard изменено 13 файлов под `paths.src`
- **THEN** finding содержит 10 путей и `more: 3`

#### Scenario: Правка данных без hooks
<!-- id: SCN-VER-160 -->
- **WHEN** `warrant.json` задаёт только `paths.data: ["std"]`, Change в `VERIFYING` меняет `std/std.json` и `docs/notes.md`, а ни в одном Run Change нет события `post` с ними
- **THEN** `warrant verify add-search --transition VERIFYING->MERGED` содержит в `data.findings[]` `FRONTEND_HOOKS_INACTIVE` с `paths: ["std/std.json"]`, а verdicts и код выхода те же, что без него
