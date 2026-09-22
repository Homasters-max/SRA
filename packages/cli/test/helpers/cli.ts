import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");
export const BIN = path.join(CLI_ROOT, "dist", "bin", "warrant.js");

export interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
  json: any;
}

/** Runs the built CLI with stdout redirected (non-TTY), parsing the envelope. */
export function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}): CliRun {
  const proc = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env }
  });
  let json: any = undefined;
  if (proc.stdout.trim().length > 0) {
    try {
      json = JSON.parse(proc.stdout);
    } catch {
      json = undefined;
    }
  }
  return { status: proc.status ?? -1, stdout: proc.stdout, stderr: proc.stderr, json };
}

export function makeTempDir(prefix = "warrant-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
