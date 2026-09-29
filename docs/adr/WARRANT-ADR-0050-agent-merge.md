---
id: WARRANT-ADR-0050
title: Merge агентом и приёмка человеком — spec одобряет человек; merge impl-PR агентом, где policy не требует `human-approval`; класс путей с приёмкой человеком в overlay проекта; код выхода 4 и `retryable` в 0.9.0; ревью без attestation — не evidence; исполнитель Change вне WARRANT
adr_state: ACCEPTED
date: 2026-09-29
supersedes: []
amends: [WARRANT-ADR-0048, WARRANT-ADR-0049]
---

## Context

Агент работает как машинный пользователь `homasters` (id 52467145): `gh` — его classic PAT, collaborator `Homasters-max/SRA` с `write` ([ADR-0049](WARRANT-ADR-0049-flow.md) п. 3). В `identities.agents` он попадёт с Change `identities` (WS-04). Решения maintainer'а 2026-09-29 — что должны уметь судья, policy и контракт CLI, когда Change проводит агент под своей идентичностью. Факты на `main` после PR #110 (CLI 0.8.3):

- Судья принимает ref `APPROVED` / `MERGED`, только если PR слил член роли одобрения (`core/ci/refs.ts:129-146`). При пустых approvals `approvalRoles` откатывается к fallback-роли `maintainer` (`core/roles.ts:42`). Impl-PR, слитый агентом, судья не засчитывает никогда — даже когда policy не требует `human-approval` на `VERIFYING->MERGED`.
- Человека на приёмке impl policy требует одним способом: оверлей `risk-high` добавляет `human-approval` на `MERGED` целиком. Почти любой Change SRA — `factory-change` HIGH, поэтому приёмка человеком стоит на каждом impl-PR, а не на правках, меняющих собственную проверку.
- Код выхода не отделяет инфраструктуру от нарушения правила (WS-06): тот, кто проводит Change, не может решить — повторить или остановиться.
- Ревью реализации (навык `review-impl`) без attestation — самоотчёт той же семьи моделей (WS-20, BL-28).
- WARRANT пассивен ([ADR-0010](WARRANT-ADR-0010-trust-by-reference.md) п. 1): судит, хранит policy и evidence, отдаёт публичный контракт CLI. ADR-0049 п. 4 и п. 8 строили исполнителя Change (`flow`) в этом репозитории и планировали поставить его потребителю — это смешивает судью и исполнителя.
- Архитектурный разбор 2026-09-29 (`architecture-review-20260929-2215.html`, вне репозитория): без одного gate engine для нового и записанного вердикта (WS-03, S1) убирать человека из merge нельзя.

## Decision

1. **Одобрение spec — всегда человек** (снимает [ADR-0049](WARRANT-ADR-0049-flow.md) п. 5).
   - Ref `APPROVED`: spec-PR сливает член роли одобрения, как сейчас, при любом риске.
   - Одобрения spec записью review без человека нет ни для LOW, ни для MEDIUM.
   - Вернуться к нему — когда review получит attestation (WS-20), строка BL-99.
