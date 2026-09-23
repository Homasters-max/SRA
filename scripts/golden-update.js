#!/usr/bin/env node
/**
 * `npm run golden:update` — единственный легальный способ менять
 * `packs/core-sdd/golden/<profile>/expected/*.json` (design Decision 8).
 *
 * Что делает для каждой фикстуры:
 *   1. `warrant sync` на месте — лок и сгенерированные файлы фикстуры
 *      приводятся к тому, что даёт текущий pack;
 *   2. копия во временный каталог и та же процедура, что в
 *      `golden.test.ts` (общий `scripts/golden-lib.js`): `sync`, `resolve
 *      --explain`, `status`, `verify --transition PROPOSED->SPECIFIED` с
 *      fake `openspec`;
 *   3. запись `expected/resolve.json`, `expected/status.json` и
 *      `expected/verify.json` каноническим писателем (тем же, что `warrant
 *      fmt`), без волатильных полей.
 *
 * Повторный запуск не должен давать diff: и лок, и снимки детерминированы.
 * После правки фикстур не забыть `warrant sync` в корне репозитория — лок
 * репозитория держит хэш pack (каталог `golden/` в него не входит, I-59, но
 * `pack.json` и объекты — входят).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CLI_ROOT,
  GOLDEN_NAMES,
  GOLDEN_ROOT,
  expectedDir,
  goldenEnv,
  makeTempRoot,
  removeDir,
  runCli,
  runGolden
} from "./golden-lib.js";

const { canonicalText } = await import(
  pathToFileURL(path.join(CLI_ROOT, "dist", "core", "canon", "format-json.js")).href
);

/** Пишет файл канонически и говорит, изменился ли он. */
function writeIfChanged(absolute, value) {
  const text = canonicalText(value).text;
  let current = null;
  try {
    current = readFileSync(absolute, "utf8");
  } catch {
    current = null;
  }
  if (current === text) return false;
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, "utf8");
  return true;
}

const tempRoot = makeTempRoot();
const written = [];
let failed = false;

try {
  for (const name of GOLDEN_NAMES) {
    const source = path.join(GOLDEN_ROOT, name);

    // (1) Лок и сгенерированные файлы самой фикстуры.
    const inPlace = await runCli(["sync"], source, goldenEnv(tempRoot, `${name}-inplace`));
    if (inPlace.status !== 0) {
      process.stderr.write(`golden ${name}: warrant sync failed\n${inPlace.stdout}${inPlace.stderr}\n`);
      failed = true;
      continue;
    }
    for (const rel of inPlace.json.data.changed) written.push(`${name}/${rel}`);

    // (2) и (3) Снимки.
    const run = await runGolden(name, tempRoot);
    if (run.changed.length > 0) {
      // Копия синхронизирована на шаге (1); всё, что sync хочет переписать
      // здесь, означало бы недетерминированную генерацию.
      process.stderr.write(`golden ${name}: sync в копии переписал ${run.changed.join(", ")}\n`);
      failed = true;
    }
    if (run.verifyExit !== 0) {
      process.stderr.write(`golden ${name}: warrant verify exited ${run.verifyExit}: ${JSON.stringify(run.verifyErrors)}\n`);
      failed = true;
    }
    const dir = expectedDir(name);
    if (writeIfChanged(path.join(dir, "resolve.json"), run.resolve)) written.push(`${name}/expected/resolve.json`);
    if (writeIfChanged(path.join(dir, "status.json"), run.status)) written.push(`${name}/expected/status.json`);
    if (writeIfChanged(path.join(dir, "verify.json"), run.verify)) written.push(`${name}/expected/verify.json`);
  }
} finally {
  removeDir(tempRoot);
}

process.stdout.write(
  `${JSON.stringify({ ok: !failed, golden: GOLDEN_NAMES, written }, null, 2)}\n`
);
process.exit(failed ? 1 : 0);
