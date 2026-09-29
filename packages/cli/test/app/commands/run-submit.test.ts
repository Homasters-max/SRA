/**
 * `warrant run submit` in the test process (REQ-ENF-007, SCN-ENF-030…035):
 * the envelope of the active review Run from stdin or `--file`, the evidence
 * record `kind: review` with its status by the findings (N22), the envelope
 * beside the Run, the Run finished; the refusals that write nothing — an
 * envelope of another skill of the packs among them (R-20) — and `--dry-run`
 * with the one write plan.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runSubmit, type RunSubmitOptions } from "../../../src/commands/run.js";
import { canonicalText } from "../../../src/core/canon/format-json.js";
import { bytesHash } from "../../../src/core/canon/hash.js";
import type { Ctx } from "../../../src/core/ctx.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CORE_SDD_RANGE, REPO_ROOT } from "../../helpers/cli.js";
import { withoutDryRun, writtenBeyond } from "../helpers/dry-run.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";
import { started } from "../helpers/run.js";
import { validateErrors } from "../helpers/validate.js";

const project = useProjectBuilder();

/** No `WARRANT_STATE_DIR`: `<state>` is `.warrant` of the project. */
const ENV: NodeJS.ProcessEnv = {};
const RUNS = ".warrant/runs";
const CURRENT = `${RUNS}/current`;
const EVIDENCE = ".warrant/evidence/add-search";
const SPEC = "openspec/changes/add-search/specs/search/spec.md";

type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

/** `add-search` in `state`, synced, its spec committed. */
async function repo(state = "PROPOSED"): Promise<ProjectBuilder> {
  const p = project()
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { "core-sdd": { version: CORE_SDD_RANGE } },
      paths: { src: "src", tests: "tests" },
      roles: { maintainer: ["kat"] }
    })
    .withRecord("add-search", state)
    .withChange("add-search", { tasks: "## 1. Search\n\n- [ ] 1.1 Index\n" })
    .write(SPEC, "## ADDED Requirements\n");
  await p.synced();
  p.commit("spec");
  return p;
}

/** The review skill of the pack as the lock holds it: `<name>@<version>`. */
function reviewSkill(p: ProjectBuilder): string {
  const skills = (JSON.parse(p.read(".warrant/warrant.lock.json")) as Data)["skills"] as Record<string, { version: string }>;
  const [name, entry] = Object.entries(skills)[0] as [string, { version: string }];
  return `${name}@${entry.version}`;
}

/** A project with an active review Run: the project, the Run id and the skill to name. */
async function reviewing(): Promise<{ p: ProjectBuilder; id: string; skill: string }> {
  const p = await repo();
  const id = await started(p, "add-search", { operation: "review" });
  return { p, id, skill: reviewSkill(p) };
}

function envelope(run: string, skill: string, severities: string[] = ["MAJOR"], extra: Data = {}): Data {
  return {
    $schema: "warrant://skill-result/1",
    skill,
    run,
    run_state: "SUCCEEDED",
    findings: severities.map((severity, i) => ({
      id: `F-${i + 1}`,
      marker: "INFERENCE",
      severity,
      category: "missing-boundary",
      statement: "No behavior for duplicate ids."
    })),
    provenance: { model: "claude-test", started_at: "2026-09-25T10:00:00Z", finished_at: "2026-09-25T10:12:00Z" },
    ...extra
  };
}

/** `run submit` with `stdin` as its standard input. */
function submit(p: ProjectBuilder, stdin: Data | string, opts: RunSubmitOptions = {}, ctx: Ctx = p.ctx): Promise<Result> {
  const text = typeof stdin === "string" ? stdin : JSON.stringify(stdin);
  return invoke(() => runSubmit(ctx, opts, () => Promise.resolve(text), ENV)) as Promise<Result>;
}

