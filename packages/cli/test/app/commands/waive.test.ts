/**
 * `warrant waive` in the test process (REQ-KRN-031, SCN-KRN-121, 122, 123, 124):
 * propose a waiver, activate and revoke it as a maintainer, and the verdict of
 * the waived gate in `warrant gate` at each step. Moved from e2e (ADR-0025,
 * task 5.1); the parse of argv and the exit code of the binary stay in
 * `e2e/waive.test.ts`.
 *
 * The id counts per UTC year of `ctx.clock`: the fake clock fixes it, so the
 * seeded waivers and the expected id use its year.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runGate } from "../../../src/commands/gate.js";
import { runWaive, type WaiveOptions } from "../../../src/commands/waive.js";
import { canonicalText } from "../../../src/core/canon/format-json.js";
import { FAKE_TODAY } from "../helpers/fakes/clock.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

const YEAR = FAKE_TODAY.slice(0, 4);
const EXPIRES = `${YEAR}-12-31`;
const wav = (n: number): string => `WAV-${YEAR}-${String(n).padStart(3, "0")}`;

function waiverFile(p: ProjectBuilder, id: string): string {
  return path.join(p.root, ".warrant", "waivers", `${id}.json`);
}

function readWaiver(p: ProjectBuilder, id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(waiverFile(p, id), "utf8")) as Record<string, unknown>;
}

/** A waiver seeded as a file, on a gate other than analyze-clean. */
function seeded(id: string, state: string, gate: string): Record<string, unknown> & { id: string } {
  return {
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
 * `VERIFYING->MERGED` has `analyze-clean`), waivers `001` and `004` of the
 * clock's year, one commit on `main`.
 */
async function repo(): Promise<ProjectBuilder> {
  const p = await project()
    .withChange("add-search", { design: "# Doc\n", tasks: "# Doc\n", specs: { search: [] } })
    .withRecord("add-search", "VERIFYING", { classification: { profiles: ["feature"] } })
    .withWaiver(seeded(wav(1), "REVOKED", "adversarial-review"))
    .withWaiver(seeded(wav(4), "PROPOSED", "branch-isolated"))
    .synced();
  p.commit("base");
  return p;
}

function waive(p: ProjectBuilder, args: string[], opts: WaiveOptions): ReturnType<typeof invoke> {
  return invoke(() => runWaive(p.ctx, args, opts));
}

async function analyzeClean(p: ProjectBuilder): Promise<string> {
  const run = await invoke(() => runGate(p.ctx, "add-search", [], {}, {}));
  expect(run.data["transition"]).toBe("VERIFYING->MERGED");
  return (run.data["gates"] as Record<string, string>)["analyze-clean"] as string;
}

const TARGET = ["add-search", "analyze-clean"];
const PROPOSE: WaiveOptions = {
  reason: "no analyze yet",
  risk: "HIGH",
  control: ["maintainer review"],
  owner: "human:kat",
  expires: EXPIRES
};

describe("warrant waive", () => {
  it("proposes WAV-<year>-005 after 001 and 004: PROPOSED, no approved_by, gate still BLOCKED (SCN-KRN-121)", async () => {
    const p = await repo();
    const run = await waive(p, TARGET, PROPOSE);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const id = wav(5);
    expect(run.data["path"]).toBe(`.warrant/waivers/${id}.json`);
    const stored = readWaiver(p, id);
    expect(run.data["waiver"]).toEqual(stored);
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
    expect(readFileSync(waiverFile(p, id), "utf8")).toBe(canonicalText(stored as never).text);
    expect(await validateErrors(p)).toEqual([]);
    expect(await analyzeClean(p)).toBe("BLOCKED");
  });

  it("activates as a maintainer: ACTIVE, approved_by human:kat, gate WAIVED; bob is ROLE_REQUIRED (SCN-KRN-122)", async () => {
    const p = await repo();
    expect((await waive(p, TARGET, PROPOSE)).exitCode).toBe(0);
    const id = wav(5);
    const before = readFileSync(waiverFile(p, id), "utf8");

    const bob = await waive(p, [], { activate: id, by: "bob" });
    expect(bob.errors[0]?.code).toBe("ROLE_REQUIRED");
    expect(bob.exitCode).toBe(3);
    expect(readFileSync(waiverFile(p, id), "utf8")).toBe(before);

    const run = await waive(p, [], { activate: id, by: "kat" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(run.data["waiver"]).toMatchObject({ id, waiver_state: "ACTIVE", approved_by: "human:kat" });
    expect(readWaiver(p, id)).toMatchObject({ waiver_state: "ACTIVE", approved_by: "human:kat" });
    expect(await validateErrors(p)).toEqual([]);
    expect(await analyzeClean(p)).toBe("WAIVED");
  });

  it("refuses a gate that is not waivable with WAIVER_INVALID and writes no file (SCN-KRN-123)", async () => {
    const p = await repo();
    const before = readdirSync(path.join(p.root, ".warrant", "waivers")).sort();
    const run = await waive(p, ["add-search", "scope-valid"], PROPOSE);
    expect(run.errors[0]?.code).toBe("WAIVER_INVALID");
    expect(run.exitCode).toBe(3);
    const unknownGate = await waive(p, ["add-search", "no-such-gate"], PROPOSE);
    expect(unknownGate.errors[0]?.code).toBe("WAIVER_INVALID");
    expect(readdirSync(path.join(p.root, ".warrant", "waivers")).sort()).toEqual(before);
  });

  it("revokes an ACTIVE waiver: REVOKED, gate BLOCKED again, a second --activate is STATE_INVALID (SCN-KRN-124)", async () => {
    const p = await repo();
    const id = wav(5);
    expect((await waive(p, TARGET, PROPOSE)).exitCode).toBe(0);
    expect((await waive(p, [], { activate: id, by: "kat" })).exitCode).toBe(0);

    const run = await waive(p, [], { revoke: id, by: "kat" });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    expect(readWaiver(p, id)).toMatchObject({ waiver_state: "REVOKED", approved_by: "human:kat" });
    expect(await validateErrors(p)).toEqual([]);
    expect(await analyzeClean(p)).toBe("BLOCKED");

    const again = await waive(p, [], { activate: id, by: "kat" });
    expect(again.errors[0]?.code).toBe("STATE_INVALID");
    expect(again.exitCode).toBe(3);
    const revokeAgain = await waive(p, [], { revoke: id, by: "kat" });
    expect(revokeAgain.errors[0]?.code).toBe("STATE_INVALID");

    // A PROPOSED waiver may be revoked too; the maintainer who closed it is its approved_by.
    const proposed = await waive(p, [], { revoke: wav(4), by: "kat" });
    expect(proposed.exitCode).toBe(0);
    expect(readWaiver(p, wav(4))).toMatchObject({ waiver_state: "REVOKED", approved_by: "human:kat" });
    expect(await validateErrors(p)).toEqual([]);
  });

  it("reports usage errors, an unknown waiver, an unknown and a frozen change", async () => {
    const p = await repo();
    const { control: _control, ...noControl } = PROPOSE;
    const cases: [string, string[], WaiveOptions, string][] = [
      ["--activate and --revoke", [], { activate: wav(4), revoke: wav(4), by: "kat" }, "USAGE"],
      ["--activate with a change", ["add-search"], { activate: wav(4), by: "kat" }, "USAGE"],
      ["--activate without --by", [], { activate: wav(4) }, "USAGE"],
      ["unknown waiver", [], { activate: "WAV-1999-001", by: "kat" }, "WAIVER_INVALID"],
      ["--expires before today", TARGET, { ...PROPOSE, expires: "2000-01-01" }, "USAGE"],
      ["--expires not a date", TARGET, { ...PROPOSE, expires: "31.12.2099" }, "USAGE"],
      ["no --control", TARGET, noControl, "USAGE"],
      ["--owner without human:", TARGET, { ...PROPOSE, owner: "kat" }, "USAGE"],
      ["--risk outside LOW|MEDIUM|HIGH", TARGET, { ...PROPOSE, risk: "SEVERE" }, "USAGE"],
      ["--by on a proposal", TARGET, { ...PROPOSE, by: "kat" }, "USAGE"],
      ["unknown change", ["no-such", "analyze-clean"], PROPOSE, "CHANGE_NOT_FOUND"]
    ];
    for (const [name, args, opts, code] of cases) {
      const run = await waive(p, args, opts);
      expect({ name, code: run.errors[0]?.code }).toEqual({ name, code });
      expect(run.exitCode).toBe(3);
    }
    expect(existsSync(waiverFile(p, wav(5)))).toBe(false);

    p.withRecord("add-search", "ARCHIVED");
    const frozen = await waive(p, TARGET, PROPOSE);
    expect(frozen.errors[0]?.code).toBe("RECORD_FROZEN");
  });
});
