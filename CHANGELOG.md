# Changelog

Релизы CLI WARRANT: тег `v<версия>` репозитория `Homasters-max/SRA`. Раздел — на каждую поднятую версию CLI; рост major или minor CLI или pack требует подразделов «Вердикт» и «Миграция для потребителя» ([ADR-0048](docs/adr/WARRANT-ADR-0048-stabilization.md) п. 3). Держит `npm run versions:check`. История до 0.8.3 — теги и `openspec/changes/archive/`.

## 0.8.3 — 2026-09-29

Patch: вердикт, схемы, JSON и коды выхода не меняются.

- **Установка CLI из тега в reusable workflow `warrant.yml` исправлена** (WS-01). `warrant: v<tag>` ставил CLI командой `npm i -g github:…#<tag>`, у которой нет `dist` и зависимостей. Теперь — tarball тега: `npm pack` вне checkout, затем `npm i -g <tgz>`. С `v0.8.2` и раньше reusable workflow у внешнего проекта не запускал `warrant ci`.
- **Канарейка поставки** `.github/workflows/canary.yml`: на теге `v*` вызывает поставляемый `warrant.yml` с CLI этого тега (REQ-VER-016).
- Миграция для проекта на копии job `warrant`:
  - заменить копию на `uses: Homasters-max/SRA/.github/workflows/warrant.yml@v0.8.3` с `warrant: v0.8.3` ([06 §8](docs/06-verification.md));
  - обновить имя обязательной проверки на `warrant / warrant`.
