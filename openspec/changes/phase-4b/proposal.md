# Proposal: phase-4b

## Why

У двух gates pack `core-sdd` нет producer'а: `analyze-clean` всегда `BLOCKED` («`warrant analyze` не реализован»,
REQ-VER-004), у `adversarial-review` нет способа получить evidence `review`. Поэтому каждый Change с фазы 3 закрывает их парой
waivers (`WAV-2026-001…012`): gate, который всегда снимается waiver'ом, ничего не проверяет. Run и guard 4a дали всё, что нужно
producer'у review: отдельный Run, Context Pack, `write_scope`, адаптер `claude`.

Change 4b ([ADR-0036](../../../docs/adr/WARRANT-ADR-0036-phase-4b-producers.md) п. 1, [ADR-0034](../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md)
п. 10) — producers. Выход: Change проходит `SPECIFIED → APPROVED` с `adversarial-review` `PASS` по evidence `run submit` и
`VERIFYING → MERGED` с `analyze-clean` `PASS` без waivers. Вход — аудит
[2026-09-25-phase-4a](../../../docs/process/audits/2026-09-25-phase-4a.md): A-23…A-25 лежат ровно там, куда producers добавили бы
копии; решения — grilling N18–N26 (ADR-0036), уточнения — design.md.

## What Changes

- **Швы первой группой** (без изменения поведения): читатели объектов pack — в `core/packs` (A-24); общий сборщик записи
  evidence (A-23); переходы Run — в `core/run` (A-25), `stateDir` и `projectUri` — в `core/fs.ts` (A-27); перечисления
  `evidence-status` и `attestation-type` — в реестр `enums`.
- **`warrant analyze <change> [--base <ref>]`** (N19, N20) — детерминированный анализ согласованности delta specs, `tasks.md` и
  тестов: находки `UNSATISFIED`, `CONFLICT`, `ORPHAN`; только отчёт, без записи. Gate `analyze-clean` вычисляется той же функцией:
  находка любого из трёх видов — `FAIL`, иначе `PASS`.
- **Операция `review`** — `warrant run start <change> --operation review` в `PROPOSED`: `write_scope` пуст, spec Change должна быть
  закоммичена, Run запоминает `spec_tree`. Guard при активном Run `review` запрещает любую правку и любую shell-команду, кроме
  `warrant run submit`.
- **`warrant://skill-result/1`** — схема envelope [07 §4](../../../docs/07-skills.md).
- **`warrant run submit [--file <path>] [--dry-run]`** — приём envelope активного Run `review`: envelope — рядом с файлом Run,
  evidence `kind: review` (`produced_by.type: skill`, `attestation: none`, `limitations` ADR-0034 п. 10, `subject.spec_tree`),
  статус — по находкам `BLOCKER` (ADR-0036 п. 4), Run завершается.
- **Evidence по дереву spec** (ADR-0036 п. 3): `evidence/1` — `subject.spec_tree`; пред-фильтр для такой записи сравнивает дерево
  spec на оцениваемом коммите вместо `commit` и `base_commit`.
- **Собственное состояние Change** (N27): record, каталог evidence и файлы Run Change с их `.result.json`. `scope-valid` разрешает его
  на всех трёх переходах и не считает policy-путём, `classify` не сверяет его с `match.paths` и floor rules. Сейчас record Change в
  diff делает любой Change `factory-change`, а закоммиченные Runs (REQ-ENF-001) роняют `scope-valid` в проекте без него.
- **Субагент `warrant-reviewer`** (N24): `sync` при `frontends ∋ "claude"` генерирует `.claude/agents/warrant-reviewer.md` — только
  чтение, хук guard в frontmatter, текст skill; skill `specification/adversarial-review` — полноценный, `0.2.0` (REQ-SDD-008). В этом
  репозитории — копия файла, совпадение с генератором держит тест.
