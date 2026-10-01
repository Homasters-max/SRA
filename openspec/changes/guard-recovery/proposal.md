# Proposal: guard-recovery

## Why

2026-10-01 guard запер сессию LATTICE при переходе на 0.9 (отчёт `D:\tmp\warrant-inbox\guard-lockout-version-skew-2026-10-01.md`). Причин три, и вместе они дают ловушку без выхода:

- **Хук исполняет чужой CLI.** Хук `warrant guard --frontend claude` берёт первый `warrant` из PATH. На машине maintainer'а это `npm link` на dev-checkout SRA, а не тег, который закрепила LATTICE. CLI сменился 0.8.2 → 0.10.0-dev без pin-Change в LATTICE.
- **Policy не грузится.** LATTICE закрепила `core-sdd` `^0.3.4`, а CLI несёт pack 0.4.1. Это `PACK_VERSION_RANGE`.
- **guard запирает всё.** При policy, которая не грузится, guard (`core/guard/guard.ts` `decidePre` → `loadPolicy`) даёт `deny` на любое событие `pre`: любой Bash, включая `git log`, и любую запись, даже вне проекта. Диапазон поднимает только pin-Change, а без Bash и записи его не начать. Причина — «the policy does not load» — не называет ни версий, ни выхода.

Агент `warrant-reviewer`, которого генерирует `warrant sync`, тоже зовёт `warrant guard` и `warrant run submit` из PATH. SRA нужен dev-CLI, потребителю — CLI тега, а PATH на машине один. Пока это так, машину нельзя перевести на CLI из тега.

Это класс A ([ADR-0048](../../../docs/adr/WARRANT-ADR-0048-stabilization.md) п. 2): агент не может исправить ошибку. Решения — [ADR-0053](../../../docs/adr/WARRANT-ADR-0053-guard-recovery.md) п. 2–5; по [ADR-0055](../../../docs/adr/WARRANT-ADR-0055-release-for-lattice.md) этот Change — последний в 0.10.0, его archive-PR ставит тег `v0.10.0`.

## What Changes

- **guard при policy, которая не грузится, не запирает восстановление** (ADR-0053 п. 2, REQ-ENF-004). Fail-closed остаётся только для правки путей проекта. Без загрузки policy guard разрешает:
  - событие без пути проекта: путь проверяется до загрузки policy;
  - правку только `.warrant/warrant.json` — закрепления;
  - shell, где каждая простая команда — команда восстановления `warrant sync`, `warrant validate`, `warrant status`, `warrant --version` или команда без записи из списка Run `review` (`git status|log|diff|show`, `warrant gate`, `--help`, `cd` внутри проекта), в строгой форме Run `review`.

  Правило Run `review` и правило `write_scope` активного Run не меняются: оба решают без policy.
- **Причина отказа называет версии и выход** (ADR-0053 п. 2). Reason: код и сообщение ошибки загрузки, версия CLI, версии встроенных packs, закреплённые диапазоны и `kernel`. Hints: `hint` ошибки загрузки, шаги pin-Change (поднять диапазон и `kernel` в `warrant.json`, затем `warrant sync`, или исполнить закреплённый CLI) и что guard разрешает до загрузки policy. Сообщение `PACK_VERSION_RANGE` встроенного pack тоже называет версию CLI.
- **Хук и агент исполняют закреплённый проектом CLI** (ADR-0053 п. 3, REQ-KRN-004, REQ-KRN-033). Новое необязательное поле `cli` в `warrant.json` — путь к файлу входа CLI от корня проекта. Например, у SRA это `packages/cli/dist/bin/warrant.js`, у Node-проекта — CLI тега в `node_modules`.
  - С полем `sync` пишет в хуки `.claude/settings.json` и субагента `warrant-reviewer` команду `node "${CLAUDE_PROJECT_DIR:-.}/<cli>" guard --frontend claude`. Тело субагента сдаёт результат командой `node <cli> run submit`. Файла `cli` нет — находка `sync` `CLI_NOT_FOUND`.
  - guard читает `node <cli>` как `warrant` в строгой форме команд Run `review` и команд восстановления.
  - Без поля всё по-прежнему: `warrant` из PATH. У потребителя там CLI тега (п. 4 ADR-0053).
