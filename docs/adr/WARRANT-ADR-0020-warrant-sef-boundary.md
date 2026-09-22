---
id: WARRANT-ADR-0020
title: Граница WARRANT и SEF — гейты argv, два транспорта Change (github, sef-hub), MVP без фабрики
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: [WARRANT-ADR-0010, WARRANT-ADR-0011, WARRANT-ADR-0013, WARRANT-ADR-0014, WARRANT-ADR-0017, WARRANT-ADR-0018]
amended_by: [WARRANT-ADR-0021, WARRANT-ADR-0022]
---

> Уточнено [ADR-0022](WARRANT-ADR-0022-path-rules.md): эталон `.sef/engines/<profile>/` (п. 14) включает и сгенерированный `AGENTS.md`; Context Pack
> попытки получает `rules[]` из `warrant run start`.

> Уточнено [ADR-0021](WARRANT-ADR-0021-archive-immutability.md): список путей п. 13 для `protected[]` расширен
> неизменными путями архива (каталог архива, record и evidence архивных Changes).

## Context

ADR-0018 предполагал, что оркестратором реализации будет Claude как ACP client. Сверка с черновиком SEF
([2026-09-17-sef-platform-design.md](../integrations/2026-09-17-sef-platform-design.md), rev 3, **предварительный**)
показала другое распределение ролей:

- ACP client — диспетчер SEF (`sef.engines.acp`); агентов запускает только он (INV-11 SEF). Claude — «стол»,
  только интерактивно с владельцем (R8); `claude-agent-acp` не используется (R4).
- Граница безопасности — контейнер попытки; запрос прав границей не считается (P2, INV-6 SEF).
- Попытка: экспорт `base_commit` + одноразовый локальный git; коммит с трейлерами делает runner; `refs/sef/attempts/<id>`;
  `master` локального bare-хаба меняет только `gitops.land` (`push --ff-only`). PR на GitHub нет.
- Задачи — `.sef/items/<id>.md` с контрактом (`impact.write`, acceptance-тесты по blob-sha, бюджет); approval —
  снимок `sef work approve` с актором `owner` (TTY + токен keyring).
- Гейты — argv в контейнере гейтов (lane, integration, cron `master`); допуск по CPU-токенам; harvest и reconcile
  проверяют scope; `.codex/**` и конфиги движков — `protected[]`, аттестуются по эталону `.sef/engines/<profile>/`.

Без решения WARRANT дублировал бы SEF: второй runner, второй authority scope, второй прогон тестов, противоречащая
git-топология (ADR-0010, ADR-0011 — GitHub PR и CI).

## Decision

### Граница

1. **WARRANT — инструмент стола и набор argv-гейтов в SEF.** WARRANT владеет spec lifecycle, stable ID, policy,
   переходами record и определениями gates. SEF владеет исполнением, попытками, evidence исполнения, допуском
   и посадкой. WARRANT не пишет runner и не решает про контейнеры и коммиты.
2. **Локальный режим и режим SEF.** `write_scope` guard ([ADR-0018](WARRANT-ADR-0018-frontend-adapters.md)) и замок
   `exclusive` ([ADR-0017](WARRANT-ADR-0017-check-execution.md)) — механизмы локального режима без SEF; внутри SEF
   они только подсказки, authority — допуск и reconcile SEF.
3. **Задачи.** `tasks.md` OpenSpec — authority плана и связей с REQ; sef item — authority контракта исполнения,
   ссылается на TASK полем `source_ref: <change>#TASK-…`. `warrant analyze` (транспорт `sef-hub`): TASK без item —
   `MISSING`, TASK с несколькими items — `AMBIGUOUS`.
4. **MVP без фабрики.** Slice MVP проводит Codex в ручном режиме под hooks ([ADR-0018](WARRANT-ADR-0018-frontend-adapters.md)
   п. 7) и CI. Слой ACP появляется со срезом S1 SEF; WARRANT встраивается туда гейтами.
5. **Adversarial review spec в MVP** — Codex (другое семейство относительно Claude, автора spec): отдельный локальный
   Run (`codex-plugin-cc` `/codex:adversarial-review` или `codex exec`), `limitations: ["produced locally, unattested"]`
   ([ADR-0013](WARRANT-ADR-0013-mvp-refinement.md)). В SEF — независимость по семействам (§3.4 черновика).

### Топология Change: два транспорта

6. [ADR-0011](WARRANT-ADR-0011-pr-topology.md) становится транспортом `github` абстрактной топологии Change:

   | Шаг | `github` (MVP) | `sef-hub` (со срезом S1 SEF) |
   |---|---|---|
   | spec → `APPROVED` | spec-PR, review, merge | стол пушит в хаб, `sef work approve` |
   | implementation → `MERGED` | impl-PR, CI, merge | попытка, гейты, `landing` |
   | `MERGED → ARCHIVED` | archive-PR | `landing` после последнего TASK (п. 12) |

   INV-01 и INV-03 общие; различается механизм. `sef-hub` — вторая реализация интерфейса `forge`
   ([ADR-0010](WARRANT-ADR-0010-trust-by-reference.md) п. 5).
