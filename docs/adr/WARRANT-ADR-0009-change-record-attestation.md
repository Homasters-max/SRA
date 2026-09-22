---
id: WARRANT-ADR-0009
title: Change record и attestation — доверенные писатели состояния
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amended_by: [WARRANT-ADR-0010]
---

> Уточнено [ADR-0010](WARRANT-ADR-0010-trust-by-reference.md): пункт 4 «authoritative записи делают CLI внутри CI»
> заменён на «authoritative запись = запись с верифицируемым ref». CI не пишет в репозиторий; он верифицирует ссылки.

## Context

Два открытых вопроса roadmap оказались одним: spike S3 (где хранить `classification` и `change_state`)
и Q5 (как принимать evidence, полученное вне CI). Оба спрашивают, **кто имеет право писать governance-состояние**
и как CI отличает доверенную запись от локальной. Кандидаты для S3: `.warrant/changes/<change>.json` или metadata
внутри артефактов OpenSpec. Кандидаты для Q5: криптографическая подпись всего evidence, доверие commit'у,
пересчёт в CI.

## Decision

1. **Change record.** Governance-состояние Change хранится в `.warrant/changes/<change>.json`
   ([04 §9](../04-lifecycle.md)): classification с источником каждого значения, `change_state`, журнал переходов
   с verdicts и ссылками на evidence. Пишет только CLI; файл коммитится; имя — ID Change без даты.
2. **Запись + сверка.** Запись фиксирует акт перехода; `warrant status` сверяет её с производными сигналами
   (artifacts, worktree, git, archive) и сообщает `STALE` при расхождении. `APPROVED` и `ABANDONED` записываются только явно.
3. **Attestation вместо подписи.** Доверие evidence определяется местом производства ([06a §3](../06a-evidence.md)).
   Воспроизводимое evidence (L0/L1) CI пересчитывает и не подписывает. Невоспроизводимое несёт `attestation.type`:
   `ci`, `human-review`, `signature`, `none`. Gate объявляет допустимые типы; `none` по умолчанию не засчитывается
   на переходе в `MERGED`.
4. **Доверенные писатели.** Authoritative записи (переходы в `APPROVED`, `MERGED`; evidence для gates merge) делают
   CLI внутри CI и человек через PR review. Локальный CLI пишет черновики. Ключи подписи агентам не выдаются.

## Consequences

- Новая схема `warrant://change-record/1`, новое поле evidence `attestation`, новое поле gate `accepts_attestation`.
- Строка владения `.warrant/changes/` в [03 §7](../03-architecture.md); ownership тот же, что у evidence.
- L2 review для risk `HIGH` выполняется как Run в CI. Это удорожает CI, но убирает необходимость в PKI на MVP.
- `signature` (keyless signing) — Maturity: later; нужен только для runtime и data evidence вне CI.
- Spike S3 закрыт; остаток (есть ли у OpenSpec собственные metadata Change) уходит в S2.

## Alternatives

- **Metadata в артефактах OpenSpec** — отвергнуто: скрытый форк формата (ADR-0001), поля видны `openspec validate`,
  каталог правится обычным Change любым агентом, тогда как запись состояния должна быть только у CLI.
- **Полностью вычисляемый `change_state` без файла** — отвергнуто: `APPROVED` и `ABANDONED` ниоткуда не выводятся,
  а журнал переходов нужен для аудита фабрики (12 §4). Вычисление сохранено как сверка.
- **Подпись всего evidence** — отвергнуто для MVP: воспроизводимому evidence подпись не нужна, CI его пересчитает;
  для остального дешевле произвести evidence в CI, чем строить PKI.
- **Доверие commit'у, в котором лежит evidence** — отвергнуто: агент коммитит под ключом человека, происхождение не отличимо.
