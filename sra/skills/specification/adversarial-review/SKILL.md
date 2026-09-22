---
name: adversarial-review
version: 0.1.0
description: Adversarial review of a specification — a reviewer in a separate run looks for the seven defect categories of 06 section 7.
---

# Adversarial review спецификации

Схема: **Author → Draft → Reviewer (отдельный Run, отдельный контекст) → Revised** ([06 §7](../../../../docs/06-verification.md)).
Достаточно двух ролей; «совет из 10 моделей» не используется — это шум.

Reviewer читает спецификацию change'а (`proposal`, delta specs, `design`, `tasks`) и ищет дефекты семи категорий.

## Семь категорий

1. **Ambiguity** — формулировки без наблюдаемого критерия: «quick response», «appropriate error», «normally», «should support».
2. **Missing boundaries** — не описаны empty, null, дубликат, невалидный вход, timeout, частичный отказ, конкурентность, retry.
3. **Missing actors** — не назван кто-то из действующих лиц: user, system, service, administrator, внешний источник.
4. **Missing error behavior** — не сказано, что происходит при отказе зависимости.
5. **Hidden assumptions** — молча предполагаются порядок, уникальность, транзакционность.
6. **Contradictions** — два утверждения несовместимы: «ID уникален» против «несколько клиентов с одним ID».
7. **Implementation leakage** — решение вместо требования: «создать Redis cache», если это не бизнес-требование.

## Результат

Каждый finding имеет `severity`; blocking findings должны быть закрыты до перехода `SPECIFIED->APPROVED`.
Результат review — L2 evidence kind `review`; он не отменяет `FAIL` на L0 и required `FAIL` на L1 (INV-02).

Полноценный skill (процедура, формат findings, промпты) — фаза 4; версия 0.1.0 фиксирует только список категорий.
