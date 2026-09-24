/**
 * Git hook (ADR-0033 п. 9): `scripts/dev/git-hook-lib.js` denies, for the main session and subagents, git calls that
 * write history or leave `main` in the main checkout, force push anywhere and `openspec archive` anywhere — by the
 * command text, IO (git dirs) injected, inert outside a git work tree.
 */
import { describe, expect, it } from "vitest";

import { hookResponse, RULES, simpleCommands } from "../../../../../scripts/dev/git-hook-lib.js";

const MAIN = "D:/project/SRA";
const WT = "D:/project/SRA-x";
const OTHER = "D:/other";

type Io = Parameters<typeof hookResponse>[2];

/** Main checkout D:/project/SRA, its worktree D:/project/SRA-x, an unrelated repo D:/other. */
function io(over: Partial<Record<string, unknown>> = {}): Io {
  const norm = (d: string) => d.replace(/\\/g, "/").replace(/\/+$/, "").replace(/\/[^/]+\/\.\.(?=\/|$)/g, "");
  return {
    env: { CLAUDE_PROJECT_DIR: MAIN },
    gitDirs: (dir: string) => {
      const d = norm(dir).toLowerCase();
      if (d.startsWith(WT.toLowerCase())) return { gitDir: `${MAIN}/.git/worktrees/SRA-x`, commonDir: `${MAIN}/.git` };
      if (d.startsWith(MAIN.toLowerCase())) return { gitDir: `${MAIN}/.git`, commonDir: `${MAIN}/.git` };
      if (d.startsWith(OTHER.toLowerCase())) return { gitDir: `${OTHER}/.git`, commonDir: `${OTHER}/.git` };
      return null;
    },
    ...over,
  } as Io;
}

const call = (command: string, cwd = MAIN, tool_name = "Bash", extra: Record<string, unknown> = {}) => ({
  session_id: "s",
  cwd,
  hook_event_name: "PreToolUse",
  tool_name,
  tool_input: { command },
  ...extra,
});

const rulesOf = (res: ReturnType<typeof hookResponse>) =>
  res ? [...res.hookSpecificOutput.permissionDecisionReason.matchAll(/git-hook: ([a-z-]+)/g)].map((m) => m[1]) : [];

describe("git-hook — ADR-0033 п. 9", () => {
  it.each([
    // main checkout: history and branch switches
    ["git commit -m x", MAIN, ["main-checkout"]],
    ["git add -A && git commit -F msg.txt", MAIN, ["main-checkout"]],
    ["git merge feature/x", MAIN, ["main-checkout"]],
    ["git cherry-pick abc123", MAIN, ["main-checkout"]],
    ["git revert HEAD", MAIN, ["main-checkout"]],
    ["git pull", MAIN, ["main-checkout"]],
    ["git checkout -b process/x", MAIN, ["main-checkout"]],
    ["git checkout spec/x", MAIN, ["main-checkout"]],
    ["git switch process/x", MAIN, ["main-checkout"]],
    ["git switch -c process/x", MAIN, ["main-checkout"]],
    ["git -C D:/project/SRA commit -m x", WT, ["main-checkout"]],
    ["cd D:/project/SRA && git commit -m x", WT, ["main-checkout"]],
    ["cd ../SRA && git commit -m x", WT, ["main-checkout"]],
    ["git -c user.name=x commit -m y", MAIN, ["main-checkout"]],
    // force push and openspec archive — anywhere
    ["git push --force origin x", WT, ["force-push"]],
    ["git push -f", WT, ["force-push"]],
    ["git push --force-with-lease=x:abc origin x", WT, ["force-push"]],
    ["git push origin +x:x", WT, ["force-push"]],
    ["openspec archive my-change --yes", WT, ["openspec-archive"]],
    ["npx openspec archive my-change", WT, ["openspec-archive"]],
    ["npx @fission-ai/openspec@1.13.1 archive my-change", WT, ["openspec-archive"]],
    ["FOO=1 openspec archive x", WT, ["openspec-archive"]],
    ["git commit -m x; git push --force", MAIN, ["main-checkout", "force-push"]],
  ])("denies %s (cwd %s)", (command, cwd, rules) => {
    expect(rulesOf(hookResponse("pre-tool", call(command, cwd), io())).sort()).toEqual([...rules].sort());
  });

  it.each([
    ["git pull --ff-only", MAIN],
    ["git fetch --prune", MAIN],
    ["git status --short && git log --oneline -3", MAIN],
    ["git worktree add ../SRA-y -b process/y origin/main", MAIN],
    ["git worktree remove ../SRA-y", MAIN],
    ["git branch -d process/y", MAIN],
    ["git push origin --delete process/y", MAIN],
    ["git checkout main", MAIN],
    ["git switch main", MAIN],
    ["git checkout -- docs/x.md", MAIN],
    ["git checkout HEAD -- docs/x.md", MAIN],
    ["git restore docs/x.md", MAIN],
    ["git merge --abort", MAIN],
    ["git commit -F msg.txt", WT],
    ["git checkout -b process/z", WT],
    ["git pull", WT],
    ["cd D:/project/SRA-x && git commit -m x", MAIN],
    ["git -C D:/project/SRA-x commit -m x", MAIN],
    ["git commit -m x", OTHER],
    ["git push -u origin process/x", WT],
    ["git push origin --delete process/x", WT],
    ['git log --grep "openspec archive"', WT],
    ['grep -rn "openspec archive" docs', WT],
    ['echo "git commit" > note.txt', MAIN],
    ['git commit -m "fix; git push --force"', WT],
    ["node packages/cli/dist/bin/warrant.js archive my-change", WT],
  ])("allows %s (cwd %s)", (command, cwd) => {
    expect(hookResponse("pre-tool", call(command, cwd), io())).toBeNull();
  });

  it("PowerShell is checked the same way", () => {
    expect(rulesOf(hookResponse("pre-tool", call("Set-Location D:\\project\\SRA; git commit -m x", WT, "PowerShell"), io()))).toEqual(["main-checkout"]);
  });

  it("the main session and subagents alike; the reason names what to do instead", () => {
    const res = hookResponse("pre-tool", call("openspec archive x", WT, "Bash", { agent_id: "a1" }), io());
    expect(res?.hookSpecificOutput).toMatchObject({ hookEventName: "PreToolUse", permissionDecision: "deny" });
    expect(res?.hookSpecificOutput.permissionDecisionReason).toContain("warrant archive <change>");
  });

  it("inert for other tools, other events, no project repo, or a failing git", () => {
    expect(hookResponse("pre-tool", { ...call("git commit -m x"), tool_name: "Read" }, io())).toBeNull();
    expect(hookResponse("post-tool", call("git commit -m x"), io())).toBeNull();
    expect(hookResponse("pre-tool", call("git commit -m x", "D:/nowhere"), io({ env: { CLAUDE_PROJECT_DIR: "D:/nowhere" } }))).toBeNull();
    const failing = io({
      gitDirs: () => {
        throw new Error("spawn failed");
      },
    });
    expect(hookResponse("pre-tool", call("git commit -m x"), failing)).toBeNull();
  });

  it("splits simple commands outside quotes", () => {
    expect(simpleCommands(`a "b; c" && d 'e|f' | g\nh`)).toEqual([["a", "b; c"], ["d", "e|f"], ["g"], ["h"]]);
  });

  it("every rule says what it protects and what to do instead", () => {
    for (const rule of Object.values(RULES)) {
      expect(rule.what).toMatch(/ADR-0033 п\. 9/);
      expect(rule.instead.length).toBeGreaterThan(0);
    }
  });
});
