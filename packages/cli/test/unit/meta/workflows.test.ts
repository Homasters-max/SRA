/**
 * The job `warrant` of this repository is the reusable workflow `.github/workflows/warrant.yml` (lattice-issues, design
 * §7, REQ-VER-014, ADR-0044 п. 7): `ci.yml` calls it with `warrant: checkout` and keeps no steps of its own, so projects
 * under WARRANT and this repository run one job. YAML is read by lines and indentation — the workflows are block style
 * without anchors or flow maps where it matters — so the test adds no dependency.
 *
 * Level `unit`: reads files, starts no process.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../../helpers/cli.js";

interface Line {
  indent: number;
  text: string;
}

/** Significant lines of a YAML file: no blanks, no whole-line comments. */
function yamlLines(rel: string): Line[] {
  const text = readFileSync(path.join(REPO_ROOT, ...rel.split("/")), "utf8");
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"))
    .map((line) => ({ indent: line.length - line.trimStart().length, text: line.trim() }));
}

/** The child lines of the key path, each key a direct child of the previous one; null when a key is missing. */
function block(lines: Line[], keys: string[]): Line[] | null {
  let scope = lines;
  let parent = -1;
  for (const key of keys) {
    const level = Math.min(...scope.filter((l) => l.indent > parent).map((l) => l.indent));
    const at = scope.findIndex((l) => l.indent === level && (l.text === `${key}:` || l.text.startsWith(`${key}: `)));
    if (at < 0) return null;
    const own = scope[at]!;
    const end = scope.findIndex((l, i) => i > at && l.indent <= own.indent);
    scope = scope.slice(at + 1, end < 0 ? scope.length : end);
    parent = own.indent;
  }
  return scope;
}

/** The value of a direct `key: value` child of the block. */
function value(lines: Line[] | null, key: string): string | undefined {
  if (lines === null || lines.length === 0) return undefined;
  const level = Math.min(...lines.map((l) => l.indent));
  const line = lines.find((l) => l.indent === level && l.text.startsWith(`${key}:`));
  return line?.text.slice(key.length + 1).trim().replace(/^"(.*)"$/, "$1");
}

/** The direct keys of the block. */
function keysOf(lines: Line[] | null): string[] {
  if (lines === null || lines.length === 0) return [];
  const level = Math.min(...lines.map((l) => l.indent));
  return lines.filter((l) => l.indent === level).map((l) => /^([^:\s]+):/.exec(l.text)?.[1] ?? l.text);
}

/** The names of the steps in order (`- name:` of each item; an unnamed item — its `uses`). */
function stepNames(steps: Line[] | null): string[] {
  if (steps === null) return [];
  const level = Math.min(...steps.map((l) => l.indent));
  const names: string[] = [];
  steps.forEach((l, i) => {
    if (l.indent !== level || !l.text.startsWith("- ")) return;
    const end = steps.findIndex((m, j) => j > i && m.indent <= level);
    const item = [{ indent: l.indent + 2, text: l.text.slice(2) }, ...steps.slice(i + 1, end < 0 ? steps.length : end)];
    names.push(value(item, "name") ?? value(item, "uses") ?? "");
  });
  return names;
}

const reusable = yamlLines(".github/workflows/warrant.yml");
const ci = yamlLines(".github/workflows/ci.yml");

