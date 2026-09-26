/**
 * The files `analyze` judges, read from the working tree (design §3: the caller
 * reads, `analyze` stays pure): delta specs of the Change, ids of the main
 * specs, `tasks.md`, files under `paths.tests` and the test files changed in
 * the diff. One reader for `warrant analyze` and gate `analyze-clean`, so both
 * judge the same input.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { testFiles as testRoot, type WarrantConfig } from "../config.js";
import { reportPath, walkFiles } from "../fs.js";
import type { Availability, DiffEntry } from "../git/facts.js";
import { readSourceText } from "../ids/references.js";
import { scanMarkdown } from "../ids/scan.js";
import { parseDelta } from "./delta.js";
import type { AnalyzeInput, TestFile } from "./index.js";

const isMarkdown = (file: string): boolean => file.toLowerCase().endsWith(".md");

/** Input of `analyze` for the active Change `change`; `diff` is `base...HEAD` as `scope-valid` reads it. */
export function readAnalyzeInput(root: string, change: string, config: WarrantConfig, diff: Availability<readonly DiffEntry[]>): AnalyzeInput {
  const changeDir = path.join(root, "openspec", "changes", change);
  const delta = walkFiles(path.join(changeDir, "specs"))
    .filter(isMarkdown)
    .flatMap((absolute) => parseDelta(readFileSync(absolute, "utf8")));

  const mainIds = new Set<string>();
  for (const absolute of walkFiles(path.join(root, "openspec", "specs")).filter(isMarkdown)) {
    for (const found of scanMarkdown(readFileSync(absolute, "utf8"), reportPath(absolute, root))) {
      if (found.prefix === "REQ" || found.prefix === "SCN") mainIds.add(found.id);
    }
  }

  const tasksAbsolute = path.join(changeDir, "tasks.md");
  const tasksText = existsSync(tasksAbsolute) ? readFileSync(tasksAbsolute, "utf8") : "";

  let tests: Availability<TestFile[]>;
  if (config.paths.tests === undefined || config.paths.tests.length === 0) {
    tests = { ok: false, reason: "paths.tests is not set in .warrant/warrant.json" };
  } else {
    const files: TestFile[] = [];
    for (const absolute of testRoot(root, config)) {
      const text = readSourceText(absolute);
      if (text !== undefined) files.push({ path: reportPath(absolute, root), text });
    }
    tests = { ok: true, value: files };
  }

  const underTests = new Set(tests.ok ? tests.value.map((file) => file.path) : []);
  const changedTests: Availability<string[]> = diff.ok
    ? { ok: true, value: diff.value.filter((entry) => entry.status !== "D" && underTests.has(entry.path)).map((entry) => entry.path) }
    : diff;

  return { delta, mainIds, tasksText, tasksPath: `openspec/changes/${change}/tasks.md`, testFiles: tests, changedTests };
}
