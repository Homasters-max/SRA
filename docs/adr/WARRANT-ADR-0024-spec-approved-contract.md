---
id: WARRANT-ADR-0024
title: spec-approved — контракт без design.md, waivable
adr_state: ACCEPTED
date: 2026-09-23
supersedes: []
amends: [WARRANT-ADR-0020]
---

## Context

[ADR-0020](WARRANT-ADR-0020-warrant-sef-boundary.md) п. 9 (решение D-3) ввёл gate `spec-approved`: hash дерева
`{proposal.md, design.md, specs/**}` Change на коммите approval сравнивается с тем же деревом на оцениваемом коммите;
расхождение требует новой ревизии approval. `tasks.md` исключён, потому что правится при реализации.

Фаза 3 показала, что `design.md` правится при реализации так же, как `tasks.md`: таблица «Решения по ходу реализации»
получает строку `I-N` на каждое отклонение (в фазе 3 — I-66…I-101). С `design.md` в дереве gate давал бы `FAIL` на
каждом impl-PR. Кроме того, impl-PR фазы 3 четыре раза уточнял сам контракт — delta specs (I-80, I-91, I-96, I-97);
«новой ревизии approval» для этого нет: возврат `IMPLEMENTING → SPECIFIED` допустим ([04 §2](../04-lifecycle.md)), но
повторный переход `SPECIFIED->APPROVED` на diff с кодом не пропускает `scope-valid`.

Решение V-9 (нарезка phase-3b, [NEXT-SESSION](../archive/2026-09-24-next-session.md)) уточняет D-3; этот ADR фиксирует его нормативно.

## Decision

1. **Контракт — `{proposal.md, specs/**}`.** Gate `spec-approved` сравнивает дерево `proposal.md` и `specs/**` каталога
   `openspec/changes/<change>/` (пары путь → blob git) на коммите approval и на оцениваемом коммите. `design.md` (с
   таблицей `I-N`) и `tasks.md` — журнал реализации и в дерево не входят.
2. **Коммит approval** — `subject.commit` записи evidence kind `human-approval`, id которой перечислен в `evidence[]`
   последнего перехода `APPROVED` record. Нет такого перехода, записи или git → `BLOCKED` с finding `NO_INPUT`;
   расхождение деревьев → `FAIL` с finding `SPEC_CHANGED_AFTER_APPROVAL` и списком изменённых путей.
3. **Где стоит.** Pack `core-sdd`, overlay `core-default`, переход `VERIFYING->MERGED` — у всех profiles. На
   `MERGED->ARCHIVED` gate не стоит: каталог Change перемещается в архив. Транспортная нейтральность ADR-0020 п. 9
   сохраняется: оцениваемый коммит — commit перехода `MERGED` (`github`) или коммит попытки (`sef-hub`).
4. **`waivable: true`.** Правка контракта после approval — осознанное решение maintainer'а, а не повод для второго
   approval: waiver на `spec-approved` создаётся `warrant waive` (агент MAY предложить, `PROPOSED`), `reason` ссылается
   на строку `I-N`, активирует maintainer (`warrant waive --activate <WAV> --by`, [05 §7](../05-policy.md)). `ACTIVE`
   waiver переводит gate в `WAIVED`; finding с путями остаётся виден reviewer'у impl-PR.

## Consequences

- ADR-0020 п. 9 уточнён: состав дерева без `design.md`; расхождение снимается waiver'ом, а не «новой ревизией
  approval»; остальное (L0, core-sdd, `VERIFYING->MERGED`, оба транспорта, без новых полей record) не меняется.
- [06 §4](../06-verification.md): строка `spec-approved` — дерево `{proposal.md, specs/**}`, `waivable: да`.
- Delta phase-3b: REQ-VER-004 (калькулятор), REQ-SDD-001/002/007 (gate в каталоге, overlay, `waivable`).
- Waiver на `spec-approved` требует `approved_by` ∈ `roles.maintainer` (R-2) — уточнение спеки без maintainer'а
  не проходит `transition MERGED`.
- Уточнение только `design.md` или `tasks.md` в impl-PR на gate не влияет; отклонение по-прежнему фиксируется строкой
  `I-N` (правило pack `rules.design`).

## Alternatives

- **Оставить `design.md` в дереве (D-3 как есть)** — отвергнуто: строки `I-N` пишутся в impl-PR по правилу pack, gate
  давал бы `FAIL` на каждом impl-PR и превращался бы в обязательный waiver.
- **`waivable: false`** — отвергнуто: запрещает уточнения spec в impl-PR, которых в фазе 3 было четыре (I-80, I-91,
  I-96, I-97); каждое пришлось бы выносить в отдельный Change с `amends` после merge.
- **Повторный `APPROVED` из `IMPLEMENTING`** (возврат в `SPECIFIED` и новый approval) — отвергнуто: gate `scope-valid`
  перехода `SPECIFIED->APPROVED` разрешает только `openspec/changes/<change>/**` и record — diff impl-PR с кодом его не
  проходит.
