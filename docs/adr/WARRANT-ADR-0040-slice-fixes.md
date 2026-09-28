---
id: WARRANT-ADR-0040
title: Change `slice-fixes` по отказам slice — `warrant unknown` с ref DECISION в CI, правка spec в `implement`, `MERGED` без `--by`, pin в slice руками, CLI 0.8.0
adr_state: ACCEPTED
date: 2026-09-27
supersedes: []
amends: [WARRANT-ADR-0024, WARRANT-ADR-0037, WARRANT-ADR-0039]
amended_by: [WARRANT-ADR-0041, WARRANT-ADR-0044]
---

> Уточнено [ADR-0044](WARRANT-ADR-0044-lattice-issues.md) п. 3: решение UNKNOWN комментарием держится при отдельной идентичности агента (GitHub App); пока `identities.agents` пуст, `warrant ci` даёт находку `SHARED_IDENTITY`.

## Context

Change `rate-limiter` в `warrant-slice` прошёл три PR на v0.7.0 ([ADR-0039](WARRANT-ADR-0039-vertical-slice.md)), но критерий MVP ([13 §1](../13-roadmap.md)) исполнен не весь: `WAIT` по blocking UNKNOWN не упражнялся (BL-59), путь waiver [ADR-0024](WARRANT-ADR-0024-spec-approved-contract.md) п. 4 не проверен (BL-63). Вход grilling — строки `docs/backlog.md` с источником `slice` (BL-56…BL-65), A-31…A-37 аудита [2026-09-26-phase-4c](../process/audits/2026-09-26-phase-4c.md) (снимок актуален: код CLI после v0.7.0 не менялся), `docs/handoff/phase-4.md`.

Факты на 2026-09-27:

- `warrant unknown add | resolve` и `warrant assumption add` — норма MVP ([02 §1](../02-vocabulary.md), [04 §10](../04-lifecycle.md)), не реализованы. DECISION, закрывающий UNKNOWN, MUST нести `ref` на комментарий maintainer'а в PR; у элемента `unknowns[]` схемы `change-record/1` поля `ref` нет, есть только `resolution`.
- Gate `blocking-unknowns-resolved` стоит на `SPECIFIED->APPROVED`; spec-PR показывает gates этого перехода информационно, связующая оценка — `transition APPROVED` первым коммитом impl-PR, ref которого судит `warrant ci`.
- `write_scope` операции `implement` (REQ-ENF-002) — `<paths.src>/**`, `<paths.tests>/**`, `tasks.md` Change; `specify` — только в `PROPOSED`. Строка `I-N` в `design.md` и правка delta spec в `IMPLEMENTING` под guard недоступны.
- `--by` у `MERGED` велит текст проектного правила slice `.warrant/local/rules/process.json` (написан bootstrap), а не генератор `sync`; `transition` его игнорирует — у `VERIFYING->MERGED` нет gate `human-approval`. Решение человека о merge уже доказывает `merged_by` слитого impl-PR ([ADR-0037](WARRANT-ADR-0037-phase-4c-ci.md) п. 5).
- Gate `factory-golden-passed` требует `test-report` `PROVEN` без привязки к check: в slice его даёт `tests-passed` (pytest), и Change с правкой `.warrant/**` gate проходит — BL-57 в записанном виде не блокер.
- Ни одна операция Run не пишет `.warrant/local/**` и `.github/workflows/**`: Change `factory-change` в slice (смена pin, текст процесса) агенту под guard не исполним.
- Pack `core-sdd` 0.3.3 несёт `kernel: ">=0.1 <0.8"`; `KERNEL_VERSION` — major.minor CLI; lock slice записан kernel `0.7.0` — CLI 0.8 даст `LOCK_MISMATCH` до `warrant sync`. Slice требует `core-sdd` `^0.3.3`.
- `npm i -g github:Homasters-max/SRA#v0.7.0` не исполняет `prepare` git-зависимости (BL-52); workflow slice ставит CLI через `npm pack github:…#<тег>` → `npm i -g ./<tgz>`.

## Decision

