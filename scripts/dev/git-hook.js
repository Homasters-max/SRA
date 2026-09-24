/**
 * Git hook (ADR-0033 п. 9). Claude Code runs it with the hook input JSON on stdin, for the main session and subagents:
 *
 *   node scripts/dev/git-hook.js pre-tool   PreToolUse: deny git in the main checkout, force push, `openspec archive`
 *
 * Decisions — `hookResponse` in git-hook-lib.js (pure); this file is only IO. A hook must never break a session: any
 * failure → exit 0 and no output (the call is allowed); stdout is valid JSON or nothing.
 */
import { spawnSync } from "node:child_process";

/** Forward slashes; Git Bash `/d/x` → `D:/x` on Windows (git.exe does not read MSYS paths). */
function nativePath(p) {
  const s = String(p).replace(/\\/g, "/");
  return process.platform === "win32" ? s.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`) : s;
}

/** `{ gitDir, commonDir }` of the work tree containing `dir`, or null. */
function gitDirs(dir) {
  const r = spawnSync("git", ["-C", nativePath(dir), "rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  const [gitDir, commonDir] = r.stdout.split(/\r?\n/).filter(Boolean).map(nativePath);
  return gitDir && commonDir ? { gitDir, commonDir } : null;
}

function readStdin() {
  if (process.stdin.isTTY) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (c) => chunks.push(c));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

async function main() {
  const event = process.argv[2];
  const raw = await readStdin();
  if (!raw.trim()) return;
  const input = JSON.parse(raw);
  // fast path: a command without git or openspec never loads the rules
  const command = input?.tool_input?.command;
  if (typeof command !== "string" || !/\b(git|openspec)\b/i.test(command)) return;
  const { hookResponse } = await import("./git-hook-lib.js");
  const res = hookResponse(event, { ...input, cwd: input.cwd ? nativePath(input.cwd) : input.cwd }, {
    env: { ...process.env, CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR ? nativePath(process.env.CLAUDE_PROJECT_DIR) : undefined },
    gitDirs,
  });
  if (res) process.stdout.write(JSON.stringify(res));
}

main().catch(() => {
  process.exitCode = 0;
});
