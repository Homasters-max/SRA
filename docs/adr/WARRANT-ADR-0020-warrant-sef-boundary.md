---
id: WARRANT-ADR-0020
title: Граница WARRANT и SEF — гейты argv, два транспорта Change (github, sef-hub), MVP без фабрики
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: [WARRANT-ADR-0010, WARRANT-ADR-0011, WARRANT-ADR-0013, WARRANT-ADR-0014, WARRANT-ADR-0017, WARRANT-ADR-0018]
amended_by: [WARRANT-ADR-0021, WARRANT-ADR-0022, WARRANT-ADR-0024, WARRANT-ADR-0034]
---

> Уточнено [ADR-0034](WARRANT-ADR-0034-phase-4-frontend.md): п. 4 — slice MVP ведёт Claude в ручном режиме под hooks (адаптер `claude`, только
> локальный режим — «стол» R8; SEF его не использует); п. 5 — review spec в MVP выполняет Claude-субагент с
> `limitations` «same model family as author», независимость по семействам — со вторым исполнителем тем же контрактом
> (`codex exec` или `opencode`). Граница с SEF и п. 14 (`.codex/hooks.json` в эталоне) не меняются.

> Уточнено [ADR-0024](WARRANT-ADR-0024-spec-approved-contract.md): дерево gate `spec-approved` (п. 9) — `{proposal.md, specs/**}`
> без `design.md` (строки `I-N` пишутся при реализации); gate `waivable: true` — правка контракта после approval снимается
> waiver'ом maintainer'а (`warrant waive`, reason `I-N`), а не новой ревизией approval; коммит approval — `subject.commit`
> записи `human-approval` последнего перехода `APPROVED`.

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
   Run, который выполняет стол: `warrant run start <change> --operation review` → `codex exec --output-schema
   <skill-result> -o result.json` → `warrant run submit result.json`; `limitations: ["produced locally, unattested"]`
   ([ADR-0013](WARRANT-ADR-0013-mvp-refinement.md)). Плагин `codex-plugin-cc` (`/codex:adversarial-review`) не
   используется: Claude — только интерактив (D-5). Proposed до spike S8 (hooks и вывод `codex exec`, D-7).
   В SEF — независимость по семействам (§3.4 черновика).

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
   `forge` `sef-hub` проверяет: снимок `.sef/approvals/<work>-r<N>.json` есть в `master` на этом коммите (git);
   `approved_by` ∈ `roles.maintainer`; `actor.kind = owner` — через control-API SEF (`sef audit --json`), потому что
   журнал живёт в volume диспетчера и столу напрямую недоступен (D-19). INV-03 в `sef-hub` держится на механизме SEF:
   `sef work approve` и ручная `sef land` принимаются только с реального TTY и owner-токеном из keyring — это
   требование WARRANT к SEF ([11 §2](../11-integrations.md)), не предположение; bot-идентичность
   [ADR-0010](WARRANT-ADR-0010-trust-by-reference.md) п. 4 — механизм транспорта `github`.
9. **INV-01 после approve — gate `spec-approved`** (L0, core-sdd, транспортно-нейтральный; D-3). Hash дерева
   `{proposal.md, design.md, specs/**}` каталога `openspec/changes/<change>/` на коммите из ref перехода `APPROVED`
   сравнивается с тем же деревом на base (`github`: CI impl-PR, base = merge-base; `sef-hub`: `manifest.base_commit`
   попытки). `tasks.md` исключён: он правится при реализации (`apply.tracks`). Расхождение → `STALE`, нужна новая
   ревизия approval. Новых полей record и снимка не нужно. (Было: только `sef-hub`, hash всего каталога на
   `approval.base_commit` — после посадки первого TASK каждая попытка была бы `STALE`; в `github` impl-PR мог править
   spec после approve незаметно.)
10. **Тесты — один гейт.** Pack SEF проекта под WARRANT объявляет `warrant verify --transition VERIFYING->MERGED`
    как lane-гейт (коммит попытки) и integration-гейт (вершина `master` после rebase); отдельного `pytest`-гейта нет.
    `attestation.type: "sef-gate"`, `ref` = `sef://<project>/attempt/<id>/gate/<gate-id>`.
11. **Писатель record.** SEF вызывает CLI WARRANT: `warrant transition <change> APPROVED --ref …` внутри
    `sef work approve` (в коммите снимка) и `warrant transition <change> MERGED --ref …` внутри `landing`
    (в коммите посадки). Писатель record — по-прежнему CLI. ADR-0010 п. 1 («CI не пишет в репозиторий») относится
    к транспорту `github`. Вопрос I5 ([11 §4](../11-integrations.md); «SEF вызывает WARRANT как CLI или API») закрыт
    ревью 2026-09-22: **CLI (argv) в обе стороны** — `warrant` на столе и на хосте диспетчера, `sef audit --json` для
    forge (D-21). `sef work approve` отклоняется, если `warrant transition` завершился с ошибкой (gates
    `SPECIFIED→APPROVED`, кроме `human-approval`, не прошли).
