#!/usr/bin/env node
/**
 * Watch pull requests until each reaches a terminal state — a development tool (not shipped):
 *
 *   node scripts/dev/pr-watch.js                  open PRs of the gh account (`--author @me`)
 *   node scripts/dev/pr-watch.js 106 109          these PRs
 *   node scripts/dev/pr-watch.js 109 --once       one snapshot, no waiting
 *   options: --interval <s> (30), --timeout <s> (3600), --json (final statuses as JSON), --repo <owner/name>
 *
 * Prints a line when the status of a PR changes (pr-watch-lib.js: merged, closed, conflict, failed, green, merging,
 * pending); a failed check names its run (`gh run view <run> --log-failed`). Only reads through `gh`: never re-runs,
 * merges or comments. Exit 0 — every PR merged, green or merging; 1 — a PR failed or conflicts; 2 — a PR closed
 * unmerged, the timeout passed, `gh` failed or usage.
 */
import { spawnSync } from "node:child_process";

import { PR_FIELDS, exitCode, formatStatus, prStatus } from "./pr-watch-lib.js";

function usage(message) {
  console.error(`pr-watch: ${message}\nusage: node scripts/dev/pr-watch.js [<number>...] [--once] [--interval <s>] [--timeout <s>] [--json] [--repo <owner/name>]`);
  process.exit(2);
}

const args = process.argv.slice(2);
const numbers = [];
const opts = { once: false, json: false, interval: 30, timeout: 3600, repo: null };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--once") opts.once = true;
  else if (a === "--json") opts.json = true;
  else if (a === "--interval" || a === "--timeout") {
    const v = Number(args[++i]);
    if (!Number.isFinite(v) || v <= 0) usage(`${a} needs a positive number of seconds`);
    opts[a.slice(2)] = v;
  } else if (a === "--repo") {
    opts.repo = args[++i] ?? usage("--repo needs <owner/name>");
  } else if (/^\d+$/.test(a)) numbers.push(Number(a));
  else usage(`unknown argument ${a}`);
}

function gh(ghArgs) {
  const run = spawnSync("gh", [...ghArgs, ...(opts.repo ? ["--repo", opts.repo] : [])], { encoding: "utf8", windowsHide: true });
  if (run.error || run.status !== 0) {
    console.error(`pr-watch: gh ${ghArgs.join(" ")} failed: ${run.error?.message ?? run.stderr.trim()}`);
    process.exit(2);
  }
  return JSON.parse(run.stdout);
}

if (numbers.length === 0) {
  for (const pr of gh(["pr", "list", "--author", "@me", "--state", "open", "--json", "number"])) numbers.push(pr.number);
  if (numbers.length === 0) {
    console.log("pr-watch: no open PRs of this gh account");
    process.exit(0);
  }
}

const sleep = (s) => new Promise((resolve) => setTimeout(resolve, s * 1000));
const last = new Map();
const started = Date.now();
let statuses = [];
for (;;) {
  statuses = numbers.map((n) => prStatus(gh(["pr", "view", String(n), "--json", PR_FIELDS])));
  for (const s of statuses) {
    const line = formatStatus(s);
    if (last.get(s.number) !== line) {
      if (!opts.json) console.log(`${new Date().toISOString().slice(11, 19)}  ${line}`);
      last.set(s.number, line);
    }
  }
  if (opts.once || statuses.every((s) => s.terminal)) break;
  if ((Date.now() - started) / 1000 >= opts.timeout) {
    console.error(`pr-watch: timeout ${opts.timeout} s; not terminal: ${statuses.filter((s) => !s.terminal).map((s) => `#${s.number}`).join(", ")}`);
    if (opts.json) console.log(JSON.stringify(statuses, null, 2));
    process.exit(2);
  }
  await sleep(opts.interval);
}
if (opts.json) console.log(JSON.stringify(statuses, null, 2));
process.exitCode = exitCode(statuses);
