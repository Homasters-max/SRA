/**
 * Code-search hook (D-3; the rules — .claude/skills/code-search/SKILL.md, ADR-0028). Claude Code runs it with the hook
 * input JSON on stdin:
 *
 *   node scripts/dev/cs-hook.js subagent-start   SubagentStart: the rule + `cs map` as additionalContext
 *   node scripts/dev/cs-hook.js pre-tool         PreToolUse: deny a subagent's call that deviates from the rules (ADR-0031)
 *   node scripts/dev/cs-hook.js post-tool        PostToolUse: a warning for what only the call's output shows
 *
 * Decisions — `hookResponse` in cs-hook-lib.js (pure); this file is only IO. A hook must never break a session: any
 * failure → exit 0 and no output (the call is allowed); stdout is valid JSON or nothing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Forward slashes; Git Bash `/d/x` → `D:/x` on Windows (the detector joins paths with the call's cwd). */
function nativePath(p) {
  const s = String(p).replace(/\\/g, "/");
  return process.platform === "win32" ? s.replace(/^\/([a-zA-Z])(?=\/|$)/, (_, d) => `${d.toUpperCase()}:`) : s;
}

/** Work-tree root: nearest ancestor (or the path itself) with `.git` (a directory, or a file in a linked worktree). */
function findRoot(dir) {
  let d = path.resolve(nativePath(dir));
  for (;;) {
    if (existsSync(path.join(d, ".git"))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

function fileLines(p) {
  const text = readFileSync(nativePath(p), "utf8");
  if (text === "") return 0;
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

function csMap(root) {
  const r = spawnSync(process.execPath, [path.join(nativePath(root), "scripts", "dev", "cs.js"), "map"], {
    cwd: nativePath(root),
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  return r.status === 0 && typeof r.stdout === "string" ? r.stdout : null;
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
  // fast path: the main session's calls (most of them) never load the detector — hookResponse says nothing for them
  if ((event === "pre-tool" || event === "post-tool") && !input?.agent_id) return;
  const { hookResponse } = await import("./cs-hook-lib.js");
  const res = hookResponse(event, input, { env: process.env, findRoot, exists: (p) => existsSync(nativePath(p)), csMap, fileLines });
  if (res) process.stdout.write(JSON.stringify(res));
}

main().catch(() => {
  process.exitCode = 0;
});
