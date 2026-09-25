/**
 * The real `git` for setting up test repositories of `contract`/`e2e`
 * (processes are forbidden in `unit`/`app`, ADR-0025). One identity and
 * `core.autocrlf=false` for every call: a commit does not depend on the
 * `git config` of the machine, and CRLF of Windows does not change diffs and
 * hashes (I-132). Not a port: the CLI reaches git only through
 * `adapters/git-cli.ts`.
 */
import { spawnSync } from "node:child_process";

/** Runs `git <args>` in `cwd`; returns stdout, throws with the command and stderr on a non-zero exit. */
export function git(cwd: string, ...args: string[]): string {
  const run = spawnSync(
    "git",
    ["-c", "user.name=warrant-test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false", ...args],
    { cwd, encoding: "utf8" }
  );
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout;
}
