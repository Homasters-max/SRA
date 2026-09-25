/**
 * `warrant archive` in the test process (REQ-VER-008): the archive of a
 * `MERGED` Change — SCN-VER-036 —, the refusal outside `MERGED` — SCN-VER-037
 * — the refusal when `spec-valid` fails — SCN-VER-038 — and `--dry-run` —
 * SCN-KRN-137. Moved from e2e
 * (ADR-0025, task 5.4); the parse of argv, the exit codes of the binary and
 * the archive by the real `openspec` (the delta merged into the main spec) stay
 * in `e2e/archive.test.ts`.
 *
 * Each case builds the synced core-sdd project with a complete `feature`
 * Change `add-search`, commits it on `main` of `FakeGit` and archives on
 * `archive/add-search`. `openspec validate --strict` is answered by
 * `FakeCheckRunner` (`withOpenspecValidate`: valid, or invalid for
 * SCN-VER-038); `openspec archive` by `FakeOpenSpec`, which moves the Change
 * directory and merges no delta (ADR-0025 п. 4). `analyze-clean` has no
 * producer in phase 3 and is waived, as in the repository (P-16).
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runArchive } from "../../../src/commands/archive.js";
import { runStatus } from "../../../src/commands/status.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { withoutDryRun, writtenBeyond } from "../helpers/dry-run.js";
import { FAKE_TODAY } from "../helpers/fakes/clock.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

/** Environment of a local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = {};

const RECORD = ".warrant/changes/add-search.json";
const ACTIVE = "openspec/changes/add-search";

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function archive(p: ProjectBuilder): Promise<Result> {
  return invoke(() => runArchive(p.ctx, "add-search", LOCAL));
}

/** Every file under `openspec/` with its content, POSIX paths relative to the project (what `git status -- openspec` compares). */
function openspecFiles(p: ProjectBuilder, rel = "openspec"): [string, string][] {
  return readdirSync(path.join(p.root, ...rel.split("/")), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? openspecFiles(p, `${rel}/${entry.name}`)
      : [[`${rel}/${entry.name}`, p.read(`${rel}/${entry.name}`)] as [string, string]]
  );
}

/** Record in `state`, the Change committed on `main`, HEAD on `archive/add-search`. */
async function repo(state: string, valid = true): Promise<ProjectBuilder> {
  const p = project()
    .withRecord("add-search", state, { classification: { profiles: ["feature"] } })
    .withChange("add-search", {
      proposal: "Users cannot find items without browsing every page of the catalogue.",
      design: "# Design\n\n## Context\n\nA linear scan is enough for the catalogue size.\n",
      tasks: "# Tasks\n\n## 1. Search\n\n- [x] 1.1 Implement search and verify the unit test passes\n",
      specs: { search: [{ name: "Search by text", scenarios: [{ name: "Match" }] }] }
    })
    .withWaiver({
      id: "WAV-2026-001",
      change: "add-search",
      gate: "analyze-clean",
      reason: "warrant analyze is not implemented in phase 3",
      owner: "kat",
      approved_by: "human:kat",
      expires_at: "2099-12-31",
      waiver_state: "ACTIVE"
    })
    .withOpenspecValidate(valid);
  await p.synced();
  p.commit("base");
  p.branch("archive/add-search");
  return p;
}