12. **Посадка и archive — один `MERGED` на Change** (D-1). Посадка не последнего item record не трогает: между
    посадками `warrant status` показывает `STALE` — штатно (ADR-0011 п. 3). Посадка последнего item (все items Change
    закрыты) несёт в коммите посадки `APPROVED → IMPLEMENTING → VERIFYING → MERGED` с refs `sef://…/attempt/<id>`,
    `…/attempt/<id>/gate/<gate-id>`, `…/landing/<id>` (актор посадки); следующим коммитом `landing` выполняет
    `warrant archive`; gates `MERGED → ARCHIVED` — integration-гейты; конфликт `openspec archive` → `sef inbox`.
    Landing — доверенный писатель `openspec/specs/**` и архива (как для `.sef/items/**`). Item закрывается, только если
    TASK отмечен в `tasks.md` (иначе `warrant analyze` → `CONFLICT` → эскалация). Lane-гейт `warrant verify
    --transition VERIFYING->MERGED` считает переход без записи `VERIFYING` в record — как CI в `github`.
13. **Protected paths.** Пути policy WARRANT (`factory-change`: `.warrant/**`, `openspec/schemas/**`,
    `openspec/config.yaml`; `openspec/specs/**`; пути архива по ADR-0021) дублируются в `protected[]` `.sef/pack.yaml`
    вручную; `warrant validate` проверяет покрытие, расхождение — `SEF_PROTECTED_DRIFT`. `warrant sync` в pack SEF не
    пишет. **Run и evidence попытки — вне репозитория** (D-2): в `sef-hub` CLI читает `WARRANT_STATE_DIR`
    (`.warrant/runs/`, `.warrant/evidence/` → `var/sef/attempts/<id>/warrant/`), поэтому `.warrant/**` остаётся в
    `protected[]` целиком, а harvest не видит правок WARRANT-состояния (иначе каждая попытка давала бы `judge_edit`).
    В контейнере гейтов policy-пути WARRANT восстанавливаются из `manifest.base_commit`, если `impact.write` item их
    не включает (судья из base, INV-9 SEF); `openspec/changes/<change>/tasks.md` входит в `impact.write` каждого item.
    Транспорт `github` — без изменений: Run и evidence в git.
14. **Hooks агента в SEF.** `.codex/hooks.json` из `warrant sync` входит в эталон `.sef/engines/<profile>/`; trust
    hook Codex выдаётся заранее — в образе или слоте. Эталон собирается шагом сборки пакета проекта через `warrant sync`
    (иначе после правки правил каждая попытка падает с `ENGINE_CONFIG_MISMATCH`).
15. **Base по транспорту** (D-20). `github` — `merge-base(HEAD, base-ветка PR)`; `sef-hub` — `manifest.base_commit`,
    передаётся `warrant check | verify | gate --base <commit>`. Действует для `scope-valid`, mutation по diff
    ([ADR-0016](WARRANT-ADR-0016-mutation-diff-scope.md) п. 2) и `spec-approved` (п. 9). Context Pack WARRANT
    (`warrant run start --task … --json`: `rules[]`, `write_scope[]`, `context_hash`) входит в context pack попытки;
    Run создаёт SEF при prepare (вопрос I6 закрыт, D-21); `write_scope` ⊆ `impact.write`.

## Consequences

- Незафиксированные ответы по оркестрации (сессия 2026-09-22): runner в WARRANT отменён; сессия на TASK, фон,
  режим прав, worktree и коммиты, готовность задачи — механизмы SEF (Attempt, DBOS, контейнер, `gitops`, `evaluate`).
  От WARRANT остаются гейты (п. 10) и `spec-approved` (п. 9).
- ADR-0018: слой ACP принадлежит SEF; адаптер `claude` не планируется.
- Kernel (фаза 3): `--base <commit>`, `WARRANT_STATE_DIR`, gate `spec-approved` в core-sdd; `warrant` и `openspec` —
  в `image.pins` SEF и на хосте диспетчера; acceptance-тесты SEF (`.sef/acceptance/**`) — в `paths.tests`.
- Ревью 2026-09-22 (D-1, D-2, D-3, D-5, D-19, D-20, D-21) отражено в [приложении F](../integrations/2026-09-17-sef-platform-design.md)
  черновика SEF (W-01…W-27).
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
- **`MERGED` на каждой посадке item** — отвергнуто (D-1): один `MERGED` на Change (04 §2), иначе вторая попытка идёт по Change в `MERGED`.
- **Run и evidence попытки в рабочей копии** — отвергнуто (D-2): `.warrant/**` в `protected[]` → `judge_edit` на каждой попытке.
- **`spec-approved` только в `sef-hub`, hash всего каталога** — отвергнуто (D-3): `tasks.md` меняется при реализации; в `github` тот же пробел INV-01.
- **Плагин Claude Code для review** — отвергнуто (D-5): Claude — только интерактив; `codex exec` детерминирован.
- **`warrant sync` пишет в `.sef/pack.yaml`** / **SEF читает `warrant resolve` при старте** — отвергнуто: чужой
  писатель в core-зоне SEF / старт попытки зависит от WARRANT.
