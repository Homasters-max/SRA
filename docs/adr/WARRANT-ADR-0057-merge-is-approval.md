---
id: WARRANT-ADR-0057
title: Акт приёмки PR с путями класса — один merge maintainer'а; защита `main` — два ruleset, обход ревью владельца — только роль admin на PR
adr_state: ACCEPTED
date: 2026-10-02
supersedes: []
amends: [WARRANT-ADR-0051]
---

## Context

[ADR-0051](WARRANT-ADR-0051-agent-merge-first.md) п. 3 держит класс путей с приёмкой человеком (CLI, policy, защита агента, workflows; `.github/CODEOWNERS`) защитой `main` на форже: «Require review from Code Owners» и обязательная проверка `warrant / warrant`. Бот `homasters` (роль `write`, `identities.agents`) не сольёт такой PR.

Судья засчитывает акт человека по merge: ref `APPROVED` / `MERGED` с gate `human-approval` принимается, только если PR слил член `roles` (`merged_by`, ADR-0051 п. 3, [ADR-0052](WARRANT-ADR-0052-cycle-1-close.md) п. 8). Ревью судья не читает: approval комментарием отвергнут в [ADR-0010](WARRANT-ADR-0010-trust-by-reference.md).

Поэтому maintainer делает два акта на один PR: Approve (его требует форж) и merge (его читает судья). Auto-merge после Approve не годится: включённый ботом, он пишет `merged_by` бота. LATTICE, где Change идут параллельно, назвала двойной акт пунктом 11 в [SRA#160](https://github.com/Homasters-max/SRA/issues/160).

Убрать «Require review from Code Owners», как предложено в #160, — потерять предотвращение: бот сольёт PR с путями класса сам. Судья увидит это только при `transition MERGED` и только у Change. Правку `AGENTS.md`, `.claude/**` или хука вне Change не увидит никто.

## Decision

1. **Акт приёмки PR с путями класса — один merge maintainer'а своим аккаунтом.** Approve не нужен и актом не считается. Судья не меняется: `merged_by` из `roles` (ADR-0051 п. 3).
2. **Защита `main` — два ruleset** (класс C, [ADR-0048](WARRANT-ADR-0048-stabilization.md) п. 2, настраивает maintainer):
   - `main` — обязательная проверка `warrant / warrant`, запрет удаления и non-fast-forward, merge только через PR (без ревью владельца); обхода нет ни у кого;
   - `main-code-owners` — «Require review from Code Owners»; обход — роль `Repository admin`, режим `pull_request` (только merge PR, не push).
3. **Как сливает maintainer.** После зелёного CI — «Merge pull request» с отметкой обхода правил («bypass rules»). Красный CI не обходится: проверка живёт в ruleset без обхода. Auto-merge обход не применяет — он остаётся путём бота для PR вне класса.
4. **Бот обхода не получает.** Роль `homasters` — `write`. Повышение бота до `admin` снимает предотвращение — это то же, что убрать правило (первая строка «Alternatives»).
5. **Тексты процесса.** Навыки (`git-land`, `change-impl-pr`, `change-spec-pr`) и `docs/process/rules.md` называют акт maintainer'а «Merge с обходом ревью владельца после зелёного CI» вместо «Approve и merge» / «Enable auto-merge». Правка `.claude/**` — путь класса: её PR maintainer сливает уже по п. 3.
6. **Потребитель.** Проект под WARRANT с классом путей и `CODEOWNERS` (миграция 0.9.0) делает то же разделение ruleset. Строка — в «Миграции» CHANGELOG следующего релиза.

## Consequences

- Один акт maintainer'а на PR с путями класса; бот по-прежнему не сливает их.
- Акт maintainer'а — после зелёного CI: обход не ждёт проверок сам, ждать их — дело maintainer'а (запрос акта — после зелёного CI).
- WARRANT настройки форжа не проверяет (ADR-0051 п. 3): разделение ruleset держится настройкой, не тестом.
- Акт maintainer'а (settings): создать ruleset `main-code-owners` с правилом п. 2 и обходом, убрать «Require review from Code Owners» из ruleset `main`.

## Alternatives

- **Убрать «Require review from Code Owners»** (#160): отвергнуто — бот сливает пути класса, судья видит это поздно и не у всех PR (Context).
- **Approve как акт, merge — бот:** отвергнуто — судья должен читать ревью форжа (новый Change CLI), а ADR-0010 держит доверие к ссылке на merge, не к отметке.
- **Обход на одном ruleset:** отвергнуто — обход снимает и обязательную проверку `warrant / warrant`, maintainer сольёт красный PR.
