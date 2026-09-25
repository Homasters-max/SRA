/**
 * Context Pack of a Run (ADR-0022 п. 6, F17, REQ-ENF-002): the JSON of
 * `run start`, no file of its own.
 *
 * - `rules[]` — the `rule/1` rules of which at least one existing project
 *   file lies inside the Run (`write_scope` and a non-empty `scope`);
 * - `items[]` — the existing `proposal.md`, `specs/**`, `design.md`,
 *   `tasks.md` of the Change, each with the hash of its bytes;
 * - `context_hash` — the canonical hash of `{ items, rules }`.
 *
 * Only the directories a `write_scope` glob can match under are walked.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { bytesHash, canonicalHash } from "../canon/hash.js";
import { projectPath, walkFiles } from "../fs.js";
import { pathMatcher } from "../glob.js";
import type { LoadedRule } from "../packs/types.js";
import { globBase, scopeMatcher } from "./scope.js";

export interface PackRule {
  id: string;
  paths: string[];
  text: string;
  enforced_by?: string;
}

export interface PackItem {
  path: string;
  hash: string;
}

export interface ContextPack {
  rules: PackRule[];
  items: PackItem[];
  context_hash: string;
}

export interface ContextPackInput {
  root: string;
  change: string;
  rules: readonly LoadedRule[];
  writeScope: readonly string[];
  scope: readonly string[];
}

/** Existing project files under the bases of `writeScope`, POSIX, sorted, without duplicates. */
function filesUnder(root: string, writeScope: readonly string[]): string[] {
  const files = new Set<string>();
  for (const base of new Set(writeScope.map(globBase))) {
    const absolute = path.join(root, ...base.split("/").filter((s) => s !== ""));
    if (!existsSync(absolute)) continue;
    const found = statSync(absolute).isDirectory() ? walkFiles(absolute) : [absolute];
    for (const file of found) {
      const rel = projectPath(root, file);
      if (rel !== undefined && rel !== "") files.add(rel);
    }
  }
  return [...files].sort();
}

/** The rules of which some existing file lies inside the Run, in the order of `rules`. */
export function rulesInScope(input: Omit<ContextPackInput, "change">): PackRule[] {
  const inside = scopeMatcher(input.writeScope, input.scope);
  const files = filesUnder(input.root, input.writeScope).filter(inside);
  return input.rules
    .filter((rule) => {
      const matches = pathMatcher(rule.paths);
      return files.some(matches);
    })
    .map((rule) => ({
      id: rule.id,
      paths: [...rule.paths],
      text: rule.text,
      ...(rule.enforcedBy === undefined ? {} : { enforced_by: rule.enforcedBy })
    }));
}

/** The artifacts of the Change the agent starts from: proposal, delta specs, design, tasks. */
export function changeItems(root: string, change: string): PackItem[] {
  const dir = `openspec/changes/${change}`;
  const absoluteDir = path.join(root, "openspec", "changes", change);
  const one = (name: string): string[] => (existsSync(path.join(absoluteDir, name)) ? [`${dir}/${name}`] : []);
  const specs = walkFiles(path.join(absoluteDir, "specs"))
    .map((file) => projectPath(root, file))
    .filter((rel): rel is string => rel !== undefined && rel !== "");
  return [...one("proposal.md"), ...specs, ...one("design.md"), ...one("tasks.md")].map((rel) => ({
    path: rel,
    hash: bytesHash(readFileSync(path.join(root, ...rel.split("/"))))
  }));
}

export function contextPack(input: ContextPackInput): ContextPack {
  const rules = rulesInScope(input);
  const items = changeItems(input.root, input.change);
  return { rules, items, context_hash: canonicalHash({ items, rules }) };
}
