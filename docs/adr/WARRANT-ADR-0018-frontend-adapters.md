---
id: WARRANT-ADR-0018
title: Frontend adapters — нейтральный guard, три слоя enforcement, MVP на Codex через ACP
adr_state: ACCEPTED
date: 2026-09-22
supersedes: []
amends: [WARRANT-ADR-0013, WARRANT-ADR-0014]
amended_by: [WARRANT-ADR-0020]
---

> Уточнено [ADR-0020](WARRANT-ADR-0020-warrant-sef-boundary.md): слой ACP принадлежит SEF (диспетчер — ACP client, не Claude);
> MVP — Codex в ручном режиме под hooks и CI; адаптер `claude` не планируется; `.codex/hooks.json` — часть эталона
> `.sef/engines/<profile>/`, trust выдаётся в образе или слоте.

## Context

ADR-0014 описал enforcement для одного frontend — Claude Code. Позже выяснилось: фабрика (SEF) запускает агентов
через ACP; реализацию в MVP ведёт Codex; spec и tasks человек пишет вместе с Claude интерактивно и утверждает
через spec-PR. Рассматриваются также OpenCode и Claude Code как исполнители.

Факты (документация и исходники адаптеров на 2026-09-22; адаптеры не запускались):

| Агент | Hooks проекта | Запрет до действия | Подсказка после | `request_permission` на каждое действие | Правки через client `fs` |
|---|---|---|---|---|---|
| Claude Code (`agentclientprotocol/claude-agent-acp`) | да (`settingSources: user, project, local`) | да | да (`additionalContext`) | нет, зависит от режима | нет |
| Codex (`zed-industries/codex-acp`) | только доверенные: trust по hash определения, недоверенные молча пропускаются; конфиг читается при старте процесса адаптера | да (`permissionDecision: deny`, `Bash`, `apply_patch`, MCP) | да (`additionalContext`) | нет, зависит от approval policy | нет, patch применяет сам |
| OpenCode (`opencode acp`) | да (plugins в `.opencode/plugins/`) | да (`throw` в `tool.execute.before`) | да (`output` в `tool.execute.after`) | нет, default `"*": "allow"` | частично |

ACP: агент MAY (не MUST) вызывать `session/request_permission`; client видит каждый `tool_call`
(`kind: edit | execute | …`, `locations`, diff); вставить сообщение агенту посреди хода нельзя — только следующий
prompt или `session/cancel`. Адаптер Codex не транслирует события hooks в ACP.

## Decision

1. **Три слоя enforcement.**
   - **ACP client** (SEF или оркестратор): наблюдение за `tool_call`, проверки после действия, `session/cancel`.
     Не полагается на `request_permission` как на механизм запрета.
   - **Hooks внутри агента**: запрет до действия и подсказка в том же ходе. Необязательное ускорение: могут не
     загрузиться.
   - **CI** — последняя инстанция ([ADR-0010](WARRANT-ADR-0010-trust-by-reference.md)).
2. **Нейтральный контракт `warrant guard`.** Вход — нормализованное событие
   `{phase: pre|post, action: shell|edit|other, argv?, paths[], cwd, run?}`; выход —
   `{decision: allow|deny, reason?, hints[]}`. `--frontend <name>` переводит родной формат агента в событие и
   решение — в родной ответ. Логика только в CLI; адаптеры — трансляция.
3. **Слой ACP.** `validate --files` ([ADR-0019](WARRANT-ADR-0019-post-edit-hints.md)) по `locations` каждого
   завершённого edit `tool_call`; hints накапливаются и уходят блоком в начале следующего prompt. Запись вне
   `write_scope` → `session/cancel` + запись в журнал Run; автоматического отката нет.
4. **Стабильное определение hook.** Определение, которое генерирует `warrant sync`, — постоянная строка
   `warrant guard --frontend <name>` без параметров. Доверие Codex подтверждается человеком один раз — шаг
   `warrant init`; версия CLI фиксируется lock и проверяется в CI.
5. **Проверка живости hooks.** Каждый вызов guard пишет событие в журнал Run. Edit `tool_call` без парного
   `post`-события guard → finding `FRONTEND_HOOKS_INACTIVE` (один раз за Run) в hints и журнал. Не блокирует.
6. **Требования к SEF** (proposed, [11 §2](../11-integrations.md)): процесс ACP-адаптера запускается с cwd =
   worktree Change, один процесс на worktree; `request_permission` не считается механизмом запрета.
   Открытые I5 / I6 не закрываются.
7. **MVP.** Адаптеры `codex` (`.codex/hooks.json`: PreToolUse и PostToolUse на `Bash` и `apply_patch`, пути —
   из текста patch) и `acp` (если оркестратор — ACP client). Адаптеры `claude` и `opencode` — фаза 7. Сессии
   Claude на этапе spec guard не получают: их защищают топология PR ([ADR-0011](WARRANT-ADR-0011-pr-topology.md)),
   human review spec-PR и CI.

## Consequences

- ADR-0013: slice ведёт Codex (через codex-acp), а не Claude Code; критерий выхода MVP не меняется по смыслу.
- ADR-0014: static deny в `.claude/settings.json`, hook Claude Code и reviewer-subagent переходят в адаптер
  `claude` (later). Static-слоя у Codex в MVP нет: запрет до действия — только hook, дальше ACP и CI.
- Предел INV-07 сохраняется: если hooks неактивны, запись вне `write_scope` обнаруживается после действия
  (ACP) или в CI, а не предотвращается.
- Открыто: (a) оркестрация — Claude-оркестратор как ACP client или Codex сам берёт утверждённые задачи
  ([13 §6](../13-roadmap.md) Q6); без ACP-слоя работают только hooks и CI; (b) кто выполняет adversarial review в
  MVP вместо Claude-subagent (Q7).

## Alternatives

- **Hooks агента как основной слой** — отвергнуто: у каждого агента свои дыры (trust Codex, subagents OpenCode),
  под ACP-адаптером могут не загрузиться.
- **`request_permission` как механизм запрета** — отвергнуто: агент не обязан его вызывать.
- **Только CI** — отвергнуто: агент узнаёт об ошибке после PR.
- **Логика в скрипте hook для каждого агента** — отвергнуто: N реализаций разойдутся.
- **Определение hook с параметрами** — отвергнуто: у Codex каждое изменение сбрасывает trust.
- **`session/cancel` на любую находку** — отвергнуто: подсказка не блокирует ([ADR-0019](WARRANT-ADR-0019-post-edit-hints.md) п. 4).
