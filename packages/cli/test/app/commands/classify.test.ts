/**
 * `warrant classify` in the test process (REQ-KRN-027, REQ-KRN-028): floors
 * from the diff of `FakeGit` or from `--paths` (SCN-KRN-073, 074, 076, 077),
 * without the own state of the Change (SCN-KRN-138),
 * monotonic runs (SCN-KRN-075), values set by a human (SCN-KRN-105, 106, 107)
 * and values below the floor with approval (SCN-KRN-116, 117). Moved from e2e
 * (ADR-0025, task 5.4); the parse of argv (`--base`, `--paths`, `--propose`,
 * repeatable `--set`, `--by`, `--ref`), the exit codes of the binary and the
 * diff of the real `git` stay in `e2e/classify.test.ts`.
 *
 * The project is the one of the e2e runs: the config (with `roles` where
 * given) and one `PROPOSED` record, no lock; `git init` and commits are those
 * of `FakeGit`, and "no git" is a `FakeGit` never initialised.
 */
import { describe, expect, it } from "vitest";

import { runClassify, type ClassifyOptions } from "../../../src/commands/classify.js";
import { canonicalText } from "../../../src/core/canon/format-json.js";
import { validateFile } from "../../../src/core/schemas/semantic.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CORE_SDD_RANGE } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const builder = useProjectBuilder();

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function classify(p: ProjectBuilder, change: string, opts: ClassifyOptions = {}): Promise<Result> {
  return invoke(() => runClassify(p.ctx, change, opts));
}

/** A project on the bundled pack `core-sdd` with one PROPOSED change record. */
function project(change = "demo", roles?: Record<string, string[]>): ProjectBuilder {
  return builder()
    .remove(".warrant")
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      ...(roles === undefined ? {} : { roles })
    })
    .write(`.warrant/changes/${change}.json`, {
      $schema: "warrant://change-record/1",
      change,
      change_state: "PROPOSED",
      transitions: [{ to: "PROPOSED", at: "2026-09-22T00:00:00.000Z", by: "cli:test" }]
    });
}

function recordText(p: ProjectBuilder, change = "demo"): string {
  return p.read(`.warrant/changes/${change}.json`);
}

function record(p: ProjectBuilder, change = "demo"): Record<string, any> {
  return JSON.parse(recordText(p, change)) as Record<string, any>;
}

