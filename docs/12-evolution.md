---
id: WARRANT-DOC-12
title: Развитие системы, метрики, самоулучшение
status: normative
maturity: later
version: 0.1.0
---

# 12. Развитие системы

## 1. factory-change

Сама методология развивается тем же процессом, которым управляет продуктом.

Status: normative · Maturity: MVP

```json
{
  "$schema": "warrant://profile/1",
  "id": "factory-change",
  "version": "1.0.0",
  "match": { "paths": [".warrant/**", "openspec/schemas/**", "openspec/config.yaml"] },
  "artifacts": { "required": ["proposal", "specs"] },
  "gates": { "VERIFYING->MERGED": ["factory-golden-passed", "human-approval"] }
}
```

- Изменение schema, policy, profile, gate, check, pack, skill version в lock — только `factory-change`.
- Обычный product Change MUST NOT затрагивать эти пути (gate `scope-valid`).
- Архив, record и evidence архивных Changes меняет только `factory-change` с целью «миграция формата»
  ([ADR-0021](adr/WARRANT-ADR-0021-archive-immutability.md)).

## 2. Golden changes и policy fixtures

Эталонные Changes, на которых проверяется поведение WARRANT, а не продукта:

```text
golden/
├── feature-with-bdd/
├── low-risk-bugfix/
├── refactor-legacy/
├── breaking-data-change/
├── architecture/
├── experiment/
├── failed-security-check/
└── expired-waiver/
```

Каждый case содержит вход (Change + diff + classification proposal) и **ожидаемый** результат:
profiles, risk level, effective policy (required artifacts, gates), capabilities, verdicts, controller action.

Policy test в форме сценария:

```text
Given: destructive schema migration
When:  rollback plan is absent
Then:  gate rollback-rehearsed = FAIL; controller_action = STOP
```

Gate `factory-golden-passed`: все golden cases дают ожидаемый результат. Если новая policy неожиданно разрешила
«data migration without reconciliation» — factory-change `FAIL`.

## 3. Обновление OpenSpec

- WARRANT фиксирует версию OpenSpec в `warrant.json` (`"openspec": "1.13.x"`).
- OpenSpec MUST NOT форкаться без необходимости: stock OpenSpec + project-local schema + config + packs.
- Обновление OpenSpec — `factory-change`:

```text
upgrade → compatibility suite (golden) → schema validation → sample changes → acceptance
```

Compatibility suite включает: создание, validate, archive эталонных Changes; сохранность ID-комментариев при archive.

## 4. Метрики

Не измерять систему количеством сгенерированного Markdown.

| Метрика | Что показывает |
|---|---|
| Spec defects до implementation | Эффективность clarify / review |
| Spec defects после implementation | Пропуски на стадии спецификации |
| REQ → test coverage | Полнота traceability |
| Change rework rate | Качество спецификаций |
| Verification failure rate | Качество implementation |
| **Escaped defects** | Что WARRANT должен был поймать, но не поймал |
| Data quality regressions | Эффективность pack data |
| Agent retry count | Качество контекста / skills |
| Human intervention rate | Уровень автономности |
| Mutation survival rate | Сила тестов |
| Runtime deviations | Расхождение observed vs intended |

### Главный KPI

> Насколько хорошо спецификация предотвращает неправильную реализацию?

```text
target behavior → implemented behavior → observed behavior
```

Измеряется отклонение между ними.

## 5. Самоулучшение

```text
Failure → Root cause → Pattern → Candidate improvement → Benchmark (golden) → Human approval → factory-change
```

Пример: агенты систематически пропускают null-границы → в specs нет null-сценариев →
правило scenario-engineering → benchmark на 20 исторических Changes → принято.

### Что система MUST NOT делать автоматически

```text
удалять quality gate            понижать уровень verification
игнорировать упавшие тесты      удалять required specification
ослаблять data contract         отключать security check
менять policy, чтобы run прошёл
```

Если правило мешает — создаётся `factory-change` и проходит обычный цикл (INV-08).

## 6. Event log и память

Status: proposed · Maturity: deferred

- Факты о работе фабрики уже есть в Runs и evidence. Отдельный event log вводится, только если их недостаточно.
- Структурированная память (FACT, DECISION, PATTERN, FAILURE, TRAP) — кандидат на хранение в LATTICE, а не в `.warrant/`.
  Решение — после [11-integrations](11-integrations.md). Один бесконечный `memory.md` MUST NOT использоваться.

## 7. Норма и практика: расхождения

Status: informative · Maturity: MVP

Норма WARRANT писалась под фабрику, которой ещё нет, а её первый носитель — этот репозиторий — живёт иначе.
Расхождение само по себе не дефект: решением может быть и «подтянуть практику», и «изменить норму». Дефект —
молчаливое расхождение, которое каждая следующая сессия открывает заново.

| Норма | Фактическая практика | Решение | Где |
|---|---|---|---|
| Код в MVP пишет Codex; сессии Claude — spec и tasks с человеком ([ADR-0018](adr/WARRANT-ADR-0018-frontend-adapters.md) п. 7) | Фазы 1–2 целиком написаны в Claude Code, фаза 3 будет там же | Изменить норму: ADR-0023 внутри Change `phase-3-verification`; адаптер `claude` — кандидат фазы 4 | ADR-0023 |
| ADR — через Change с ADR ([03 §7](03-architecture.md)); specification предшествует implementation (INV-01) | ADR-0016…0022 и правки восьми нормативных документов прошли вне Change | Зафиксировать и не повторять: дальнейшая работа — внутри Change | [NEXT-SESSION](NEXT-SESSION.md), «Долг» |
| Два PR на Change плюс archive ([ADR-0011](adr/WARRANT-ADR-0011-pr-topology.md)) | Одна ветка `feature/<change>`, один merge; CI нет | Проверить норму на Change `agent-session-guide`: либо практика подтягивается, либо `chore` получает явное исключение | [NEXT-SESSION](NEXT-SESSION.md), план |

Строка живёт здесь, пока решение не исполнено; исполненное уходит в ADR или в практику и из таблицы удаляется.
