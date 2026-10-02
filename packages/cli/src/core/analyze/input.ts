/**
 * The files `analyze` judges (design §3: the caller reads, `analyze` stays
 * pure): delta specs of the Change, ids of the main specs, ids of the delta
 * specs of the other open Changes (#141), `tasks.md`, files under
 * `paths.tests` and the test files changed in the diff. One reader for
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

const CHANGES_DIR = "openspec/changes";

/** The name of the Change of `changeDir`: its last segment, without the date of an archive directory. */
function changeName(changeDir: string): string {
  return (changeDir.split("/").pop() ?? "").replace(/^\d{4}-\d{2}-\d{2}-/, "");
}

/**
 * REQ and SCN of `ADDED` / `MODIFIED` in the delta specs of every directory
 * `openspec/changes/<name>/` but `archive` and the Change itself (REQ-VER-010,
 * #141): a Change whose impl-PR merged before its archive-PR declares them
 * there. A file directly under `openspec/changes/`, a directory without
 * `specs/` and a delta that does not parse give none.
 */
function openChangeIds(files: ProjectFiles, own: string): Set<string> {
  const ids = new Set<string>();
  for (const file of files.list(CHANGES_DIR).filter(isMarkdown)) {
    const segments = file.slice(CHANGES_DIR.length + 1).split("/");
    const name = segments[0] as string;
    if (segments.length < 3 || segments[1] !== "specs" || name === "archive" || name === own) continue;
    for (const entry of parseDelta(files.read(file) ?? "")) {
      if (entry.section === "ADDED" || entry.section === "MODIFIED") for (const id of [entry.req, ...entry.scenarios]) ids.add(id);
    }
  }
  return ids;
}

/**
 * The paths `analyze` of the Change in `changeDir` (active or archived, as
 * `findChangeDir` names it) reads — the whole change directory among them,
 * and `openspec/changes` for the other open Changes — for a reader of a
 * commit ({@link ProjectFiles}).
 */
export function analyzePaths(changeDir: string, config: WarrantConfig): string[] {
  const tests = config.paths.tests;
  return [changeDir, "openspec/specs", CHANGES_DIR, ...(tests === undefined || tests.length === 0 ? [] : [tests])];
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

  return {
    delta,
    mainIds,
    openIds: openChangeIds(files, changeName(changeDir)),
    tasksText,
    tasksPath: `${changeDir}/tasks.md`,
    testFiles: tests,
    changedTests
  };
}