2. **Merge impl-PR агентом там, где policy не требует человека.**
   - Ref `MERGED`: если effective policy перехода `VERIFYING->MERGED` не содержит `human-approval`, судья засчитывает merge impl-PR агентом из `identities.agents` при зелёных gates на merge-результате.
   - Если содержит — merge только членом роли одобрения, как сейчас.
   - `approvalRoles` при отсутствии approvals отдаёт «нет роли» вместо fallback-роли `maintainer`.
   - Класс угроз — B ([ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 2): merge агентом не снимает обнаружение, пока судья держит WS-03, WS-13, WS-14 (п. 6).
3. **Класс путей с приёмкой человеком.**
   - Policy проекта называет пути, чья правка требует `human-approval` на `MERGED` независимо от риска. Это заменяет `human-approval` у всего `risk-high`.
   - Класс SRA:
     - код судьи — `packages/cli/src/core/ci/**`, `packages/cli/src/core/gates/**`;
     - policy — `packs/**`, `.warrant/**` кроме состояния Change;
     - защита агента — `.claude/**`, `**/AGENTS.md`, `CLAUDE.md`, `scripts/dev/*-hook.js`;
     - workflow — `.github/workflows/**`.
   - Пути SRA — в локальном overlay SRA, не в pack `core-sdd` (WS-12): у другого проекта свой класс.
   - Почему: правка, которая меняет собственную проверку, без второго взгляда — ANT-032.
4. **Код выхода инфраструктуры — в 0.9.0** (меняет срок WS-06).
   - Код 4 и признак `retryable` (решение Р-10) переносятся из цикла 2 в цикл 1.
   - Повторять можно только их; нарушение правила не повторяется.
5. **Ревью без attestation — не evidence.**
   - Результат ревью реализации без attestation не записывается как evidence kind `review` и не читается gates.
   - Если хранится — только помеченным advisory.
   - Gate ревью реализации появится после attestation (WS-20) и другой семьи моделей (BL-28).
6. **Срок и каденс** (дополняет [ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 4).
   - П. 2–4 — цикл 1, один minor `0.9.0`, вместе с WS-03, WS-13, WS-14 и floor `feature` ([ADR-0049](WARRANT-ADR-0049-flow.md) п. 6). Без них merge агентом пропустит дыры судьи.
   - **До 0.9.0** impl-PR сливает maintainer (auto-merge на GitHub). Условие снятия — п. 2 и п. 3 в релизе.
7. **Исполнитель Change — вне WARRANT** (меняет [ADR-0049](WARRANT-ADR-0049-flow.md) п. 4 и п. 8).
   - Кто и как проводит Change после одобрения spec (запуск, бюджеты, отчёты, расписание) — не предмет WARRANT.
   - Исполнитель — внешний потребитель публичного контракта CLI: не `scripts/dev/flow.js`, не pack `core-sdd`, не пакет этого репозитория.
   - Его нужда залезть внутрь — пробел контракта CLI (WS-05), а не код исполнителя здесь.
   - `docs/process/flow.md` из репозитория удаляется. Волны ADR-0049 п. 8 снимаются; их пункты про судью (WS-03, WS-06, WS-13, WS-14, WS-30, floor) остаются в циклах ADR-0048.
8. **Merge в SRA** (меняет [ADR-0049](WARRANT-ADR-0049-flow.md) п. 2).
   - Spec-PR сливает maintainer (п. 1).
   - Impl-PR — агент там, где п. 2 это разрешает, после 0.9.0; до того — maintainer (п. 6).
   - Archive-, docs-, process- и fix-PR — как в ADR-0049 п. 2.

## Consequences

- `06 §8`: вторая линия против B — merge spec-PR человеком и приёмка impl человеком на классе путей п. 3.
- `13-roadmap` §2: строка «Стабилизация» без волн flow.
- Backlog:
  - BL-98 — пилот внешнего исполнителя на контракте 0.9.0; пробелы — строками WS-05;
  - BL-99 — одобрение spec без человека (LOW, затем MEDIUM) после attestation;
  - WS-06 — цикл 1;
  - WS-10 — без волны 4;
  - WS-12, WS-13 — класс путей п. 3 в overlay SRA;
  - WS-20 — п. 5.
- Spec-PR цикла 1 решает форму WS-03. Рекомендация разбора — один gate engine: `transition` и `ci/record` спрашивают его, допустим ли записанный вердикт по policy базы и файлам waiver, evidence заново не вычисляется. Противоречие с N44 ([ADR-0037](WARRANT-ADR-0037-phase-4c-ci.md), spec `verification`: вердикты `warrant ci` заново SHALL NOT вычислять) — вопрос этого spec-PR.
- Навыки `change-spec-pr`, `change-impl-pr`, `change-archive-pr`, `git-land`, `fast-mode`: merge — по п. 8 (Change `identities`).
- Индекс ADR: ADR-0048, ADR-0049 — «уточнён 0050».
- Черновики `docs/drafts/2026-09-29-agent-merge/` удаляются этим PR ([ADR-0033](WARRANT-ADR-0033-git-process.md) п. 12).

## Alternatives

- **Одобрение spec LOW review'ом без человека (ADR-0049 п. 5):** отвергнуто. Review без attestation — самоотчёт той же семьи моделей (WS-20), его вес не отличить от слова агента.
- **Merge impl-PR только человеком всегда:** отвергнуто. Человек на каждом impl-PR проверяет механику, а не смысл; приёмка теряет вес там, где она нужна (п. 3).
- **`human-approval` у всего `risk-high`:** отвергнуто. Риск Change не называет правки, которые меняют собственную проверку; класс путей называет.
- **Класс путей в pack `core-sdd`:** отвергнуто. Пути SRA — не пути потребителя (WS-12).
- **Merge агентом сразу, до 0.9.0:** отвергнуто. Судья пока пропускает WS-03, WS-13, WS-14.
- **Код 4 в цикле 2:** отвергнуто. Без него внешний исполнитель не отличит повтор от остановки уже при merge агентом.
- **Исполнитель в `scripts/dev` или в pack (ADR-0049 п. 4):** отвергнуто. Судья и исполнитель в одном репозитории размывают пассивность CLI; нужды исполнителя становятся заходами внутрь, а не контрактом.
