/**
 * A fake `openspec` for the gate and verify e2e tests: `--version` → 1.13.1;
 * `validate <change> --strict --json` logs its argv to `FAKE_OPENSPEC_LOG`
 * (appending one line per call) and prints a report in the shape of OpenSpec
 * 1.13.1 (I-78), invalid when `FAKE_OPENSPEC_INVALID=1`; `status --change <c>
 * --json` derives the artifact statuses from the files of the change, like
 * the fake of the golden fixtures (I-61).
 */
import { chmodSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHIM = `const fs = require("fs");
const path = require("path");
const args = process.argv.slice(2);
if (args.includes("--version")) { process.stdout.write("1.13.1\\n"); process.exit(0); }
if (args[0] === "validate") {
  if (process.env.FAKE_OPENSPEC_LOG) fs.appendFileSync(process.env.FAKE_OPENSPEC_LOG, JSON.stringify(args) + "\\n");
  const valid = process.env.FAKE_OPENSPEC_INVALID !== "1";
  const issues = valid ? [] : [{ level: "ERROR", path: "proposal.md", message: "broken" }];
  process.stdout.write(JSON.stringify({ items: [{ id: args[1], type: "change", valid, issues, durationMs: 1 }],
    summary: { totals: { items: 1, passed: valid ? 1 : 0, failed: valid ? 0 : 1 } }, version: "1.0" }) + "\\n");
  process.exit(valid ? 0 : 1);
}
if (args[0] === "status") {
  const i = args.indexOf("--change");
  const change = i === -1 ? "" : args[i + 1];
  const dir = path.join(process.cwd(), "openspec", "changes", change);
  if (!fs.existsSync(dir)) { process.stdout.write(JSON.stringify({ status: [{ severity: "error" }] }) + "\\n"); process.exit(1); }
  const defs = [
    { id: "proposal", requires: [], file: "proposal.md" },
    { id: "specs", requires: ["proposal"], file: "specs" },
    { id: "design", requires: ["proposal"], file: "design.md" },
    { id: "tasks", requires: ["specs", "design"], file: "tasks.md" }
  ];
  const status = {};
  for (const def of defs) {
    if (fs.existsSync(path.join(dir, def.file))) { status[def.id] = "done"; continue; }
    status[def.id] = def.requires.some((r) => status[r] !== "done") ? "blocked" : "ready";
  }
  process.stdout.write(JSON.stringify({ changeName: change, artifacts: defs.map((d) => ({ id: d.id, status: status[d.id], requires: d.requires })) }) + "\\n");
  process.exit(0);
}
process.exit(1);
`;

/**
 * The POSIX launcher of a fake: `${0%/*}` is the shell's own dirname. Tests
 * often make the fake directory the WHOLE PATH, where an external `dirname`
 * does not exist (I-101); `node` is spelled out absolutely for the same reason.
 */
export function posixLauncher(node: string): string {
  return `#!/bin/sh\nexec "${node}" "\${0%/*}/shim.cjs" "$@"\n`;
}

/**
 * Installs a fake `openspec` into `dir` whose behaviour is the node script
 * `shim`: `shim.cjs` beside `openspec.cmd` (Windows) and `openspec` (POSIX).
 */
export function installFakeOpenspec(dir: string, shim: string): string {
  const node = process.execPath;
  writeFileSync(path.join(dir, "shim.cjs"), shim, "utf8");
  writeFileSync(path.join(dir, "openspec.cmd"), `@"${node}" "%~dp0shim.cjs" %*\r\n`, "utf8");
  const posix = path.join(dir, "openspec");
  writeFileSync(posix, posixLauncher(node), "utf8");
  try {
    chmodSync(posix, 0o755);
  } catch {
    // no permissions on Windows; the .cmd is used there
  }
  return dir;
}

/** Writes the fake into `dir` (`openspec.cmd` for Windows, `openspec` for POSIX) and returns `dir`. */
export function writeFakeOpenspec(dir: string): string {
  return installFakeOpenspec(dir, SHIM);
}

/** PATH key as Windows spells it, so an override replaces rather than duplicates it. */
export const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

/** PATH with the fake first; `git` and `node` stay reachable. */
export function pathWithFake(dir: string): string {
  return `${dir}${path.delimiter}${process.env[PATH_KEY] ?? ""}`;
}
