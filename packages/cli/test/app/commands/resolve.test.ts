/**
 * `warrant resolve` in the test process (REQ-KRN-026, SCN-KRN-065..069,
 * SCN-KRN-115). Moved from e2e (ADR-0025, task 5.4); the parse of argv
 * (`<change>`, `--explain`, `--classification`) and the exit codes of the
 * binary stay in `e2e/resolve.test.ts`.
 *
 * The projects enable fixture packs; the loader finds them through
 * `WARRANT_PACKS_DIR`, as the e2e runs did through the environment of the
 * binary (restored after each test, as in `unit/packs/*`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runResolve, type ResolveOptions } from "../../../src/commands/resolve.js";
import type { CommandResult } from "../../../src/io/output.js";
import { CLI_ROOT } from "../../helpers/cli.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const GOLDEN_DIR = path.join(CLI_ROOT, "test", "golden", "resolve");

const builder = useProjectBuilder();

const PACKS_ENV = "WARRANT_PACKS_DIR";
const packsEnvBefore = process.env[PACKS_ENV];
beforeEach(() => {
  process.env[PACKS_ENV] = FIXTURE_PACKS;
});
afterEach(() => {
  if (packsEnvBefore === undefined) delete process.env[PACKS_ENV];
  else process.env[PACKS_ENV] = packsEnvBefore;
});

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function resolve(p: ProjectBuilder, change: string, opts: ResolveOptions = {}): Promise<Result> {
  return invoke(() => runResolve(p.ctx, change, opts));
}

/** A project enabling the given fixture packs, with one change record. */
function project(packs: string[], change: string, record: Record<string, unknown>): ProjectBuilder {
  return builder()
    .remove(".warrant")
    .write(".warrant/warrant.json", {
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: Object.fromEntries(packs.map((id) => [id, { version: "^1.0" }]))
    })
    .write(`.warrant/changes/${change}.json`, {
      $schema: "warrant://change-record/1",
      change,
      change_state: "SPECIFIED",
      ...record
    });
}

const FEATURE_HIGH = {
  profiles: ["feature"],
  risk: { data_loss: { value: "HIGH", from: "human:kat" } }
};

