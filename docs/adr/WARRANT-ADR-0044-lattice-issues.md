---
id: WARRANT-ADR-0044
title: Change `lattice-issues` по вопросам LATTICE — пропущенный тест сценария `NOT_PROVEN`, атомарная запись состояния и восстановление Run, gate по check, общий аккаунт — находка до GitHub App агента, job `warrant` — reusable workflow, CLI 0.8.2
adr_state: ACCEPTED
date: 2026-09-29
supersedes: []
amends: [WARRANT-ADR-0010, WARRANT-ADR-0036, WARRANT-ADR-0037, WARRANT-ADR-0040]
---

## Context

Исследование модели `dev/` LATTICE (grilling LATTICE 2026-09-28) передало WARRANT шесть вопросов S-1…S-6. Каждый факт сверен с репозиторием 2026-09-28 (`main` 01d37f6). Решения maintainer'а — 2026-09-29.

- **S-1, идентичность.** REQ-VER-013 принимает решение blocking UNKNOWN по комментарию PR, если автор ∈ `roles.maintainer` ([ADR-0040](WARRANT-ADR-0040-slice-fixes.md) п. 3). [ADR-0010](WARRANT-ADR-0010-trust-by-reference.md) в Alternatives отверг approval комментарием `/approve`: такой комментарий не отличить от комментария агента под токеном человека. П. 4 ADR-0010 (бот агента, `identities.agents`) не реализован: `identities.agents` есть в схеме `config/1`, но код его не читает. Агент и maintainer работают под одним аккаунтом (BL-83). Поэтому `warrant ci` засчитывает решение UNKNOWN, merge и `human-approval`, сделанные агентом, как акты maintainer'а, и молчит об этом. `merged_by = pr.author` — только информационная находка `APPROVER_IS_AUTHOR` (ADR-0037 п. 5, BL-44).
- **S-4, пропущенный тест.** Parser `junit` даёт `PROVEN`, если нет падений и выполнен хотя бы один тест (REQ-VER-002). Частичный пропуск виден только в `metrics.skipped`. `analyze` засчитывает SCN по вхождению id в файл `paths.tests` (REQ-VER-010). Исполнитель помечает тест сценария `skip` / `todo` — `tests-passed` и `analyze-clean` зелёные. В этом репозитории id SCN стоит в имени теста (`it("SCN-VER-117 …")`), а значит и в `<testcase name>` отчёта.
- **S-3, надёжность Run.**
  - Ни одна запись состояния не атомарна. `writeJsonFile` пишет `writeFileSync` прямо в целевой файл: record, evidence, manifest, Run, `current`, waivers. Атомарно только создание lock (`O_EXCL`, `core/lock.ts`).
  - `run submit` пишет результат, evidence и manifest раньше Run. Обрыв между ними оставляет Run в `RUNNING` с записанным EVID; повтор выдаёт второй EVID того же Run.
  - Упавший Run остаётся в `RUNNING`, следующий `run start` получает `RUN_ACTIVE`. Отмена есть — `run finish --state CANCELLED`, но под Run `review` guard пропускает из shell только `warrant run submit`, а подсказка отказа отмену не называет (BL-81).
  - Незакоммиченное ловится только в `review` (`SPEC_UNCOMMITTED`).
- **S-2, своя проверка проекта.**
  - Утверждение LATTICE «самостоятельной локальной проверки нет» неверно. Загрузчик принимает check, gate и overlay из `.warrant/local/` без `overrides` (`pack: "local"`), и `warrant ci` запускает их в impl-PR.
  - Настоящих дыр три:
    1. Gate требует evidence по kind (`requires_evidence[]{kind, status}`) и берёт самую свежую запись. Второй producer `test-report` маскируется: упавший `dev-check` закрывает запись `tests-passed` или наоборот (как BL-57).
    2. В PR без Change (kind `none`) проверки не запускаются.
    3. Job `warrant` не поставляется: подключённый проект держит его копию (BL-51), и копии расходятся — `warrant-slice`, теперь LATTICE.
  - Прогон на каждый push в `main` ADR-0037 отверг (Alternatives), решение maintainer'а — оставить так.

## Decision

