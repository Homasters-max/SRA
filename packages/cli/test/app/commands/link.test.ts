/**
 * `warrant link` in the test process (REQ-KRN-030, SCN-KRN-118, 119, 120):
 * links between Changes are written only before approval, to a target check
 * (10) of `validate` accepts, and show up as back-links in `status` of the
 * target. Moved from e2e (ADR-0025, task 5.4); the parse of argv
 * (`--amends`, `--supersedes`, `--remove`) and the exit codes of the binary
 * stay in `e2e/link.test.ts`.
 */
import { describe, expect, it } from "vitest";

import { runLink, type LinkOptions } from "../../../src/commands/link.js";
import { runStatus } from "../../../src/commands/status.js";
import { runValidate } from "../../../src/commands/validate.js";
import { canonicalText } from "../../../src/core/canon/format-json.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const project = useProjectBuilder();

/** Environment of a local run: no CI attestation, whatever the environment of the test runner. */
const LOCAL: NodeJS.ProcessEnv = {};

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function link(p: ProjectBuilder, change: string, opts: LinkOptions): Promise<Result> {
  return invoke(() => runLink(p.ctx, change, opts));
}

function status(p: ProjectBuilder, change: string): Promise<Result> {
  return invoke(() => runStatus(p.ctx, change, LOCAL));
}

async function validateErrors(p: ProjectBuilder): Promise<unknown[]> {
  return (await invoke(() => runValidate(p.ctx))).errors;
}

function recordText(p: ProjectBuilder, change: string): string {
  return p.read(`.warrant/changes/${change}.json`);
}

/** Synced project with `fix-search` in `state` and `add-search` in `target`. */
async function linked(state: string, target: string, extra: Record<string, unknown> = {}): Promise<ProjectBuilder> {
  const p = project().withRecord("add-search", target).withRecord("fix-search", state, extra);
  return p.synced();
}

describe("warrant link", () => {
  it("adds an ARCHIVED target to amends[] once and status of the target shows amended_by (SCN-KRN-118)", async () => {
    const p = await linked("PROPOSED", "ARCHIVED");

    const run = await link(p, "fix-search", { amends: "add-search" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data).toEqual({ field: "amends", target: "add-search", action: "add", changed: true, amends: ["add-search"] });
    const stored = JSON.parse(recordText(p, "fix-search")) as Record<string, unknown>;
    expect(stored["amends"]).toEqual(["add-search"]);
    // Canonical, as every writer of the CLI.
    expect(recordText(p, "fix-search")).toBe(canonicalText(stored as never).text);

    const again = await link(p, "fix-search", { amends: "add-search" });
    expect(again.exitCode).toBe(0);
    expect(again.data["changed"]).toBe(false);
    expect((JSON.parse(recordText(p, "fix-search")) as { amends: string[] }).amends).toEqual(["add-search"]);

    const shown = await status(p, "add-search");
    expect(shown.data["amended_by"]).toEqual(["fix-search"]);
    expect(shown.data["superseded_by"]).toEqual([]);
    expect(await validateErrors(p)).toEqual([]);
  });

  it("adds an ABANDONED target to supersedes[] (REQ-KRN-030)", async () => {
    const p = await linked("SPECIFIED", "ABANDONED");
    const run = await link(p, "fix-search", { supersedes: "add-search" });
    expect(run.exitCode).toBe(0);
    expect((JSON.parse(recordText(p, "fix-search")) as { supersedes: string[] }).supersedes).toEqual(["add-search"]);
    expect((await status(p, "add-search")).data["superseded_by"]).toEqual(["fix-search"]);
    expect(await validateErrors(p)).toEqual([]);
  });

  it("refuses a target in the wrong state, a missing target and itself with LINK_TARGET_INVALID (SCN-KRN-119)", async () => {
    const p = await linked("PROPOSED", "ARCHIVED");
    const before = recordText(p, "fix-search");

    const wrong = await link(p, "fix-search", { supersedes: "add-search" });
    expect(wrong.errors[0]?.code).toBe("LINK_TARGET_INVALID");
    expect(wrong.exitCode).toBe(3);

    const missing = await link(p, "fix-search", { amends: "no-such-change" });
    expect(missing.errors[0]?.code).toBe("LINK_TARGET_INVALID");
    const self = await link(p, "fix-search", { amends: "fix-search" });
    expect(self.errors[0]?.code).toBe("LINK_TARGET_INVALID");
    expect(recordText(p, "fix-search")).toBe(before);
  });

  it("refuses from APPROVED on with STATE_INVALID, RECORD_FROZEN when frozen; --remove in SPECIFIED removes (SCN-KRN-120)", async () => {
    const p = await linked("APPROVED", "ARCHIVED");
    const before = recordText(p, "fix-search");
    const approved = await link(p, "fix-search", { amends: "add-search" });
    expect(approved.errors[0]?.code).toBe("STATE_INVALID");
    expect(approved.exitCode).toBe(3);
    expect(recordText(p, "fix-search")).toBe(before);

    p.withRecord("fix-search", "ABANDONED");
    const frozen = await link(p, "fix-search", { amends: "add-search" });
    expect(frozen.errors[0]?.code).toBe("RECORD_FROZEN");
    expect(frozen.exitCode).toBe(3);

    p.withRecord("fix-search", "SPECIFIED", { amends: ["add-search"] });
    const removed = await link(p, "fix-search", { amends: "add-search", remove: true });
    expect(removed.errors).toEqual([]);
    expect(removed.data).toMatchObject({ action: "remove", changed: true, amends: [] });
    expect(JSON.parse(recordText(p, "fix-search"))).not.toHaveProperty("amends");
    expect(await validateErrors(p)).toEqual([]);
  });

  it("needs exactly one of --amends, --supersedes (USAGE) and a known change (CHANGE_NOT_FOUND)", async () => {
    const p = await linked("PROPOSED", "ARCHIVED");
    const none = await link(p, "fix-search", {});
    expect(none.errors[0]?.code).toBe("USAGE");
    expect(none.exitCode).toBe(3);
    const both = await link(p, "fix-search", { amends: "add-search", supersedes: "add-search" });
    expect(both.errors[0]?.code).toBe("USAGE");
    const unknown = await link(p, "no-such", { amends: "add-search" });
    expect(unknown.errors[0]?.code).toBe("CHANGE_NOT_FOUND");
  });
});