describe("warrant archive", () => {
  it("validates, gates, archives through OpenSpec and records ARCHIVED (SCN-VER-036)", async () => {
    const p = await repo("MERGED");
    const run = await archive(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(p.checks.calls.map((c) => c.argv.slice(1))).toEqual([["validate", "add-search", "--strict", "--json"]]);
    expect(p.openspec.calls).toContain("archive add-search --yes");

    const data = run.data;
    expect(data["transition"]).toBe("MERGED->ARCHIVED");
    expect(data["checks"]).toEqual([expect.objectContaining({ id: "openspec-validate", kind: "spec-report", evidence_status: "PROVEN" })]);
    expect(data["gates"]).toEqual({
      "analyze-clean": "WAIVED",
      "ids-valid": "PASS",
      "required-artifacts-present": "PASS",
      "spec-valid": "PASS"
    });
    expect(data["archive"]).toMatch(/^openspec\/changes\/archive\/\d{4}-\d{2}-\d{2}-add-search$/);
    expect(existsSync(path.join(p.root, data["archive"], "proposal.md"))).toBe(true);
    expect(existsSync(path.join(p.root, ACTIVE))).toBe(false);

    const stored = JSON.parse(p.read(RECORD));
    expect(stored.change_state).toBe("ARCHIVED");
    expect(stored.transitions.at(-1)).toEqual({
      to: "ARCHIVED",
      at: expect.any(String),
      by: "cli:local",
      effective_policy_hash: expect.stringMatching(/^sha256:/),
      gates: data["gates"],
      evidence: [data["checks"][0].evidence]
    });

    const status: Result = await invoke(() => runStatus(p.ctx, "add-search", LOCAL));
    expect(status.data["stale"]).toEqual([]);
    expect(await validateErrors(p)).toEqual([]);

    // The record is frozen from now on.
    const again = await archive(p);
    expect(again.errors[0]?.code).toBe("RECORD_FROZEN");
    expect(again.exitCode).toBe(3);
  });

  it("refuses a Change that is not MERGED with STATE_INVALID and moves nothing (SCN-VER-037)", async () => {
    const p = await repo("VERIFYING");
    const before = p.read(RECORD);
    const run = await archive(p);
    expect(run.errors[0]?.code).toBe("STATE_INVALID");
    expect(run.exitCode).toBe(3);
    expect(existsSync(path.join(p.root, ACTIVE))).toBe(true);
    expect(p.read(RECORD)).toBe(before);
    expect(p.openspec.calls.filter((c) => c.startsWith("archive"))).toEqual([]);
  });

  it("does not call openspec archive when spec-valid fails (SCN-VER-038)", async () => {
    const p = await repo("MERGED", false);
    const before = p.read(RECORD);
    const files = openspecFiles(p);
    const run = await archive(p);
    expect(run.ok).toBe(false);
    expect(run.errors.map((e) => e.code)).toEqual(["GATES_NOT_PASSED"]);
    expect(run.data["gates"]["spec-valid"]).toBe("FAIL");
    expect(run.exitCode).toBe(2);
    expect(existsSync(path.join(p.root, ACTIVE, "proposal.md"))).toBe(true);
    // Nothing under openspec/ moved or appeared: OpenSpec archive was not run.
    expect(p.openspec.calls.filter((c) => c.startsWith("archive"))).toEqual([]);
    expect(openspecFiles(p)).toEqual(files);
    expect(p.read(RECORD)).toBe(before);
  });
});

describe("warrant archive --dry-run (REQ-KRN-034)", () => {
  it("runs openspec validate and the gates, not openspec archive, and writes nothing (SCN-KRN-137)", async () => {
    const p = await repo("MERGED");
    const before = p.tree();

    const run: Result = await invoke(() => runArchive(p.dryRun(), "add-search", LOCAL));
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(p.checks.calls.map((c) => c.argv.slice(1))).toEqual([["validate", "add-search", "--strict", "--json"]]);
    expect(p.openspec.calls.filter((c) => c.startsWith("archive"))).toEqual([]);
    expect(existsSync(path.join(p.root, ACTIVE, "proposal.md"))).toBe(true);
    expect(p.tree()).toEqual(before);

    const archived = `openspec/changes/archive/${FAKE_TODAY}-add-search`;
    expect(run.data["dry_run"]).toBe(true);
    expect(run.data["archive"]).toBe(archived);
    expect(run.data["gates"]["spec-valid"]).toBe("PASS");
    const evidence = run.data["checks"][0].evidence as string;
    expect(run.data["would_write"]).toEqual([
      RECORD,
      `.warrant/evidence/add-search/${evidence}.json`,
      ".warrant/evidence/add-search/manifest.json",
      ".warrant/evidence/add-search/raw/openspec-validate",
      ACTIVE,
      archived,
      "openspec/specs/search/spec.md"
    ]);

    const real = await archive(p);
    expect(real.exitCode).toBe(0);
    expect(withoutDryRun(run.data)).toEqual(withoutDryRun(real.data));
    expect(writtenBeyond(before, p.tree(), run.data["would_write"])).toEqual([]);
  });

  it("refuses as the real run does when spec-valid fails", async () => {
    const p = await repo("MERGED", false);
    const before = p.tree();
    const run: Result = await invoke(() => runArchive(p.dryRun(), "add-search", LOCAL));
    expect(p.tree()).toEqual(before);
    const real = await archive(p);
    expect(run.errors).toEqual(real.errors);
    expect(run.exitCode).toBe(real.exitCode);
    expect(withoutDryRun(run.data)).toEqual(withoutDryRun(real.data));
  });
});