1. **Change `lattice-issues`** — один Change WARRANT, profile `factory-change`. Группы по порядку: (1) атомарная запись (п. 4); (2) пропущенный тест сценария (п. 2); (3) Run (п. 5); (4) gate по check (п. 6); (5) идентичность (п. 3); (6) reusable workflow (п. 7). CLI **0.8.2**. Pack `core-sdd` поднимается, только если меняются его golden-копии схем. Приёмка — Change LATTICE, который поднимает тег CLI и переходит на reusable workflow.
2. **Пропущенный тест сценария — `NOT_PROVEN`** (S-4; уточняет REQ-VER-002). Parser `junit` читает атрибут `name` каждого `<testcase>`. Если testcase пропущен (`<skipped>`, в том числе `todo`) и его имя содержит ссылку на SCN (формат `SCN-<AREA>-NNN`, ADR-0012), статус записи — `NOT_PROVEN` с limitation `junit: skipped SCN-…` (id через запятую, по порядку). Правило «все пропущены — `INCONCLUSIVE`» (R-4) остаётся для отчётов без таких имён. Честный пропуск (платформа, окружение) снимается waiver'ом. Форма «id SCN — в имени теста» становится нормой 06 для проектов под WARRANT. Покрытие `analyze` (L0, без прогона тестов) не меняется.
3. **Идентичность агента** (S-1; реализует ADR-0010 п. 4 со стороны CLI, уточняет ADR-0037 п. 5 и ADR-0040 п. 3):
   - Идентичность агента — **GitHub App** (решение maintainer'а 2026-09-29). App и его установку создаёт maintainer. Токен установки живёт только в окружении агента. `gh` на машине агента авторизован только App'ом: токен человека агенту недоступен, иначе разделение не держится. WARRANT этого не проверяет — это граница доверия, записанная в 06 §8 (угроза «общий аккаунт»).
   - `config/1`: `identities.agents[].login` читается. `validate` отклоняет логин, стоящий и в `roles.*`, и в `identities.agents` (`CONFIG_INVALID`, ADR-0010 п. 4: `roles.*` не содержат ботов).
   - `warrant ci`, пока `identities.agents` базы пуст: каждый проверенный акт (решение UNKNOWN, ref `APPROVED` / `MERGED` с `merged_by`) даёт информационную находку `SHARED_IDENTITY` — акт maintainer'а не отличить от акта агента. Код выхода от неё не меняется.
   - Когда `identities.agents` непуст: `merged_by = pr.author` — `REF_NOT_VERIFIED` с причиной `merged_by`, а не находка `APPROVER_IS_AUTHOR` (INV-03 полностью, BL-44). Автор решения UNKNOWN из `identities.agents` — деталь `author`.
   - Решение UNKNOWN комментарием maintainer'а остаётся (ADR-0040 п. 3). Отказ ADR-0010 от `/approve` держится, пока агент может писать под аккаунтом человека. С GitHub App комментарий агента приходит от `…[bot]`, и проверка автора его отличает. До App противоречие видно находкой `SHARED_IDENTITY`, а не скрыто.
   - Активация waiver (`--by`, BL-75) — локальная запись, форж её не видит. Проверка исполнителя остаётся за BL-75.
4. **Атомарная запись состояния** (S-3). Все записи состояния WARRANT идут через `writeJsonFile` или один атомарный примитив рядом с ним: record, evidence, manifest, Run, `current`, waivers, результат review. Файл пишется во временный файл того же каталога, затем rename на место (на Windows — с повтором при `EPERM` / `EBUSY`). Оборванная запись оставляет прежний файл целым; временные файлы `validate` не читает. Сырой вывод checks (`raw/**`) — не состояние, остаётся как есть.
5. **Run: повтор, отмена, граница коммита** (S-3, BL-81; уточняет ADR-0036):
   - `run submit` идемпотентен по Run. Если evidence с `produced_by.run` этого Run уже записана, повтор переиспользует её id и дописывает Run, второй EVID не выдаётся.
   - Под Run `review` guard пропускает, кроме `warrant run submit`, команды без записи: `warrant status`, `warrant gate` (у `verify` нет `--dry-run` — review 1 spec `lattice-issues`), `warrant … --help`, `git status | log | diff | show`, `cd`, — и отмену `warrant run finish --state CANCELLED`. Подсказка отказа называет отмену. Отдельной команды `run cancel` нет: отмена уже есть в `run finish` (REQ-ENF-003).
   - `run start` `specify` / `implement` при незакоммиченных файлах внутри `write_scope` нового Run даёт находку `UNCOMMITTED_IN_SCOPE` со списком путей. Граница результата Run — коммит; Run не стартует поверх чужой незакоммиченной работы молча.
   - Восстановления («возобновить Run») нет. В 04 — таблица восстановления: точка обрыва → что осталось на диске → команда.
   - R-32 (недостижимая ветка `review` в `editWithRun`) удаляется.
6. **Gate по check** (S-2 п. 1; механизм для BL-57). Элемент `requires_evidence[]` gate/1 получает необязательное поле `check` — id check. Gate берёт самую свежую запись kind'а, произведённую этим check (`produced_by`), и не видит записи других producers того же kind. `validate`: `check` называет загруженный check, чей `produces` содержит `kind` (иначе `CONFIG_INVALID`). Без `check` — прежнее правило. Проект со своим `dev-check` объявляет его check и gate с `check: "dev-check"` в `.warrant/local/`.
7. **Job `warrant` — reusable workflow; проверки вне Change — job проекта** (S-2 п. 2, 3; BL-51; уточняет ADR-0037):
   - WARRANT поставляет job `warrant` как reusable workflow (`on: workflow_call`) в своём репозитории. Проект вызывает его по тегу CLI, копии не держит. Входы — команда подготовки проекта (установка зависимостей и инструментов checks), версия OpenSpec. Job этого репозитория вызывает тот же workflow: источник один.
   - Job `warrant` судит Changes. Проверки PR без Change (документы, контекст разработки) — job проекта в его workflow, как job `test` здесь. Прогона на каждый push в `main` нет (ADR-0037 п. 4, Alternatives).

## Consequences

- ADR-0010, ADR-0036, ADR-0037, ADR-0040 — заметки `amended_by`.
- Delta specs `lattice-issues`: REQ-VER-002 (parser `junit`), REQ-VER-003 (выбор записи gate по `check`), REQ-VER-011 и REQ-VER-013 (`SHARED_IDENTITY`, `merged_by = pr.author`), REQ-KRN-021 (`validate`: `identities.agents` ∩ `roles`, `check` gate), REQ-ENF-002 (`UNCOMMITTED_IN_SCOPE`), REQ-ENF-004 (guard под Run `review`), REQ-ENF-007 (повтор `run submit`); атомарная запись — требование kernel. Документы 04 (таблица восстановления), 06 §2 (id SCN в имени теста), 06 §8 (угроза «общий аккаунт», reusable workflow, проверки вне Change — job проекта).
- `docs/backlog.md`: «Куда» BL-44, BL-51, BL-81, R-32 — `lattice-issues`. BL-83 — `lattice-issues`, затем GitHub App maintainer'а и `identities.agents` в `warrant.json`. BL-57 — механизм в `lattice-issues`, привязка gate `factory-golden-passed` — по failure mode. S-5 (жизненный цикл `rule/1`) — новая строка backlog.
- BL-86 (длинная команда в guard) остаётся в нарезке фазы 5: в вопросах LATTICE её нет.
- После archive-PR — тег `v0.8.2`, `npm link` из основного checkout, передача в сессию LATTICE.

## Alternatives

- **Проверка «автор ∉ `identities.agents`» без GitHub App** — отвергнуто: под общим аккаунтом логин агента = логин maintainer'а, проверка ничего не отличает; видимость даёт `SHARED_IDENTITY`.
- **Машинный аккаунт с PAT** — отвергнуто maintainer'ом: аккаунт того же класса, что человеческий; права App задаются по репозиторию.
- **Заменить решение UNKNOWN комментарием другой формой** — отвергнуто: формы, недоступной агенту под тем же токеном, нет; с App комментарий различим.
- **Пропущенный тест сценария — находка при `PROVEN`** — отвергнуто: gate судит по статусу, находку никто не обязан читать.
- **Покрытие `analyze` по отчёту тестов** — отвергнуто: `analyze` — L0 без прогона; отчёт судит `tests-passed`.
- **`warrant run cancel`** (план BL-81) — отвергнуто: дублирует `run finish --state CANCELLED`; достаточно пропустить её под Run `review` и назвать в подсказке.
- **Возобновление упавшего Run** — отвергнуто: у Run нет точки сохранения, которой можно доверять; отмена и новый Run дешевле.
- **Своя evidence kind и parser `exit-code` для проверки проекта** — отвергнуто: kind — каталог packs, а маскировку снимает привязка gate к check.
- **Проверки проекта в kind `none` job `warrant`** и **прогон на push в `main`** — отвергнуто maintainer'ом: CI на каждом PR и `main` ради проверок, которые проект запускает своим job.
- **Шаблон workflow копией (`init` или файл pack'а)** — отвергнуто: копия расходится (BL-51 — ровно этот отказ); reusable workflow по тегу не копируется.
- **Жизненный цикл `rule/1` в этом Change** (S-5) — отложено maintainer'ом: первого набора правил нет (BL-4), failure mode WARRANT нет ([ADR-0007](WARRANT-ADR-0007-mvp-scope.md)).
