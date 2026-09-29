---
id: WARRANT-ADR-0049
title: Flow — доставка Change без рутины человека; авто-merge archive- и docs-PR, машинный пользователь агента, `scripts/dev/flow.js` над публичным CLI, решения человека по риску, floor `feature` для кода, PR без Change с кодом — `SCOPE_VIOLATION`
adr_state: ACCEPTED
date: 2026-09-29
supersedes: []
amends: [WARRANT-ADR-0044, WARRANT-ADR-0047]
---

## Context

Предложение 2026-09-29: «убирать шаги, не требующие решения человека, а не ускорять их» — основа тёмной фабрики. Разбор — в аудите `80-flow-dark-factory.md` (вне репозитория), решения — в grilling того же дня. Факты на HEAD `b578861`:

- На Change приходится план, три синхронных «merge #N» в чате и активации waiver. Merge archive-PR и docs-PR — механика, но по ADR-0047 п. 2 это решение maintainer'а.
- Агент и maintainer — один аккаунт `Homasters-max`, единственный collaborator (WS-04). `identities.agents[]` в схеме уже есть (`config.1.schema.json:110-135`), в `warrant.json` SRA не заполнен.
- Судья уже считает решением человека **merge** spec-PR и impl-PR. Ref `APPROVED` / `MERGED` требует, чтобы `mergedBy` входил в роль одобрения и не был из `identities.agents`; при заданных agents — ещё и не был автором PR (`core/ci/refs.ts:129-146`). При пустых approvals `approvalRoles` откатывается к fallback-роли (`core/roles.ts:42`), поэтому merge spec-PR человеком требуется при любом риске.
- `human-approval` на `SPECIFIED→APPROVED` задают профили `chore` и `feature`, а не риск. Floor есть только у риска (`risk/floors.json`). `feature` не матчится по путям, и Change с кодом получает `chore` или пустой `profiles` от одного proposer (WS-15).
- PR без Change с правкой `src/**` проходит `warrant ci` (`core/ci/paths.ts:92-98`). По ADR-0044 п. 7 это норма («проверки PR без Change — job проекта»), для потребителя — дыра (WS-14).
- Branch protection `main` SRA: 4 required checks, `strict: false`, required reviews нет, auto-merge включён, squash и rebase запрещены.

## Decision

1. **Принцип.** Человек управляет смыслом, система — механикой.
   - Тёмный цикл — доставка Change. Написание spec и кода сюда не входит.
   - Человек решает:
     - намерение;
     - одобрение spec по риску (п. 5);
     - приёмку impl, если policy держит `human-approval` на `MERGED`;
     - waiver и blocking UNKNOWN.
   - Остальное решают gates.
2. **Merge** (меняет [ADR-0047](WARRANT-ADR-0047-pr-cycle.md) п. 2).
   - Archive-PR — всегда `--auto` на зелёный CI, в любом режиме.
   - Docs- и process-PR — тоже `--auto`, если diff не трогает защиту агента: `.claude/**`, `**/AGENTS.md`, `CLAUDE.md`, `scripts/dev/*-hook.js`. На PR с защитой агента `--auto` не ставится, его сливает maintainer. Исключение снимается, когда WS-13 закрыт у судьи.
   - Spec-PR и impl-PR сливает maintainer своим аккаунтом, и это его решение. Судья проверяет его по `mergedBy`.
3. **Машинный пользователь агента — сейчас** (меняет [ADR-0044](WARRANT-ADR-0044-lattice-issues.md) п. 3, где идентичность — GitHub App).
   - Отдельный аккаунт GitHub, collaborator с `write`.
   - Classic PAT (`repo`, `workflow`) в `GH_TOKEN` среды пользователя, где работает агент. Fine-grained PAT не даёт collaborator'у доступа к личному репозиторию чужого владельца.
   - Git-автор бота — в worktree агента.
   - `identities.agents` — в `.warrant/warrant.json` SRA, затем LATTICE: Change `identities`, policy-путь.
   - Аккаунт и токен заводит maintainer.
   - GitHub App и организация — позже, отдельным решением.
4. **Flow — `scripts/dev/flow.js`, а не команда `warrant`.** Судья и исполнитель — разные компоненты: CLI пассивен (ADR-0010 п. 1), а исполнитель, который сам пушит, сливает и судит, — самоотчёт вместо проверки.
   - Команды — `start`, `land`, `status`.
   - Своего состояния нет: стадия каждый раз выводится из `warrant status --json`, `git` и `gh`.
   - Любой вызов можно повторить.
   - Flow идёт до первой остановки.
   - Текст коммитов и PR — детерминированный, из артефактов Change, с трейлером `Flow: <stage>`.
   - Нет `--admin`, нет правки защиты, нет активации waiver без ссылки на решение.
   - **Только публичный контракт CLI:**
     - тест запрещает `flow.js` импорт `packages/cli/src/**` и чтение `.warrant/**`;
     - каждая нужда залезть внутрь — строка backlog «пробел контракта» (WS-05).
   - Рабочий дизайн — `docs/process/flow.md` (удалён [ADR-0050](WARRANT-ADR-0050-agent-merge.md) п. 7): таблица стадий, точки решения, метрики. Он меняется без нового ADR, пока не противоречит пунктам 1–7.
   - Поставка потребителю — волна 4, строка backlog.
