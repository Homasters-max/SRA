/**
 * `warrant waive` end to end (REQ-KRN-031, SCN-KRN-121, 122, 123, 124): propose
 * a waiver, activate and revoke it as a maintainer, and the verdict of the
 * waived gate in `warrant gate` at each step.
 *
 * The id counts per UTC year of the clock, so the seeded waivers and the
 * expected id use the current year, not a spelled one.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { openspecAvailable } from "../../src/core/openspec/cli.js";
import { makeTempDir, removeDir, runCli, type CliRun } from "../helpers/cli.js";
import { PATH_KEY, pathWithFake, writeFakeOpenspec } from "../helpers/fake-openspec.js";
import { PACKS, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasOpenspec = openspecAvailable();
const hasGit = spawnSync("git", ["--version"]).status === 0;
const project = useSyncedProject();

const YEAR = new Date().getUTCFullYear();
const EXPIRES = `${YEAR}-12-31`;
const wav = (n: number): string => `WAV-${YEAR}-${String(n).padStart(3, "0")}`;

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

let fakeBin: string | undefined;
function env(): NodeJS.ProcessEnv {
  if (fakeBin === undefined) {
    fakeBin = makeTempDir("warrant-waive-fake-openspec-");
    tempDirs.push(fakeBin);
    writeFakeOpenspec(fakeBin);
  }
  return { WARRANT_PACKS_DIR: PACKS, [PATH_KEY]: pathWithFake(fakeBin), GITHUB_ACTIONS: "" };
}

function waive(root: string, ...args: string[]): Promise<CliRun> {
  return runCli(["waive", ...args], root, env());
}

function git(cwd: string, ...args: string[]): void {
  const run = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
}

function waiverFile(root: string, id: string): string {
  return path.join(root, ".warrant", "waivers", `${id}.json`);
}

function readWaiver(root: string, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(waiverFile(root, id), "utf8")) as Record<string, unknown>;
}

/** A waiver seeded as a file, on a gate other than analyze-clean. */
function seeded(id: string, state: string, gate: string): Record<string, unknown> {
  return {
    $schema: "warrant://waiver/1",
    id,
    change: "add-search",
    gate,
    reason: "seeded",
    risk: "LOW",
    compensating_controls: ["review"],
    owner: "human:kat",
    ...(state === "PROPOSED" ? {} : { approved_by: "human:kat" }),
    expires_at: EXPIRES,
    waiver_state: state
  };
}

/**
 * Synced project, record `add-search` in `VERIFYING` on profile `feature` (its
 * `VERIFYING->MERGED` has `analyze-clean`), waivers `001` and `004` of this
 * year, one git commit on `main`.
 */
function repo(): string {
  const root = project();
  write(root, ".warrant/changes/add-search.json", record("add-search", "VERIFYING", { classification: { profiles: ["feature"] } }));
  for (const rel of ["proposal.md", "design.md", "tasks.md", "specs/search/spec.md"]) {
    write(root, `openspec/changes/add-search/${rel}`, "# Doc\n");
  }
  write(root, `.warrant/waivers/${wav(1)}.json`, seeded(wav(1), "REVOKED", "adversarial-review"));
  write(root, `.warrant/waivers/${wav(4)}.json`, seeded(wav(4), "PROPOSED", "branch-isolated"));
  git(root, "-c", "init.defaultBranch=main", "init", "--quiet");
  git(root, "config", "user.name", "warrant-test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "checkout", "--quiet", "-B", "main");
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "base");
  return root;
}

async function analyzeClean(root: string): Promise<string> {
  const run = await runCli(["gate", "add-search"], root, env());
  expect(run.json?.data.transition).toBe("VERIFYING->MERGED");
  return run.json?.data.gates["analyze-clean"] as string;
}

const PROPOSE = [
  "add-search",
  "analyze-clean",
  "--reason",
  "no analyze yet",
  "--risk",
  "HIGH",
  "--control",
  "maintainer review",
  "--owner",
  "human:kat",
  "--expires",
  EXPIRES
];

