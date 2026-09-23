---
description: "Maintainer: сводный отчёт по статистике групп задач и черновик ADR"
disable-model-invocation: true
---

Свести эксперимент Graft в отчёт и подготовить решение. Процесс — `docs/process/graft.md` §6, порог —
ADR-0026 п. 4.

**Шаги**

1. **Ветка.** Отчёт коммитится не в ветке Change (иначе `scope-valid`): нужна ветка `process/stats-report` в своём
   worktree от `main`. Текущая ветка другая — вывести команды создания worktree и остановиться:
   ```bash
   git worktree add -b process/stats-report ../SRA-graft-report origin/main
   ```

2. **Сводка.**
   ```bash
   node scripts/dev/graft-metrics.js report
   ```
   Код 1 — вердикт `reject` или `missing` непуст (группа закрыта без записи — сначала `/group-stats` по ней). Прочитать и записи `$(git rev-parse --git-common-dir)/graft-lab/runs/*.json`
   (карточки, `graft_commands`, `violations`).

3. **`docs/process/stats-report.md`** (русский, термины и числа как есть):
   - вердикт и причины (`reasons`);
   - таблица по группам: Change#группа, метка, токены, tool calls, `shell_search`, `cs`, `deviations`, время,
     `red_runs`, `helped`; `non_compliant` — отдельно;
   - медианы `[A]` / `[B]` / baseline и дельты в %;
   - где graft помог и где ошибся — из карточек, с примерами команд;
   - оговорки: число групп, разный характер групп, фон phase-3b на другом коде, остаточный риск слепоты.

4. **Черновик ADR** — следующий номер в `docs/adr/`, `amends: [WARRANT-ADR-0026]`: `accept` — постоянный порядок
   использования (что остаётся из `docs/process/graft.md`, нужна ли фиксация версии, условия пересмотра); `reject`
   или `insufficient` без продолжения — отказ и откат (`docs/process/graft.md` §7). Решение — за maintainer'ом:
   показать черновик и спросить до коммита.

5. **После решения.** `docs/process/graft.md`: `status: closed`, ссылка на отчёт; `docs/process/coordinator.md` —
   метки и блок `[A]` по итоговому ADR; строки ADR в `docs/adr/README.md`; `docs/NEXT-SESSION.md` — строки «Процессные правила» про Graft. Коммит через
   файл сообщения (`git commit -F`), без push.
