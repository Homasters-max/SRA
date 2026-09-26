/**
 * The files `analyze` judges (design §3: the caller reads, `analyze` stays
 * pure): delta specs of the Change, ids of the main specs, `tasks.md`, files
 * under `paths.tests` and the test files changed in the diff. One reader for
 * `warrant analyze` (the working tree) and gate `analyze-clean` (the evaluated
 * commit, R-21), so both judge the same input.
 */
import type { WarrantConfig } from "../config.js";
import type { Availability, DiffEntry } from "../git/facts.js";
import type { ProjectFiles } from "../git/files.js";
import { sourceText } from "../ids/references.js";
import { scanMarkdown } from "../ids/scan.js";
import { parseDelta } from "./delta.js";
import type { AnalyzeInput, TestFile } from "./index.js";

const isMarkdown = (file: string): boolean => file.toLowerCase().endsWith(".md");

/**
 * The paths `analyze` of the Change in `changeDir` (active or archived, as
 * `findChangeDir` names it) reads — the whole change directory among them —
 * for a reader of a commit ({@link ProjectFiles}).
 */
export function analyzePaths(changeDir: string, config: WarrantConfig): string[] {
  const tests = config.paths.tests;
  return [changeDir, "openspec/specs", ...(tests === undefined || tests.length === 0 ? [] : [tests])];
}

/**
 * Input of `analyze` for the Change in `changeDir` (`openspec/changes/<change>`
 * or its archive directory, BL-43) in `files`; `diff` is `base...HEAD` as
 * `scope-valid` reads it.
 */
export function readAnalyzeInput(
  files: ProjectFiles,
  changeDir: string,
  config: WarrantConfig,
  diff: Availability<readonly DiffEntry[]>
): AnalyzeInput {
  const delta = files
    .list(`${changeDir}/specs`)
    .filter(isMarkdown)
    .flatMap((file) => parseDelta(files.read(file) ?? ""));

  const mainIds = new Set<string>();
  for (const file of files.list("openspec/specs").filter(isMarkdown)) {
    for (const found of scanMarkdown(files.read(file) ?? "", file)) {
      if (found.prefix === "REQ" || found.prefix === "SCN") mainIds.add(found.id);
    }
  }

  const tasksText = files.read(`${changeDir}/tasks.md`) ?? "";

  let tests: Availability<TestFile[]>;
  if (config.paths.tests === undefined || config.paths.tests.length === 0) {
    tests = { ok: false, reason: "paths.tests is not set in .warrant/warrant.json" };
  } else {
    const found: TestFile[] = [];
    for (const file of files.list(config.paths.tests)) {
      const read = files.read(file);
      const text = read === undefined ? undefined : sourceText(read);
      if (text !== undefined) found.push({ path: file, text });
    }
    tests = { ok: true, value: found };
  }

  const underTests = new Set(tests.ok ? tests.value.map((file) => file.path) : []);
  const changedTests: Availability<string[]> = diff.ok
    ? { ok: true, value: diff.value.filter((entry) => entry.status !== "D" && underTests.has(entry.path)).map((entry) => entry.path) }
    : diff;

  return { delta, mainIds, tasksText, tasksPath: `${changeDir}/tasks.md`, testFiles: tests, changedTests };
}
