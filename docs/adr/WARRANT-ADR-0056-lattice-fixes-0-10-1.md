---
id: WARRANT-ADR-0056
title: 0.10.1 — пять исправлений для LATTICE одним patch-тегом (#138, #139, #141, #142, #143); id waiver — `WAV-<ULID>`; `SPECIFIED -> PROPOSED` до `APPROVED`
adr_state: ACCEPTED
date: 2026-10-02
supersedes: []
amends: [WARRANT-ADR-0012, WARRANT-ADR-0048, WARRANT-ADR-0055]
---

## Context

2026-10-02 LATTICE на WARRANT 0.10.0 завела пять issues. Каждая мешает работать с несколькими Change и worktree одновременно:

- **#138** (P1) — guard в git worktree Claude Code не видит активный Run. Хук берёт проект из каталога процесса, а не из `cwd` события. `write_scope` в worktree-сессиях не защищён.
- **#139** — id waiver `WAV-YYYY-NNN` — сквозная последовательность. Параллельные ветки выдают одинаковый id и получают merge-конфликт файлов waiver.
- **#141** — `analyze-clean` одного Change падает на `ORPHAN` по SCN другого открытого Change, чей impl-PR слит раньше archive-PR.
- **#142** — у Change в `SPECIFIED` до `APPROVED` нет пути переделки. Выход только `ABANDONED` и новый Change.
- **#143** — локальный судья CI оставляет записи evidence. `ci fetch` перечисляет в manifest каждую запись каталога.

Правила версий запрещают patch для части из них:

- По [ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 3 patch не меняет схему машинных файлов и вердикт на тех же входах. #139 расширяет схему `waiver/1`, #141 смягчает `analyze-clean`.
- По п. 1 того же ADR до конца цикла 2 minor не несёт новой функциональности. #142 добавляет переход, #143 — флаг.

По букве это `0.11.0`. Но `KERNEL_VERSION` — major.minor CLI. Значит, `0.11.0` — это `kernel` 0.11, patch `core-sdd` (диапазон `kernel` `<0.12`), а в LATTICE — `kernel: "0.11"`, `warrant sync` и pin-Change высокого риска. Кроме того, `0.11.0` по [ADR-0055](WARRANT-ADR-0055-release-for-lattice.md) п. 3–4 занят `judge-law`.

[ADR-0055](WARRANT-ADR-0055-release-for-lattice.md) п. 1: сбой перехода LATTICE на `v0.10.0` исправляется patch `v0.10.1`.

[ADR-0012](WARRANT-ADR-0012-id-allocation.md) п. 3 оставил `WAV-<year>-NNN`, так как waivers «редки и создаются человеком на `main`». Это больше не так: `warrant waive` зовёт агент в ветке каждого Change.

Вопросы maintainer'у заданы в issues:
- [#139](https://github.com/Homasters-max/SRA/issues/139#issuecomment-5950664575) — форма id и версия;
- [#142](https://github.com/Homasters-max/SRA/issues/142#issuecomment-5950853948) — переход.

Решения от 2026-10-02 — п. 1–3 ниже.

## Decision

1. **0.10.1 — patch для LATTICE: пять Change, один тег.**
   - Состав — пять Change: `guard-worktree` (#138), `analyze-open` (#141), `ci-local` (#143), Change id waiver (#139), Change перехода `SPECIFIED -> PROPOSED` (#142).
   - Тег `v0.10.1` ставит archive-PR последнего из них, когда слиты все пять. Если один надолго ждёт maintainer'а, выпуск без него — тоже решение maintainer'а.
   - Это исключение из ADR-0048 п. 1 и п. 3 по ADR-0055 п. 1. Каждое изменение обратно совместимо на входах 0.10.0:
     - старые файлы waiver валидны;
     - новых кодов выхода нет;
     - новый переход и флаг `--no-record` необязательны;
     - вердикт мягче только для `ORPHAN` по SCN другого открытого Change;
     - строже только guard, а он не судья.
   - `kernel` остаётся 0.10, диапазоны packs не меняются: потребитель меняет только тег.
   - Версию CLI 0.10.1 поднимает первый impl-PR из пяти (R-14).
   - CHANGELOG `## 0.10.1` — с подразделами «Вердикт» и «Миграция для потребителя», как у minor: каждое изменение поведения названо.
2. **Id waiver — `WAV-<ULID>`** (меняет ADR-0012 п. 3).
   - `warrant waive` выдаёт `WAV-` и ULID в той же форме, что `EVID` и `RUN`: без координации между ветками.
   - Старые `WAV-YYYY-NNN` остаются валидными в схеме, ссылках и `--activate` / `--revoke`.
   - Новых id в старой форме CLI не выдаёт.
3. **`SPECIFIED -> PROPOSED` до `APPROVED`** (меняет [04 §2](../04-lifecycle.md)).
   - Третий переход назад, как `VERIFYING -> IMPLEMENTING` и `IMPLEMENTING -> SPECIFIED`: без gates и без `--by`.
   - Record и история evidence сохраняются.
   - Переделка — spec-PR: `transition PROPOSED`, Run `specify`, новое review, `verify`, `transition SPECIFIED`. Сливает его maintainer, и этот merge — акт человека. `APPROVED --ref` называет этот spec-PR.
4. **`judge-law` и `code-floor` — 0.11.0 без изменений** (ADR-0055 п. 3–4). Impl-PR `judge-law` поднимает CLI с 0.10.1 до 0.11.0.

## Consequences

- `CHANGELOG.md` — `## 0.10.1` при первом impl-PR.
- ADR-0012 — «уточнён 0056» (п. 3); ADR-0048 и ADR-0055 — «уточнён 0056»; индекс ADR.
- [04 §2](../04-lifecycle.md) и kernel spec (переход) — в Change #142. 02 §3 и `waiver/1` (форма id) — в Change #139.
- Передача `lattice`: после тега — pin-Change на `v0.10.1` (только тег, `kernel` прежний).

## Alternatives

- **`0.11.0` для всех пяти, `judge-law` → `0.12.0`.** Отвергнуто: LATTICE платит pin-Change `kernel` 0.11 за исправления, которые ей нужны на 0.10.
- **`0.10.1` с #138 и #141, остальное — в `0.11.0`.** Отвергнуто: два тега и два pin-Change вместо одного.
- **Id waiver `WAV-<year>-<change>-NN`** — короче, но связывает id с именем Change, и два waiver одного Change в двух ветках всё равно сталкиваются.
- **Переделка в `SPECIFIED` без перехода** (Run `specify` / `review` в `SPECIFIED`) — у PR нет перехода. Непонятно, каким видом PR его судит `warrant ci`, а gates `PROPOSED -> SPECIFIED` не перепроверяются.
