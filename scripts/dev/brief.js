/**
 * State of a WARRANT development session (ADR-0032 п. 4, 9, 11): branch and worktree of the session, uncommitted
 * changes, all worktrees with their docs/handoff/*.md, latest tag, CLI and pack versions, active Changes with open
 * tasks, merged branches not deleted, auto-memory warnings. At most 2 KB; local reads only (git and files).
 *
 *   node scripts/dev/brief.js                  manual call: prints the state
 *   node scripts/dev/brief.js session-start    SessionStart hook: the same text on stdout (it becomes session context);
 *                                              the hook input on stdin is not read
 *   node scripts/dev/brief.js --help           usage on stdout, exit 0
 *
 * Any other argument → exit 0, no output (a hook must never break a session). Logic — brief-lib.js (pure); this file
 * is only IO. Any failure or exception, and git calls running past DEADLINE_MS in total → exit 0 and empty output
 * (п. 11). Every git call — execFileSync without a shell, with a timeout. Root — `git rev-parse --show-toplevel` from
 * CLAUDE_PROJECT_DIR or cwd.
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import os from "node:os";

const GIT_TIMEOUT_MS = 3_000;
/** Under the hook's 10 s timeout: past it, give up silently rather than be killed. */
const DEADLINE_MS = 8_000;
const deadline = Date.now() + DEADLINE_MS;

const USAGE = "usage: node scripts/dev/brief.js [session-start]  — state of the WARRANT dev session (ADR-0032 п. 4)\n";

const io = {
  startDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  home: os.homedir().replace(/\\/g, "/"),
  git(args, cwd) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error("brief.js: deadline");
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        timeout: Math.min(GIT_TIMEOUT_MS, left),
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
        maxBuffer: 16 * 1024 * 1024,
      });
    } catch {
      return null;
    }
  },
  readFile(p) {
    try {
      return readFileSync(p, "utf8");
    } catch {
      return null;
    }
  },
  readDir(p) {
    try {
      return readdirSync(p, { withFileTypes: true }).map((e) => ({ name: e.name, dir: e.isDirectory() }));
    } catch {
      return null;
    }
  },
};

async function main() {
  const mode = process.argv[2];
  if (mode === "--help" || mode === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  if (mode !== undefined && mode !== "session-start") return;
  const { brief } = await import("./brief-lib.js");
  const text = brief(io);
  if (text) process.stdout.write(text);
}

main().catch(() => {
  process.exitCode = 0;
});