7. **MVP — `github`** без изменений ADR-0010 и ADR-0011.

### Сопоставление `sef-hub` (proposed; опирается на черновик SEF rev 3, пересматривается при его принятии)

8. **Approval.** `attestation.type: "sef-approval"`, `ref` = `sef://<project>/approval/<work>-r<N>@<commit хаба>`.
   `forge` `sef-hub` проверяет: снимок есть в `master` на этом коммите; в журнале SEF событие approve с
   `actor.kind = owner`; `approved_by` ∈ `roles.maintainer`.
9. **INV-01 без PR.** При `APPROVED` фиксируется hash дерева `openspec/changes/<change>/` на `approval.base_commit`.
   Gate `spec-approved` (L0, core-sdd, только `sef-hub`) сравнивает его с деревом на `manifest.base_commit` попытки;
   расхождение → `STALE`, нужна новая ревизия approval.
10. **Тесты — один гейт.** Pack SEF проекта под WARRANT объявляет `warrant verify --transition VERIFYING->MERGED`
    как lane-гейт (коммит попытки) и integration-гейт (вершина `master` после rebase); отдельного `pytest`-гейта нет.
    `attestation.type: "sef-gate"`, `ref` = `sef://<project>/attempt/<id>/gate/<gate-id>`.
11. **Писатель record.** SEF вызывает CLI WARRANT: `warrant transition <change> APPROVED --ref …` внутри
    `sef work approve` (в коммите снимка) и `warrant transition <change> MERGED --ref …` внутри `landing`
    (в коммите посадки). Писатель record — по-прежнему CLI. ADR-0010 п. 1 («CI не пишет в репозиторий») относится
    к транспорту `github`. Открытый вопрос I5 (SEF вызывает WARRANT как CLI или API) этим не закрывается.
12. **Archive.** Когда садится последний TASK Change (все его items закрыты), `landing` отдельным коммитом выполняет
    `warrant archive`; gates `MERGED → ARCHIVED` — integration-гейты; конфликт `openspec archive` → `sef inbox`.
13. **Protected paths.** Пути policy WARRANT (`factory-change`: `.warrant/**`, `openspec/schemas/**`,
    `openspec/config.yaml`; `openspec/specs/**`) дублируются в `protected[]` `.sef/pack.yaml` вручную;
    `warrant validate` проверяет покрытие, расхождение — `SEF_PROTECTED_DRIFT`. `warrant sync` в pack SEF не пишет.
14. **Hooks агента в SEF.** `.codex/hooks.json` из `warrant sync` входит в эталон `.sef/engines/<profile>/`; trust
    hook Codex выдаётся заранее — в образе или слоте.

## Consequences

- Незафиксированные ответы по оркестрации (сессия 2026-09-22): runner в WARRANT отменён; сессия на TASK, фон,
  режим прав, worktree и коммиты, готовность задачи — механизмы SEF (Attempt, DBOS, контейнер, `gitops`, `evaluate`).
  От WARRANT остаются гейты (п. 10) и `spec-approved` (п. 9).
- ADR-0018: слой ACP принадлежит SEF; адаптер `claude` не планируется.
- Новые attestation types `sef-approval`, `sef-gate` ([06a §3](../06a-evidence.md)); новый gate `spec-approved`;
  новая проверка `analyze` TASK ↔ item; новая ошибка `validate` `SEF_PROTECTED_DRIFT` — реализация вместе с S1 SEF.
- Черновик SEF не правится этим ADR; требования к SEF — в [11 §2](../11-integrations.md).

## Alternatives

- **Runner-заглушка в WARRANT** — отвергнуто: дублирует S1 SEF (P9, R1 черновика), размывает authority оркестрации.
- **Только GitHub, SEF подстраивается** — отвергнуто: противоречит хабу и посадке SEF.
- **Отдельные правила для каждого транспорта** — отвергнуто: инварианты и gates общие.
- **Локальный хаб в MVP** — отвергнуто: без `sef work approve` и `landing` нечем принуждать INV-01 и INV-03.
- **Approval SEF без hash spec** — отвергнуто: spec правится после approve незаметно (`contract_hash` не покрывает Change).
- **SEF запускает свои тесты, WARRANT читает junit** / **оба запускают** — отвергнуто: второй путь evidence / двойной прогон.
- **Переходы record пишет стол позже** — отвергнуто: окно `STALE` без причины; у хаба есть доверенный писатель.
- **Archive вручную столом** — отвергнуто: забытый шаг оставляет Change в `MERGED`.
- **`warrant sync` пишет в `.sef/pack.yaml`** / **SEF читает `warrant resolve` при старте** — отвергнуто: чужой
  писатель в core-зоне SEF / старт попытки зависит от WARRANT.
