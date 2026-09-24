/**
 * `branch-isolated`: the work happens on a branch of its own — the checked-out
 * branch exists (HEAD is not detached) and is not the base branch `main`
 * (ADR-0011, REQ-VER-004, SCN-VER-023).
 */
import { BASE_BRANCH } from "../../git/facts.js";
import { noInput, pass, type Calculator } from "./types.js";

export const branchIsolated: Calculator = (ctx) => {
  if (!ctx.signals.branch.ok) return noInput(ctx.gate, `branch unknown: ${ctx.signals.branch.reason}`);
  const branch = ctx.signals.branch.value;
  if (branch === "HEAD") {
    return {
      verdict: "FAIL",
      findings: [{ code: "BRANCH_NOT_ISOLATED", gate: ctx.gate, items: ["HEAD"], message: "HEAD is detached: no branch is checked out" }]
    };
  }
  if (branch === BASE_BRANCH) {
    return {
      verdict: "FAIL",
      findings: [
        {
          code: "BRANCH_NOT_ISOLATED",
          gate: ctx.gate,
          items: [branch],
          message: `the work is on the base branch ${BASE_BRANCH}; use a branch of its own (worktree/<change>)`
        }
      ]
    };
  }
  return pass();
};
