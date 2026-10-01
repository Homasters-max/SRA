---
id: WARRANT-ADR-0055
title: Цель 0.10.0 — версия, работающая в LATTICE; 0.10.0 — `exit-contract` и `guard-recovery`, тег — archive-PR `guard-recovery`; `judge-law` и `code-floor` — 0.11.0
adr_state: ACCEPTED
date: 2026-10-01
supersedes: []
amends: [WARRANT-ADR-0052, WARRANT-ADR-0053]
---

## Context

[ADR-0053](WARRANT-ADR-0053-guard-recovery.md) п. 1 собрал 0.10.0 из четырёх Change: `exit-contract` (закрыт) → `guard-recovery` → `judge-law` → `code-floor`. Тег `v0.10.0` ставит archive-PR `code-floor`, LATTICE переходит сразу на него, одной миграцией.

Состояние на 2026-10-01:

- **До тега — 8 PR.** `guard-recovery` не начат (3 PR); у `judge-law` слит spec-PR #130, остались impl и archive (2 PR); `code-floor` не начат (3 PR). Пять из восьми PR — с путями класса приёмки, их сливает maintainer.
- **LATTICE ждёт тег.** Закреплена на 0.8.2 с копией job `warrant` по waiver WAV-2026-002 до 2026-10-13. Запасной путь в [передаче lattice](../handoff/lattice.md) — `v0.9.0`, если тег позже 2026-10-10.
- **Запасной путь `v0.9.0` не работает на этой машине.** CLI из тега глобально заменит dev-CLI SRA, а агент `warrant-reviewer` берёт `warrant` из PATH. Развести их может только ADR-0053 п. 3 (хук и агенты исполняют закреплённый проектом CLI), то есть `guard-recovery`.
- **LATTICE нужен только `guard-recovery`.** Без него guard запирает её сессию при расхождении версий CLI и закрепления. `judge-law` и `code-floor` ужесточают судью; LATTICE они не разблокируют, а срок waiver торопит правки судьи, где спешка опаснее всего.
- **Перенос `judge-law` в следующую версию проверен по его spec.** Закон коммита `main`, чей `kernel` lock не равен kernel CLI, не вычисляется и даёт информационную находку `LAW_NOT_COMPUTED`, а не нарушение (delta `verification` `judge-law`). Подъём kernel до 0.11 — штатный путь.

Вопрос maintainer'у 2026-10-01: предложено выпустить 0.10.0 после `guard-recovery`, принято. Maintainer задал цель: довести версию до работы в LATTICE.

## Decision

1. **Цель 0.10.0 — версия, работающая в LATTICE.**
   - 0.10.0 закрыта, когда в LATTICE слит pin-Change на `v0.10.0`: CLI на машине — из тега (ADR-0053 п. 4), job `warrant / warrant` — reusable workflow тега, копия job удалена, guard не запирает сессию. Тег — шаг к цели, не сама цель.
   - Сбой перехода LATTICE на `v0.10.0` идёт в потоке `stabilization` первым, до impl `judge-law`; исправление — patch `v0.10.1`.
2. **0.10.0 — два Change: `exit-contract` (закрыт) → `guard-recovery`** (меняет ADR-0052 п. 1 и ADR-0053 п. 1). Тег `v0.10.0` ставит archive-PR `guard-recovery`.
3. **0.11.0 — `judge-law` → `code-floor`.** Состав и решения обоих Change — ADR-0052 без изменений. Тег `v0.11.0` ставит archive-PR `code-floor`; им закрывается цикл 1 ([ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 4).
4. **Версии в `judge-law`.** Первым изменением поставляемого после `v0.10.0` (R-14) impl-PR `judge-law` поднимает CLI до 0.11.0, `kernel` до 0.11 и диапазон `kernel` pack `core-sdd` до `<0.12` (patch pack, как 0.4.1).
   - Design D11 и строка proposal «Версии не поднимаются» заменяются строкой `I-N` impl-PR (навык `decision`); spec-артефакты `judge-law` не правятся, waiver `spec-approved` для этого не нужен.
   - Переходы `judge-law`, записанные при `kernel` 0.10, судья 0.11 видит законами, которые не вычисляются: находка `LAW_NOT_COMPUTED`, не нарушение.
   - CHANGELOG — раздел `## 0.11.0`, а не дополнение `## 0.10.0`.
5. **LATTICE.** pin-Change на `v0.10.0` — сразу после тега, по [передаче lattice](../handoff/lattice.md). Запасной путь `v0.9.0` снят. Переход на `v0.11.0` — отдельный pin-Change после тега, без срока.

## Consequences

- `CHANGELOG.md` `## 0.10.0` — состав и момент тега по п. 2; «Вердикт» и «Миграция» `guard-recovery` дополняет как в ADR-0053.
- [Передача stabilization](../handoff/stabilization.md): цель — п. 1, порядок — `guard-recovery` → тег → проверка LATTICE → `judge-law` → `code-floor`.
- [Передача lattice](../handoff/lattice.md): тег `v0.10.0` — после archive-PR `guard-recovery`; миграция — без floor `feature` (0.11.0).
- Backlog: «Куда» строк `judge-law` и `code-floor` — 0.11.0; R-46 — `guard-recovery` (его готовый запрос уже берёт R-46).
- Индекс ADR: 0052 и 0053 — «уточнён 0055».

## Alternatives

- **Оставить четыре Change в 0.10.0** — отвергнуто: 8 PR до LATTICE, а срок waiver давит на правки судьи.
- **LATTICE на `v0.9.0` до 2026-10-13** — отвергнуто: без ADR-0053 п. 3 CLI тега в PATH ломает review spec в SRA, а guard без `guard-recovery` снова запирает сессию при следующем расхождении версий.
- **Предварительный тег (`v0.10.0-rc`) после `guard-recovery`** — отвергнуто: второй вид тега, которого нет в процессе релиза (CHANGELOG, `versions:check`, закрепление `kernel` major.minor), а LATTICE всё равно мигрировала бы дважды.