describe("warrant resolve", () => {
  it("is deterministic and names the source of every gate with --explain (SCN-KRN-065)", async () => {
    const p = project(["policy"], "demo", { classification: FEATURE_HIGH });
    const a = await resolve(p, "demo", { explain: true });
    const b = await resolve(p, "demo", { explain: true });
    expect(a.exitCode).toBe(0);
    expect(a.ok).toBe(true);
    expect(a.change).toBe("demo");
    expect(a.data["hash"]).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(b.data["hash"]).toBe(a.data["hash"]);

    const gateSources = (a.data["explain"] as { item: string; from: string }[])
      .filter((e) => e.item.startsWith("gate:"))
      .map((e) => `${e.item} <- ${e.from}`);
    expect(gateSources).toEqual([
      "gate:adversarial-review <- overlay/risk-high",
      "gate:tests-passed <- overlay/baseline",
      "gate:tests-passed <- profile/feature"
    ]);
  });

  it("omits explain unless --explain is given (REQ-KRN-026)", async () => {
    const p = project(["policy"], "demo", { classification: FEATURE_HIGH });
    const run = await resolve(p, "demo");
    expect(run.exitCode).toBe(0);
    expect(Object.keys(run.data)).toEqual(["hash", "sources", "risk_level", "artifacts", "gates", "capabilities", "approvals", "evidence"]);
  });

  it("unions the gates of the profile and the risk overlay (SCN-KRN-066)", async () => {
    const p = project(["policy"], "demo", { classification: FEATURE_HIGH });
    const run = await resolve(p, "demo");
    expect(run.data["risk_level"]).toBe("HIGH");
    expect(run.data["gates"]).toEqual({ "VERIFYING->MERGED": ["adversarial-review", "tests-passed"] });
    expect(run.data["approvals"]).toEqual([{ role: "security", at: "APPROVED->IMPLEMENTING" }]);
  });

  it("escalates a policy conflict with exit code 2 (SCN-KRN-067)", async () => {
    const p = project(["policy", "policy-conflict"], "demo", { classification: FEATURE_HIGH });
    const run = await resolve(p, "demo");
    expect(run.exitCode).toBe(2);
    expect(run.ok).toBe(false);
    expect(run.errors[0]?.code).toBe("POLICY_CONFLICT");
    expect(run.data["controller_action"]).toBe("ESCALATE");
    expect(run.data["conflicts"]).toEqual([
      { item: "adr", required_by: ["overlay/conflict-require"], forbidden_by: ["overlay/conflict-forbid"] }
    ]);
  });

  it("a required evidence kind no gate reads is a policy conflict (SCN-KRN-115)", async () => {
    const p = project(["policy"], "demo", { classification: FEATURE_HIGH }).write(".warrant/local/overlays/perf.json", {
      $schema: "warrant://overlay/1",
      id: "perf",
      version: "1.0.0",
      match: {},
      evidence: { required: ["perf-report"] }
    });
    const run = await resolve(p, "demo");
    expect(run.exitCode).toBe(2);
    expect(run.ok).toBe(false);
    expect(run.errors[0]?.code).toBe("POLICY_CONFLICT");
    expect(run.errors[0]?.message).toContain("perf-report");
    expect(run.data["controller_action"]).toBe("ESCALATE");
    expect(run.data["conflicts"]).toEqual([{ code: "EVIDENCE_KIND_UNGATED", kind: "perf-report" }]);
  });

  it("falls back to MEDIUM and to default plus project only, without classification (SCN-KRN-068)", async () => {
    const p = project(["policy"], "demo", {});
    const run = await resolve(p, "demo", { explain: true });
    expect(run.exitCode).toBe(0);
    expect(run.data["risk_level"]).toBe("MEDIUM");
    expect(run.data["sources"]).toEqual([expect.stringMatching(/^kernel@/), "policy@1.0.0:overlay/baseline@1.0.0"]);
    expect(run.data["explain"][0]).toEqual({ item: "risk_level:MEDIUM", from: "default:no-classification" });
  });

  it("takes the classification from --classification and matches the golden case (SCN-KRN-069)", async () => {
    const golden = JSON.parse(readFileSync(path.join(GOLDEN_DIR, "feature-high-adds-review", "expected.json"), "utf8"));
    const input = JSON.parse(readFileSync(path.join(GOLDEN_DIR, "feature-high-adds-review", "input.json"), "utf8"));
    // The record carries a different classification on purpose: the file wins.
    const p = project(["policy"], "demo", { classification: { profiles: ["chore"] } }).write("classification.json", input.classification);

    const run = await resolve(p, "demo", { explain: true, classification: "classification.json" });
    expect(run.exitCode).toBe(0);
    const { hash, sources, ...rest } = run.data;
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(sources).toEqual(expect.any(Array));
    expect(rest).toEqual({
      risk_level: golden.risk_level,
      artifacts: golden.artifacts,
      gates: golden.gates,
      capabilities: golden.capabilities,
      approvals: golden.approvals,
      evidence: golden.evidence,
      explain: golden.explain
    });
  });

  it("reports CHANGE_NOT_FOUND with exit code 3", async () => {
    const p = project(["policy"], "demo", {});
    const run = await resolve(p, "nosuch");
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CHANGE_NOT_FOUND");
    expect(run.errors[0]?.path).toBe(".warrant/changes/nosuch.json");
  });

  it("reports CONFIG_MISSING outside a project (SCN-KRN-007)", async () => {
    const p = builder().remove(".warrant").remove("openspec");
    const run = await resolve(p, "demo");
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CONFIG_MISSING");
  });

  it("reports CONFIG_MISSING for a missing --classification file", async () => {
    const p = project(["policy"], "demo", {});
    const run = await resolve(p, "demo", { classification: "nope.json" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CONFIG_MISSING");
  });

  it("rejects a --classification file that does not match the schema", async () => {
    const p = project(["policy"], "demo", {}).write("bad.json", { risk: { data_loss: "HIGH" } });
    const run = await resolve(p, "demo", { classification: "bad.json" });
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("SCHEMA_VIOLATION");
    expect(run.errors[0]?.path).toContain("bad.json");
  });
});
