# WARRANT — вход для сессии Claude Code

Указатель, правил здесь нет: правила — в ADR (`docs/adr/`) и в документах, на которые ведут ссылки.

- Начало сессии — [docs/NEXT-SESSION.md](docs/NEXT-SESSION.md): состояние, долг, процессные правила, готовый запрос.
- Процедуры — `.claude/commands/`: `/decision`, `/group-done`, `/next-session`.
- Поиск по коду (`packages/**`, `scripts/**`) — навык `code-search` ([ADR-0028](docs/adr/WARRANT-ADR-0028-graft-adoption.md)).
- Сессия, которая раздаёт группы задач субагентам, — перед первой раздачей читает
  [docs/process/coordinator.md](docs/process/coordinator.md).