1. **Change `slice-fixes`** (N59) — один Change WARRANT по отказам slice, profile `factory-change`; каждый отдельный Change — лишний цикл «тег → pin → Change slice». Группы по порядку: (1) швы `core/ci` (п. 6); (2) `warrant unknown` (п. 2); (3) ref DECISION в CI (п. 3) с A-37 и BL-53; (4) `write_scope` `implement` (п. 4); (5) мелкие (п. 6). CLI **0.8.0** (новая команда, расширение схемы record), pack `core-sdd` **0.3.4** — только `kernel: ">=0.1 <0.9"`. Строки нового ADR в roadmap нет: приёмка — строка 4c 13 §2 (ADR-0039 п. 8).
2. **`warrant unknown`** (N60; BL-59) — по норме 02 §1:
   - `warrant unknown add <change> --area <AREA> --text <вопрос> [--blocking] [--dry-run] [--json]` — id `UNK-<AREA>-NNN`, следующий номер по record (резерва не нужно);
   - `warrant unknown resolve <change> <UNK> --as decision|fact|assumption --text <ответ> [--ref <URL>] [--dry-run] [--json]`; `--as decision` без `--ref` — `USAGE` с `hint`; закрытый UNKNOWN повторно не закрывается;
   - элемент `unknowns[]` `change-record/1` получает необязательные `resolved_as` и `ref` (аддитивно, major тот же), `resolution` — текст ответа;
   - только в `PROPOSED` и `SPECIFIED` (вопрос реализации — строка `I-N` с решением maintainer'а), перехода не пишет; открытый blocking UNKNOWN — `warrant status` `WAIT`, next `clarify`;
   - blocking UNKNOWN закрывает только DECISION с `ref` (`fact` и `assumption` — для не-blocking); локально gate `blocking-unknowns-resolved` проверяет форму: blocking без DECISION с `ref` — `FAIL`. Состояния и закрытие blocking — решения maintainer'а по review 1 spec `slice-fixes` (2026-09-27). Контракт вывода и exit-коды — design Change по линзе `cli-contract`. `warrant assumption add` — не в этом Change (строка backlog).
3. **Ref DECISION в `warrant ci`** (N61). На impl-PR вместе с ref `APPROVED` (`judgeRefs`), на spec-PR — информационно: ref — URL комментария PR `#issuecomment-<id>` или `#pullrequestreview-<id>` (строчные `#discussion_r…` — нет); автор ∈ `roles.maintainer`; текст комментария содержит id UNKNOWN (review 1 spec, решение maintainer'а); комментарий — в том PR, который несёт ref `APPROVED` (spec-PR Change). `ForgePort` получает пятый метод — комментарий по URL → автор, PR и текст (уточняет ADR-0037 п. 6). Без этой проверки агент снимает `WAIT` сам. PR после `SPECIFIED` не удаляет элемент `unknowns[]` record базы и не ослабляет его (`blocking`, `resolution`, `resolved_as`, `ref`) — `RECORD_MISMATCH` (решение maintainer'а по review 2 spec, F-1, 2026-09-27; в impl-PR `slice-fixes` — строкой `I-N` и правкой delta spec по ADR-0024 п. 4).
4. **Правка spec в `IMPLEMENTING`** (N62; BL-63). `write_scope` `implement` += `openspec/changes/<change>/design.md` и `openspec/changes/<change>/specs/**`; `proposal.md` — нет (правка REQ-ENF-002). Контроль — gate `spec-approved`: правка spec даёт `SPEC_CHANGED_AFTER_APPROVAL`, пока maintainer не активирует waiver. ADR-0024 п. 4 исполним и под guard: строка `I-N` и правка delta spec — внутри Run `implement`, waiver предлагает агент, активирует maintainer.
5. **`MERGED` без `--by`** (N63; BL-65). `--by` у `MERGED` уходит из текста процесса — навык `change-archive-pr` здесь, `process.json` slice — pin-Change (п. 7); gate `human-approval` на `VERIFYING->MERGED` не вводится.
6. **Швы и мелкие правки** (N64). Первой группой — A-31, A-32 (ADR-0039 п. 7) и строки, чьё «Куда» срабатывает на тех же файлах: A-35, A-36; A-33 — ручная сборка `judgeImpl` строкой `I-N`, мёртвая опция `EvaluateOptions.admit` уходит. С группой ref DECISION — A-37 и BL-53 (имя workflow в `hint` — не литерал `ci.yml`). Мелкие одной группой: BL-60 (проверка `--propose` по схеме до записи), BL-58 (отказ `BASE_BEHIND_UPSTREAM` до записи, когда база позади своего upstream: повторный `classify` запись не ослабляет, поэтому предупреждение после записи бесполезно; пересчёта записи нет), BL-64 (dry-run `archive` — дата каталога по правилу настоящего прогона), BL-61 (guard сверяет полную команду check), BL-56 — только `hint` у `AREA_UNKNOWN` и у `deny` guard для пути, который никакой Run не пишет. Вне Change: BL-57 (п. Context — строка переписывается, по failure mode), BL-62, BL-54, BL-55, A-34.
7. **Pin в slice — руками maintainer'а** (N65; уточняет ADR-0039 п. 5). Change `factory-change` в slice проводит maintainer без сессии Claude (guard — только в hooks агента), тремя PR, переходы — через `warrant`: тег `v0.8.0` в `warrant.yml`, `kernel: "0.8"` в `warrant.json`, `warrant sync` (lock, схемы), текст `process.json` — без `--by` у `MERGED`, с `warrant unknown add | resolve` и путём waiver п. 4. В отчёте приёмки шаг помечен человеческим, как bootstrap. Форма установки CLI — `npm pack github:Homasters-max/SRA#<тег>` → `npm i -g ./<tgz>` (BL-52); tarball релиза — строкой backlog до второго проекта. Пути конфигурации проекта без операции записи — BL-56, фаза 5 или второй проект.
8. **Второй малый Change slice** (N66) — `rate-limiter-precision`, чтение F-1 последнего review `rate-limiter` («представимо конечным double»): в spec-PR агент записывает его blocking UNKNOWN (`unknown add --blocking`) → `WAIT`; maintainer решает комментарием в spec-PR, агент — `unknown resolve --as decision --ref`; REQ-RL-001 уточняется (MODIFIED). Review spec `PROVEN` с MAJOR — maintainer выбирает правку spec в impl-PR путём п. 4 (`I-N`, delta spec, `waive` → `--activate`). MAJOR нет — путь waiver в отчёте «не проверен», инсценировки нет.

## Consequences

- ADR-0024 п. 4, ADR-0037 п. 6, ADR-0039 п. 5 — заметки `amended_by`.
- Delta specs `slice-fixes`: REQ-ENF-002 (`write_scope` `implement`), команда `warrant unknown`, gate `blocking-unknowns-resolved` (форма ref), проверка ref DECISION в `warrant ci`, `ForgePort`; схема `change-record/1`.
- [04 §10](../04-lifecycle.md): синтаксис `warrant unknown`; `warrant assumption add` — позже.
- `docs/backlog.md`: «Куда» взятых строк — `slice-fixes`; BL-57 переписан (gate доказывается любым `test-report`); BL-56 расширен (пути конфигурации без операции записи); BL-52 — tarball релиза; новая строка `assumption add`.
- Навык `change-archive-pr`: шаг 3 без `--by`.
- После archive-PR `slice-fixes` — тег `v0.8.0`, `npm link` из основного checkout, pin-Change в slice (п. 7), затем сессия slice на `rate-limiter-precision` (п. 8) и отчёт приёмки в строке 4c 13 §2.

## Alternatives

- **`classify --propose` с `unknowns[]`** — отвергнуто: `classify` отвечает за риск, закрыть UNKNOWN им нельзя. **Перенос `unknowns[]` envelope `run submit` в record** — отложен 07 §4 и закрытия не решает.
- **Ref DECISION только по форме** — отвергнуто: blocking UNKNOWN снимается агентом без решения человека, `WAIT` проверяется лишь как текст.
- **Операция `amend` в `IMPLEMENTING`** — отвергнуто: дублирует контроль gate `spec-approved` + waiver, новая операция и подсказки. **Только `design.md` в `implement`, spec — отдельным Change `amends`** — возвращает отвергнутое ADR-0024.
- **Gate `human-approval` на `VERIFYING->MERGED`** — отвергнуто: ручной шаг без новой гарантии, `merged_by` доказывает то же.
- **Привязать `factory-golden-passed` к check golden сейчас** — отвергнуто: отказа нет; pin-Change покажет поведение gate в slice.
- **`write_scope` агента на `.warrant/local/**` и `.github/workflows/**` при `factory-change` или операция `configure`** — отвергнуто: агент правил бы свои правила и workflow CI.
- **CLI 0.7.1** — отвергнуто: новая команда не патч; переход kernel заодно проверяет обновление проекта `sync`.
- **Мелкие правки отдельным fix-Change** — отвергнуто: второй цикл «тег → pin».
