/**
 * Local IO of the development state scripts `brief.js` and `hygiene.js` (ADR-0032 п. 4, ADR-0033 п. 13): git and
 * files only — no network, no `gh`, no `openspec`. Every git call — execFileSync without a shell, with a timeout;
 * a call past the deadline throws (the caller prints nothing rather than be killed by a hook timeout).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";

const GIT_TIMEOUT_MS = 3_000;

/** The `io` of brief-lib.js / hygiene-lib.js; git calls stop at `deadlineMs` from now. */
export function localIo(deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  return {
    startDir: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
    home: os.homedir().replace(/\\/g, "/"),
    today: new Date().toISOString().slice(0, 10),
    git(args, cwd) {
      const left = deadline - Date.now();
      if (left <= 0) throw new Error("local-io: deadline");
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
    exists: (p) => existsSync(p),
  };
}