- **`warrant.json` SRA получает `cli`** — dev-CLI репозитория. Агент `warrant-reviewer` SRA перегенерирован: его хук и `run submit` больше не зависят от PATH. После этого машину можно перевести на CLI из тега.
- **R-46.** Исключение runner'а `warrant guard` без `--frontend` (например, сбой чтения stdin) даёт `deny` с кодом 0 по REQ-ENF-004, а не `INTERNAL` с кодом 3.
- **Документы процесса** (ADR-0053 п. 4–5):
  - `docs/process/rules.md`, раздел «Настройка машины»: CLI потребителя — из тега (`npm pack` вне checkout, затем `npm i -g`); `npm link` — только для разработки WARRANT;
  - навык `warrant-upgrade`: подъём minor pack, порядок «сначала закрепление (диапазон, `kernel`), затем CLI», поле `cli`;
  - 08 §3: поле `cli`;
  - CHANGELOG `## 0.10.0`: «Вердикт» и «Миграция для потребителя».

## Capabilities

### New Capabilities

нет

### Modified Capabilities

- `enforcement`:
  - REQ-ENF-004 — guard при policy, которая не грузится: путь вне проекта до policy, `.warrant/warrant.json`, команды восстановления, reason с версиями; `node <cli>` как `warrant`; исключение runner'а — `deny` с кодом 0;
  - REQ-ENF-005 — ответ адаптера `claude` при policy, которая не грузится.
- `kernel`:
  - REQ-KRN-004 — поле `cli` схемы `config/1`;
  - REQ-KRN-033 — команда CLI в сгенерированных хуках и субагенте, находка `CLI_NOT_FOUND`. ADR-0053 называет REQ-KRN-025, но текст команды хука живёт в REQ-KRN-033; REQ-KRN-025 не меняется;
  - REQ-KRN-021 — сообщение и `hint` `PACK_VERSION_RANGE` называют версию CLI и `kernel`.

## Non-Goals

- **Шум guard** — «start a Run first» на каждую правку вне Run (WS-26): рядом, но не этот Change.
- **guard при битом Run, занятом замке, невалидном событии** — по-прежнему `deny` на всё (F9). ADR-0053 меняет только случай policy, которая не грузится.
- **Переадресация `warrant` из PATH на закреплённый CLI** для любых команд: отвергнута в design (D3). Навыки SRA уже исполняют dev-CLI явно (`node packages/cli/dist/bin/warrant.js`).
- **Установка закреплённого CLI командой `warrant`.** Способ установки — документ, а не команда.
- **Поле `cli` в `warrant init`.** Новый проект получает поле только руками.

## Impact

- `packages/cli/src/core/guard/guard.ts`, `core/guard/decide.ts` — восстановление при policy, которая не грузится; алиас `node <cli>`.
- `packages/cli/src/core/config.ts`, `packages/cli/schemas/config.1.schema.json` — поле `cli`.
- `packages/cli/src/core/sync/claude.ts`, `core/sync/plan.ts` — команда хука и тела субагента.
- `packages/cli/src/core/packs/loader.ts` — сообщение `PACK_VERSION_RANGE`.
- `packages/cli/src/bin/warrant.ts` — R-46.
- `packages/cli/test/**` — тесты SCN.
- `.warrant/warrant.json`, `.warrant/warrant.lock.json`, `.claude/agents/warrant-reviewer.md` — `cli` SRA и перегенерированный агент.
- `packs/core-sdd/**` — не меняется.
- `docs/08-packs.md`, `docs/process/rules.md`, `CHANGELOG.md`, `docs/backlog.md` (R-46 закрыт).
- Навык `warrant-upgrade` (`~/.claude/skills/`, вне репозитория).