function evidenceFiles(p: ProjectBuilder): string[] {
  const dir = path.join(p.root, ".warrant", "evidence", "add-search");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

describe("warrant run submit: the evidence of a review", () => {
  it("SUCCEEDED with one MAJOR on stdin: a review record PROVEN on the spec tree of the Run, the Run SUCCEEDED, current gone (SCN-ENF-030)", async () => {
    const { p, id, skill } = await reviewing();
    const specTree = p.json(`${RUNS}/${id}.json`)["spec_tree"] as string;
    const sent = envelope(id, skill);
    const result = await submit(p, sent);
    expect(result.errors).toEqual([]);
    expect(result.exitCode).toBe(0);
    expect(result.change).toBe("add-search");

    const evid = result.data["evidence"] as string;
    expect(result.data).toEqual({
      run: id,
      change: "add-search",
      evidence: evid,
      evidence_status: "PROVEN",
      findings: { BLOCKER: 0, MAJOR: 1, MINOR: 0, INFO: 0 },
      reused: false
    });
    expect(evid).toMatch(/^EVID-[0-9A-HJKMNP-TV-Z]{26}$/);

    // The envelope beside the Run, canonical.
    const resultFile = `${RUNS}/${id}.result.json`;
    expect(p.read(resultFile)).toBe(canonicalText(sent as never).text);

    const [name, version] = skill.split("@") as [string, string];
    const record = p.json(`${EVIDENCE}/${evid}.json`);
    expect(record).toMatchObject({
      kind: "review",
      level: "L2",
      evidence_status: "PROVEN",
      produced_by: { type: "skill", id: name, version, run: id },
      attestation: { type: "none" },
      limitations: ["produced locally, unattested", "same model family as author"],
      metrics: { BLOCKER: 0, MAJOR: 1, MINOR: 0, INFO: 0 },
      artifacts: [{ uri: resultFile, sha256: bytesHash(p.read(resultFile)) }]
    });
    expect(record["subject"]).toEqual({
      commit: p.git.headCommit()?.sha,
      spec_revision: `openspec/changes/add-search@${p.git.headCommit()?.sha ?? ""}`,
      spec_tree: specTree,
      dataset_snapshot: null
    });
    expect(p.json(`${EVIDENCE}/manifest.json`)["evidence"]).toEqual([evid]);

    expect(p.json(`${RUNS}/${id}.json`)).toMatchObject({
      run_state: "SUCCEEDED",
      evidence: [evid],
      skill,
      model: "claude-test",
      finished_at: expect.any(String)
    });
    expect(existsSync(path.join(p.root, ".warrant", "runs", "current"))).toBe(false);
    // Written by the CLI: the Run, the envelope, the record and its metrics pass `validate`.
    expect(await validateErrors(p)).toEqual([]);
  });

  it("a BLOCKER: NOT_PROVEN, data.findings.BLOCKER 1, exit 0 (SCN-ENF-031)", async () => {
    const { p, id, skill } = await reviewing();
    const result = await submit(p, envelope(id, skill, ["BLOCKER", "MINOR", "INFO"]));
    expect(result.exitCode).toBe(0);
    expect(result.data["evidence_status"]).toBe("NOT_PROVEN");
    expect(result.data["findings"]).toEqual({ BLOCKER: 1, MAJOR: 0, MINOR: 1, INFO: 1 });
    expect(p.json(`${EVIDENCE}/${result.data["evidence"] as string}.json`)["evidence_status"]).toBe("NOT_PROVEN");
  });

  it("run_state FAILED: INCONCLUSIVE, the Run FAILED; CANCELLED alike (SCN-ENF-032)", async () => {
    const { p, id, skill } = await reviewing();
    const result = await submit(p, envelope(id, skill, [], { run_state: "FAILED" }));
    expect(result.exitCode).toBe(0);
    expect(p.json(`${EVIDENCE}/${result.data["evidence"] as string}.json`)["evidence_status"]).toBe("INCONCLUSIVE");
    expect(p.json(`${RUNS}/${id}.json`)["run_state"]).toBe("FAILED");

    const second = await started(p, "add-search", { operation: "review" });
    const cancelled = await submit(p, envelope(second, skill, ["BLOCKER"], { run_state: "CANCELLED" }));
    expect(cancelled.data["evidence_status"]).toBe("INCONCLUSIVE");
    expect(p.json(`${RUNS}/${second}.json`)["run_state"]).toBe("CANCELLED");
  });

  it("--file: the envelope from a file of the project, the same record", async () => {
    const { p, id, skill } = await reviewing();
    p.write("review.json", envelope(id, skill, []));
    const result = await submit(p, "", { file: "review.json" });
    expect(result.errors).toEqual([]);
    expect(result.data["evidence_status"]).toBe("PROVEN");
    expect(result.data["findings"]).toEqual({ BLOCKER: 0, MAJOR: 0, MINOR: 0, INFO: 0 });
  });
});

describe("warrant run submit: a repeat after an interrupted submit (SCN-ENF-043)", () => {
  /**
   * A submit of `sent` interrupted after its record, before the manifest and
   * the Run: the record stays, the Run and `current` are as before, the id is
   * out of `manifest.evidence[]`. Returns the id of the record.
   */
  async function interrupted(p: ProjectBuilder, id: string, sent: Data): Promise<string> {
    const runBefore = p.read(`${RUNS}/${id}.json`);
    const first = await submit(p, sent);
    expect(first.errors).toEqual([]);
    const evid = first.data["evidence"] as string;
    p.write(`${RUNS}/${id}.json`, runBefore).write(CURRENT, `${id}\n`);
    p.write(`${EVIDENCE}/manifest.json`, { ...p.json(`${EVIDENCE}/manifest.json`), evidence: [] });
    return evid;
  }

  it("the same envelope: the record of the Run reused, its id added to the manifest, the Run finished with it once, current gone", async () => {
    const { p, id, skill } = await reviewing();
    const sent = envelope(id, skill);
    const evid = await interrupted(p, id, sent);
    const record = p.read(`${EVIDENCE}/${evid}.json`);

    const again = await submit(p, sent);
    expect(again.errors).toEqual([]);
    expect(again.exitCode).toBe(0);
    expect(again.data).toEqual({
      run: id,
      change: "add-search",
      evidence: evid,
      evidence_status: "PROVEN",
      findings: { BLOCKER: 0, MAJOR: 1, MINOR: 0, INFO: 0 },
      reused: true
    });
    expect(evidenceFiles(p)).toEqual([`${evid}.json`, "manifest.json"]);
    expect(p.read(`${EVIDENCE}/${evid}.json`)).toBe(record);
    expect(p.json(`${EVIDENCE}/manifest.json`)["evidence"]).toEqual([evid]);
    expect(p.json(`${RUNS}/${id}.json`)).toMatchObject({ run_state: "SUCCEEDED", evidence: [evid], skill });
    expect(existsSync(path.join(p.root, ".warrant", "runs", "current"))).toBe(false);
    expect(await validateErrors(p)).toEqual([]);
  });

  it("another envelope: EVIDENCE_CONFLICT naming the record, a hint to cancel, exit 3, nothing written, the Run active", async () => {
    const { p, id, skill } = await reviewing();
    const evid = await interrupted(p, id, envelope(id, skill));
    const before = p.tree();
    const other = await submit(p, envelope(id, skill, ["MAJOR", "MINOR"]));
    expect(other.exitCode).toBe(3);
    expect(other.errors[0]).toMatchObject({ code: "EVIDENCE_CONFLICT", path: `${EVIDENCE}/${evid}.json` });
    expect(other.errors[0]?.hint).toContain("warrant run finish --state CANCELLED");
    expect(p.tree()).toEqual(before);
    expect(p.json(`${RUNS}/${id}.json`)["run_state"]).toBe("RUNNING");
    expect(p.read(CURRENT)).toBe(`${id}\n`);
  });

  it("--dry-run of a repeat: reused, would_write[] without the record; the id already in the manifest is not rewritten", async () => {
    const { p, id, skill } = await reviewing();
    const sent = envelope(id, skill);
    const evid = await interrupted(p, id, sent);
    const before = p.tree();
    const dry = await submit(p, sent, {}, p.dryRun());
    expect(dry.errors).toEqual([]);
    expect(dry.data).toMatchObject({ evidence: evid, reused: true, dry_run: true });
    expect(dry.data["would_write"]).toEqual([`${EVIDENCE}/manifest.json`, `${RUNS}/${id}.json`, `${RUNS}/${id}.result.json`, CURRENT]);
    expect(p.tree()).toEqual(before);

    // The id listed already (the interruption came after the manifest): the manifest is not a write of the repeat.
    p.write(`${EVIDENCE}/manifest.json`, { ...p.json(`${EVIDENCE}/manifest.json`), evidence: [evid] });
    const listed = await submit(p, sent, {}, p.dryRun());
    expect(listed.data["would_write"]).toEqual([`${RUNS}/${id}.json`, `${RUNS}/${id}.result.json`, CURRENT]);
    const real = await submit(p, sent);
    expect(withoutDryRun(listed.data)).toEqual(withoutDryRun(real.data));
  });
});

describe("warrant run submit: refusals write nothing", () => {
  it("an envelope of another Run: SKILL_RESULT_INVALID at /run, no record, the Run RUNNING, exit 3 (SCN-ENF-033)", async () => {
    const { p, id, skill } = await reviewing();
    const before = p.tree();
    const result = await submit(p, envelope("RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y", skill));
    expect(result.exitCode).toBe(3);
    expect(result.errors[0]).toMatchObject({ code: "SKILL_RESULT_INVALID", path: "/run" });
    expect(result.errors[0]?.hint).toContain(id);
    expect(result.data["received"]).toMatchObject({ root: "object", keys: expect.arrayContaining(["$schema", "run", "skill"]) });
    expect(evidenceFiles(p)).toEqual([]);
    expect(p.json(`${RUNS}/${id}.json`)["run_state"]).toBe("RUNNING");
    expect(p.tree()).toEqual(before);
  });

  it("SKILL_RESULT_INVALID says what came, without values; a blank or missing file is USAGE (SCN-ENF-042)", async () => {
    const { p, id } = await reviewing();
    const partial = `{"$schema":"warrant://skill-result/1","run":"${id}","findings":[]}`;
    const object = await submit(p, partial);
    expect(object.exitCode).toBe(3);
    expect(object.errors[0]?.code).toBe("SKILL_RESULT_INVALID");
    expect(object.data["received"]).toEqual({ bytes: Buffer.byteLength(partial, "utf8"), root: "object", keys: ["$schema", "findings", "run"] });
    expect(JSON.stringify(object.data)).not.toContain(id);

    const text = await submit(p, "not json");
    expect(text.errors[0]?.code).toBe("SKILL_RESULT_INVALID");
    expect(text.data["received"]).toEqual({ bytes: 8, root: "not-json", keys: [] });

    writeFileSync(path.join(p.root, "blank.json"), "  \n");
    const blank = await submit(p, "", { file: "blank.json" });
    expect(blank.errors[0]).toMatchObject({ code: "USAGE", path: "blank.json" });
    expect(blank.data["received"]).toBeUndefined();
    const missing = await submit(p, "", { file: "nowhere.json" });
    expect(missing.errors[0]).toMatchObject({ code: "USAGE", path: "nowhere.json" });
    expect(missing.data["received"]).toBeUndefined();
    expect(p.json(`${RUNS}/${id}.json`)["run_state"]).toBe("RUNNING");
  });

  it("an active implement Run: STATE_INVALID with warrant run finish, exit 3 (SCN-ENF-034)", async () => {
    const p = await repo("IMPLEMENTING");
    const id = await started(p);
    const result = await submit(p, envelope(id, reviewSkill(p)));
    expect(result.exitCode).toBe(3);
    expect(result.errors[0]?.code).toBe("STATE_INVALID");
    expect(result.errors[0]?.hint).toContain("warrant run finish");
    expect(p.json(`${RUNS}/${id}.json`)["run_state"]).toBe("RUNNING");
  });

  it("no active Run: RUN_NOT_ACTIVE with warrant run start", async () => {
    const p = await repo();
    const result = await submit(p, envelope("RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y", reviewSkill(p)));
    expect(result.exitCode).toBe(3);
    expect(result.errors[0]?.code).toBe("RUN_NOT_ACTIVE");
    expect(result.errors[0]?.hint).toContain("--operation");
  });

  it("off the schema, a verdict in it, not JSON: SKILL_RESULT_INVALID with the JSON Pointer; --file prefixes the file", async () => {
    const { p, id, skill } = await reviewing();
    const verdict = await submit(p, envelope(id, skill, [], { evidence_status: "PROVEN" }));
    expect(verdict.errors[0]).toMatchObject({ code: "SKILL_RESULT_INVALID", path: "/evidence_status" });
    const other = await submit(p, { ...envelope(id, skill), $schema: "warrant://run/1" });
    expect(other.errors[0]).toMatchObject({ code: "SKILL_RESULT_INVALID", path: "/$schema" });
    expect((await submit(p, "{ not json")).errors[0]?.code).toBe("SKILL_RESULT_INVALID");

    p.write("review.json", envelope("RUN-01J8Z3KQ2M7N4P6R8T0V2W4X6Y", skill));
    const filed = await submit(p, "", { file: "review.json" });
    expect(filed.errors[0]).toMatchObject({ code: "SKILL_RESULT_INVALID", path: "review.json#/run" });
    expect(evidenceFiles(p)).toEqual([]);
  });

  it("a skill the pack does not declare, or a version outside its range: SKILL_RESULT_INVALID at /skill", async () => {
    const { p, id, skill } = await reviewing();
    const name = skill.split("@")[0] as string;
    for (const other of ["specification/authoring@1.0.0", `${name}@99.0.0`]) {
      const result = await submit(p, envelope(id, other));
      expect(result.errors[0], other).toMatchObject({ code: "SKILL_RESULT_INVALID", path: "/skill" });
      expect(result.errors[0]?.hint, other).toContain(name);
    }
    expect(p.json(`${RUNS}/${id}.json`)["run_state"]).toBe("RUNNING");
  });

  it("an envelope of another skill of an enabled pack, locked too: SKILL_RESULT_INVALID at /skill, the Run RUNNING (R-20)", async () => {
    // core-sdd from a bundle of its own with a second skill beside the review skill.
    const bundle = mkdtempSync(path.join(tmpdir(), "warrant-bundle-"));
    const before = process.env["WARRANT_PACKS_DIR"];
    try {
      const pack = path.join(bundle, "packs", "core-sdd");
      cpSync(path.join(REPO_ROOT, "packs", "core-sdd"), pack, { recursive: true });
      const skills = path.join(pack, "skills", "specification");
      cpSync(path.join(REPO_ROOT, "sra", "skills", "specification", "adversarial-review"), path.join(skills, "adversarial-review"), { recursive: true });
      mkdirSync(path.join(skills, "authoring"), { recursive: true });
      writeFileSync(path.join(skills, "authoring", "SKILL.md"), "---\nname: authoring\nversion: 1.0.0\ndescription: Authoring.\n---\n\nWrite the spec.\n");
      const manifest = JSON.parse(readFileSync(path.join(pack, "pack.json"), "utf8")) as { provides: { skills: string[] } };
      manifest.provides.skills.push("specification/authoring@^1.0");
      writeFileSync(path.join(pack, "pack.json"), JSON.stringify(manifest, null, 2));
      process.env["WARRANT_PACKS_DIR"] = path.join(bundle, "packs");

      const { p, id } = await reviewing();
      const lock = JSON.parse(p.read(".warrant/warrant.lock.json")) as Data;
      expect(Object.keys(lock["skills"]).sort()).toEqual(["specification/adversarial-review", "specification/authoring"]);
      const result = await submit(p, envelope(id, "specification/authoring@1.0.0"));
      expect(result.exitCode).toBe(3);
      expect(result.errors[0]).toMatchObject({ code: "SKILL_RESULT_INVALID", path: "/skill" });
      expect(result.errors[0]?.hint).toContain("specification/adversarial-review");
      expect(p.json(`${RUNS}/${id}.json`)["run_state"]).toBe("RUNNING");
      expect(evidenceFiles(p)).toEqual([]);
    } finally {
      if (before === undefined) delete process.env["WARRANT_PACKS_DIR"];
      else process.env["WARRANT_PACKS_DIR"] = before;
      rmSync(bundle, { recursive: true, force: true });
    }
  });

  it("no envelope: an empty stdin or a missing file is USAGE; every error carries a hint (REQ-KRN-002)", async () => {
    const { p } = await reviewing();
    const results = [await submit(p, "  \n"), await submit(p, "", { file: "missing.json" })];
    expect(results.map((r) => r.errors[0]?.code)).toEqual(["USAGE", "USAGE"]);
    for (const r of results) {
      expect(r.exitCode).toBe(3);
      expect(r.errors[0]?.hint).toContain("warrant run submit");
    }
  });
});

describe("warrant run submit --dry-run (SCN-ENF-035)", () => {
  it("the same JSON, would_write[] of the envelope, the record, the manifest, the Run and current; nothing changes", async () => {
    const { p, id, skill } = await reviewing();
    p.write("result.json", envelope(id, skill));
    const before = p.tree();
    const dry = await submit(p, "", { file: "result.json" }, p.dryRun());
    expect(dry.errors).toEqual([]);
    expect(dry.data["dry_run"]).toBe(true);
    const evid = dry.data["evidence"] as string;
    expect(dry.data["would_write"]).toEqual([
      `${EVIDENCE}/${evid}.json`,
      `${EVIDENCE}/manifest.json`,
      `${RUNS}/${id}.json`,
      `${RUNS}/${id}.result.json`,
      CURRENT
    ]);
    expect(p.tree()).toEqual(before);

    const real = await submit(p, "", { file: "result.json" });
    expect(withoutDryRun(dry.data)).toEqual(withoutDryRun(real.data));
    expect(writtenBeyond(before, p.tree(), dry.data["would_write"])).toEqual([]);
  });
});
