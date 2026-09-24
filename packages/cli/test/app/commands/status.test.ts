/**
 * `warrant status` in the test process (REQ-KRN-027, SCN-KRN-067, 070..072,
 * 102..104). Moved from e2e (ADR-0025, task 5.3); a large envelope through a
 * pipe with its exit code (SCN-KRN-085, B4) stays in `e2e/status.test.ts`.
 *
 * Each case is a project on the fixture pack `policy` — the loader is pointed at
 * the fixture packs through `WARRANT_PACKS_DIR`, as the e2e runs did through the
 * environment of the binary — with one record and one change directory, outside
 * git. `FakeOpenSpec` answers `status` as the saved OpenSpec 1.13.1 body
 * `status-fresh` did: a Change none of whose artifacts is done.
 */
import { cpSync, rmSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runStatus } from "../../../src/commands/status.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CLI_ROOT } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");

const builder = useProjectBuilder();

const PACKS_ENV = "WARRANT_PACKS_DIR";
const packsEnvBefore = process.env[PACKS_ENV];
afterEach(() => {
  if (packsEnvBefore === undefined) delete process.env[PACKS_ENV];
  else process.env[PACKS_ENV] = packsEnvBefore;
});

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function status(p: ProjectBuilder, change?: string): Promise<Result> {
  return invoke(() => runStatus(p.ctx, change, {}));
}

function config(packs: Record<string, { version: string }>): Record<string, unknown> {
  return { $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs };
}

/** A project with the `policy` fixture pack, one record and one change directory. */
function project(change = "add-search"): ProjectBuilder {
  process.env[PACKS_ENV] = FIXTURE_PACKS;
  const p = builder()
    .remove(".warrant")
    .write(".warrant/warrant.json", config({ policy: { version: "^1.0" } }))
    .withRecord(change, "PROPOSED")
    .write(`openspec/changes/${change}/proposal.md`, "# Why\n");
  // The saved answer `status-fresh`: OpenSpec knows the Change, no artifact is done.
  p.openspec.change(change);
  return p;
}

