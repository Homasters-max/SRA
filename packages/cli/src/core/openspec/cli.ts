/**
 * Thin wrapper around the `openspec` binary on PATH (design D-7).
 *
 * `cross-spawn` is used because on Windows `openspec` is a `.cmd` shim, which
 * `child_process.spawnSync` will not execute without a shell.
 *
 * Shapes observed on OpenSpec 1.13.1 in this repository:
 *
 *   openspec list --json
 *     { "changes": [ { "name", "completedTasks", "totalTasks", "lastModified", "status" } ],
 *       "root": { "path", "source" } }
 *
 *   openspec list --specs --json
 *     { "specs": [ ... ], "root": { ... } }        // empty here: no main specs yet
 *
 *   openspec show <change> --json
 *     { "id", "title", "deltaCount",
 *       "deltas": [ { "spec", "operation", "description",
 *                     "requirement":  { "text", "scenarios": [ { "rawText" } ] },
 *                     "requirements": [ { "text", "scenarios": [ { "rawText" } ] } ] } ] }
 *
 *   openspec show <spec> --type spec --json
 *     { "id", "requirements": [ { "text", "scenarios": [ { "rawText" } ] } ], ... }
 *
 * In both `show` shapes a stable-ID comment that is placed correctly is the
 * FIRST line of `requirement.text` / `scenario.rawText` (ADR-0015, spike S1).
 */
import spawnCjs from "cross-spawn";

// `cross-spawn` is CommonJS with `export =`.
const spawn = spawnCjs as unknown as typeof import("cross-spawn");

let availability: boolean | null = null;

/** True when `openspec --version` runs. Cached for the lifetime of the process. */
export function openspecAvailable(): boolean {
  if (availability !== null) return availability;
  const proc = spawn.sync("openspec", ["--version"], { encoding: "utf8" });
  // `spawn.sync` reports no failure as `error: null`, not `undefined`.
  availability = proc.error == null && proc.status === 0;
  return availability;
}

export interface OpenspecRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  json: unknown;
}

/** Runs `openspec` with the given arguments in `cwd` and parses `--json` output. */
export function runOpenspec(args: string[], cwd: string): OpenspecRun {
  const proc = spawn.sync("openspec", args, { cwd, encoding: "utf8" });
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  if (proc.error != null || proc.status !== 0) {
    return { ok: false, stdout, stderr, json: undefined };
  }
  // OpenSpec prints deprecation warnings before the JSON body; start at the
  // first `{` or `[` so those lines do not break the parse.
  const start = stdout.search(/[[{]/);
  if (start < 0) return { ok: true, stdout, stderr, json: undefined };
  try {
    return { ok: true, stdout, stderr, json: JSON.parse(stdout.slice(start)) };
  } catch {
    return { ok: true, stdout, stderr, json: undefined };
  }
}
