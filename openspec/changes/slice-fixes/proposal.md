# Proposal: slice-fixes

## Why

Vertical slice `rate-limiter` ([ADR-0039](../../../docs/adr/WARRANT-ADR-0039-vertical-slice.md)) прошёл три PR на v0.7.0, но
критерий MVP ([13 §1](../../../docs/13-roadmap.md)) исполнен не весь:

- **`WAIT` по blocking UNKNOWN не исполним (BL-59).** `unknowns[]` record читают gate и controller, но не пишет ни одна
  команда, а правку record агентом guard запрещает. UNKNOWN живёт только в markdown, gate его не видит.
- **Путь waiver ADR-0024 п. 4 под guard закрыт (BL-63).** Строку `I-N` в `design.md` и правку delta spec в `IMPLEMENTING`
  не пишет ни одна операция Run; подсказки guard ходят по кругу.
- **Мелкие отказы slice:**
  - невалидный `--propose` записывается в record (BL-60);
  - устаревший локальный `main` как база `classify` (BL-58);
  - `archive --dry-run` называет каталог не той датой (BL-64);
  - guard запрещает `python -` как запуск check `python -m pytest` (BL-61);
  - `AREA_UNKNOWN` и `deny` для путей, которые не пишет ни один Run, — без выхода (BL-56);
  - подсказки восстановления называют `ci.yml`, а в slice workflow — `warrant.yml` (BL-53).

Первый Change, который правит `core/ci` по отказу slice, начинается швами A-31 + A-32 (ADR-0039 п. 7). Решения — grilling
N59–N66, [ADR-0040](../../../docs/adr/WARRANT-ADR-0040-slice-fixes.md).

## What Changes

- **Швы `core/ci` первой группой** (без изменения поведения):
  - A-31 — один читатель attestation и один run-ключ;
  - A-32 — одна карта «переход → ref подтверждения, вид PR»;
  - A-35 — пути состояния Change;
  - A-36 — подмножество видов PR у владельца;
  - A-33 — ручная сборка оценки impl-PR остаётся, мёртвая опция уходит.
- **`warrant unknown add | resolve`** (BL-59, [02 §1](../../../docs/02-vocabulary.md)):
  - запись и закрытие UNKNOWN в record;
  - `UNK-<AREA>-NNN` — следующий номер по spec, Changes и records;
  - закрытие `--as decision | fact | assumption`; blocking UNKNOWN закрывает только решение (`decision`) с `--ref` на
    комментарий maintainer'а, в тексте которого стоит id UNKNOWN;
  - только в `PROPOSED` и `SPECIFIED`: вопрос реализации — строка `I-N`;
  - `--dry-run`.
- **Схема `change-record/1`:** у `unknowns[]` необязательные `resolved_as` и `ref` (аддитивно).
- **Gate `blocking-unknowns-resolved`:** blocking UNKNOWN, закрытый не решением с `ref`, — `FAIL` с `DECISION_WITHOUT_REF`
  (ответ записан, доказательства нет).
- **`warrant ci` проверяет решения UNKNOWN через форж:**
  - автор комментария — maintainer, текст называет id UNKNOWN;
  - комментарий — в spec-PR, который несёт ref `APPROVED`;
  - PR после `SPECIFIED` не удаляет и не ослабляет UNKNOWN record базы — `RECORD_MISMATCH`;
  - `ForgePort` получает метод чтения комментария.
- **`write_scope` операции `implement`** += `design.md` и `specs/**` Change (BL-63): ADR-0024 п. 4 исполним под guard.
- **Мелкие правки:**
  - `classify` проверяет `--propose` до записи (BL-60) и отказывает до записи, когда база позади upstream (BL-58);
  - dry-run `archive` называет каталог датой настоящего прогона (BL-64);
  - guard сверяет команду check с `-m <модуль>` (BL-61);
  - `hint` у `AREA_UNKNOWN` и у `deny` пути без операции записи (BL-56);
  - подсказки восстановления — имя workflow из run (BL-53).
