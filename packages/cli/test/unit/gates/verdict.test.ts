/**
 * The gate engine as a pure function (REQ-VER-003, design §8): the
 * pre-filter (D-12), the verdict algorithm of 06 section 3 and the table of
 * cases SCN-VER-012…018, over the gate documents of the shipped `core-sdd`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { prefilter } from "../../../src/core/gates/prefilter.js";
import type { EvidenceInput, GateSignals } from "../../../src/core/gates/types.js";
import { evaluateGates, freshest, worstVerdict } from "../../../src/core/gates/verdict.js";
import type { EffectivePolicy } from "../../../src/core/resolve/types.js";
import type { WaiverInput } from "../../../src/core/waivers/read.js";
import { REPO_ROOT } from "../../helpers/cli.js";

const GATES_DIR = path.join(REPO_ROOT, "packs", "core-sdd", "gates");

/** The gate documents of core-sdd by id. */
const CORE_GATES = new Map<string, Record<string, unknown>>(
  readdirSync(GATES_DIR).map((name) => {
    const json = JSON.parse(readFileSync(path.join(GATES_DIR, name), "utf8")) as Record<string, unknown>;
    return [json["id"] as string, json];
  })
);

const HEAD = "c".repeat(40);
const PREVIOUS = "p".repeat(40);
const BASE = "b".repeat(40);

/** Transition of gate `adversarial-review` (04 section 5). */
const REVIEW_TRANSITION = "SPECIFIED->APPROVED";

function policy(gates: Record<string, string[]>, extra: Partial<EffectivePolicy> = {}): EffectivePolicy {
  return {
    hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
    sources: [],
    risk_level: "LOW",
    artifacts: { required: ["proposal", "specs", "design", "tasks"], recommended: [], forbidden: [] },
    gates,
    capabilities: { forbidden: [] },
    approvals: [],
    evidence: { required: [] },
    explain: [],
    ...extra
  };
}

function signals(extra: Partial<GateSignals> = {}): GateSignals {
  return {
    change: "add-search",
    today: "2026-09-22",
    commit: HEAD,
    base: BASE,
    diff: { ok: true, value: [{ status: "M", path: "src/search.ts" }] },
    branch: { ok: true, value: "worktree/add-search" },
    artifacts: { ok: true, value: { proposal: "done", specs: "done", design: "done", tasks: "done" } },
    ids: { ok: true, value: [] },
    unknowns: [],
    profiles: ["feature"],
    policyPaths: ["packs/**", ".warrant/**"],
    state: { own: () => false, other: () => false },
    ...extra
  };
}

let counter = 0;

function record(kind: string, status: string, extra: Record<string, unknown> = {}): EvidenceInput {
  counter += 1;
  const id = `EVID-01J8Z3M5K9X7Q2R4T6V8W0Y${String(counter).padStart(3, "0")}`;
  const { subject, ...rest } = extra as { subject?: Record<string, unknown> };
  return {
    id,
    json: {
      id,
      kind,
      evidence_status: status,
      subject: { commit: HEAD, base_commit: BASE, ...subject },
      produced_by: { type: "check", id: "fixture-check" },
      attestation: { type: "none" },
      created_at: `2026-09-22T10:00:${String(counter % 60).padStart(2, "0")}Z`,
      limitations: [],
      ...rest
    }
  };
}

function waiver(gate: string, extra: Record<string, unknown> = {}): WaiverInput {
  return {
    path: `.warrant/waivers/WAV-2026-001.json`,
    json: {
      $schema: "warrant://waiver/1",
      id: "WAV-2026-001",
      change: "add-search",
      gate,
      approved_by: "human:kat",
      expires_at: "2026-12-31",
      waiver_state: "ACTIVE",
      ...extra
    }
  };
}

function evaluate(
  transition: string,
  gates: string[],
  records: EvidenceInput[] = [],
  opts: {
    waivers?: WaiverInput[];
    approvers?: Set<string>;
    signals?: Partial<GateSignals>;
    policy?: Partial<EffectivePolicy>;
    definitions?: Map<string, Record<string, unknown>>;
  } = {}
) {
  return evaluateGates({
    policy: policy({ [transition]: gates }, opts.policy),
    transition,
    definitions: opts.definitions ?? CORE_GATES,
    records,
    waivers: opts.waivers ?? [],
    ...(opts.approvers === undefined ? {} : { approvers: opts.approvers }),
    signals: signals(opts.signals)
  });
}

