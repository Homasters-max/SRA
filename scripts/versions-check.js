#!/usr/bin/env node
/**
 * `npm run versions:check` — дисциплина версий (R-14, `scripts/versions-lib.js`):
 * CLI, pack или skill, изменённый после последнего tag `v*`, уже несёт новую
 * версию. Тот же код гоняет `npm test` (`versions.test.ts`), а CI — с полной
 * историей и tags. Код выхода 1 — есть компонент без bump.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkVersions } from "./versions-lib.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const result = checkVersions(root);
const report = {
  ok: result.errors.length === 0,
  tag: result.tag,
  components: result.components.map((c) => ({ id: c.id, version: c.now, released: c.then, changed: c.changed.length })),
  errors: result.errors
};
process.stdout.write(JSON.stringify(report, null, 2) + "\n");
if (result.tag === null) process.stderr.write("versions:check: no release tag v* reachable from HEAD; nothing to compare with\n");
process.exitCode = report.ok ? 0 : 1;
