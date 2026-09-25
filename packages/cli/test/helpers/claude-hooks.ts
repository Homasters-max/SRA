/**
 * The recorded stdin of the Claude Code hooks (ADR-0034 п. 2, design phase-4a
 * §7): `test/contract/fixtures/claude/<version>/{pre,post}-{edit,write,
 * notebook-edit,bash}.json`, written by `scripts/dev/probe-hooks.js collect`
 * and never edited by hand. A fixture names the probe project it was recorded
 * in (`cwd`, the paths of the tool); `recordedInputIn` moves it into the test
 * project, whatever the platform of the recording and of the test.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { REPO_ROOT } from "./cli.js";

export const CLAUDE_FIXTURES = path.join(REPO_ROOT, "packages", "cli", "test", "contract", "fixtures", "claude");

/** Versions of Claude Code with recorded fixtures, in order. */
export function recordedVersions(): string[] {
  return readdirSync(CLAUDE_FIXTURES, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/** One recorded hook input as parsed JSON: `name` is `pre-edit`, `post-notebook-edit`, … */
export function recordedHook(version: string, name: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(CLAUDE_FIXTURES, version, `${name}.json`), "utf8")) as Record<string, any>;
}

/** Key of `tool_input` that names the file of an editing tool. */
const PATH_KEY: Readonly<Record<string, string>> = { Edit: "file_path", Write: "file_path", NotebookEdit: "notebook_path" };

/**
 * The text of `recorded` as if the hook ran in `root`: `cwd` is `root`, every
 * string under the recorded `cwd` is the same path under `root`; `rel` (POSIX,
 * from the project) replaces the file of an editing tool. Everything else
 * stays as recorded.
 */
export function recordedInputIn(recorded: Record<string, any>, root: string, rel?: string): string {
  const cwd = String(recorded["cwd"]);
  const from = /^[A-Za-z]:[\\/]/.test(cwd) || cwd.includes("\\") ? path.win32 : path.posix;
  const under = (value: string): string | undefined => {
    const relative = from.relative(cwd, value);
    if (value !== cwd && (relative === "" || relative.startsWith("..") || from.isAbsolute(relative))) return undefined;
    return relative === "" ? root : path.join(root, ...relative.split(from.sep));
  };
  const walk = (value: unknown): unknown => {
    if (typeof value === "string") return from.isAbsolute(value) ? (under(value) ?? value) : value;
    if (Array.isArray(value)) return value.map(walk);
    if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, walk(v)]));
    return value;
  };
  const moved = walk(recorded) as Record<string, any>;
  const key = PATH_KEY[String(recorded["tool_name"])];
  if (rel !== undefined && key !== undefined) moved["tool_input"] = { ...moved["tool_input"], [key]: path.join(root, ...rel.split("/")) };
  return JSON.stringify(moved);
}
