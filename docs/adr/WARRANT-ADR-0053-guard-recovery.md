---
id: WARRANT-ADR-0053
title: guard не запирает сессию при расхождении версий CLI и закрепления проекта — Change `guard-recovery` первым в 0.10.0; хук и агенты исполняют закреплённый проектом CLI; CLI потребителя на машине — из тега
adr_state: ACCEPTED
date: 2026-10-01
supersedes: []
amends: [WARRANT-ADR-0052]
---

## Context

2026-10-01 сессия LATTICE при переходе на 0.9 оказалась заперта guard'ом. Отчёт — `D:\tmp\warrant-inbox\guard-lockout-version-skew-2026-10-01.md`.

Факты:

- **Чей CLI исполняет хук.** Глобальный `warrant` на машине maintainer'а — `npm link` на dev-checkout SRA (`npm ls -g`: `warrant@0.10.0 -> D:\project\SRA`). Хук LATTICE `warrant guard --frontend claude` исполняет CLI из `main` SRA. Закреплённый LATTICE тег роли не играет: CLI сменился 0.8.2 → 0.9.0 → 0.10.0-dev без pin-Change в LATTICE.
- **Почему policy не грузится.** LATTICE закрепил `core-sdd` `^0.3.4`, а CLI 0.9+ несёт pack 0.4.x — версия вне диапазона, начиная с 0.10 это `PACK_VERSION_RANGE`.
- **Как guard реагирует.** При policy, которая не грузится, guard (`core/guard/guard.ts` `decidePre` → `loadPolicy`, F9, REQ-ENF-004) даёт `deny` на любое событие `pre`. Под запрет попадают любой Bash, включая `git log`, и любая запись, даже вне проекта: policy грузится раньше проверки пути, хотя путь вне проекта guard не охраняет.
- **Выхода нет.** Диапазон поднимает только pin-Change, а без Bash и записи его не начать. Сообщение «policy does not load» не называет версии и путь выхода.
- **SRA зависит от того же PATH.** Агент `warrant-reviewer`, сгенерированный `warrant sync`, вызывает `warrant guard` и `warrant run submit` из PATH. SRA нужен dev-CLI, потребителю — тег, а PATH на машине один.
- **Навык `warrant-upgrade`** не описывает подъём minor pack: caret `^0.3` не пускает `0.4`.

Это класс A ([ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 2): агент, который не может исправить ошибку. Запрет ничего не защищает — не защищён ни один путь, только исчезает путь восстановления. Это исправление, его место — цикл 1 (ADR-0048 п. 1). Два вопроса maintainer'у 2026-10-01; приняты рекомендации.

## Decision

1. **0.10.0 — четыре Change** (меняет ADR-0052 п. 1): `exit-contract` (закрыт) → `guard-recovery` → `judge-law` → `code-floor`.
   - `guard-recovery` идёт перед судьёй: LATTICE переходит на 0.10 уже с исправленным guard.
   - Тег `v0.10.0` — по-прежнему после archive-PR `code-floor`.
2. **guard при policy, которая не грузится, не запирает восстановление** (меняет REQ-ENF-004 «внутренний сбой — deny»).
   - Fail-closed остаётся только для правки путей проекта.
   - Не запрещаются:
     - событие вне проекта — путь проверяется до загрузки policy;
     - правка закрепления (`.warrant/warrant.json`);
     - команды восстановления `warrant` (`sync`, `validate`, `status`, `--version`);
     - shell, который не правит проект.
   - Точную форму разрешённого задаёт spec Change.
   - Отказ и находка называют причину и выход: версию CLI, версию встроенного pack и закреплённый диапазон, затем шаги pin-Change — поднять диапазон, `warrant sync`.
3. **Хук и агенты исполняют CLI, который закрепил проект, а не первый `warrant` в PATH.**
   - Касается `.claude/settings.json` и агентов, которые генерирует `warrant sync`.
   - Форму выбирает design Change: поле `warrant.json` (08 §3) или разрешение через проект. Второго формата конфигурации нет (`AGENTS.md`).
   - SRA исполняет свой dev-CLI, потребитель — CLI тега.
4. **CLI потребителя на машине — из тега** (форма [ADR-0040](WARRANT-ADR-0040-slice-fixes.md) п. 7 для CI): `npm pack github:Homasters-max/SRA#v<тег>` вне checkout, затем `npm i -g ./<tgz>`.
   - `npm link` на dev-checkout SRA — только для разработки WARRANT. При нём версия CLI потребителя меняется с каждым merge в SRA.
   - Правило — в `docs/process/rules.md` «Настройка машины» и навыке `warrant-upgrade`.
5. **Навык `warrant-upgrade`** описывает подъём minor pack и порядок «сначала закрепление (диапазон, `kernel`), затем CLI». В обратном порядке — запасной выход по п. 2.

## Consequences

- **Delta specs `guard-recovery`:** REQ-ENF-004 и REQ-ENF-005 (guard при незагружаемой policy, сообщение); REQ-KRN-025 (команда CLI в сгенерированных хуках и агентах, п. 3); при новом поле — REQ-KRN-004 (схема `config`).
- **CHANGELOG `## 0.10.0`:**
  - «Вердикт» — без изменений: guard не судья;
  - «Миграция для потребителя» — CLI из тега на машине, порядок перехода, команда хука после `warrant sync`.
- **LATTICE до тега `v0.10.0`:** диапазон `core-sdd` `^0.4.0` правкой одной строки снимает запирание при dev-CLI. Правка входит в pin-Change на `v0.10.0`.
- **Backlog:** WS-26 (шум guard) — рядом, но не закрывается этим Change.
- **Индекс ADR:** ADR-0052 — «уточнён 0053».

## Alternatives

- **Исправить guard внутри `judge-law`:** отвергнуто — судья и guard в одной spec утяжеляют review (довод ADR-0052 Alternatives «Один Change»).
- **Отложить до цикла 2 (контракт потребителя):** отвергнуто — LATTICE переходит на 0.10 сейчас и попал бы в ту же ловушку на 0.4.x.
- **Только порядок шагов в навыке, без правки guard:** отвергнуто — при `npm link` CLI меняется раньше закрепления, и порядок не соблюсти.
- **guard при незагружаемой policy разрешает всё:** отвергнуто — правка путей проекта без policy остаётся не охраняемой. Fail-closed для неё сохраняется (класс A).
- **Оставить `npm link` и у потребителя:** отвергнуто maintainer'ом 2026-10-01 — ловушка повторяется на каждом подъёме pack.