describe("pre-filter (D-12)", () => {
  it("sets aside records of another commit, base, threshold, a scoped run or a waiver not in force", () => {
    const ok = record("spec-report", "PROVEN");
    const commit = record("spec-report", "PROVEN", { subject: { commit: PREVIOUS } });
    const base = record("spec-report", "PROVEN", { subject: { base_commit: PREVIOUS } });
    const threshold = record("mutation-report", "PROVEN", { metrics: { threshold: 60 } });
    const scoped = record("test-report", "PROVEN", { limitations: ["scoped: src/a.py"] });
    const waived = record("test-report", "PROVEN", { metrics: { waivers: ["WAV-2026-009"] } });
    const result = prefilter([ok, commit, base, threshold, scoped, waived], {
      commit: HEAD,
      base: BASE,
      thresholds: { "mutation-report": 80 },
      activeWaivers: new Set(["WAV-2026-001"])
    });
    expect(result.admissible.map((r) => r.id)).toEqual([ok.id]);
    expect(result.excluded.map((e) => e.finding.reason)).toEqual(["commit", "base", "threshold", "scoped", "waiver"]);
    expect(result.excluded.every((e) => e.finding.code === "STALE")).toBe(true);
  });

  it("accepts a nogit record on a project without git: both commits are unknown (design §6)", () => {
    const nogit = record("spec-report", "PROVEN", { subject: { commit: "nogit", base_commit: undefined } });
    delete (nogit.json["subject"] as Record<string, unknown>)["base_commit"];
    const result = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [nogit], {
      signals: { commit: "nogit", base: undefined as unknown as string }
    });
    expect(result.gates).toEqual({ "spec-valid": "PASS" });
  });

  it("does not accept a nogit record on a git project", () => {
    const nogit = record("spec-report", "PROVEN", { subject: { commit: "nogit" } });
    const result = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [nogit]);
    expect(result.gates["spec-valid"]).toBe("BLOCKED");
    expect(result.findings[0]).toMatchObject({ code: "STALE", evidence: nogit.id, reason: "commit" });
  });

  it("compares a record with subject.spec_tree by the spec tree instead of commit and base (ADR-0036 п. 3, SCN-VER-056, 057)", () => {
    const TREE = `sha256:${"3".repeat(64)}`;
    // Made on an older commit against another base: admissible while the spec tree is the same.
    const review = record("review", "PROVEN", { subject: { commit: PREVIOUS, base_commit: undefined, spec_tree: TREE } });
    const same = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [review], { signals: { specTree: { ok: true, value: TREE } } });
    expect(same.gates).toEqual({ "adversarial-review": "PASS" });
    expect(same.findings).toEqual([]);

    const changed = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [review], {
      signals: { specTree: { ok: true, value: `sha256:${"4".repeat(64)}` } }
    });
    expect(changed.gates["adversarial-review"]).toBe("BLOCKED");
    expect(changed.findings).toEqual([
      expect.objectContaining({ code: "STALE", evidence: review.id, reason: "spec_tree", kind: "review" }),
      expect.objectContaining({ code: "NO_EVIDENCE", gate: "adversarial-review", kind: "review" })
    ]);

    // The tree of the evaluated commit is unknown, or was not gathered: STALE with the reason.
    const unknown = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [review], {
      signals: { specTree: { ok: false, reason: "the project is not a git repository with a commit" } }
    });
    expect(unknown.findings[0]).toMatchObject({ code: "STALE", reason: "spec_tree" });
    expect(unknown.findings[0]?.message).toContain("not a git repository");
    const absent = prefilter([review], { commit: HEAD, base: BASE, activeWaivers: new Set() });
    expect(absent.excluded.map((e) => e.finding.reason)).toEqual(["spec_tree"]);

    // The other checks still apply to such a record.
    const scoped = record("review", "PROVEN", { subject: { spec_tree: TREE }, limitations: ["scoped: src/a.py"] });
    const rest = prefilter([scoped], { commit: HEAD, base: BASE, activeWaivers: new Set(), specTree: { ok: true, value: TREE } });
    expect(rest.excluded.map((e) => e.finding.reason)).toEqual(["scoped"]);
  });

  describe("a record of warrant ci on the result of a merge (subject.tree, ADR-0037 п. 2)", () => {
    const TREE = "7".repeat(40);
    /** `test-report` of CI on head H (= HEAD here) against base B, made on the merge tree T. */
    const ciRecord = (subject: Record<string, unknown> = {}): EvidenceInput =>
      record("test-report", "PROVEN", {
        subject: { base_commit: PREVIOUS, tree: TREE, ...subject },
        attestation: { type: "ci", ref: "https://github.com/o/r/actions/runs/42/attempts/1" }
      });

    it("is admissible when the merge of the evaluated commit has its tree, whatever the base (SCN-VER-069)", () => {
      const ci = ciRecord();
      const result = evaluate("VERIFYING->MERGED", ["tests-passed"], [ci], { signals: { mergeTree: { ok: true, value: TREE } } });
      expect(result.gates).toEqual({ "tests-passed": "PASS" });
      expect(result.findings).toEqual([]);
      expect(result.evidence["tests-passed"]).toEqual([ci.id]);
    });

    it("is STALE with reason tree when the merge has another tree, not a status (SCN-VER-070)", () => {
      const ci = ciRecord();
      const result = evaluate("VERIFYING->MERGED", ["tests-passed"], [ci], {
        signals: { mergeTree: { ok: true, value: "8".repeat(40) } }
      });
      expect(result.gates["tests-passed"]).toBe("BLOCKED");
      expect(result.findings).toEqual([
        expect.objectContaining({ code: "STALE", evidence: ci.id, reason: "tree", kind: "test-report" }),
        expect.objectContaining({ code: "NO_EVIDENCE", gate: "tests-passed", kind: "test-report" })
      ]);
      expect(result.findings[0]?.message).toContain("8".repeat(40));
      expect(ci.json["evidence_status"]).toBe("PROVEN");
    });

    it("is STALE with reason tree without a merge of the evaluated commit; commit still comes first", () => {
      const ci = ciRecord();
      const none = prefilter([ci], {
        commit: HEAD,
        base: BASE,
        activeWaivers: new Set(),
        mergeTree: { ok: false, reason: `no merge commit on the first-parent line of HEAD has ${HEAD} as its head` }
      });
      expect(none.excluded.map((e) => e.finding.reason)).toEqual(["tree"]);
      expect(none.excluded[0]?.finding.message).toContain("no merge commit");
      expect(prefilter([ci], { commit: HEAD, base: BASE, activeWaivers: new Set() }).excluded.map((e) => e.finding.reason)).toEqual([
        "tree"
      ]);
      const other = ciRecord({ commit: PREVIOUS });
      const merged = { ok: true as const, value: TREE };
      expect(prefilter([other], { commit: HEAD, base: BASE, activeWaivers: new Set(), mergeTree: merged }).excluded.map((e) => e.finding.reason)).toEqual([
        "commit"
      ]);
      // A record without tree is judged by the base, as before, whatever the merge tree.
      const local = record("test-report", "PROVEN", { subject: { base_commit: PREVIOUS } });
      expect(prefilter([local], { commit: HEAD, base: BASE, activeWaivers: new Set(), mergeTree: merged }).excluded.map((e) => e.finding.reason)).toEqual([
        "base"
      ]);
    });
  });
});