describe.skipIf(!hasOpenspec || !hasGit)("warrant waive", () => {
  it("proposes WAV-<year>-005 after 001 and 004: PROPOSED, no approved_by, gate still BLOCKED (SCN-KRN-121)", async () => {
    const root = repo();
    const run = await waive(root, ...PROPOSE);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    const id = wav(5);
    expect(run.json.data.path).toBe(`.warrant/waivers/${id}.json`);
    const stored = readWaiver(root, id);
    expect(run.json.data.waiver).toEqual(stored);
    expect(stored).toEqual({
      $schema: "warrant://waiver/1",
      id,
      change: "add-search",
      gate: "analyze-clean",
      reason: "no analyze yet",
      risk: "HIGH",
      compensating_controls: ["maintainer review"],
      owner: "human:kat",
      expires_at: EXPIRES,
      waiver_state: "PROPOSED"
    });
    expect(stored).not.toHaveProperty("approved_by");
    expect(stored).not.toHaveProperty("targets");
    expect(readFileSync(waiverFile(root, id), "utf8")).toBe(canonicalText(stored as never).text);
    expect((await validate(root)).json?.errors).toEqual([]);
    expect(await analyzeClean(root)).toBe("BLOCKED");
  }, 120_000);

  it("activates as a maintainer: ACTIVE, approved_by human:kat, gate WAIVED; bob is ROLE_REQUIRED (SCN-KRN-122)", async () => {
    const root = repo();
    expect((await waive(root, ...PROPOSE)).status).toBe(0);
    const id = wav(5);
    const before = readFileSync(waiverFile(root, id), "utf8");

    const bob = await waive(root, "--activate", id, "--by", "bob");
    expect(bob.json?.errors[0].code).toBe("ROLE_REQUIRED");
    expect(bob.status).toBe(3);
    expect(readFileSync(waiverFile(root, id), "utf8")).toBe(before);

    const run = await waive(root, "--activate", id, "--by", "kat");
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data.waiver).toMatchObject({ id, waiver_state: "ACTIVE", approved_by: "human:kat" });
    expect(readWaiver(root, id)).toMatchObject({ waiver_state: "ACTIVE", approved_by: "human:kat" });
    expect((await validate(root)).json?.errors).toEqual([]);
    expect(await analyzeClean(root)).toBe("WAIVED");
  }, 120_000);

  it("refuses a gate that is not waivable with WAIVER_INVALID and writes no file (SCN-KRN-123)", async () => {
    const root = repo();
    const before = readdirSync(path.join(root, ".warrant", "waivers")).sort();
    const run = await waive(root, "add-search", "scope-valid", ...PROPOSE.slice(2));
    expect(run.json?.errors[0].code).toBe("WAIVER_INVALID");
    expect(run.status).toBe(3);
    const unknownGate = await waive(root, "add-search", "no-such-gate", ...PROPOSE.slice(2));
    expect(unknownGate.json?.errors[0].code).toBe("WAIVER_INVALID");
    expect(readdirSync(path.join(root, ".warrant", "waivers")).sort()).toEqual(before);
  }, 60_000);

  it("revokes an ACTIVE waiver: REVOKED, gate BLOCKED again, a second --activate is STATE_INVALID (SCN-KRN-124)", async () => {
    const root = repo();
    const id = wav(5);
    expect((await waive(root, ...PROPOSE)).status).toBe(0);
    expect((await waive(root, "--activate", id, "--by", "kat")).status).toBe(0);

    const run = await waive(root, "--revoke", id, "--by", "kat");
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(readWaiver(root, id)).toMatchObject({ waiver_state: "REVOKED", approved_by: "human:kat" });
    expect((await validate(root)).json?.errors).toEqual([]);
    expect(await analyzeClean(root)).toBe("BLOCKED");

    const again = await waive(root, "--activate", id, "--by", "kat");
    expect(again.json?.errors[0].code).toBe("STATE_INVALID");
    expect(again.status).toBe(3);
    const revokeAgain = await waive(root, "--revoke", id, "--by", "kat");
    expect(revokeAgain.json?.errors[0].code).toBe("STATE_INVALID");

    // A PROPOSED waiver may be revoked too; the maintainer who closed it is its approved_by.
    const proposed = await waive(root, "--revoke", wav(4), "--by", "kat");
    expect(proposed.status).toBe(0);
    expect(readWaiver(root, wav(4))).toMatchObject({ waiver_state: "REVOKED", approved_by: "human:kat" });
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 120_000);

  it("reports usage errors, an unknown waiver, an unknown and a frozen change", async () => {
    const root = repo();
    const cases: [string[], string][] = [
      [["--activate", wav(4), "--revoke", wav(4), "--by", "kat"], "USAGE"],
      [["add-search", "--activate", wav(4), "--by", "kat"], "USAGE"],
      [["--activate", wav(4)], "USAGE"],
      [["--activate", "WAV-1999-001", "--by", "kat"], "WAIVER_INVALID"],
      [[...PROPOSE.slice(0, -1), "2000-01-01"], "USAGE"],
      [[...PROPOSE.slice(0, -1), "31.12.2099"], "USAGE"],
      [PROPOSE.filter((a) => a !== "--control" && a !== "maintainer review"), "USAGE"],
      [[...PROPOSE.slice(0, 9), "kat", ...PROPOSE.slice(10)], "USAGE"],
      [[...PROPOSE.slice(0, 5), "SEVERE", ...PROPOSE.slice(6)], "USAGE"],
      [[...PROPOSE, "--by", "kat"], "USAGE"],
      [["no-such", ...PROPOSE.slice(1)], "CHANGE_NOT_FOUND"]
    ];
    for (const [args, code] of cases) {
      const run = await waive(root, ...args);
      expect({ args, code: run.json?.errors[0]?.code }).toEqual({ args, code });
      expect(run.status).toBe(3);
    }
    expect(existsSync(waiverFile(root, wav(5)))).toBe(false);

    write(root, ".warrant/changes/add-search.json", record("add-search", "ARCHIVED"));
    const frozen = await waive(root, ...PROPOSE);
    expect(frozen.json?.errors[0].code).toBe("RECORD_FROZEN");
  }, 120_000);
});
