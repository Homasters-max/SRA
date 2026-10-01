## MODIFIED Requirements

### Requirement: Адаптер claude
<!-- id: REQ-ENF-005 -->

`warrant guard --frontend claude` SHALL читать из stdin родной вход хука Claude Code (`hook_event_name` `PreToolUse` |
`PostToolUse`, `tool_name`, `tool_input`, `cwd`), переводить его в нормализованное событие — `Edit`, `Write` (`file_path`) и
`NotebookEdit` (`notebook_path`) → `edit`, `Bash` (`command`) → `shell`, иначе `other` — и печатать родной ответ: `deny` →
`hookSpecificOutput.permissionDecision: "deny"` с `permissionDecisionReason` из reason и hints; `allow` — без
`permissionDecision` (решает обычный механизм разрешений Claude Code), hints `PostToolUse` — в
`hookSpecificOutput.additionalContext`; `allow` `PreToolUse` — пустой stdout (`additionalContext` `PreToolUse` доходит до
модели только после результата инструмента — зонд Claude Code 2.1.263, design I-165).
Код выхода SHALL быть 0; вход, который нельзя разобрать, SHALL давать код 2 и причину в stderr (Claude Code отменяет действие
`PreToolUse`). Коды этого адаптера — ответ протоколу хуков Claude Code, а не коды [REQ-KRN-003](../kernel/spec.md): код 2 здесь
не `WAIT`, и таблица классов ошибок его не меняет ([ADR-0052](../../../../docs/adr/WARRANT-ADR-0052-cycle-1-close.md) п. 2). Имя frontend SHALL встречаться только в адаптере, генераторе `sync` и значении `--frontend`
([ADR-0034](../../../../docs/adr/WARRANT-ADR-0034-phase-4-frontend.md) п. 2); неизвестное значение `--frontend` — `USAGE`, код 3.

#### Scenario: Отказ Edit
<!-- id: SCN-ENF-017 -->
- **WHEN** записанный вход `PreToolUse` с `tool_name: "Edit"` и `file_path` вне `write_scope` активного Run подан в `warrant guard --frontend claude`
- **THEN** stdout — JSON с `hookSpecificOutput.permissionDecision: "deny"` и причиной, называющей путь; код 0

#### Scenario: Подсказка после NotebookEdit
<!-- id: SCN-ENF-018 -->
- **WHEN** записанный вход `PostToolUse` с `tool_name: "NotebookEdit"` и `notebook_path` файла под правилом `rule/1`, ещё не показанным в Run
- **THEN** `hookSpecificOutput.additionalContext` содержит текст правила, `permissionDecision` отсутствует

#### Scenario: Разрешение не обходит механизм Claude Code
<!-- id: SCN-ENF-019 -->
- **WHEN** записанный вход `PreToolUse` `Write` пути внутри `write_scope`
- **THEN** ответ не содержит `permissionDecision: "allow"`

#### Scenario: Нейтральность Run
<!-- id: SCN-ENF-020 -->
- **WHEN** после событий через `--frontend claude` читается файл Run
- **THEN** файл не содержит строки `claude`, а те же события в нормализованной форме дают те же решения

#### Scenario: Неразборчивый вход
<!-- id: SCN-ENF-021 -->
- **WHEN** в `warrant guard --frontend claude` подан не-JSON
- **THEN** код выхода 2, stderr называет причину, stdout пуст
