/**
 * Scenario steps of the `warrant ci` tests (A-37): the record of `add-search`
 * moved along, a pull request merged into `main` by a merge commit, a directory
 * as `actions/upload-artifact` uploads it. `ci.test.ts` and `ci-fetch.test.ts`
 * share them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import type { ProjectBuilder } from "./project-builder.js";

/** The record of the Change of the scenarios. */
export const RECORD = ".warrant/changes/add-search.json";
/** `effective_policy_hash` of a transition the scenario writes by hand. */
export const HASH = `sha256:${"0".repeat(64)}`;
/** `at` of a transition the scenario writes by hand. */
export const AT = "2026-09-25T10:00:00Z";

/** Appends a transition to the record of `add-search` in the working tree; `ABANDONED` carries no policy hash and gates. */
export function advance(p: ProjectBuilder, to: string, fields: Record<string, unknown> = {}): void {
  const record = p.json(RECORD);
  const forward = to !== "ABANDONED";
  record.transitions.push({ to, at: AT, by: "cli:local", ...(forward ? { effective_policy_hash: HASH, gates: {} } : {}), ...fields });
  record.change_state = to;
  p.write(RECORD, record);
}

/** A pull request: branch `name` from `main` (unless on it), `work` on it, one commit; `main` merges it with a merge commit. */
export function pullRequest(p: ProjectBuilder, name: string, work: (p: ProjectBuilder) => void): { head: string; merge: string } {
  if (p.git.current !== name) p.branch(name, "main");
  work(p);
  const head = p.commit(`${name}: head`);
  p.checkout("main", { force: true });
  const merge = p.merge(name, { label: `Merge ${name}` });
  return { head, merge };
}

/** The files of the directory `rel` as `actions/upload-artifact` uploads it: POSIX path → bytes. */
export function artifactOf(p: ProjectBuilder, rel: string): Record<string, Buffer> {
  const dir = path.join(p.root, rel);
  const out: Record<string, Buffer> = {};
  for (const entry of readdirSync(dir, { recursive: true }) as string[]) {
    const file = path.join(dir, entry);
    if (statSync(file).isFile()) out[entry.split(path.sep).join("/")] = readFileSync(file);
  }
  return out;
}