5. **Одобрение spec без человека — только LOW и не раньше волны 3.** Условия: закрыты WS-03, WS-13, WS-14 (п. 7) и floor (п. 6), а судья для LOW проверяет запись review — `PROVEN` без MAJOR — вместо `mergedBy`.
   - `human-approval` на `SPECIFIED→APPROVED` переносится из профилей в оверлеи `risk-medium` / `risk-high`.
   - `approvalRoles` при отсутствии approvals отдаёт «нет роли» вместо fallback.
   - MEDIUM и HIGH — merge spec-PR человеком.
   - Расширение на MEDIUM — когда review получит attestation (WS-20), строка backlog.
6. **Floor профиля для кода** (Р-4).
   - Match профиля получает ссылку на роль путей проекта: `"match": {"path_roles": ["src"]}` у `feature`.
   - Diff в `paths.src` делает `feature` обязательным и в `classify`, и в CI (`requiredProfiles`, `ci/base.ts:97-112`).
   - Пустой `profiles` у Change, задевающего `paths.src` или `paths.tests`, — ошибка `classify` и находка `validate`.
   - Срок — цикл 1, minor pack ([ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 3–4).
7. **PR без Change, задевающий `paths.src` или `paths.tests`, — `SCOPE_VIOLATION`** (меняет ADR-0044 п. 7 в этой части).
   - Опции «выключить» нет.
   - Тесты тоже держатся: это evidence для SCN.
   - Срок — цикл 1, вместе с п. 5, чтобы цена «Change на каждую правку кода» и её снятие flow'ом пришли одновременно.
   - До того `flow land` такой PR не выпускает.
8. **Волны** (готовность каждой — `docs/process/flow.md` (удалён [ADR-0050](WARRANT-ADR-0050-agent-merge.md) п. 7) §5):
   - **0** — правила п. 2–3 и `delete_branch_on_merge`;
   - **1** — `flow.js` v0 для не-Change PR и стадии archive;
   - **2** — обходы навыков → 0: ISS-018, `transition` без записи при отказе, код выхода инфраструктуры, флейк WS-30;
   - **3** — все стадии, п. 5–7, судья: WS-03, WS-13, WS-14;
   - **4** — поставка и пилот LATTICE.

## Consequences

- Навыки `git-land`, `change-archive-pr`, `fast-mode`: шаг merge следует п. 2. Мелкие правки — в process-PR волны 1, вместе с `flow.js`.
- `06 §8`: идентичность агента — машинный пользователь; GitHub App — позже.
- Backlog:
  - поставка flow (волна 4);
  - расширение п. 5 на MEDIUM;
  - опция п. 7 для потребителя — по просьбе потребителя;
  - организация и GitHub App;
  - лёгкий CI для docs-only diff.
- Change: `identities` (волна 0, после аккаунта бота); floor, `SCOPE_VIOLATION`, перенос `human-approval` и судья — цикл 1, `0.9.0`.
- ADR-0044, ADR-0047 — пометка «изменён ADR-0049» в индексе.

## Alternatives

- **`warrant flow` в CLI:** отвергнуто. Судья становится исполнителем, а CLI перестаёт быть пассивным (ADR-0010 п. 1).
- **Отдельный пакет `packages/flow` сразу:** отложено до волны 4. Пакет удваивает цену волны 1 без выгоды для SRA.
- **Решение человека — GitHub review «Approve»:** отвергнуто сейчас. Судья уже проверяет `mergedBy`, а merge человеком так же асинхронен и атрибутирован. Review — вариант для волны 3 и для п. 5.
- **GitHub App вместо машинного пользователя:** отложено. App нужен для записи CI (ADR-0047 п. 3), но не для атрибуции решений.
- **Все merge авто, включая PR с защитой агента:** отвергнуто. Пока WS-13 открыт, агент снял бы себе guard без человека (класс B, ADR-0048 п. 2).
- **Одобрение spec без человека для LOW и MEDIUM сразу** (предложение аудита): отвергнуто. Независимость review субагента той же сессии пока держится на честном слове (WS-20), а судья не закрывает WS-03, WS-13, WS-14.
- **Floor только в `classify`:** отвергнуто. Запись, правленная руками или старым CLI, прошла бы CI.
- **Оставить границу ADR-0044 п. 7:** отвергнуто. PR без Change, который ослабил тест, снимает доказательство без Change и review.
