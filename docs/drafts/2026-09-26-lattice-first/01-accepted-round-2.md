# Принято в раунде 2: LATTICE — отдельный проект, WARRANT строится на нём

## Проблема

- Maintainer (2026-09-26, grilling kb-domains, раунд 2): «создаём LATTICE в `D:\project`, в первую очередь реализуем
  LATTICE, а на основе него строим компоненты WARRANT»; фаза 4 WARRANT доводится до конца, LATTICE — после неё.
- Факты (проверены 2026-09-26):
  - решение 2026-09-22 (`lattice/README.md`): LATTICE выделяется в свой репозиторий **после** первого vertical slice
    (Change → REQ `part_of` → TEST `tests` → mutation → history → projection → lint);
  - LD-B-06 (`ACCEPTED`): LATTICE внедряется через один vertical slice на объектах OpenSpec, «не строится полностью
    заранее»;
  - LATTICE: кода нет, `meta/*` и registry нет; 79 решений `LD-*`; стек не выбран, есть LD-T-03 (JSON first,
    PostgreSQL — будущий backend) и LD-T-08 (JSON вместо YAML, `PROPOSED`);
  - контракты стыка — `docs/integrations/01, 02, 05` в SRA, один owner (INV-06 README LATTICE);
  - активный Change `phase-4c` — SPECIFIED, 30 открытых задач.

## Идея

| # | Решение |
|---|---|
| Q9 | Новый репозиторий `D:\project\LATTICE`: `lattice/` переносится из SRA с историей (`git subtree split --prefix=lattice`). В SRA `lattice/` удаляется PR'ом, остаётся ссылка; тем же PR — белый список `structure.test.ts` и правило «не трогать `lattice/`» в `CLAUDE.md`. Контракты `docs/integrations/01, 02, 05` остаются в SRA |
| Q10 | Первым в LATTICE — vertical slice из README; WARRANT подключается к нему, LATTICE растёт по потребности потребителей. LD-B-06 в силе; меняется только порядок: slice — до продолжения WARRANT после фазы 4, не параллельно. Домены поиска (REQ, SCN, Change, TERM и связи) — второй потребитель после slice |
| Q11 | Порядок в LATTICE — по его `NEXT-SESSION.md`: grilling реестра LD-* (противоречия, непроверяемые строки) → данные раньше кода (`meta/*.json`, `spec/types.json`, `evidence/types.json`) → код slice. Стек — TypeScript/Node, как WARRANT (ADR-0013): сверить со строками LD-* первым вопросом grilling реестра |
| Q12 | Фаза 4 WARRANT (`phase-4c` и остальные Change фазы) доводится до конца; LATTICE — после неё. Уточнение maintainer'а к рекомендации (б) |
| Q13 | Поток kb-domains: grilling 09 и 01 продолжается сейчас; 02–07 — после slice LATTICE. 02 заменяется ответом «модель — это LATTICE»: локального слоя в форме read model нет, источник — read model LATTICE (пересматривает Q4 раунда 1). Рефакторинг навыка — после 09 и 01 (Q8) |
| Q14 | Запись — двумя ADR, каждый о своём: ADR WARRANT — порядок (фаза 4 → slice LATTICE → WARRANT на LATTICE), потребитель ждёт slice; `LATTICE-ADR-0001` в новом репозитории — выделение до slice (отменяет решение 2026-09-22 README, не LD-B-06). Решения раунда 1 (Q1–Q8) — в итоговый ADR потока kb-domains |

Порядок работ:

```text
фаза 4 WARRANT (phase-4c → … → конец фазы)
  → репозиторий D:\project\LATTICE (Q9) → grilling LD-* → данные meta/* → vertical slice
  → WARRANT подключается к slice → домены поиска как projection над read model (kb-domains 02–07)
```

## Вопросы для grilling

1. Какие Change ещё входят в фазу 4 после `phase-4c` (факт — `docs/roadmap` / backlog), и есть ли среди них
   зависящие от объектов LATTICE? Рекомендация: зависящие — перенести за slice.
2. Кто ведёт поток LATTICE: файл передачи `docs/handoff/lattice.md` в SRA с `После: phase-4` или `NEXT-SESSION.md`
   в новом репозитории? Рекомендация: в SRA до переноса (ADR-0033 п. 12), после Q9 — в репозитории LATTICE.
3. GitHub-репозиторий LATTICE: remote, CI, конвенции ADR-0032/0033 — копировать или своё? Рекомендация: минимальный
   набор (JSON-конвенции, `structure`, ADR-формат), остальное — по потребности.

## Вне объёма

- Изменение решений `LD-*` — только grilling реестра в репозитории LATTICE.
- Правка `docs/integrations/` — отдельным решением владельца стыка.
