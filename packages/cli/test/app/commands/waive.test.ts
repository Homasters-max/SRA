/**
 * `warrant waive` in the test process (REQ-KRN-031, SCN-KRN-121, 122, 123, 124):
 * propose a waiver, activate and revoke it as a maintainer, and the verdict of
 * the waived gate in `warrant gate` at each step. Moved from e2e (ADR-0025,
 * task 5.1); the parse of argv and the exit code of the binary stay in
 * `e2e/waive.test.ts`.
 *
 * A new waiver is `WAV-<ULID>` (ADR-0056 п. 2); the seeded ones keep the former
 * form `WAV-<year>-NNN` of the fake clock's year, valid and activatable.
 */
import { copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runGate } from "../../../src/commands/gate.js";
import { runWaive, type WaiveOptions } from "../../../src/commands/waive.js";
import { canonicalText } from "../../../src/core/canon/format-json.js";
import { FAKE_TODAY } from "../helpers/fakes/clock.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { withoutDryRun, writtenBeyond } from "../helpers/dry-run.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

const YEAR = FAKE_TODAY.slice(0, 4);
const EXPIRES = `${YEAR}-12-31`;
const wav = (n: number): string => `WAV-${YEAR}-${String(n).padStart(3, "0")}`;
const ULID_WAV = /^WAV-[0-9A-HJKMNP-TV-Z]{26}$/;

function waiverFile(p: ProjectBuilder, id: string): string {
  return path.join(p.root, ".warrant", "waivers", `${id}.json`);
}

/** `warrant waive` of TARGET with PROPOSE; the id of the new waiver. */
async function proposed(p: ProjectBuilder): Promise<string> {
  const run = await waive(p, TARGET, PROPOSE);
  expect(run.exitCode).toBe(0);
  return (run.data["waiver"] as { id: string }).id;
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
 * clock's year. No git on purpose: without a diff `analyze-clean` is
 * `BLOCKED` with `NO_INPUT` (REQ-VER-004), the gate SCN-KRN-121, 122 and 124
 * speak of; with a diff it is computed and passes on this Change (I-166).
 */
async function repo(): Promise<ProjectBuilder> {
  const p = await project()
    .withChange("add-search", { design: "# Doc\n", tasks: "# Doc\n", specs: { search: [] } })
    .withRecord("add-search", "VERIFYING", { classification: { profiles: ["feature"] } })
    .withWaiver(seeded(wav(1), "REVOKED", "adversarial-review"))
    .withWaiver(seeded(wav(4), "PROPOSED", "branch-isolated"))
    .synced();
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
  it("proposes WAV-<ULID> beside 001 and 004: PROPOSED, no approved_by, gate still BLOCKED (SCN-KRN-121)", async () => {
    const p = await repo();
    const run = await waive(p, TARGET, PROPOSE);
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const id = (run.data["waiver"] as { id: string }).id;
    expect(id).toMatch(ULID_WAV);
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

  it("activates as a maintainer: ACTIVE, approved_by human:kat, gate WAIVED; bob is ROLE_REQUIRED; the id in lower case is WAIVER_INVALID (SCN-KRN-122, SCN-KRN-171)", async () => {
    const p = await repo();
    const id = await proposed(p);
    const untouched = p.tree();
    const lower = await waive(p, [], { activate: id.toLowerCase(), by: "kat" });
    expect(lower.errors[0]?.code).toBe("WAIVER_INVALID");
    expect(lower.exitCode).toBe(3);
    expect(p.tree()).toEqual(untouched);

    // A PROPOSED waiver of the former form activates as before.
    const formerForm = await waive(p, [], { activate: wav(4), by: "kat" });
    expect(formerForm.errors).toEqual([]);
    expect(readWaiver(p, wav(4))).toMatchObject({ waiver_state: "ACTIVE", approved_by: "human:kat" });
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

  it("two copies of one project propose waivers of distinct names; brought together they validate, WAV-<year>-004 still valid (SCN-KRN-168)", async () => {
    const p = await repo();
    const q = await repo();
    const ours = await proposed(p);
    const theirs = await proposed(q);
    expect(theirs).not.toBe(ours);
    copyFileSync(waiverFile(q, theirs), waiverFile(p, theirs));
    expect(readdirSync(path.join(p.root, ".warrant", "waivers")).sort()).toEqual([`${ours}.json`, `${theirs}.json`, `${wav(1)}.json`, `${wav(4)}.json`].sort());
    expect(await validateErrors(p)).toEqual([]);
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

  it("revokes an ACTIVE waiver: REVOKED, gate BLOCKED again, a second --activate is STATE_INVALID (SCN-KRN-124, SCN-KRN-171)", async () => {
    const p = await repo();
    const id = await proposed(p);
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
    const formerForm = await waive(p, [], { revoke: wav(4), by: "kat" });
    expect(formerForm.exitCode).toBe(0);
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

describe("warrant waive --dry-run (REQ-KRN-034)", () => {
  function dry(p: ProjectBuilder, args: string[], opts: WaiveOptions): ReturnType<typeof invoke> {
    return invoke(() => runWaive(p.dryRun(), args, opts));
  }

  it("proposes and activates on paper: the same JSON, the waiver in would_write[], no file written", async () => {
    const p = await repo();
    const before = p.tree();
    const onPaper = await dry(p, TARGET, PROPOSE);
    expect(onPaper.errors).toEqual([]);
    expect(onPaper.exitCode).toBe(0);
    const paperId = (onPaper.data["waiver"] as { id: string }).id;
    expect(onPaper.data["would_write"]).toEqual([`.warrant/waivers/${paperId}.json`]);
    expect(p.tree()).toEqual(before);

    // The id of a dry run is illustrative: a ULID is new on every call (ADR-0056 п. 2, backlog R-60).
    const real = await waive(p, TARGET, PROPOSE);
    const id = (real.data["waiver"] as { id: string }).id;
    expect(withoutDryRun(onPaper.data)).toEqual(JSON.parse(JSON.stringify(withoutDryRun(real.data)).split(id).join(paperId)));
    expect(writtenBeyond(before, p.tree(), [`.warrant/waivers/${id}.json`])).toEqual([]);

    const proposedTree = p.tree();
    const activated = await dry(p, [], { activate: id, by: "kat" });
    expect(activated.data).toMatchObject({ dry_run: true, would_write: [`.warrant/waivers/${id}.json`] });
    expect(activated.data["waiver"]).toMatchObject({ waiver_state: "ACTIVE", approved_by: "human:kat" });
    expect(p.tree()).toEqual(proposedTree);
    expect(await analyzeClean(p)).toBe("BLOCKED");

    const bob = await dry(p, [], { activate: id, by: "bob" });
    expect(bob.errors[0]?.code).toBe("ROLE_REQUIRED");
    expect(bob.exitCode).toBe(3);
    expect(bob.data).toEqual({ dry_run: true, would_write: [] });
  });
});
