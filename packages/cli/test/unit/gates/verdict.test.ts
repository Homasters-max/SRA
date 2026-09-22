/**
 * The gate engine as a pure function (REQ-VER-003, design §8): the
 * pre-filter (D-12), the verdict algorithm of 06 section 3 and the table of
 * cases SCN-VER-012…018, over the gate documents of the shipped `core-sdd`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { prefilter } from "../../../src/core/gates/prefilter.js";
import type { EvidenceInput, GateSignals, WaiverInput } from "../../../src/core/gates/types.js";
import { evaluateGates, freshest, worstVerdict } from "../../../src/core/gates/verdict.js";
import type { EffectivePolicy } from "../../../src/core/resolve/types.js";
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
  opts: { waivers?: WaiverInput[]; signals?: Partial<GateSignals>; policy?: Partial<EffectivePolicy>; definitions?: Map<string, Record<string, unknown>> } = {}
) {
  return evaluateGates({
    policy: policy({ [transition]: gates }, opts.policy),
    transition,
    definitions: opts.definitions ?? CORE_GATES,
    records,
    waivers: opts.waivers ?? [],
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
    const result = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], { waivers: [waiver("analyze-clean")] });
    expect(result.gates).toEqual({ "analyze-clean": "WAIVED" });
    expect(result.findings).toContainEqual(expect.objectContaining({ code: "WAIVED_BY", gate: "analyze-clean", waiver: "WAV-2026-001" }));

    // Another Change, an expired or a revoked waiver waive nothing.
    const other = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], { waivers: [waiver("analyze-clean", { change: "other" })] });
    expect(other.gates["analyze-clean"]).toBe("BLOCKED");
    const expired = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], {
      waivers: [waiver("analyze-clean", { expires_at: "2026-09-21" })]
    });
    expect(expired.gates["analyze-clean"]).toBe("BLOCKED");
    expect(expired.findings).toContainEqual(expect.objectContaining({ code: "WAIVER_IGNORED", reason: "expired" }));
    const revoked = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], {
      waivers: [waiver("analyze-clean", { waiver_state: "REVOKED" })]
    });
    expect(revoked.gates["analyze-clean"]).toBe("BLOCKED");
    // A waiver expiring today is still in force (UTC date, I-75).
    const today = evaluate("VERIFYING->MERGED", ["analyze-clean"], [], {
      waivers: [waiver("analyze-clean", { expires_at: "2026-09-22" })]
    });
    expect(today.gates["analyze-clean"]).toBe("WAIVED");
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
    expect(result.findings[1]).toMatchObject({ gate: "scope-valid", waiver: "WAV-2026-001", reason: "not-waivable" });
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

  it("evidence-complete: FAIL names the kinds without an admissible record; unattested on merge is BLOCKED", () => {
    const required = { evidence: { required: ["test-report", "review"] } };
    const ci = { attestation: { type: "ci", ref: "https://ci/1" } };
    const missing = evaluate("VERIFYING->MERGED", ["evidence-complete"], [record("test-report", "PROVEN", ci)], { policy: required });
    expect(missing.gates["evidence-complete"]).toBe("FAIL");
    expect(missing.findings[0]).toMatchObject({ code: "EVIDENCE_MISSING", items: ["review"] });
    const complete = evaluate("VERIFYING->MERGED", ["evidence-complete"], [record("test-report", "PROVEN", ci), record("review", "PROVEN", ci)], {
      policy: required
    });
    expect(complete.gates["evidence-complete"]).toBe("PASS");
    const local = evaluate("VERIFYING->MERGED", ["evidence-complete"], [record("test-report", "PROVEN"), record("review", "PROVEN", ci)], {
      policy: required
    });
    expect(local.gates["evidence-complete"]).toBe("BLOCKED");
    expect(local.findings[0]).toMatchObject({ code: "ATTESTATION_REQUIRED", items: ["test-report"] });
  });

  it("analyze-clean is BLOCKED/NO_INPUT until warrant analyze exists", () => {
    const result = evaluate("VERIFYING->MERGED", ["analyze-clean"]);
    expect(result.gates["analyze-clean"]).toBe("BLOCKED");
    expect(result.findings[0]).toMatchObject({ code: "NO_INPUT", gate: "analyze-clean" });
    expect(result.findings[0]?.message).toContain("warrant analyze");
  });

  it("scope-valid: BLOCKED/NO_INPUT without a diff", () => {
    const result = evaluate("VERIFYING->MERGED", ["scope-valid"], [], { signals: { diff: { ok: false, reason: "no git" } } });
    expect(result.gates["scope-valid"]).toBe("BLOCKED");
  });
});