describe("verdict algorithm (06 section 3)", () => {
  it("PASS by a fresh PROVEN spec-report on HEAD (SCN-VER-012)", () => {
    const result = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [record("spec-report", "PROVEN")]);
    expect(result.gates).toEqual({ "spec-valid": "PASS" });
    expect(result.findings).toEqual([]);
  });

  it("STALE by commit, then BLOCKED with NO_EVIDENCE (SCN-VER-013)", () => {
    const old = record("spec-report", "PROVEN", { subject: { commit: PREVIOUS } });
    const result = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [old]);
    expect(result.gates["spec-valid"]).toBe("BLOCKED");
    expect(result.findings).toEqual([
      expect.objectContaining({ code: "STALE", evidence: old.id, reason: "commit" }),
      expect.objectContaining({ code: "NO_EVIDENCE", gate: "spec-valid", kind: "spec-report" })
    ]);
  });

  it("NOT_APPLICABLE when applies_when misses the diff; evidence is not required (SCN-VER-014)", () => {
    const result = evaluate("VERIFYING->MERGED", ["factory-golden-passed"]);
    expect(result.gates).toEqual({ "factory-golden-passed": "NOT_APPLICABLE" });
    expect(result.findings).toEqual([]);

    const hit = evaluate("VERIFYING->MERGED", ["factory-golden-passed"], [], {
      signals: { diff: { ok: true, value: [{ status: "M", path: "packs/core-sdd/pack.json" }] } }
    });
    expect(hit.gates["factory-golden-passed"]).toBe("BLOCKED");

    const nogit = evaluate("VERIFYING->MERGED", ["factory-golden-passed"], [], {
      signals: { diff: { ok: false, reason: "not a git repository" } }
    });
    expect(nogit.gates["factory-golden-passed"]).toBe("BLOCKED");
    expect(nogit.findings[0]).toMatchObject({ code: "NO_INPUT", gate: "factory-golden-passed" });
  });

  it("NOT_APPLICABLE when every required kind is NOT_APPLICABLE from a check (D-11)", () => {
    const result = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [record("spec-report", "NOT_APPLICABLE")]);
    expect(result.gates["spec-valid"]).toBe("NOT_APPLICABLE");
  });

  it("WAIVED by an ACTIVE waiver of a waivable gate without a record (SCN-VER-015)", () => {
    const result = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [], { waivers: [waiver("adversarial-review")] });
    expect(result.gates).toEqual({ "adversarial-review": "WAIVED" });
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "NO_EVIDENCE", gate: "adversarial-review" }));
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "WAIVED_BY", gate: "adversarial-review", waiver: "WAV-2026-001" }));

    // Another Change, an expired or a revoked waiver waive nothing.
    const other = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [], { waivers: [waiver("adversarial-review", { change: "other" })] });
    expect(other.gates["adversarial-review"]).toBe("BLOCKED");
    const expired = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [], {
      waivers: [waiver("adversarial-review", { expires_at: "2026-09-21" })]
    });
    expect(expired.gates["adversarial-review"]).toBe("BLOCKED");
    expect(expired.findings).toContainEqual(expect.objectContaining({ code: "WAIVER_IGNORED", reason: "expired" }));
    const revoked = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [], {
      waivers: [waiver("adversarial-review", { waiver_state: "REVOKED" })]
    });
    expect(revoked.gates["adversarial-review"]).toBe("BLOCKED");
    // A waiver expiring today is still in force (UTC date, I-75).
    const today = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [], {
      waivers: [waiver("adversarial-review", { expires_at: "2026-09-22" })]
    });
    expect(today.gates["adversarial-review"]).toBe("WAIVED");
  });

  it("a waiver with targets[] does not waive the whole gate", () => {
    const result = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], {
      waivers: [waiver("analyze-clean", { targets: [{ file: "a.py" }] })]
    });
    expect(result.gates["analyze-clean"]).toBe("BLOCKED");
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "WAIVER_IGNORED", reason: "targets" }));
  });

  it("FAIL and WAIVER_IGNORED for a waiver of a non-waivable gate (SCN-VER-016)", () => {
    const result = evaluate("VERIFYING->MERGED", ["scope-valid"], [], {
      waivers: [waiver("scope-valid")],
      signals: { diff: { ok: true, value: [{ status: "A", path: "openspec/specs/search/spec.md" }] } }
    });
    expect(result.gates).toEqual({ "scope-valid": "FAIL" });
    expect(result.findings.map((f) => f.code)).toEqual(["SCOPE_VIOLATION", "WAIVER_IGNORED"]);
    expect(result.findings[1]).toMatchObject({ gate: "scope-valid", waiver: "WAV-2026-001", reason: "waivable" });
  });

  it("a waiver that is not ACTIVE is reported with reason state (REQ-VER-003)", () => {
    for (const state of ["PROPOSED", "REVOKED", "EXPIRED"]) {
      const result = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], { waivers: [waiver("analyze-clean", { waiver_state: state })] });
      expect(result.gates["analyze-clean"]).toBe("BLOCKED");
      expect(result.findings).toContainEqual(
        expect.objectContaining({ code: "WAIVER_IGNORED", gate: "analyze-clean", waiver: "WAV-2026-001", reason: "state" })
      );
    }
  });

  it("a PROPOSED waiver without approved_by waives nothing, reason state (REQ-KRN-019)", () => {
    const proposed = waiver("analyze-clean", { waiver_state: "PROPOSED" });
    delete proposed.json["approved_by"];
    const result = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], { waivers: [proposed], approvers: new Set(["kat"]) });
    expect(result.gates["analyze-clean"]).toBe("BLOCKED");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "WAIVER_IGNORED", gate: "analyze-clean", waiver: "WAV-2026-001", reason: "state" })
    );
  });

  it("WAIVER_IGNORED reason approver for a waiver by a login outside roles (SCN-VER-043)", () => {
    const result = evaluate(REVIEW_TRANSITION, ["adversarial-review"], [], {
      waivers: [waiver("adversarial-review", { approved_by: "human:bob" })],
      approvers: new Set(["kat"])
    });
    expect(result.gates["adversarial-review"]).toBe("BLOCKED");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "WAIVER_IGNORED", gate: "adversarial-review", waiver: "WAV-2026-001", reason: "approver" })
    );
  });

  it("NOT_APPLICABLE from a human is untrusted: FAIL with NOT_APPLICABLE_UNTRUSTED (SCN-VER-044)", () => {
    const claimed = record("test-report", "NOT_APPLICABLE", {
      produced_by: { type: "human", id: "kat" },
      attestation: { type: "ci", ref: "https://ci.example/runs/1" }
    });
    const result = evaluate("VERIFYING->MERGED", ["tests-passed"], [claimed]);
    expect(result.gates["tests-passed"]).toBe("FAIL");
    expect(result.findings).toEqual([
      expect.objectContaining({ code: "NOT_APPLICABLE_UNTRUSTED", gate: "tests-passed", evidence: claimed.id, kind: "test-report" })
    ]);
    // Without a producer at all it is no better.
    const anonymous = record("spec-report", "NOT_APPLICABLE", { produced_by: undefined });
    const none = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [anonymous]);
    expect(none.gates["spec-valid"]).toBe("FAIL");
    expect(none.findings).toContainEqual(expect.objectContaining({ code: "NOT_APPLICABLE_UNTRUSTED", evidence: anonymous.id }));
  });

  it("a waiver approved by a login outside roles waives nothing (review R-2)", () => {
    const approvers = new Set(["kat"]);
    const stranger = waiver("analyze-clean", { approved_by: "human:mallory" });
    const result = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], { waivers: [stranger], approvers });
    expect(result.gates["analyze-clean"]).toBe("BLOCKED");
    expect(result.findings).toContainEqual(
      expect.objectContaining({ code: "WAIVER_IGNORED", gate: "analyze-clean", waiver: "WAV-2026-001", reason: "approver" })
    );
    // The same waiver by a member of roles, with or without the human: prefix.
    for (const by of ["human:kat", "kat"]) {
      const ok = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], { waivers: [waiver("analyze-clean", { approved_by: by })], approvers });
      expect(ok.gates["analyze-clean"]).toBe("WAIVED");
    }
    // Nor does it excuse a kind of evidence-complete, nor keep a record resting on it admissible.
    const required = { evidence: { required: ["review"] } };
    const complete = evaluate("VERIFYING->MERGED", ["evidence-complete"], [], {
      policy: required,
      waivers: [waiver("adversarial-review", { approved_by: "human:mallory" })],
      approvers
    });
    expect(complete.gates["evidence-complete"]).toBe("FAIL");
    const resting = record("spec-report", "PROVEN", { metrics: { waivers: ["WAV-2026-001"] } });
    const stale = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [resting], {
      waivers: [waiver("spec-valid", { approved_by: "human:mallory" })],
      approvers
    });
    expect(stale.gates["spec-valid"]).toBe("BLOCKED");
    expect(stale.findings).toContainEqual(expect.objectContaining({ code: "STALE", reason: "waiver" }));
  });

  it("FAIL by a fresh NOT_PROVEN test-report (SCN-VER-017)", () => {
    const result = evaluate("VERIFYING->MERGED", ["tests-passed"], [record("test-report", "NOT_PROVEN", { attestation: { type: "ci", ref: "r" } })]);
    expect(result.gates).toEqual({ "tests-passed": "FAIL" });
    expect(result.findings[0]).toMatchObject({ code: "EVIDENCE_STATUS", gate: "tests-passed", kind: "test-report" });
  });

  it("the freshest admissible record by created_at decides", () => {
    const older = record("spec-report", "NOT_PROVEN", { created_at: "2026-09-22T09:00:00Z" });
    const newer = record("spec-report", "PROVEN", { created_at: "2026-09-22T11:00:00Z" });
    expect(freshest([newer, older])?.id).toBe(newer.id);
    const result = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [newer, older]);
    expect(result.gates["spec-valid"]).toBe("PASS");
    expect(result.evidence["spec-valid"]).toEqual([newer.id]);
    const reversed = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [
      record("spec-report", "PROVEN", { created_at: "2026-09-22T09:00:00Z" }),
      record("spec-report", "NOT_PROVEN", { created_at: "2026-09-22T11:00:00Z" })
    ]);
    expect(reversed.gates["spec-valid"]).toBe("FAIL");
  });

  it("BLOCKED with ATTESTATION_REQUIRED for a local record on VERIFYING->MERGED (SCN-VER-018)", () => {
    const local = record("test-report", "PROVEN");
    const result = evaluate("VERIFYING->MERGED", ["tests-passed"], [local]);
    expect(result.gates).toEqual({ "tests-passed": "BLOCKED" });
    expect(result.findings).toEqual([expect.objectContaining({ code: "ATTESTATION_REQUIRED", gate: "tests-passed", items: [local.id] })]);

    const ci = evaluate("VERIFYING->MERGED", ["tests-passed"], [record("test-report", "PROVEN", { attestation: { type: "ci", ref: "https://ci/1" } })]);
    expect(ci.gates["tests-passed"]).toBe("PASS");

    // A gate that declares `none` accepts the local record; other transitions never judge attestation.
    const definitions = new Map(CORE_GATES);
    definitions.set("tests-passed", { ...(CORE_GATES.get("tests-passed") as object), accepts_attestation: ["ci", "none"] });
    expect(evaluate("VERIFYING->MERGED", ["tests-passed"], [local], { definitions }).gates["tests-passed"]).toBe("PASS");
    expect(evaluate("IMPLEMENTING->VERIFYING", ["tests-passed"], [local]).gates["tests-passed"]).toBe("PASS");
  });

  it("tests-passed and factory-golden-passed accept only ci on VERIFYING->MERGED (review R-5)", () => {
    for (const gate of ["tests-passed", "factory-golden-passed"]) {
      expect(CORE_GATES.get(gate)?.["accepts_attestation"]).toEqual(["ci"]);
    }
    // A test-report is reproducible (06a section 3): a human-review or signature string does not stand in for CI.
    for (const type of ["human-review", "signature"]) {
      const other = record("test-report", "PROVEN", { attestation: { type, ref: "https://example/1" } });
      const result = evaluate("VERIFYING->MERGED", ["tests-passed"], [other]);
      expect(result.gates["tests-passed"]).toBe("BLOCKED");
      expect(result.findings).toEqual([expect.objectContaining({ code: "ATTESTATION_REQUIRED", gate: "tests-passed", items: [other.id] })]);
    }
  });

  it("a gate of another pack without a calculator and without requires_evidence is BLOCKED/NO_INPUT (INV-10)", () => {
    const definitions = new Map(CORE_GATES);
    definitions.set("adr-present", { id: "adr-present", level: "L0", waivable: true });
    const result = evaluate("SPECIFIED->APPROVED", ["adr-present"], [], { definitions });
    expect(result.gates).toEqual({ "adr-present": "BLOCKED" });
    expect(result.findings[0]).toMatchObject({ code: "NO_INPUT", gate: "adr-present" });
  });

  it("a failed check of verify leaves its gates BLOCKED whatever the records say (REQ-VER-006)", () => {
    const result = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [record("spec-report", "PROVEN")], {
      signals: { checkFailures: [{ check: "openspec-validate", code: "CHECK_TIMEOUT", kinds: ["spec-report"] }] }
    });
    expect(result.gates["spec-valid"]).toBe("BLOCKED");
    expect(result.findings[0]).toMatchObject({ code: "NO_INPUT", gate: "spec-valid", check: "openspec-validate", error: "CHECK_TIMEOUT" });
  });

  it("reports STALE only for kinds the evaluated gates read", () => {
    const staleTests = record("test-report", "PROVEN", { subject: { commit: PREVIOUS } });
    const result = evaluate("PROPOSED->SPECIFIED", ["spec-valid"], [record("spec-report", "PROVEN"), staleTests]);
    expect(result.findings).toEqual([]);
  });

  it("orders verdicts FAIL > BLOCKED > WAIVED > NOT_APPLICABLE > PASS", () => {
    expect(worstVerdict(["PASS", "NOT_APPLICABLE", "WAIVED"])).toBe("WAIVED");
    expect(worstVerdict(["PASS", "BLOCKED", "WAIVED"])).toBe("BLOCKED");
    expect(worstVerdict(["BLOCKED", "FAIL"])).toBe("FAIL");
    expect(worstVerdict([])).toBeNull();
  });
});

