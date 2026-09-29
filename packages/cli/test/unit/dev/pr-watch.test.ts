/**
 * PR watch (`scripts/dev/pr-watch-lib.js`): the status of a pull request from `gh pr view --json` — checks of the
 * rollup (CheckRun and StatusContext), the verdict and whether it is terminal, the run of a failed check, the exit code.
 * Pure: the JSON is given, no process.
 */
import { describe, expect, it } from "vitest";

// @ts-expect-error — plain Node ESM of scripts/dev without types (as brief-lib.js in dev-context.test.ts).
import { checkState, exitCode, formatStatus, prStatus, runOf } from "../../../../../scripts/dev/pr-watch-lib.js";

const run = (name: string, status: string, conclusion: string | null, job = "11") => ({
  __typename: "CheckRun",
  name,
  status,
  conclusion,
  detailsUrl: `https://github.com/o/r/actions/runs/777/job/${job}`,
});
const pr = (extra: Record<string, unknown>) => ({ number: 5, title: "t", url: "u", state: "OPEN", mergeable: "MERGEABLE", ...extra });

describe("pr-watch-lib", () => {
  it("a check: CheckRun by status and conclusion, StatusContext by state", () => {
    expect(checkState(run("a", "IN_PROGRESS", null))).toBe("pending");
    expect(checkState(run("a", "COMPLETED", "SUCCESS"))).toBe("pass");
    expect(checkState(run("a", "COMPLETED", "FAILURE"))).toBe("fail");
    expect(checkState(run("a", "COMPLETED", "CANCELLED"))).toBe("fail");
    expect(checkState(run("a", "COMPLETED", "SKIPPED"))).toBe("skipped");
    expect(checkState({ context: "c", state: "SUCCESS" })).toBe("pass");
    expect(checkState({ context: "c", state: "ERROR" })).toBe("fail");
    expect(checkState({ context: "c", state: "PENDING" })).toBe("pending");
    expect(runOf("https://github.com/o/r/actions/runs/36609637983/job/1")).toBe("36609637983");
    expect(runOf("https://example.com")).toBeNull();
  });

  it("the verdict: merged and closed first, then conflict, a failed check, all green with or without auto-merge, pending", () => {
    const green = [run("test", "COMPLETED", "SUCCESS"), run("warrant", "COMPLETED", "SKIPPED")];
    expect(prStatus(pr({ state: "MERGED", mergedBy: { login: "m" }, statusCheckRollup: green }))).toMatchObject({ verdict: "merged", terminal: true, mergedBy: "m" });
    expect(prStatus(pr({ state: "CLOSED" }))).toMatchObject({ verdict: "closed", terminal: true });
    expect(prStatus(pr({ mergeable: "CONFLICTING", statusCheckRollup: green }))).toMatchObject({ verdict: "conflict", terminal: true });
    const failed = prStatus(pr({ statusCheckRollup: [...green, run("win", "COMPLETED", "FAILURE", "22")] }));
    expect(failed).toMatchObject({ verdict: "failed", terminal: true, failing: [{ name: "win", state: "fail", run: "777" }] });
    expect(prStatus(pr({ statusCheckRollup: green }))).toMatchObject({ verdict: "green", terminal: true, autoMerge: null });
    expect(prStatus(pr({ statusCheckRollup: green, autoMergeRequest: { enabledBy: { login: "bot" } } }))).toMatchObject({ verdict: "merging", terminal: false, autoMerge: "bot" });
    expect(prStatus(pr({ statusCheckRollup: [...green, run("ubuntu", "QUEUED", null)] }))).toMatchObject({ verdict: "pending", terminal: false });
    expect(prStatus(pr({ statusCheckRollup: [] }))).toMatchObject({ verdict: "pending", terminal: false });
  });

  it("a line names the failing check and the command for its log; the exit code — 1 failed or conflict, 2 closed, else 0", () => {
    const failed = prStatus(pr({ statusCheckRollup: [run("win", "COMPLETED", "FAILURE")] }));
    expect(formatStatus(failed)).toContain("#5 failed");
    expect(formatStatus(failed)).toContain("✗ win — gh run view 777 --log-failed");
    const merged = prStatus(pr({ state: "MERGED", mergedBy: { login: "m" } }));
    expect(formatStatus(merged)).toContain("merged by m");
    const stuck = prStatus(pr({ mergeStateStatus: "CLEAN", statusCheckRollup: [run("t", "COMPLETED", "SUCCESS")], autoMergeRequest: { enabledBy: { login: "bot" } } }));
    expect(formatStatus(stuck)).toContain("gh pr merge 5 --merge");
    expect(exitCode([merged, failed])).toBe(1);
    expect(exitCode([merged, prStatus(pr({ state: "CLOSED" }))])).toBe(2);
    expect(exitCode([merged, prStatus(pr({ statusCheckRollup: [run("t", "COMPLETED", "SUCCESS")] }))])).toBe(0);
  });
});
