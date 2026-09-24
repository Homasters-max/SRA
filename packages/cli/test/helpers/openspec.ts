/**
 * The real `openspec` for setting up e2e projects (`openspec init`, a first
 * Change) and for the version check of `contract`/`e2e` (`require-openspec.ts`).
 * Not a port: the CLI reaches OpenSpec only through `adapters/openspec-cli.ts`.
 * Synchronous, as the setup it serves; `contract`/`e2e` only (processes are
 * forbidden in `unit`/`app`).
 */
import spawnCjs from "cross-spawn";

// `cross-spawn` is CommonJS with `export =`; on Windows `openspec` is a `.cmd` shim.
const spawn = spawnCjs as unknown as typeof import("cross-spawn");

/** The OpenSpec version `contract`/`e2e` require and the fakes answer (ADR-0015). */
export const OPENSPEC_VERSION = "1.13.1";

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