- **Версии:** CLI `0.7.0 → 0.8.0`; pack `core-sdd` `0.3.3 → 0.3.4` — диапазон `kernel: ">=0.1 <0.9"`.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `kernel`:
  - REQ-KRN-011 — `resolved_as`, `ref` у `unknowns[]`;
  - REQ-KRN-024 — номер `UNK`/`ASM` с учётом records, `hint` у `AREA_UNKNOWN`;
  - REQ-KRN-028 — проверка `--propose`, база позади upstream;
  - REQ-KRN-034 — дата каталога в `archive --dry-run`;
  - новое требование — команда `unknown` (REQ-KRN-035).
- `verification`:
  - REQ-VER-004 — `blocking-unknowns-resolved` и `ref` решения;
  - новое требование — решения UNKNOWN в `warrant ci` (REQ-VER-013).
- `enforcement`:
  - REQ-ENF-002 — `write_scope` `implement`;
  - REQ-ENF-004 — префикс команды check с `-m`, `hint` для пути без операции записи.
- `core-sdd`:
  - REQ-SDD-001 — диапазон `kernel` `<0.9`.

## Non-Goals

- **`warrant assumption add`** — BL-66: ASSUMPTION пишется только закрытием UNKNOWN.
- **Перенос `unknowns[]` envelope `run submit` в record** — отложен 07 §4.
- **UNKNOWN после `APPROVED`:** `warrant unknown` в реализации недоступен; вопрос реализации — строка `I-N` с решением
  maintainer'а, как и прежде.
- **Операция записи для `.warrant/local/**` и `.github/workflows/**`** — BL-56. Pin-Change в slice ведёт maintainer руками
  (ADR-0040 п. 7).
- **Привязка `factory-golden-passed` к check golden** — BL-57, по failure mode.
- **Пересчёт ошибочной `classification` до `SPECIFIED`, `classify --dry-run`** (BL-58) и **резерв `warrant id`** (BL-62).
- **Gate `human-approval` на `VERIFYING->MERGED`:** `merged_by` уже проверяет `warrant ci` (ADR-0040 п. 5).
- **Tarball релиза CLI** (BL-52), **A-34**, **A-5**, **BL-54**, **BL-55**.

## Impact

- `packages/cli/src`:
  - новые — `commands/unknown.ts`, `core/unknowns/*` (запись, закрытие, номер), `core/evidence/attestation.ts` (A-31),
    `core/ci/decisions.ts` (решения UNKNOWN);
  - правки:
    - `core/ci/*` (A-31, A-32, A-35, A-36, BL-53), `core/record/lifecycle.ts` (A-32), `core/transition/*` (A-31, A-33);
    - `core/ports/forge.ts`, `adapters/forge-gh.ts`;
    - `core/gates/l0/blocking-unknowns-resolved.ts`, `core/ids/*`;
    - `core/run/scope.ts`, `core/guard/*`, `core/classify/*`;
    - `commands/archive.ts`, `bin/warrant.ts`.
- `packages/cli/schemas/change-record.1.schema.json` и копия в `.warrant/schemas/`.
- `packages/cli/test`:
  - app `unknown`, `ci`, `classify`, `guard`, `run`, `archive`;
  - контракт `ForgePort` (комментарий);
  - помощники тестов `ci` (A-37).
- `packs/core-sdd/pack.json` (версия, диапазон `kernel`), fixture-packs, lock, golden.
- Навыки `change-spec-pr` и `change-impl-pr` — шаги `warrant unknown` и правки spec в Run `implement`.
- `docs/`:
  - 04 §10 — синтаксис `warrant unknown`;
  - 06 §4 — `blocking-unknowns-resolved`;
  - `backlog.md` — закрытые строки.
- **BREAKING** (внешних пользователей нет, ADR-0013):
  - проект на kernel 0.7 получает `LOCK_MISMATCH` до `warrant sync`;
  - закрытое решение без `ref` больше не проходит `blocking-unknowns-resolved`.
