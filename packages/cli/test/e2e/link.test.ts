/**
 * `warrant link` end to end (REQ-KRN-030, SCN-KRN-118, 119, 120): links
 * between Changes are written only before approval, to a target check (10)
 * of `validate` accepts, and show up as back-links in `status` of the target.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { openspecAvailable } from "../../src/core/openspec/cli.js";
import { runCli, type CliRun } from "../helpers/cli.js";
import { PACKS, record, useSyncedProject, validate, write } from "../helpers/synced.js";

const hasOpenspec = openspecAvailable();
const project = useSyncedProject();

function link(root: string, ...args: string[]): Promise<CliRun> {
  return runCli(["link", ...args], root, { WARRANT_PACKS_DIR: PACKS });
}

function recordText(root: string, change: string): string {
  return readFileSync(path.join(root, ".warrant", "changes", `${change}.json`), "utf8");
}

/** Project with `fix-search` in `state` and `add-search` in `target`. */
function linked(state: string, target: string, extra: Record<string, unknown> = {}): string {
  const root = project();
  write(root, ".warrant/changes/add-search.json", record("add-search", target));
  write(root, ".warrant/changes/fix-search.json", record("fix-search", state, extra));
  return root;
}

describe.skipIf(!hasOpenspec)("warrant link", () => {
  it("adds an ARCHIVED target to amends[] once and status of the target shows amended_by (SCN-KRN-118)", async () => {
    const root = linked("PROPOSED", "ARCHIVED");

    const run = await link(root, "fix-search", "--amends", "add-search");
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json.data).toEqual({ field: "amends", target: "add-search", action: "add", changed: true, amends: ["add-search"] });
    const stored = JSON.parse(recordText(root, "fix-search")) as Record<string, unknown>;
    expect(stored["amends"]).toEqual(["add-search"]);
    // Canonical, as every writer of the CLI.
    expect(recordText(root, "fix-search")).toBe(canonicalText(stored as never).text);

    const again = await link(root, "fix-search", "--amends", "add-search");
    expect(again.status).toBe(0);
    expect(again.json.data.changed).toBe(false);
    expect((JSON.parse(recordText(root, "fix-search")) as { amends: string[] }).amends).toEqual(["add-search"]);

    const status = await runCli(["status", "add-search"], root, { WARRANT_PACKS_DIR: PACKS });
    expect(status.json?.data.amended_by).toEqual(["fix-search"]);
    expect(status.json?.data.superseded_by).toEqual([]);
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 60_000);

  it("adds an ABANDONED target to supersedes[] (REQ-KRN-030)", async () => {
    const root = linked("SPECIFIED", "ABANDONED");
    const run = await link(root, "fix-search", "--supersedes", "add-search");
    expect(run.status).toBe(0);
    expect((JSON.parse(recordText(root, "fix-search")) as { supersedes: string[] }).supersedes).toEqual(["add-search"]);
    const status = await runCli(["status", "add-search"], root, { WARRANT_PACKS_DIR: PACKS });
    expect(status.json?.data.superseded_by).toEqual(["fix-search"]);
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 60_000);

  it("refuses a target in the wrong state, a missing target and itself with LINK_TARGET_INVALID (SCN-KRN-119)", async () => {
    const root = linked("PROPOSED", "ARCHIVED");
    const before = recordText(root, "fix-search");

    const wrong = await link(root, "fix-search", "--supersedes", "add-search");
    expect(wrong.json?.errors[0].code).toBe("LINK_TARGET_INVALID");
    expect(wrong.status).toBe(3);

    const missing = await link(root, "fix-search", "--amends", "no-such-change");
    expect(missing.json?.errors[0].code).toBe("LINK_TARGET_INVALID");
    const self = await link(root, "fix-search", "--amends", "fix-search");
    expect(self.json?.errors[0].code).toBe("LINK_TARGET_INVALID");
    expect(recordText(root, "fix-search")).toBe(before);
  }, 60_000);

  it("refuses from APPROVED on with STATE_INVALID, RECORD_FROZEN when frozen; --remove in SPECIFIED removes (SCN-KRN-120)", async () => {
    const root = linked("APPROVED", "ARCHIVED");
    const before = recordText(root, "fix-search");
    const approved = await link(root, "fix-search", "--amends", "add-search");
    expect(approved.json?.errors[0].code).toBe("STATE_INVALID");
    expect(approved.status).toBe(3);
    expect(recordText(root, "fix-search")).toBe(before);

    write(root, ".warrant/changes/fix-search.json", record("fix-search", "ABANDONED"));
    const frozen = await link(root, "fix-search", "--amends", "add-search");
    expect(frozen.json?.errors[0].code).toBe("RECORD_FROZEN");
    expect(frozen.status).toBe(3);

    write(root, ".warrant/changes/fix-search.json", record("fix-search", "SPECIFIED", { amends: ["add-search"] }));
    const removed = await link(root, "fix-search", "--amends", "add-search", "--remove");
    expect(removed.json?.errors).toEqual([]);
    expect(removed.json.data).toMatchObject({ action: "remove", changed: true, amends: [] });
    expect(JSON.parse(recordText(root, "fix-search"))).not.toHaveProperty("amends");
    expect((await validate(root)).json?.errors).toEqual([]);
  }, 60_000);

  it("needs exactly one of --amends, --supersedes (USAGE) and a known change (CHANGE_NOT_FOUND)", async () => {
    const root = linked("PROPOSED", "ARCHIVED");
    const none = await link(root, "fix-search");
    expect(none.json?.errors[0].code).toBe("USAGE");
    expect(none.status).toBe(3);
    const both = await link(root, "fix-search", "--amends", "add-search", "--supersedes", "add-search");
    expect(both.json?.errors[0].code).toBe("USAGE");
    const unknown = await link(root, "no-such", "--amends", "add-search");
    expect(unknown.json?.errors[0].code).toBe("CHANGE_NOT_FOUND");
  }, 60_000);
});
