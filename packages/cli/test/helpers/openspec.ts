/**
 * The real `openspec` for setting up e2e projects (`openspec init`, a first
 * Change) and for the skip guard of tests that need it. Not a port: the CLI
 * reaches OpenSpec only through `adapters/openspec-cli.ts`. Synchronous, as the
 * setup it serves; `contract`/`e2e` only (processes are forbidden in
 * `unit`/`app`). The skip guard goes away with task 4.3 (ADR-0025 п. 5).
 */
import spawnCjs from "cross-spawn";

// `cross-spawn` is CommonJS with `export =`; on Windows `openspec` is a `.cmd` shim.
const spawn = spawnCjs as unknown as typeof import("cross-spawn");

export interface OpenspecSyncRun {
  ok: boolean;
  stdout: string;
  stderr: string;
  json: unknown;
}

/** Runs `openspec <args>` in `cwd` and parses a `--json` body when there is one. */
export function openspecSync(args: string[], cwd: string): OpenspecSyncRun {
  const proc = spawn.sync("openspec", args, { cwd, encoding: "utf8" });
  const stdout = proc.stdout ?? "";
  const stderr = proc.stderr ?? "";
  if (proc.error != null || proc.status !== 0) return { ok: false, stdout, stderr, json: undefined };
  const start = stdout.search(/[[{]/);
  if (start < 0) return { ok: true, stdout, stderr, json: undefined };
  try {
    return { ok: true, stdout, stderr, json: JSON.parse(stdout.slice(start)) };
  } catch {
    return { ok: true, stdout, stderr, json: undefined };
  }
}

let availability: boolean | undefined;

/** True when `openspec --version` runs. Cached per test file. */
export function openspecAvailable(): boolean {
  availability ??= openspecSync(["--version"], process.cwd()).ok;
  return availability;
}
