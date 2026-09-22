---
id: WARRANT-ADR-0013
title: Уточнение объёма MVP — цель slice, стек, критерий выхода, состав core-sdd@0.1
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: [WARRANT-ADR-0007]
amended_by: [WARRANT-ADR-0018]
---

> Уточнено [ADR-0018](WARRANT-ADR-0018-frontend-adapters.md): slice ведёт Codex через codex-acp, а не Claude Code;
> критерий выхода MVP по смыслу не меняется.

## Context

ADR-0007 задал MVP как «kernel + core-sdd + один vertical slice», но не сказал: в каком репозитории проводится
slice, кто его ведёт (человек через CLI или агент под hooks), на каком языке CLI, какие profiles входят в 0.1,
входит ли L2 review, где физически живут skills, насколько строг approval.

## Decision

| Вопрос | Решение | Почему |
|---|---|---|
| Цель slice | Отдельный sample-проект, Python + pytest, новый маленький сервис | В репозитории CLI любая правка `.warrant/**` — сам продукт; slice не проверит `feature` в нормальном виде. Язык проекта ≠ язык CLI доказывает, что checks не привязаны к Node |
| Содержание slice | ≥ 2 REQ, ≥ 3 SCN, один blocking UNKNOWN, одно измерение risk от proposer, тесты с токеном `SCN-…` | Иначе slice не упражняет `WAIT`, record и `analyze` |
| Кто ведёт slice | Агент (Claude Code) под hooks / permissions; фаза 4 входит в MVP | Slice руками не проверяет INV-04 и INV-07 |
| Критерий выхода MVP | Агент проходит slice; в журнале `warrant guard` нет `deny`, обойдённого через shell; ни одна транзиция не записана вне `warrant` | Измеримо по `guard_events[]` в Run и по верификации refs в CI |
| Язык CLI (S4) | TypeScript на Node | OpenSpec — npm-пакет, Node уже обязателен; второй runtime лишний для ACP / API-агентов |
| Где код | Этот репозиторий как monorepo: `docs/`, `packages/cli/`, `packs/core-sdd/`, `sra/skills/`, `lattice/` | Docs и schemas контрактов меняются одним `factory-change` |
| Публикация | Не публикуется в MVP; `npm i -g <git-tag>`; bin `warrant` | Имя `warrant` на npm занято заглушкой; scoped-имя — при первой публикации |
| Profiles core-sdd@0.1 | `feature`, `chore`, `factory-change` | `chore` нужен для `skip_specs`; `factory-change` — для bootstrap и правки конфигурации. `bugfix`, `refactor`, `experiment` — без проверяемых gates, добавляются по failure mode |
| L2 adversarial review | В MVP, минимально: review спецификации на `SPECIFIED → APPROVED`, отдельный Run, локально с `limitations: ["produced locally, unattested"]` | Иначе L2-путь evidence остаётся непроверенным до фазы 5 и будет переписан. Code review — фаза 5 |
| Skills MVP | `sra/skills/<namespace>/<name>/SKILL.md` в monorepo; pack ссылается по `namespace/name@version`, lock — путь + hash | Прецедент `lattice/`; граница 07 §1 не нарушается |
| Approval | `human-approval` на `SPECIFIED → APPROVED` для всех уровней risk; merge — CI + кнопка человека без gate | `LOW` практически недостижим (любой `UNKNOWN` → `MEDIUM`); ветвление policy по risk на первом slice — лишняя поверхность |
| Waiver | Schema и шаг 4 gate-алгоритма — в MVP; команда `warrant waive` и golden — по первому failure mode | Активация всё равно требует human ref; slice его не упражняет |
| Proposer risk | Сам агент через `warrant classify --propose <json>`; JEV deferred | Любой `UNKNOWN` → `MEDIUM` + blocking UNKNOWN — то, что slice должен показать |

## Consequences

- [13-roadmap](../13-roadmap.md): фаза 2 exit — golden `feature`, `chore`, `factory-change`; фаза 4 — часть MVP.
- Spikes S1, S2, S4, S5 закрыты фактами; открыт только S6 (LATTICE identity).
- `read`-capabilities (`READ_REPO`, `READ_SPEC`, `READ_EVIDENCE`) в MVP не принуждаются: пометка «informative в MVP».

## Alternatives

- **Dogfooding на репозитории CLI** — отложено до появления exemption для «репозиторий самого WARRANT».
- **Все шесть profiles в 0.1** — отвергнуто: три из них не имеют ни одного проверяемого gate.
- **MVP без L2** — отвергнуто: формат evidence для `produced_by.type: skill` останется гипотезой.
