/**
 * Form of a pull request (ADR-0033 п. 10) — a CI step of pull requests:
 *
 *   node scripts/dev/pr-form.js <head-ref> <base-ref>
 *
 * Checks the branch prefix and the subjects of the PR's commits (`git log --no-merges origin/<base>..HEAD`); decisions —
 * `checkPr` in pr-form-lib.js. Exit 0 — the form holds; 1 — problems, one per line as GitHub `::error::` annotations;
 * 2 — usage or git failed.
 */
import { execFileSync } from "node:child_process";

import { checkPr } from "./pr-form-lib.js";

const [head, base] = process.argv.slice(2);
if (!head || !base) {
  console.error("usage: node scripts/dev/pr-form.js <head-ref> <base-ref>");
  process.exit(2);
}
let subjects;
try {
  const out = execFileSync("git", ["log", "--no-merges", "--format=%s", `origin/${base}..HEAD`], { encoding: "utf8", windowsHide: true });
  subjects = out.split(/\r?\n/).filter((s) => s !== "");
} catch (e) {
  console.error(`pr-form: git log failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(2);
}
const problems = checkPr(head, subjects);
for (const p of problems) console.log(`::error::${p}`);
if (problems.length === 0) console.log(`pr-form: ${head} — branch and ${subjects.length} commit subject(s) ok`);
process.exit(problems.length === 0 ? 0 : 1);