describe("job warrant — the reusable workflow warrant.yml, called by ci.yml (REQ-VER-014)", () => {
  it("SCN-VER-122 warrant.yml declares workflow_call with the inputs, `warrant` required", () => {
    const inputs = block(reusable, ["on", "workflow_call", "inputs"]);
    expect(keysOf(inputs).sort()).toEqual(["merge_commit", "node-version", "openspec-version", "setup", "warrant"]);
    expect(value(block(reusable, ["on", "workflow_call", "inputs", "warrant"]), "required")).toBe("true");
    for (const optional of ["setup", "node-version", "openspec-version", "merge_commit"]) {
      expect(value(block(reusable, ["on", "workflow_call", "inputs", optional]), "required"), optional).toBe("false");
    }
    expect(value(block(reusable, ["on", "workflow_call", "inputs", "node-version"]), "default")).toBe("22");
    expect(value(block(reusable, ["on", "workflow_call", "inputs", "openspec-version"]), "default")).toBe("1.13.1");
  });

  it("SCN-VER-122 warrant.yml checks the input `warrant` before the CLI is installed, then runs `warrant ci`", () => {
    const steps = stepNames(block(reusable, ["jobs", "warrant", "steps"]));
    const check = steps.indexOf("Check the input warrant");
    const install = steps.indexOf("Install warrant");
    const run = steps.indexOf("warrant ci");
    expect(check, steps.join(" | ")).toBeGreaterThanOrEqual(0);
    expect(install).toBeGreaterThan(check);
    expect(run).toBeGreaterThan(install);
    expect(steps.indexOf("Upload evidence")).toBeGreaterThan(run);
  });

  it("SCN-VER-122 ci.yml: job warrant uses ./.github/workflows/warrant.yml with warrant: checkout, no steps, read rights", () => {
    const job = block(ci, ["jobs", "warrant"]);
    expect(job).not.toBeNull();
    expect(value(job, "uses")).toBe("./.github/workflows/warrant.yml");
    expect(keysOf(job)).not.toContain("steps");
    expect(value(block(ci, ["jobs", "warrant", "with"]), "warrant")).toBe("checkout");
    expect(value(block(ci, ["jobs", "warrant", "with"]), "setup")).toBe("npm ci");
    expect(value(block(ci, ["jobs", "warrant", "with"]), "merge_commit")).toMatch(/^\$\{\{ inputs\.merge_commit\b/);
    const permissions = block(ci, ["jobs", "warrant", "permissions"]);
    expect(Object.fromEntries(keysOf(permissions).map((key) => [key, value(permissions, key)]))).toEqual({
      contents: "read",
      actions: "read",
      "pull-requests": "read",
      issues: "read",
    });
  });
});

/** The lines of the step item `- name: <name>` without its first line; null when there is no such step. */
function stepBlock(steps: Line[] | null, name: string): Line[] | null {
  if (steps === null) return null;
  const level = Math.min(...steps.map((l) => l.indent));
  const at = steps.findIndex((l) => l.indent === level && l.text === `- name: ${name}`);
  if (at < 0) return null;
  const end = steps.findIndex((l, i) => i > at && l.indent <= level);
  return steps.slice(at + 1, end < 0 ? steps.length : end);
}

/** The items of a YAML list of flat mappings (`- os: x` then `shard: y`) as objects. */
function listItems(lines: Line[] | null): Record<string, string>[] {
  if (lines === null) return [];
  const items: Record<string, string>[] = [];
  for (const l of lines) {
    const text = l.text.startsWith("- ") ? l.text.slice(2) : l.text;
    if (l.text.startsWith("- ")) items.push({});
    const m = /^([^:\s]+):\s*(.*)$/.exec(text);
    if (m && items.length > 0) items[items.length - 1]![m[1]!] = m[2]!.replace(/^"(.*)"$/, "$1");
  }
  return items;
}

describe("job test — windows by two vitest shards (REQ-VER-015)", () => {
  const steps = block(ci, ["jobs", "test", "steps"]);

  it("SCN-VER-124 matrix: ubuntu without a shard, windows 1/2 and 2/2, fail-fast off", () => {
    expect(value(block(ci, ["jobs", "test", "strategy"]), "fail-fast")).toBe("false");
    expect(listItems(block(ci, ["jobs", "test", "strategy", "matrix", "include"]))).toEqual([
      { os: "ubuntu-latest", shard: "" },
      { os: "windows-latest", shard: "1/2" },
      { os: "windows-latest", shard: "2/2" },
    ]);
  });

  it("SCN-VER-124 the name and --shard carry the shard only when it is not empty", () => {
    expect(value(block(ci, ["jobs", "test"]), "name")).toBe(
      "test (${{ matrix.os }}${{ matrix.shard && format(', {0}', matrix.shard) || '' }})",
    );
    const test = stepBlock(steps, "Test");
    expect(value(test, "run")).toBe("npm test -- ${SHARD:+--shard=$SHARD}");
    expect(value(block(test ?? [], ["env"]), "SHARD")).toBe("${{ matrix.shard }}");
    expect(value(test, "if")).toBeUndefined();
  });

  it("SCN-VER-124 typecheck, install and validate run once per OS: in ubuntu and shard 1/2, skipped in 2/2", () => {
    for (const name of [
      "Typecheck",
      "Install warrant from the checkout",
      "warrant validate (repository)",
      "warrant validate (fixture project)",
    ]) {
      expect(value(stepBlock(steps, name), "if"), name).toBe("matrix.shard != '2/2'");
    }
  });
});
