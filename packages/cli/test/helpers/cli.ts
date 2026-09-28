import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const REPO_ROOT = path.resolve(CLI_ROOT, "..", "..");
export const BIN = path.join(CLI_ROOT, "dist", "bin", "warrant.js");

/**
 * Version of the bundled pack `core-sdd`, read from its manifest: tests never
 * spell it, so a bump (R-14) does not touch them.
 */
export const CORE_SDD_VERSION: string = (
  JSON.parse(readFileSync(path.join(REPO_ROOT, "packs", "core-sdd", "pack.json"), "utf8")) as { version: string }
).version;

/** A caret range of `core-sdd` that accepts the bundled version: `^<major>.<minor>`. */
export const CORE_SDD_RANGE = `^${CORE_SDD_VERSION.split(".").slice(0, 2).join(".")}`;

export interface CliRun {
  status: number;
  stdout: string;
  stderr: string;
  json: any;
}

/**
 * Runs the built CLI with stdout redirected (non-TTY), parsing the envelope.
 *
 * Asynchronous on purpose: a synchronous child process blocks the vitest
 * worker's event loop, so the reporter RPC (`onTaskUpdate`) times out on the
 * long e2e runs even though every test passes. `input`, when given, is the
 * whole of stdin (`warrant guard`); otherwise stdin stays open and unread.
 */
export function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}, input?: string): Promise<CliRun> {
  return new Promise<CliRun>((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env: { ...process.env, ...env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    if (input !== undefined) child.stdin.end(input, "utf8");
    child.on("close", (code) => {
      let json: any = undefined;
      if (stdout.trim().length > 0) {
        try {
          json = JSON.parse(stdout);
        } catch {
          json = undefined;
        }
      }
      // No envelope, a non-zero exit and something on stderr: the binary failed before it could answer
      // (BL-89; `--help` answers on stderr with 0). The assertion shows only `undefined`, so the cause goes
      // to the stderr of the test, which the reporters keep.
      if (json === undefined && code !== 0 && stderr.trim().length > 0) {
        process.stderr.write(`runCli ${args.join(" ")} (cwd ${cwd}): exit ${String(code)}, no JSON on stdout; stderr:\n${stderr}\n`);
      }
      resolve({ status: code ?? -1, stdout, stderr, json });
    });
  });
}

export function makeTempDir(prefix = "warrant-"): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