describe("warrant classify", () => {
  it("raises blast_radius to the floor of .warrant/** (SCN-KRN-073)", async () => {
    const p = project();
    p.commit("base");
    p.branch("work");
    p.write(".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
    p.commit("areas");

    const run = await classify(p, "demo", { base: "main" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["changed"]).toContain(".warrant/local/areas.json");

    const classification = run.data["classification"];
    expect(classification.risk.blast_radius).toEqual({ value: "SYSTEM", from: "floor:core-sdd:2" });
    expect(classification.profiles).toContain("factory-change");
    expect(classification.risk_level).toBeUndefined();

    // The record is the one writer of classification, and transitions are untouched.
    const stored = record(p);
    expect(stored["classification"]).toEqual(classification);
    expect(stored["transitions"]).toHaveLength(1);
    expect(run.data["effective_policy"].risk_level).toBe("HIGH");
  });

  it("leaves the own state of the Change out of floors and match.paths (SCN-KRN-138)", async () => {
    const run = "RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y";
    const p = project("add-search");
    p.commit("base");
    p.branch("work");
    p.write("src/search.py", "print('search')\n");
    p.write(".warrant/changes/add-search.json", { ...record(p, "add-search"), unknowns: [] });
    p.write(".warrant/evidence/add-search/EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3.json", { id: "EVID-01J8Z3M5K9X7Q2R4T6V8W0Y1A3" });
    p.write(`.warrant/runs/${run}.json`, {
      $schema: "warrant://run/1",
      id: run,
      change: "add-search",
      operation: "implement",
      write_scope: ["src/**"],
      scope: [],
      branch: "work",
      started_at: "2026-09-25T10:00:00Z",
      finished_at: "2026-09-25T10:12:00Z",
      run_state: "SUCCEEDED",
      context_hash: `sha256:${"1".repeat(64)}`,
      effective_policy_hash: `sha256:${"2".repeat(64)}`,
      guard_events: []
    });
    p.commit("work");

    const own = await classify(p, "add-search", { base: "main" });
    expect(own.errors).toEqual([]);
    expect(own.data["changed"]).toContain(`.warrant/runs/${run}.json`);
    const froms = (c: Data): string[] => Object.values((c["risk"] ?? {}) as Record<string, { from: string }>).map((v) => v.from);
    expect(own.data["classification"].profiles ?? []).not.toContain("factory-change");
    expect(froms(own.data["classification"])).not.toContain("floor:core-sdd:2");

    // Configuration under .warrant/** still makes the Change factory-change, as in SCN-KRN-073.
    p.write(".warrant/local/areas.json", { $schema: "warrant://areas/1", KRN: { capability: "kernel" } });
    p.commit("areas");
    const areas = await classify(p, "add-search", { base: "main" });
    expect(areas.data["classification"].profiles).toContain("factory-change");
    expect(areas.data["classification"].risk.blast_radius).toEqual({ value: "SYSTEM", from: "floor:core-sdd:2" });
  });

  it("reports USAGE and touches nothing without git and without --paths (SCN-KRN-076)", async () => {
    const p = project();
    const before = recordText(p);

    const run = await classify(p, "demo");
    expect(run.exitCode).toBe(3);
    expect(run.ok).toBe(false);
    expect(run.errors[0]?.code).toBe("USAGE");
    expect(recordText(p)).toBe(before);
  });

  it("writes an empty classification for an empty diff (SCN-KRN-077)", async () => {
    const p = project();
    p.commit("base");
    p.branch("work");

    const run = await classify(p, "demo", { base: "main" });
    expect(run.errors).toEqual([]);
    expect(run.data["changed"]).toEqual([]);
    expect(run.data["classification"]).toEqual({});
    expect(run.data["effective_policy"].risk_level).toBe("MEDIUM");
    expect(record(p)["classification"]).toEqual({});
  });

  it("takes the changed paths from --paths without git at all", async () => {
    const p = project().write("changed.txt", ".warrant/local/areas.json\ndocs/04-lifecycle.md\n\n");

    const run = await classify(p, "demo", { paths: "changed.txt" });
    expect(run.errors).toEqual([]);
    expect(run.data["changed"]).toEqual([".warrant/local/areas.json", "docs/04-lifecycle.md"]);
    const profiles = (run.data["profiles"] as { id: string }[]).map((x) => x.id);
    expect(profiles).toContain("chore");
    expect(profiles).toContain("factory-change");
    expect(p.git.calls).toEqual([]);
  });

  it("keeps the floor and lists the lowered proposal in data.ignored (SCN-KRN-074)", async () => {
    const p = project().write("changed.txt", ".warrant/local/areas.json\n");

    const run = await classify(p, "demo", { paths: "changed.txt", propose: '{"risk":{"blast_radius":"LOCAL"}}' });
    expect(run.data["classification"].risk.blast_radius.value).toBe("SYSTEM");
    expect(run.data["ignored"]).toEqual([{ dimension: "blast_radius", proposed: "LOCAL", kept: "SYSTEM", reason: "below-floor" }]);
  });

  it("is monotonic across runs (SCN-KRN-075)", async () => {
    const p = project().write("changed.txt", "README.md\n");

    const first = await classify(p, "demo", { paths: "changed.txt", propose: '{"risk":{"security_impact":"MEDIUM"}}' });
    expect(first.data["classification"].risk.security_impact).toEqual({ value: "MEDIUM", from: "proposer" });

    const second = await classify(p, "demo", { paths: "changed.txt" });
    expect(second.data["classification"].risk.security_impact).toEqual({ value: "MEDIUM", from: "record" });
  });

  it("reports USAGE for a --propose payload that is not a classification", async () => {
    const p = project().write("changed.txt", "README.md\n");
    const run = await classify(p, "demo", { paths: "changed.txt", propose: '{"risk":{"nope":"HIGH"}}' });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("USAGE");
  });

  it("records values and profiles set by a human with from human:<login> (SCN-KRN-105)", async () => {
    const p = project("add-search", { maintainer: ["kat"] }).write("changed.txt", "src/search.ts\n");
    const run = await classify(p, "add-search", { paths: "changed.txt", set: ["security_impact=HIGH", "profile=feature"], by: "kat" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["profiles"]).toEqual([{ id: "feature", from: "human:kat" }]);
    const stored = record(p, "add-search");
    expect(stored["classification"].risk["security_impact"]).toEqual({ value: "HIGH", from: "human:kat" });
    expect(stored["classification"].profiles).toEqual(["feature"]);
    expect(run.data["effective_policy"].risk_level).toBe("HIGH");
  });

  it("refuses a human value below the floor with BELOW_FLOOR and writes nothing (SCN-KRN-106)", async () => {
    const p = project("add-search", { maintainer: ["kat"] }).write("changed.txt", ".warrant/local/areas.json\n");
    const before = recordText(p, "add-search");
    const run = await classify(p, "add-search", { paths: "changed.txt", set: ["blast_radius=LOCAL"], by: "kat" });
    expect(run.errors[0]?.code).toBe("BELOW_FLOOR");
    expect(run.exitCode).toBe(3);
    expect(recordText(p, "add-search")).toBe(before);
  });

  it("refuses --set without --by (USAGE) and with a login outside roles (ROLE_REQUIRED) (SCN-KRN-107)", async () => {
    const p = project("add-search", { maintainer: ["kat"] }).write("changed.txt", "src/search.ts\n");
    const before = recordText(p, "add-search");

    const noBy = await classify(p, "add-search", { paths: "changed.txt", set: ["data_loss=LOW"] });
    expect(noBy.errors[0]?.code).toBe("USAGE");
    expect(noBy.exitCode).toBe(3);

    const bob = await classify(p, "add-search", { paths: "changed.txt", set: ["data_loss=LOW"], by: "bob" });
    expect(bob.errors[0]?.code).toBe("ROLE_REQUIRED");
    expect(bob.exitCode).toBe(3);

    const badValue = await classify(p, "add-search", { paths: "changed.txt", set: ["data_loss=HUGE"], by: "kat" });
    expect(badValue.errors[0]?.code).toBe("USAGE");
    expect(recordText(p, "add-search")).toBe(before);
  });

  it("reports CHANGE_NOT_FOUND for a change without a record", async () => {
    const p = project().write("changed.txt", "README.md\n");
    const run = await classify(p, "missing", { paths: "changed.txt" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CHANGE_NOT_FOUND");
  });
});

describe("warrant classify: below the floor with approval (REQ-KRN-028)", () => {
  const REF = "https://github.com/o/r/pull/7#issuecomment-1";
  const ROLES = { maintainer: ["kat"], reviewer: ["bob"] };

  function inState(state: string): ProjectBuilder {
    const p = project("add-search", ROLES);
    return p.write(".warrant/changes/add-search.json", { ...record(p, "add-search"), change_state: state }).write("changed.txt", ".warrant/local/areas.json\n");
  }

  it("writes the lowered value with ref and keeps it on the next run, floor ignored as approved-below-floor (SCN-KRN-116)", async () => {
    const p = inState("SPECIFIED");
    const first = await classify(p, "add-search", { paths: "changed.txt" });
    expect(first.data["classification"].risk.blast_radius).toEqual({ value: "SYSTEM", from: "floor:core-sdd:2" });

    const run = await classify(p, "add-search", { paths: "changed.txt", set: ["blast_radius=LOCAL"], by: "kat", ref: REF });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const lowered = { value: "LOCAL", from: "human:kat", ref: REF };
    expect(record(p, "add-search")["classification"].risk["blast_radius"]).toEqual(lowered);

    const again = await classify(p, "add-search", { paths: "changed.txt" });
    expect(again.errors).toEqual([]);
    expect(again.data["classification"].risk.blast_radius).toEqual(lowered);
    // The record stays valid (REQ-KRN-011: ref only with from human:*) and canonical.
    expect(validateFile(record(p, "add-search") as never).ok).toBe(true);
    const text = recordText(p, "add-search");
    expect(text).toBe(canonicalText(JSON.parse(text) as never).text);
    expect(again.data["ignored"]).toContainEqual(
      expect.objectContaining({ dimension: "blast_radius", reason: "approved-below-floor", proposed: "SYSTEM", kept: "LOCAL" })
    );
    expect(record(p, "add-search")["classification"].risk["blast_radius"]).toEqual(lowered);
  });

  it("refuses the approval after APPROVED with STATE_INVALID and writes nothing (SCN-KRN-117)", async () => {
    const p = inState("APPROVED");
    const before = recordText(p, "add-search");
    const run = await classify(p, "add-search", { paths: "changed.txt", set: ["blast_radius=LOCAL"], by: "kat", ref: REF });
    expect(run.errors[0]?.code).toBe("STATE_INVALID");
    expect(run.exitCode).toBe(3);
    expect(recordText(p, "add-search")).toBe(before);
  });

  it("wants an approver of SPECIFIED->APPROVED (ROLE_REQUIRED), an http(s) --ref and a risk --set (USAGE)", async () => {
    const p = inState("PROPOSED");
    const before = recordText(p, "add-search");
    const base: ClassifyOptions = { paths: "changed.txt" };

    const bob = await classify(p, "add-search", { ...base, set: ["blast_radius=LOCAL"], by: "bob", ref: REF });
    expect(bob.errors[0]?.code).toBe("ROLE_REQUIRED");
    expect(bob.exitCode).toBe(3);
    const notUrl = await classify(p, "add-search", { ...base, set: ["blast_radius=LOCAL"], by: "kat", ref: "PR 7" });
    expect(notUrl.errors[0]?.code).toBe("USAGE");
    const noSet = await classify(p, "add-search", { ...base, ref: REF });
    expect(noSet.errors[0]?.code).toBe("USAGE");
    const profileOnly = await classify(p, "add-search", { ...base, set: ["profile=feature"], by: "kat", ref: REF });
    expect(profileOnly.errors[0]?.code).toBe("USAGE");
    expect(recordText(p, "add-search")).toBe(before);
  });
});
