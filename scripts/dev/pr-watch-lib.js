/**
 * Status of a pull request from `gh pr view --json` — pure, for `scripts/dev/pr-watch.js` and its unit test.
 *
 * A check of `statusCheckRollup` is a CheckRun (`status`, `conclusion`) or a StatusContext (`state`); it becomes
 * `pass`, `fail`, `pending` or `skipped`. The verdict of the PR:
 *   merged    — merged (terminal);
 *   closed    — closed without merge (terminal);
 *   conflict  — does not merge into its base (terminal until the branch is updated);
 *   failed    — a check failed (terminal: someone has to act);
 *   green     — every check passed, no auto-merge (terminal: waits for a merge);
 *   merging   — every check passed, auto-merge on (GitHub merges shortly; stuck at `CLEAN` — the line names `gh pr merge`);
 *   pending   — checks run or have not started.
 * The run of a check comes from its URL (`…/actions/runs/<run>/job/<job>`): a failed check names the run to re-run.
 */

const FAIL_CONCLUSIONS = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
const SKIP_CONCLUSIONS = new Set(["SKIPPED", "NEUTRAL"]);

/** One check of the rollup → `pass` | `fail` | `pending` | `skipped`. */
export function checkState(check) {
  if (check.state !== undefined && check.status === undefined) {
    if (check.state === "SUCCESS") return "pass";
    if (check.state === "FAILURE" || check.state === "ERROR") return "fail";
    return "pending";
  }
  if (check.status !== "COMPLETED") return "pending";
  if (check.conclusion === "SUCCESS") return "pass";
  if (SKIP_CONCLUSIONS.has(check.conclusion)) return "skipped";
  if (FAIL_CONCLUSIONS.has(check.conclusion)) return "fail";
  return "pending";
}

/** The run id in the URL of a check; null without one. */
export function runOf(url) {
  const m = /\/actions\/runs\/(\d+)/.exec(url ?? "");
  return m ? m[1] : null;
}

/** The status of one PR from the JSON of `gh pr view --json <PR_FIELDS>`. */
export function prStatus(pr) {
  const checks = (pr.statusCheckRollup ?? []).map((c) => ({
    name: c.name ?? c.context ?? "?",
    state: checkState(c),
    run: runOf(c.detailsUrl ?? c.targetUrl)
  }));
  const failing = checks.filter((c) => c.state === "fail");
  const autoMerge = pr.autoMergeRequest?.enabledBy?.login ?? (pr.autoMergeRequest ? "?" : null);
  let verdict;
  if (pr.state === "MERGED") verdict = "merged";
  else if (pr.state === "CLOSED") verdict = "closed";
  else if (pr.mergeable === "CONFLICTING") verdict = "conflict";
  else if (failing.length > 0) verdict = "failed";
  else if (checks.length > 0 && checks.every((c) => c.state === "pass" || c.state === "skipped")) verdict = autoMerge ? "merging" : "green";
  else verdict = "pending";
  return {
    number: pr.number,
    title: pr.title ?? "",
    url: pr.url ?? "",
    verdict,
    terminal: !["pending", "merging"].includes(verdict),
    mergedBy: pr.mergedBy?.login ?? null,
    autoMerge,
    mergeState: pr.mergeStateStatus ?? null,
    checks,
    failing
  };
}

/** One line for a person: `#N verdict  pass/fail/pending  [auto: login | merged by login]  title`, then failing checks. */
export function formatStatus(s) {
  const count = (state) => s.checks.filter((c) => c.state === state).length;
  const who = s.mergedBy ? `merged by ${s.mergedBy}` : s.autoMerge ? `auto: ${s.autoMerge}` : "";
  const head = `#${s.number} ${s.verdict.padEnd(8)} ${count("pass")}✓ ${count("fail")}✗ ${count("pending")}…${who ? `  ${who}` : ""}  ${s.title}`;
  const stuck = s.verdict === "merging" && s.mergeState === "CLEAN" ? `\n    CLEAN: not merged in a minute — gh pr merge ${s.number} --merge` : "";
  const tail = stuck + s.failing.map((c) => `\n    ✗ ${c.name}${c.run ? ` — gh run view ${c.run} --log-failed` : ""}`).join("");
  return head + tail;
}

/** Exit code of a watch: 1 — a PR failed or conflicts; 2 — a PR closed unmerged; 0 — the rest (merged, green, merging). */
export function exitCode(statuses) {
  if (statuses.some((s) => s.verdict === "failed" || s.verdict === "conflict")) return 1;
  if (statuses.some((s) => s.verdict === "closed")) return 2;
  return 0;
}

/** The fields `pr-watch.js` asks `gh pr view --json` for. */
export const PR_FIELDS = "number,title,url,state,mergeable,mergeStateStatus,mergedBy,autoMergeRequest,statusCheckRollup";
