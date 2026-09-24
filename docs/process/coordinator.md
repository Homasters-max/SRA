# Координатор: раздача групп задач субагентам

Для сессии, которая ведёт Change по `tasks.md` и отдаёт каждую группу субагенту (модель — `opus`).

## 1. Перед группой

1. Ветка `worktree/<change>`, worktree этой ветки (`git worktree list`), дерево чистое, в worktree выполнен `npm ci`
   (поиск по коду — `scripts/dev/cs.js`, ему нужен `cross-spawn`).
2. **Одна группа — один субагент.** Вызов: `description` = `<change> group <N>`. Группа не помещается в одного
   субагента — продолжение тем же шаблоном, `description` = `<change> group <N> part <k>`; каждую часть записать
   отдельно (`--part k`, §3).

## 2. Промпт субагента

Контекст группы (что читать: proposal, design, tasks группы, ADR) — называть явно.

```text
Change <change>, группа <N> tasks.md (openspec/changes/<change>/tasks.md, раздел «## <N>.»). Worktree <путь>,
ветка worktree/<change>. Прочитай: <proposal/design/ADR — по группе>. Выполни задачи группы; отклонение от spec —
через /decision; в конце — /group-done <N>.
Поиск по коду — строго по навыку code-search (.claude/skills/code-search/SKILL.md): прочитай его до первого
обращения к коду.
Отчёт (до одной страницы): что сделано по задачам; решения I-N; разделы
«Поиск по коду» — как находил нужные места в коде (2–3 примера), где поиск ошибся или не нашёл и к чему это привело
(или «нет»);
«Проверки» — сколько раз проверки /group-done (шаг 2) были красными до зелёного и почему.
```

## 3. После группы — наблюдение (ADR-0028 п. 5)

1. Отчёт субагента → карточка: `red_runs` (из «Проверки»), `helped`, `misled`, `notes` (из «Поиск по коду»).
   `misled` — только когда неверный ответ `cs` привёл к ошибке (красный прогон, неверная правка).
2. Запись: `node scripts/dev/graft-metrics.js run --change <change> --group <N> [--part <k>] --mode on
   --red-runs <k> --helped <…> --misled "<…>" --notes "<…>"` (или `/group-stats <N>`). Транскрипт копируется в
   `graft-lab/transcripts/`. `misled` ≠ `none` или `compliant: false` — сообщить maintainer'у: `misled` — условие
   пересмотра ADR-0028 и повод добавить вопрос в бенчмарк ([graft.md](graft.md) §5).
