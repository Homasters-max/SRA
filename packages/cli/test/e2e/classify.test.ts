import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

/** True when `git` runs: without it the diff source of `classify` cannot be exercised. */
function gitAvailable(): boolean {
  const proc = spawnSync("git", ["--version"], { encoding: "utf8" });
  return proc.error == null && proc.status === 0;
}

const hasGit = gitAvailable();

function git(args: string[], cwd: string): void {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (proc.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${proc.stderr}`);
}

function write(root: string, rel: string, content: string | object): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, typeof content === "string" ? content : canonicalText(content).text, "utf8");
}

/** A project on the bundled pack `core-sdd` with one PROPOSED change record. */
function project(change = "demo"): string {
  const root = makeTempDir("warrant-classify-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: { "core-sdd": { version: "^0.2" } }
  });
  write(root, `.warrant/changes/${change}.json`, {
    $schema: "warrant://change-record/1",
    change,
    change_state: "PROPOSED",
    transitions: [{ to: "PROPOSED", at: "2026-09-22T00:00:00.000Z", by: "cli:test" }]
  });
  return root;
}

/** Initialises a repository with `main` holding the current tree. */
function initGit(root: string): void {
  git(["init"], root);
  git(["symbolic-ref", "HEAD", "refs/heads/main"], root);
  git(["config", "user.email", "test@example.invalid"], root);
  git(["config", "user.name", "test"], root);
  git(["config", "commit.gpgsign", "false"], root);
  git(["add", "-A"], root);
  git(["commit", "-m", "base"], root);
}

function record(root: string, change = "demo"): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(root, ".warrant", "changes", `${change}.json`), "utf8"));
}

describe("warrant classify", () => {
  it.skipIf(!hasGit)("raises blast_radius to the floor of .warrant/** (SCN-KRN-073)", async () => {
    const root = project();
    initGit(root);
    git(["checkout", "-b", "work"], root);
    write(root, ".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
    git(["add", "-A"], root);
    git(["commit", "-m", "areas"], root);

    const run = await runCli(["classify", "demo", "--base", "main"], root);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json?.data.changed).toContain(".warrant/local/areas.json");

    const classification = run.json?.data.classification;
    expect(classification.risk.blast_radius).toEqual({ value: "SYSTEM", from: "floor:core-sdd:2" });
    expect(classification.profiles).toContain("factory-change");
    expect(classification.risk_level).toBeUndefined();

    // The record is the one writer of classification, and transitions are untouched.
    const stored = record(root) as { classification?: unknown; transitions?: unknown[] };
    expect(stored.classification).toEqual(classification);
    expect(stored.transitions).toHaveLength(1);
    expect(run.json?.data.effective_policy.risk_level).toBe("HIGH");
  });

  it("reports USAGE and touches nothing without git and without --paths (SCN-KRN-076)", async () => {
    const root = project();
    const before = readFileSync(path.join(root, ".warrant", "changes", "demo.json"), "utf8");

    const run = await runCli(["classify", "demo"], root);
    expect(run.status).toBe(3);
    expect(run.json?.ok).toBe(false);
    expect(run.json?.errors[0].code).toBe("USAGE");
    expect(readFileSync(path.join(root, ".warrant", "changes", "demo.json"), "utf8")).toBe(before);
  });

  it.skipIf(!hasGit)("writes an empty classification for an empty diff (SCN-KRN-077)", async () => {
    const root = project();
    initGit(root);
    git(["checkout", "-b", "work"], root);

    const run = await runCli(["classify", "demo", "--base", "main"], root);
    expect(run.json?.errors).toEqual([]);
    expect(run.json?.data.changed).toEqual([]);
    expect(run.json?.data.classification).toEqual({});
    expect(run.json?.data.effective_policy.risk_level).toBe("MEDIUM");
    expect((record(root) as { classification?: unknown }).classification).toEqual({});
  });

  it("takes the changed paths from --paths without git at all", async () => {
    const root = project();
    write(root, "changed.txt", ".warrant/local/areas.json\ndocs/04-lifecycle.md\n\n");

    const run = await runCli(["classify", "demo", "--paths", "changed.txt"], root);
    expect(run.json?.errors).toEqual([]);
    expect(run.json?.data.changed).toEqual([".warrant/local/areas.json", "docs/04-lifecycle.md"]);
    const profiles = (run.json?.data.profiles as { id: string }[]).map((p) => p.id);
    expect(profiles).toContain("chore");
    expect(profiles).toContain("factory-change");
  });

  it("keeps the floor and lists the lowered proposal in data.ignored (SCN-KRN-074)", async () => {
    const root = project();
    write(root, "changed.txt", ".warrant/local/areas.json\n");

    const run = await runCli(
      ["classify", "demo", "--paths", "changed.txt", "--propose", '{"risk":{"blast_radius":"LOCAL"}}'],
      root
    );
    expect(run.json?.data.classification.risk.blast_radius.value).toBe("SYSTEM");
    expect(run.json?.data.ignored).toEqual([
      { dimension: "blast_radius", proposed: "LOCAL", kept: "SYSTEM", reason: "below-floor" }
    ]);
  });

  it("is monotonic across runs (SCN-KRN-075)", async () => {
    const root = project();
    write(root, "changed.txt", "README.md\n");

    const first = await runCli(
      ["classify", "demo", "--paths", "changed.txt", "--propose", '{"risk":{"security_impact":"MEDIUM"}}'],
      root
    );
    expect(first.json?.data.classification.risk.security_impact).toEqual({
      value: "MEDIUM",
      from: "proposer"
    });

    const second = await runCli(["classify", "demo", "--paths", "changed.txt"], root);
    expect(second.json?.data.classification.risk.security_impact).toEqual({
      value: "MEDIUM",
      from: "record"
    });
  });

  it("reports USAGE for a --propose payload that is not a classification", async () => {
    const root = project();
    write(root, "changed.txt", "README.md\n");
    const run = await runCli(["classify", "demo", "--paths", "changed.txt", "--propose", '{"risk":{"nope":"HIGH"}}'], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("USAGE");
  });

  it("reports CHANGE_NOT_FOUND for a change without a record", async () => {
    const root = project();
    write(root, "changed.txt", "README.md\n");
    const run = await runCli(["classify", "missing", "--paths", "changed.txt"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CHANGE_NOT_FOUND");
  });
});