describe("warrant status <change>", () => {
  it("reports a fresh change with no stale signals (SCN-KRN-070)", async () => {
    const p = project();
    const run = await status(p, "add-search");
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.change).toBe("add-search");
    expect(run.data["change_state"]).toBe("PROPOSED");
    expect((run.data["artifacts"] as Record<string, string>)["proposal"]).toBe("ready");
    expect(run.data["stale"]).toEqual([]);
    // No classification in the record: the key is present and null.
    expect(run.data["classification"]).toBeNull();
    expect(run.data["effective_policy"].hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Array.isArray(run.data["effective_policy"].sources)).toBe(true);
  });

  it("carries the verification of the next transition last (REQ-KRN-027)", async () => {
    const p = project();
    const run = await status(p, "add-search");
    expect(Object.keys(run.data)).toEqual([
      "change",
      "change_state",
      "classification",
      "effective_policy",
      "artifacts",
      "stale",
      "amended_by",
      "superseded_by",
      "verification"
    ]);
    expect(Object.keys(run.data["verification"])).toEqual(["transition", "gates", "findings", "controller_action", "rule"]);
    expect(run.data["verification"].transition).toBe("PROPOSED->SPECIFIED");
    // `rules` belongs to the form without an argument only (SCN-KRN-104).
    expect(run.data["rules"]).toBeUndefined();
  });

  it("reports the risk level of the effective policy (REQ-KRN-027)", async () => {
    const p = project();
    const run = await status(p, "add-search");
    // No classification: every dimension is UNKNOWN, which the policy fixture levels as MEDIUM.
    expect(run.data["effective_policy"].risk_level).toBe("MEDIUM");
  });

  it("flags an ABANDONED record whose change directory still exists (SCN-KRN-102)", async () => {
    const p = project().withRecord("add-search", "ABANDONED");
    const present = await status(p, "add-search");
    expect(present.exitCode).toBe(0);
    expect(present.data["stale"]).toEqual([
      {
        code: "ABANDONED_DIR_PRESENT",
        message: expect.stringContaining("add-search") as unknown as string,
        path: "openspec/changes/add-search"
      }
    ]);

    // Without the directory an ABANDONED record is the expected end state, not CHANGE_DIR_MISSING.
    p.remove("openspec/changes/add-search");
    const gone = await status(p, "add-search");
    expect(gone.exitCode).toBe(0);
    expect(gone.data["stale"]).toEqual([]);
  });

  it("computes amended_by and superseded_by without writing them into the record (SCN-KRN-103)", async () => {
    const p = project()
      .withRecord("fix-search", "PROPOSED", { amends: ["add-search"] })
      .withRecord("new-search", "PROPOSED", { supersedes: ["add-search"] });
    const before = p.read(".warrant/changes/add-search.json");

    const run = await status(p, "add-search");
    expect(run.exitCode).toBe(0);
    expect(run.data["amended_by"]).toEqual(["fix-search"]);
    expect(run.data["superseded_by"]).toEqual(["new-search"]);
    const after = p.read(".warrant/changes/add-search.json");
    expect(after).toBe(before);
    expect(JSON.parse(after)).not.toHaveProperty("amended_by");

    const other = await status(p, "fix-search");
    expect(other.data["amended_by"]).toEqual([]);
    expect(other.data["superseded_by"]).toEqual([]);
  });

  it("flags an archived directory whose record is not ARCHIVED (SCN-KRN-071)", async () => {
    const p = project();
    cpSync(
      path.join(p.root, "openspec", "changes", "add-search"),
      path.join(p.root, "openspec", "changes", "archive", "2026-09-22-add-search"),
      { recursive: true }
    );
    rmSync(path.join(p.root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    p.withRecord("add-search", "MERGED", {
      transitions: [
        { to: "PROPOSED", at: "2026-09-22T09:00:00Z", by: "cli:local" },
        { to: "APPROVED", at: "2026-09-22T11:00:00Z", by: "ci:run/8812" },
        { to: "MERGED", at: "2026-09-22T12:00:00Z", by: "ci:run/8812" }
      ]
    });

    const run = await status(p, "add-search");
    expect(run.exitCode).toBe(0);
    expect(run.errors).toEqual([]);
    const stale = run.data["stale"] as { code: string; path: string }[];
    expect(stale.map((s) => s.code)).toContain("ARCHIVED_WITHOUT_TRANSITION");
    expect(stale[0]?.path).toBe("openspec/changes/archive/2026-09-22-add-search");
    // OpenSpec no longer owns the directory, so no artifacts are reported.
    expect(run.data["artifacts"]).toEqual({});
  });

  it("stays quiet about an archived directory once the record is ARCHIVED", async () => {
    const p = project();
    cpSync(
      path.join(p.root, "openspec", "changes", "add-search"),
      path.join(p.root, "openspec", "changes", "archive", "2026-09-22-add-search"),
      { recursive: true }
    );
    rmSync(path.join(p.root, "openspec", "changes", "add-search"), { recursive: true, force: true });
    p.withRecord("add-search", "ARCHIVED");
    const run = await status(p, "add-search");
    expect(run.exitCode).toBe(0);
    expect(run.data["stale"]).toEqual([]);
  });

  it("flags a record whose change directory is gone", async () => {
    const p = project().remove("openspec/changes/add-search");
    const run = await status(p, "add-search");
    expect(run.exitCode).toBe(0);
    const stale = run.data["stale"] as { code: string; path: string }[];
    expect(stale).toEqual([
      {
        code: "CHANGE_DIR_MISSING",
        message: expect.stringContaining("add-search") as unknown as string,
        path: "openspec/changes/add-search"
      }
    ]);
    expect(run.data["artifacts"]).toEqual({});
  });

  it("rejects a change without a record (SCN-KRN-072)", async () => {
    const p = project();
    const run = await status(p, "nosuch");
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CHANGE_NOT_FOUND");
    expect(run.errors[0]?.path).toBe(".warrant/changes/nosuch.json");
  });

  it("reports the record without artifacts when openspec is not on PATH", async () => {
    const p = project();
    p.openspec.installedVersion = null;
    const run = await status(p, "add-search");
    expect(run.exitCode).toBe(0);
    expect(run.data["artifacts"]).toEqual({});
    expect(p.warnings.join("")).toContain("`openspec` is not on PATH");
    expect(run.data["change_state"]).toBe("PROPOSED");
  });

  it("escalates a policy conflict instead of hiding it (SCN-KRN-067)", async () => {
    const p = project()
      .write(".warrant/warrant.json", config({ policy: { version: "^1.0" }, "policy-conflict": { version: "^1.0" } }))
      .withRecord("add-search", "PROPOSED", {
        classification: { profiles: ["feature"], risk: { data_loss: { value: "HIGH", from: "human:kat" } } }
      });
    const run = await status(p, "add-search");
    expect(run.exitCode).toBe(2);
    expect(run.errors[0]?.code).toBe("POLICY_CONFLICT");
    expect(run.data["controller_action"]).toBe("ESCALATE");
    // The derived signals are still reported.
    expect(run.data["effective_policy"]).toBeNull();
    expect(run.data["stale"]).toEqual([]);
  });
});

describe("warrant status", () => {
  it("reports every record, sorted by name (task 9.3)", async () => {
    const p = project("add-search").withRecord("zz-cleanup", "SPECIFIED").withRecord("aa-rename", "PROPOSED");

    const run = await status(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.change).toBeUndefined();
    const changes = run.data["changes"] as { change: string; stale: unknown[] }[];
    expect(changes.map((c) => c.change)).toEqual(["aa-rename", "add-search", "zz-cleanup"]);
    // Only `add-search` has a directory; the other two are stale.
    expect(changes[1]?.stale).toEqual([]);
    expect((changes[0]?.stale[0] as { code: string }).code).toBe("CHANGE_DIR_MISSING");
  });

  it("reports an empty list for a project without records", async () => {
    const p = project().remove(".warrant/changes");
    const run = await status(p);
    expect(run.exitCode).toBe(0);
    expect(run.data).toEqual({ changes: [], rules: { total: 0, unenforced: 0 } });
  });

  it("counts path rules of packs and .warrant/local/rules/, and those without enforced_by (SCN-KRN-104)", async () => {
    const p = project()
      .write(".warrant/warrant.json", config({ policy: { version: "^1.0" }, rules: { version: "^1.0" } }))
      .write(".warrant/local/rules/ids-allocated-by-cli.json", {
        $schema: "warrant://rule/1",
        id: "ids-allocated-by-cli",
        paths: ["**"],
        text: "Stable ids are allocated by warrant id, never by hand.",
        enforced_by: "ids-valid"
      });
    const run = await status(p);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["rules"]).toEqual({ total: 3, unenforced: 1 });
  });
});