describe("L0 calculators (REQ-VER-004)", () => {
  it("required-artifacts-present: done, and skipped only for specs; BLOCKED without openspec", () => {
    const chore = evaluate("PROPOSED->SPECIFIED", ["required-artifacts-present"], [], {
      policy: { artifacts: { required: ["proposal", "specs", "tasks"], recommended: [], forbidden: [] } },
      signals: { artifacts: { ok: true, value: { proposal: "done", specs: "skipped", tasks: "done" } } }
    });
    expect(chore.gates["required-artifacts-present"]).toBe("PASS");
    const missing = evaluate("PROPOSED->SPECIFIED", ["required-artifacts-present"], [], {
      signals: { artifacts: { ok: true, value: { proposal: "done", specs: "ready", design: "skipped", tasks: "blocked" } } }
    });
    expect(missing.gates["required-artifacts-present"]).toBe("FAIL");
    expect(missing.findings[0]).toMatchObject({ code: "ARTIFACT_MISSING", items: ["specs", "design", "tasks"] });
    const unknown = evaluate("PROPOSED->SPECIFIED", ["required-artifacts-present"], [], {
      signals: { artifacts: { ok: false, reason: "`openspec` is not on PATH" } }
    });
    expect(unknown.gates["required-artifacts-present"]).toBe("BLOCKED");
  });

  it("ids-valid: FAIL names the file of every finding", () => {
    const result = evaluate("PROPOSED->SPECIFIED", ["ids-valid"], [], {
      signals: { ids: { ok: true, value: [{ code: "ID_DUPLICATE", message: "REQ-SRC-001 twice", path: "openspec/specs/s/spec.md" }] } }
    });
    expect(result.gates["ids-valid"]).toBe("FAIL");
    expect(result.findings[0]).toMatchObject({ code: "ID_DUPLICATE", gate: "ids-valid", paths: ["openspec/specs/s/spec.md"] });
  });

  it("blocking-unknowns-resolved lists the open blocking UNKNOWNs (SCN-VER-022)", () => {
    const result = evaluate("SPECIFIED->APPROVED", ["blocking-unknowns-resolved"], [], {
      signals: {
        unknowns: [
          { id: "UNK-SRC-001", text: "?", blocking: true },
          { id: "UNK-SRC-002", text: "?", blocking: true, resolution: "decided" },
          { id: "UNK-SRC-003", text: "?", blocking: false }
        ]
      }
    });
    expect(result.gates["blocking-unknowns-resolved"]).toBe("FAIL");
    expect(result.findings[0]).toMatchObject({ code: "BLOCKING_UNKNOWN", items: ["UNK-SRC-001"] });
  });

  it("branch-isolated: FAIL on main and on a detached HEAD, BLOCKED without git (SCN-VER-023)", () => {
    const onMain = evaluate("APPROVED->IMPLEMENTING", ["branch-isolated"], [], { signals: { branch: { ok: true, value: "main" } } });
    expect(onMain.gates["branch-isolated"]).toBe("FAIL");
    expect(onMain.findings[0]).toMatchObject({ code: "BRANCH_NOT_ISOLATED", items: ["main"] });
    const detached = evaluate("APPROVED->IMPLEMENTING", ["branch-isolated"], [], { signals: { branch: { ok: true, value: "HEAD" } } });
    expect(detached.gates["branch-isolated"]).toBe("FAIL");
    expect(evaluate("APPROVED->IMPLEMENTING", ["branch-isolated"]).gates["branch-isolated"]).toBe("PASS");
    const nogit = evaluate("APPROVED->IMPLEMENTING", ["branch-isolated"], [], { signals: { branch: { ok: false, reason: "no git" } } });
    expect(nogit.gates["branch-isolated"]).toBe("BLOCKED");
  });

  it("evidence-complete: a record of each required kind on any commit, of any attestation, is enough (I-96)", () => {
    const required = { evidence: { required: ["test-report", "review", "human-approval"] } };
    const missing = evaluate("VERIFYING->MERGED", ["evidence-complete"], [record("test-report", "PROVEN")], { policy: required });
    expect(missing.gates["evidence-complete"]).toBe("FAIL");
    expect(missing.findings).toEqual([expect.objectContaining({ code: "EVIDENCE_MISSING", gate: "evidence-complete", items: ["review", "human-approval"] })]);

    // human-approval of SPECIFIED->APPROVED sits on an earlier commit and base: still counted, no STALE finding.
    const approval = record("human-approval", "PROVEN", { subject: { commit: PREVIOUS, base_commit: PREVIOUS } });
    const earlier = evaluate(
      "VERIFYING->MERGED",
      ["evidence-complete"],
      [record("test-report", "PROVEN"), record("review", "NOT_APPLICABLE"), approval],
      { policy: required }
    );
    expect(earlier.gates["evidence-complete"]).toBe("PASS");
    expect(earlier.findings).toEqual([]);

    // A NOT_PROVEN review proves nothing (R-8): the kind is missing.
    const unproven = evaluate(
      "VERIFYING->MERGED",
      ["evidence-complete"],
      [record("test-report", "PROVEN"), record("review", "NOT_PROVEN"), approval],
      { policy: required }
    );
    expect(unproven.gates["evidence-complete"]).toBe("FAIL");
    expect(unproven.findings).toEqual([expect.objectContaining({ code: "EVIDENCE_MISSING", items: ["review"] })]);
  });

  it("evidence-complete does not take NOT_PROVEN; a counting waiver on adversarial-review does (SCN-VER-045)", () => {
    const required = { evidence: { required: ["review"] } };
    const approvers = new Set(["kat"]);
    const records = [record("review", "NOT_PROVEN")];
    const missing = evaluate("VERIFYING->MERGED", ["evidence-complete"], records, { policy: required, approvers });
    expect(missing.gates["evidence-complete"]).toBe("FAIL");
    expect(missing.findings).toEqual([expect.objectContaining({ code: "EVIDENCE_MISSING", gate: "evidence-complete", items: ["review"] })]);

    const waived = evaluate("VERIFYING->MERGED", ["evidence-complete"], records, {
      policy: required,
      approvers,
      waivers: [waiver("adversarial-review")]
    });
    expect(waived.gates["evidence-complete"]).toBe("PASS");

    // The predicate of step 4 decides here too (design §1): outside roles, with targets[],
    // or on a gate that is not waivable, a waiver excuses nothing.
    const notWaivable = new Map(CORE_GATES);
    notWaivable.set("adversarial-review", { ...CORE_GATES.get("adversarial-review"), waivable: false });
    for (const [other, definitions] of [
      [waiver("adversarial-review", { approved_by: "human:bob" }), CORE_GATES],
      [waiver("adversarial-review", { targets: [{ file: "a.py" }] }), CORE_GATES],
      [waiver("adversarial-review"), notWaivable]
    ] as const) {
      const result = evaluate("VERIFYING->MERGED", ["evidence-complete"], records, {
        policy: required,
        approvers,
        waivers: [other],
        definitions
      });
      expect(result.gates["evidence-complete"]).toBe("FAIL");
    }
  });

  it("evidence-complete: a waiver in force on a gate requiring the kind excuses it (I-96)", () => {
    const required = { evidence: { required: ["test-report", "review"] } };
    const records = [record("test-report", "PROVEN")];
    // review is required by adversarial-review; WAV on it excuses the kind.
    const waived = evaluate("VERIFYING->MERGED", ["evidence-complete"], records, {
      policy: required,
      waivers: [waiver("adversarial-review")]
    });
    expect(waived.gates["evidence-complete"]).toBe("PASS");
    expect(waived.findings).toEqual([]);

    for (const other of [
      waiver("adversarial-review", { expires_at: "2026-09-21" }),
      waiver("adversarial-review", { waiver_state: "REVOKED" }),
      waiver("adversarial-review", { change: "other-change" }),
      waiver("analyze-clean")
    ]) {
      const result = evaluate("VERIFYING->MERGED", ["evidence-complete"], records, { policy: required, waivers: [other] });
      expect(result.gates["evidence-complete"]).toBe("FAIL");
      expect(result.findings).toEqual([expect.objectContaining({ code: "EVIDENCE_MISSING", items: ["review"] })]);
    }
  });

  it("analyze-clean: FAIL with the findings of analyze (SCN-VER-058), PASS without (SCN-VER-059)", () => {
    const unsatisfied = { code: "UNSATISFIED" as const, id: "REQ-SRC-004", missing: ["task" as const] };
    const orphan = { code: "ORPHAN" as const, id: "SCN-SRC-099", path: "tests/test_search.py" };
    const failed = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], {
      signals: { analyze: { ok: true, value: { findings: [orphan, unsatisfied], skipped: [] } } }
    });
    expect(failed.gates["analyze-clean"]).toBe("FAIL");
    expect(failed.findings).toEqual([
      expect.objectContaining({ ...orphan, gate: "analyze-clean" }),
      expect.objectContaining({ ...unsatisfied, gate: "analyze-clean" })
    ]);

    const clean = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], {
      signals: { analyze: { ok: true, value: { findings: [], skipped: [{ code: "ORPHAN", reason: "no diff" }] } } }
    });
    expect(clean.gates["analyze-clean"]).toBe("PASS");
    expect(clean.findings).toEqual([]);
  });

  it("analyze-clean: BLOCKED/NO_INPUT without the diff or without the signal (REQ-VER-004)", () => {
    const nogit = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], {
      signals: { analyze: { ok: false, reason: "diff unknown: the project is not a git repository with a commit" } }
    });
    expect(nogit.gates["analyze-clean"]).toBe("BLOCKED");
    expect(nogit.findings[0]).toMatchObject({ code: "NO_INPUT", gate: "analyze-clean" });
    expect(nogit.findings[0]?.message).toContain("not a git repository");

    const unread = evaluate("VERIFYING->MERGED", ["analyze-clean"]);
    expect(unread.gates["analyze-clean"]).toBe("BLOCKED");
    expect(unread.findings[0]).toMatchObject({ code: "NO_INPUT", gate: "analyze-clean" });
  });

  it("scope-valid: BLOCKED/NO_INPUT without a diff", () => {
    const result = evaluate("VERIFYING->MERGED", ["scope-valid"], [], { signals: { diff: { ok: false, reason: "no git" } } });
    expect(result.gates["scope-valid"]).toBe("BLOCKED");
  });
});
