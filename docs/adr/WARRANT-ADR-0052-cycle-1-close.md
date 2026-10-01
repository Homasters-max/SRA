---
id: WARRANT-ADR-0052
title: Остаток цикла 1, 0.10.0 — три Change (`exit-contract`, `judge-law`, `code-floor`); один gate engine — общие предикаты, N44 держится; hash перехода — окно законов `main`; floor профиля — к моменту spec; `dangling` в тестах — по префиксу области; archive и abandon — только PR (Р-5); активация waiver — merge maintainer'ом (Р-9)
adr_state: ACCEPTED
date: 2026-10-01
supersedes: []
amends: [WARRANT-ADR-0049, WARRANT-ADR-0051]
amended_by: [WARRANT-ADR-0053, WARRANT-ADR-0055]
---

## Context

После `agent-merge` (0.9.0) в цикле 1 ([ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 4) остались пункты, которые [ADR-0051](WARRANT-ADR-0051-agent-merge-first.md) п. 1 перенёс на 0.10.0: код выхода 4 и `retryable` (WS-06), WS-15, A-34, сверка hash policy у `APPROVED`, `SPECIFIED`, `ARCHIVED`, A-40, A-41, остаток WS-03, R-45. Аудит `2026-10-01-cycle-1b` (после `agent-merge`) добавил A-45…A-48 и вопрос: что значит «один gate engine для `transition` и судьи» (ADR-0051 п. 5) рядом с N44 ([ADR-0037](WARRANT-ADR-0037-phase-4c-ci.md), design `phase-4c`: судья не пересчитывает вердикты прошлых переходов).

Факты кода (сбор 2026-10-01 на `0993a74`):

- коды выхода: `EXIT` = 0/1/2/3 (`core/errors.ts:117-125`); код выбирают по месту 56 строк в 25 файлах, сложение `Math.max` ×5 (A-42); инфраструктура (форж, таймаут check, git, openspec, `INTERNAL`) — 3, падение до JSON — 1; `BUSY` — 2 в `check`, `run`, `fmt` и 3 в `ci fetch`; `warrant ci` при занятом замке check — 2, вне REQ-VER-011; схемы envelope нет, `errors[]` — `{code, message, path?, hint?}`;
- hash policy (`core/resolve/merge.ts:201-213`) — вся effective policy, не переход; судья сверяет его только у `MERGED` против базы archive-PR (`core/ci/record.ts:123-169`);
- классификация: `feature` с пустым `match.paths` из diff не выводится (REQ-SDD-003); пустой `profiles` валиден; судья судит classification только в impl-, archive-, abandon-PR;
- `paths.tests: packages/cli/test` в SRA даёт 224 `ID_DANGLING`: 219 — с префиксами, которых нет ни в одной spec (`REQ-SRC`, `SCN-TST` …: данные фикстур), 5 — выдуманные `REQ-KRN`.

Два раунда вопросов maintainer'у 2026-10-01; приняты рекомендации.

## Decision

1. **0.10.0 — три Change по порядку** (уточняет ADR-0051 п. 1).
   - `exit-contract`: WS-06, A-42, A-48 (п. 2).
   - `judge-law`: остаток WS-03 (п. 4), A-45 (п. 3), A-47, R-45, A-34, A-40.
   - `code-floor`: WS-15 (п. 5), A-46, A-41, `paths.tests` SRA (п. 6).
   - Порядок — по зависимостям: R-45 (`judge-law`) ловит ошибку загрузки M^1 классом ошибки `exit-contract`; floor (`code-floor`) читает пути diff одной функцией A-46.
   - Версия `0.10.0` поднимается первым изменением поставляемого (R-14); тег `v0.10.0` — после archive-PR `code-floor`.
2. **Код выхода и `retryable`** (WS-06; Р-10 — да).
   - Код 4 — сбой инфраструктуры, повтор может пройти: форж недоступен, таймаут, сетевой сбой, занятый замок. Признак — `retryable: true` в элементе `errors[]`; ключ пишется только при `true` (как `path` и `hint`).
   - Повторять можно только код 4; нарушение правила и конфигурация не повторяются.
   - Код выбирает одна функция по таблице приоритета, не `Math.max`: не повторяемая ошибка старше повторяемой (A-42).
   - Один сбой — один код во всех командах (`BUSY`, `validate` и `validate --files`); падение до JSON — не 1.
   - Ошибка диапазона pack различается подвидом ошибки, не текстом сообщения (A-48).
   - `guard --frontend` — протокол Claude Code, его код 2 не меняется.
3. **Один gate engine — общие предикаты, N44 держится** (форма ADR-0051 п. 5).
   - Gate engine отдаёт чистые предикаты оснований вердикта: `applies_when` (`appliesTo`), засчитываемый waiver (`countingWaiver`) и основание `NOT_APPLICABLE` по evidence от check (A-45). Их зовут и `transition`, и судья.
   - Судья проверяет ими записанный вердикт, evidence не пересчитывает (N44).
   - Судья, исполняющий `evaluateGates` над записанным evidence, снимает N44 — только отдельным ADR.
4. **Hash перехода — окно законов `main`** (остаток WS-03; меняет ADR-0051 Alternatives «сверка hash policy у всех переходов — отложено»).
   - У каждого нового перехода вперёд, кроме `PROPOSED`, `effective_policy_hash` SHALL совпасть с hash одного из допустимых законов, а ключи `gates` — с gates перехода в этом законе.
   - Допустимые законы: effective policy на first-parent коммитах `main` от точки ответвления PR до HEAD^1 (те, что меняют policy-пути, и начальный) и на HEAD; классификация — record базы или HEAD.
   - Закон коммита, который текущий CLI не вычисляет (встроенный pack другой версии), — информационная находка, не нарушение.
   - `MERGED` переходит на то же правило вместо сверки с базой archive-PR.
   - Почему окно: сдвиг `main` между переходом и CI не ломает честный record; все законы окна — законы `main`, их слил maintainer (класс путей ADR-0051 п. 2), закон HEAD — diff самого PR, который судья видит.
5. **Floor профиля — к моменту spec** (WS-15; уточняет ADR-0049 п. 6).
   - `feature` выводится из diff в `paths.src` (`match.path_roles`), в `classify` и у судьи (`requiredProfiles`).
   - В impl-PR профили floor из его diff SHALL уже быть в classification record базы — классификации spec-PR по путям «Impact» (BL-45); иначе `RECORD_MISMATCH` с причиной `classification`: Change возвращается в spec, иначе `APPROVED` прошёл бы по gates более слабого профиля.
   - Пустой `profiles` у Change, задевающего `paths.src` или `paths.tests`, — ошибка `classify`.
6. **`dangling` в `paths.tests` — по префиксу области** (меняет REQ-KRN-021 п. 13).
   - В файлах `paths.tests` висячим считается только ID с префиксом области, объявленной в `openspec/specs/**` или `openspec/changes/**`; ID чужой области — данные фикстуры.
   - SRA задаёт `paths.tests: packages/cli/test` (ADR-0051 п. 8, I-231); 5 выдуманных `REQ-KRN` в тестах переписываются.
7. **Archive и abandon — только PR** (Р-5; меняет [04 §5](../04-lifecycle.md)).
   - «Или push в `main`» из 04 §5 убирается: судья на push не запускается, `main` закрыт ruleset (ADR-0051 п. 3).
   - Детектор push в `main` и проверка настроек форжа WARRANT'ом — цикл 2 (WS-16; ADR-0051 п. 3: WARRANT настройки форжа не проверяет).
8. **Активация waiver человеком — merge maintainer'ом** (Р-9; уточняет [05 §7](../05-policy.md)).
   - `warrant waive --activate --by` — заявление. Актом человека его делает merge PR, который вносит файл waiver в `ACTIVE`: `.warrant/waivers/**` — путь класса приёмки (ADR-0051 п. 2), spec-PR сливает maintainer (ADR-0050 п. 1), impl-PR с путём класса — тоже он, и судья проверяет `merged_by` у ref.
   - Проверяемой ссылки на комментарий, как у UNKNOWN, нет: обнаружение держат класс путей и ref.
   - У потребителя — свой профиль приёмки с `.warrant/waivers/**` и `CODEOWNERS` (миграция 0.9.0).

## Consequences

- Три Change начинаются в новой сессии, по порядку п. 1; каждый — spec-PR и impl-PR сливает maintainer (пути CLI — класс приёмки), archive-PR — бот.
- Delta specs: `exit-contract` — REQ-KRN-002, REQ-KRN-003, REQ-KRN-021, REQ-KRN-032, REQ-KRN-036, REQ-VER-002, REQ-VER-005, REQ-VER-006, REQ-VER-011, REQ-VER-012, REQ-VER-013, REQ-ENF-005; `judge-law` — REQ-VER-011 («Record», «Ref»); `code-floor` — REQ-SDD-001, REQ-SDD-003, REQ-KRN-021, REQ-KRN-028, REQ-VER-011.
- `CHANGELOG.md` 0.10.0 — «Вердикт» и «Миграция для потребителя»: код 4 и `retryable` (reusable `warrant.yml` и копия job у LATTICE — код 4 тоже красит job), floor `feature`, `path_roles`, пустой `profiles`.
- Нормы в этом ADR: 04 §5 (п. 7) и 05 §7 (п. 8).
- Backlog: WS-06, WS-03, WS-15, WS-16 — «Куда» по п. 1 и п. 7; новые расхождения WS-06 (`BUSY` 2/3, `ci` → 2).
- Индекс ADR: ADR-0049, ADR-0051 — «уточнён 0052».

## Alternatives

- **Один Change на 0.10.0:** отвергнуто — delta specs четырёх capabilities сразу, около 12 групп, высокий риск `NOT_PROVEN` у review spec.
- **Два Change** (`exit-contract` и остальное): отвергнуто — судья и floor независимы, их review легче порознь.
- **Судья исполняет `evaluateGates`:** отвергнуто для 0.10.0 — снимает N44, расходится с локальным `transition` по времени и attestation.
- **Только состав gates против базы HEAD^1:** отвергнуто — ловит лишь пропущенный gate и ломается тем же сдвигом `main`.
- **Опорный коммит на переход** (`SPECIFIED` — точка ответвления, `APPROVED` — M spec-PR): отвергнуто — сдвиг `main` между merge spec-PR и ответвлением impl-PR даёт отказ честному record.
- **Floor только в impl-PR:** отвергнуто — `APPROVED`, пройденный по gates `chore` (без `adversarial-review`), остаётся.
- **Тесты вне `dangling`; переписать фикстуры:** отвергнуто — первое теряет висячие SCN в неизменённых тестах, второе — 224 ID в ~40 файлах, хрупко.
- **Активация waiver проверяемой ссылкой** (как UNKNOWN): отвергнуто — новый вид ref, а merge maintainer'ом с 0.9.0 уже держат класс путей и судья.
