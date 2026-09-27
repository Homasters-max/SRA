/**
 * `warrant unknown add | resolve` in the test process (REQ-KRN-035,
 * SCN-KRN-148…153): UNKNOWNs are written to and closed in `unknowns[]` of the
 * record before approval, a blocking one only by the maintainer's decision
 * with a ref; every refusal leaves the record as it was, with a `hint`.
 *
 * The project is the synced core-sdd one with Change `add-search`; an archived
 * Change already holds `UNK-SRC-003`, so the next id is `UNK-SRC-004`
 * (REQ-KRN-024).
 */
import { describe, expect, it } from "vitest";

import { runStatus } from "../../../src/commands/status.js";
import { runUnknownAdd, runUnknownResolve, type UnknownAddOptions, type UnknownResolveOptions } from "../../../src/commands/unknown.js";
import type { Ctx } from "../../../src/core/ctx.js";
import type { CommandResult } from "../../../src/io/output.js";
import { withoutDryRun } from "../helpers/dry-run.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const project = useProjectBuilder();

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

const RECORD = ".warrant/changes/add-search.json";
const QUESTION = "Что делать при часах, идущих назад?";
const REF = "https://github.com/o/r/pull/7#issuecomment-11";

function add(p: ProjectBuilder, opts: UnknownAddOptions, ctx: Ctx = p.ctx): Promise<Result> {
  return invoke(() => runUnknownAdd(ctx, "add-search", opts));
}

function resolve(p: ProjectBuilder, id: string, opts: UnknownResolveOptions, change = "add-search"): Promise<Result> {
  return invoke(() => runUnknownResolve(p.ctx, change, id, opts));
}

/** Synced project with record `add-search` in `state`; `UNK-SRC-003` is taken by an archived Change. */
async function withChange(state: string, extra: Record<string, unknown> = {}): Promise<ProjectBuilder> {
  const p = project()
    .withChange("add-search", { design: "# Design\n", tasks: "# Tasks\n", specs: { search: [] } })
    .withRecord("add-search", state, extra)
    .write("openspec/changes/archive/2026-09-01-clock/proposal.md", "# Proposal\n\n### Unknown: clock\n<!-- id: UNK-SRC-003 -->\n")
    .withOpenspecValidate();
  return p.synced();
}

/** Expects a refusal with `code` and a `hint`, exit 3, the record byte for byte as before. */
async function refused(p: ProjectBuilder, run: Promise<Result>, code: string): Promise<Result> {
  const before = p.read(RECORD);
  const result = await run;
  expect(result.errors.map((e) => e.code)).toEqual([code]);
  expect(result.errors[0]?.hint ?? "").not.toBe("");
  expect(result.exitCode).toBe(3);
  expect(p.read(RECORD)).toBe(before);
  return result;
}

describe("warrant unknown add", () => {
  it("records a blocking UNKNOWN with the next id; status answers WAIT, next clarify (SCN-KRN-148)", async () => {
    const p = await withChange("PROPOSED");
    const transitions = p.json(RECORD).transitions;
    const run = await add(p, { area: "SRC", text: QUESTION, blocking: true });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const unknown = { id: "UNK-SRC-004", text: QUESTION, blocking: true };
    expect(run.data).toEqual({ change: "add-search", unknown, open_blocking: ["UNK-SRC-004"] });
    const record = p.json(RECORD);
    expect(record.unknowns).toEqual([unknown]);
    expect(record.transitions).toEqual(transitions);
    expect(record.change_state).toBe("PROPOSED");

    const status = (await invoke(() => runStatus(p.ctx, "add-search", {}))) as Result;
    const verification = status.data["verification"];
    expect(Object.values(verification.gates)).not.toContain("FAIL");
    expect(verification.controller_action).toBe("WAIT");
    expect(verification.next).toBe("clarify");
    expect(verification.rule).toBe("blocking-unknown");
  });

  it("refuses after approval with STATE_INVALID naming a line I-N in design.md (SCN-KRN-152)", async () => {
    const p = await withChange("APPROVED");
    const run = await refused(p, add(p, { area: "SRC", text: "…" }), "STATE_INVALID");
    expect(run.errors[0]?.hint).toContain("I-N");
    expect(run.errors[0]?.hint).toContain("design.md");
  });

  it("refuses an undeclared AREA with AREA_UNKNOWN and a hint", async () => {
    const p = await withChange("PROPOSED");
    const run = await refused(p, add(p, { area: "ZZZ", text: "…" }), "AREA_UNKNOWN");
    expect(run.errors[0]?.hint).toContain("SRC");
  });

  it("prints under --dry-run the id a real run would give and writes nothing (SCN-KRN-153)", async () => {
    const p = await withChange("PROPOSED");
    const before = p.read(RECORD);
    const dry = await add(p, { area: "SRC", text: "…" }, p.dryRun());
    expect(dry.exitCode).toBe(0);
    expect(dry.data["dry_run"]).toBe(true);
    expect(dry.data["unknown"].id).toBe("UNK-SRC-004");
    expect(dry.data["would_write"]).toContain(RECORD);
    expect(p.read(RECORD)).toBe(before);

    const real = await add(p, { area: "SRC", text: "…" });
    expect(withoutDryRun(dry.data)).toEqual(real.data);
  });
});