- CLI `0.5.0 → 0.6.0`; pack `core-sdd` `0.3.1 → 0.3.2` — диапазон `kernel: ">=0.1 <0.7"` и skill `^0.2`.

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `enforcement`: REQ-ENF-001 (операция `review`, пустой `write_scope`, `spec_tree`, `evidence[]`), REQ-ENF-002 (`run start
  --operation review`), REQ-ENF-004 (guard при Run `review`); новые требования — схема `skill-result/1`, команда `run submit`.
- `verification`: REQ-VER-003 (пред-фильтр для `subject.spec_tree`), REQ-VER-004 (`analyze-clean`; `scope-valid` и собственное
  состояние Change); новое требование — команда `analyze`.
- `kernel`: REQ-KRN-028 (`classify` без собственного состояния Change), REQ-KRN-033 (файл субагента `warrant-reviewer` в `sync` и
  `validate`).
- `core-sdd`: REQ-SDD-001 (диапазон `kernel` `<0.7`, skill `^0.2`, metrics `review`), REQ-SDD-008 (полноценный skill).

## Non-Goals

- `warrant ci`, `ForgePort`, `ci fetch`, `subject.tree` и сверка дерева merge (R-12), specs через archive по record (R-16),
  `FRONTEND_HOOKS_INACTIVE` в отчёте `ci` (BL-7), BL-12 — Change `phase-4c` (ADR-0036 п. 1).
- Находки `analyze` `MISSING`, `AMBIGUOUS` (транспорт `sef-hub`), `STALE` (BL-11), связь evidence с REQ через `claim.targets` —
  после 4b, по failure mode (N20).
- Приём envelope операций `specify` и `implement`; выдача stable ID для `unknowns[]` и `decisions_required[]` envelope;
  покрытие входа `dismissed[]` (later в 07 §4) (N23).
- Второе семейство моделей для review (`codex exec`, `opencode`, BL-28); guard на разработке самого WARRANT (ADR-0034 п. 4) —
  файл субагента в этом репозитории не включает guard основной сессии.
- Изменение таблицы gates по переходам (04 §5): `adversarial-review` остаётся на `SPECIFIED->APPROVED`.

## Impact

- `packages/cli/src`: новые `commands/analyze.ts`, `core/analyze/*`, `core/run/lifecycle.ts`, `core/run/submit.ts`; правки
  `commands/run.ts`, `core/run/{types,scope,store}.ts`, `core/guard/*`, `core/gates/{prefilter,verdict}.ts`,
  `core/gates/l0/{analyze-clean,scope-valid}.ts`, `core/classify/*`, `core/evidence/{record,store}.ts`, `core/packs/*` (читатели объектов),
  `core/transition/*`, `core/sync/*` (цель `warrant-reviewer`), `core/fs.ts`, `bin/warrant.ts`.
- `packages/cli/schemas/`: `skill-result.1.schema.json` (новая), `run.1.schema.json` (`review`, `spec_tree`),
  `evidence.1.schema.json` (`subject.spec_tree`) и копии в `.warrant/schemas/`.
- `packs/core-sdd/`: `pack.json` (версия, `kernel`, skill, kind `review`), `evidence/review.metrics.schema.json`; `sra/skills/specification/adversarial-review/SKILL.md` `0.2.0`.
- `packages/cli/test`: unit, app, contract (субагент на записанном входе Claude Code), e2e (Change фикстуры без waivers);
  `enums`, `helpers`, `test_helpers` в `architecture.json`.
- `.claude/agents/warrant-reviewer.md` этого репозитория; навык `change-spec-pr` — шаг review.
- `docs/`: 02 (статусы evidence, `review`), 04 §6–7 (`run submit`, `analyze`), 06 §5, 07 §4; `backlog.md` — закрытые BL-2, BL-3,
  BL-13, A-23…A-27.
- **BREAKING** (внешних пользователей нет, ADR-0013): `analyze-clean` вместо `BLOCKED` даёт `PASS` / `FAIL`; waivers на него
  становятся ненужными, но не отзываются.