describe("warrant unknown resolve", () => {
  const BLOCKING = { id: "UNK-SRC-004", text: QUESTION, blocking: true };
  const OPEN = { id: "UNK-SRC-005", text: "Is the index rebuilt nightly?", blocking: false };

  it("closes a blocking UNKNOWN by the maintainer's decision with ref (SCN-KRN-149)", async () => {
    const p = await withChange("SPECIFIED", { unknowns: [BLOCKING] });
    const run = await resolve(p, "UNK-SRC-004", { as: "decision", text: "Часы назад — метка сдвигается", ref: REF });
    expect(run.errors).toEqual([]);
    expect(run.exitCode).toBe(0);
    const closed = { ...BLOCKING, resolution: "Часы назад — метка сдвигается", resolved_as: "decision", ref: REF };
    expect(run.data).toEqual({ change: "add-search", unknown: closed, open_blocking: [] });
    expect(p.json(RECORD).unknowns).toEqual([closed]);
  });

  it("refuses a blocking UNKNOWN without the decision with ref; fact closes a non-blocking one (SCN-KRN-150)", async () => {
    const p = await withChange("PROPOSED", { unknowns: [BLOCKING, OPEN] });
    for (const opts of [{ as: "decision", text: "…" }, { as: "fact", text: "…" }]) {
      const run = await refused(p, resolve(p, "UNK-SRC-004", opts), "USAGE");
      expect(run.errors[0]?.hint, opts.as).toContain("#issuecomment-");
      expect(run.errors[0]?.hint, opts.as).toContain("UNK-SRC-004");
    }

    const run = await resolve(p, "UNK-SRC-005", { as: "fact", text: "Nightly" });
    expect(run.exitCode).toBe(0);
    expect(run.data["unknown"]).toEqual({ ...OPEN, resolution: "Nightly", resolved_as: "fact" });
    expect(run.data["open_blocking"]).toEqual(["UNK-SRC-004"]);
    const record = p.json(RECORD);
    expect(record.unknowns[1]).toEqual({ ...OPEN, resolution: "Nightly", resolved_as: "fact" });
    expect(record.assumptions).toBeUndefined();
  });

  it("assumption closes a non-blocking UNKNOWN and adds nothing to assumptions[] (SCN-KRN-150)", async () => {
    const p = await withChange("PROPOSED", { unknowns: [OPEN] });
    const run = await resolve(p, "UNK-SRC-005", { as: "assumption", text: "Nightly" });
    expect(run.exitCode).toBe(0);
    expect(p.json(RECORD).assumptions).toBeUndefined();
  });

  it("refuses an unknown id, a closed one, a blank answer, a Change without record; --replace rewrites (SCN-KRN-151)", async () => {
    const p = await withChange("PROPOSED", { unknowns: [OPEN] });
    const missing = await refused(p, resolve(p, "UNK-SRC-009", { as: "fact", text: "…" }), "UNKNOWN_NOT_FOUND");
    expect(missing.errors[0]?.hint).toContain("UNK-SRC-005");

    expect((await resolve(p, "UNK-SRC-005", { as: "fact", text: "Nightly" })).exitCode).toBe(0);
    const closed = await refused(p, resolve(p, "UNK-SRC-005", { as: "fact", text: "Hourly" }), "UNKNOWN_RESOLVED");
    expect(closed.errors[0]?.hint).toContain("--replace");
    await refused(p, resolve(p, "UNK-SRC-005", { as: "fact", text: "  " }), "USAGE");
    const noRecord = await invoke(() => runUnknownResolve(p.ctx, "no-such", "UNK-SRC-005", { as: "fact", text: "…" }));
    expect(noRecord.errors.map((e) => e.code)).toEqual(["CHANGE_NOT_FOUND"]);
    expect(noRecord.errors[0]?.hint ?? "").not.toBe("");
    expect(noRecord.exitCode).toBe(3);

    const replaced = await resolve(p, "UNK-SRC-005", { as: "fact", text: "Hourly", replace: true });
    expect(replaced.exitCode).toBe(0);
    expect(p.json(RECORD).unknowns).toEqual([{ ...OPEN, resolution: "Hourly", resolved_as: "fact" }]);
  });

  it("refuses a ref that is not an http(s) URL and --as outside the three kinds", async () => {
    const p = await withChange("PROPOSED", { unknowns: [BLOCKING] });
    await refused(p, resolve(p, "UNK-SRC-004", { as: "decision", text: "…", ref: "pull/7#issuecomment-11" }), "USAGE");
    await refused(p, resolve(p, "UNK-SRC-004", { as: "guess", text: "…", ref: REF }), "USAGE");
  });

  it("refuses after approval with STATE_INVALID (SCN-KRN-152)", async () => {
    const p = await withChange("IMPLEMENTING", { unknowns: [BLOCKING] });
    const run = await refused(p, resolve(p, "UNK-SRC-004", { as: "decision", text: "…", ref: REF }), "STATE_INVALID");
    expect(run.errors[0]?.hint).toContain("I-N");
  });
});
