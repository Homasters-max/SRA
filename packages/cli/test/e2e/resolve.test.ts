/** `warrant resolve` end to end (REQ-KRN-026, SCN-KRN-065..069, SCN-KRN-115). */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { CLI_ROOT, makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const GOLDEN_DIR = path.join(CLI_ROOT, "test", "golden", "resolve");
const ENV = { WARRANT_PACKS_DIR: FIXTURE_PACKS };
const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function write(root: string, rel: string, content: string | object): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, typeof content === "string" ? content : canonicalText(content).text, "utf8");
}

/** A project enabling the given fixture packs, with one change record. */
function project(packs: string[], change: string, record: Record<string, unknown>): string {
  const root = makeTempDir("warrant-resolve-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: Object.fromEntries(packs.map((id) => [id, { version: "^1.0" }]))
  });
  write(root, `.warrant/changes/${change}.json`, {
    $schema: "warrant://change-record/1",
    change,
    change_state: "SPECIFIED",
    ...record
  });
  return root;
}

const FEATURE_HIGH = {
  profiles: ["feature"],
  risk: { data_loss: { value: "HIGH", from: "human:kat" } }
};

describe("warrant resolve", () => {
  it("is deterministic and names the source of every gate with --explain (SCN-KRN-065)", async () => {
    const root = project(["policy"], "demo", { classification: FEATURE_HIGH });
    const a = await runCli(["resolve", "demo", "--explain"], root, ENV);
    const b = await runCli(["resolve", "demo", "--explain"], root, ENV);
    expect(a.status).toBe(0);
    expect(a.json?.ok).toBe(true);
    expect(a.json?.change).toBe("demo");
    expect(a.json?.data.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(b.json?.data.hash).toBe(a.json?.data.hash);

    const gateSources = (a.json?.data.explain as { item: string; from: string }[])
      .filter((e) => e.item.startsWith("gate:"))
      .map((e) => `${e.item} <- ${e.from}`);
    expect(gateSources).toEqual([
      "gate:adversarial-review <- overlay/risk-high",
      "gate:tests-passed <- overlay/baseline",
      "gate:tests-passed <- profile/feature"
    ]);
  });

  it("omits explain unless --explain is given (REQ-KRN-026)", async () => {
    const root = project(["policy"], "demo", { classification: FEATURE_HIGH });
    const run = await runCli(["resolve", "demo"], root, ENV);
    expect(run.status).toBe(0);
    expect(Object.keys(run.json?.data)).toEqual([
      "hash",
      "sources",
      "risk_level",
      "artifacts",
      "gates",
      "capabilities",
      "approvals",
      "evidence"
    ]);
  });

  it("unions the gates of the profile and the risk overlay (SCN-KRN-066)", async () => {
    const root = project(["policy"], "demo", { classification: FEATURE_HIGH });
    const run = await runCli(["resolve", "demo"], root, ENV);
    expect(run.json?.data.risk_level).toBe("HIGH");
    expect(run.json?.data.gates).toEqual({
      "VERIFYING->MERGED": ["adversarial-review", "tests-passed"]
    });
    expect(run.json?.data.approvals).toEqual([{ role: "security", at: "APPROVED->IMPLEMENTING" }]);
  });

  it("escalates a policy conflict with exit code 2 (SCN-KRN-067)", async () => {
    const root = project(["policy", "policy-conflict"], "demo", { classification: FEATURE_HIGH });
    const run = await runCli(["resolve", "demo"], root, ENV);
    expect(run.status).toBe(2);
    expect(run.json?.ok).toBe(false);
    expect(run.json?.errors[0].code).toBe("POLICY_CONFLICT");
    expect(run.json?.data.controller_action).toBe("ESCALATE");
    expect(run.json?.data.conflicts).toEqual([
      { item: "adr", required_by: ["overlay/conflict-require"], forbidden_by: ["overlay/conflict-forbid"] }
    ]);
  });

  it("a required evidence kind no gate reads is a policy conflict (SCN-KRN-115)", async () => {
    const root = project(["policy"], "demo", { classification: FEATURE_HIGH });
    write(root, ".warrant/local/overlays/perf.json", {
      $schema: "warrant://overlay/1",
      id: "perf",
      version: "1.0.0",
      match: {},
      evidence: { required: ["perf-report"] }
    });
    const run = await runCli(["resolve", "demo"], root, ENV);
    expect(run.status).toBe(2);
    expect(run.json?.ok).toBe(false);
    expect(run.json?.errors[0].code).toBe("POLICY_CONFLICT");
    expect(run.json?.errors[0].message).toContain("perf-report");
    expect(run.json?.data.controller_action).toBe("ESCALATE");
    expect(run.json?.data.conflicts).toEqual([{ code: "EVIDENCE_KIND_UNGATED", kind: "perf-report" }]);
  });

  it("falls back to MEDIUM and to default plus project only, without classification (SCN-KRN-068)", async () => {
    const root = project(["policy"], "demo", {});
    const run = await runCli(["resolve", "demo", "--explain"], root, ENV);
    expect(run.status).toBe(0);
    expect(run.json?.data.risk_level).toBe("MEDIUM");
    expect(run.json?.data.sources).toEqual([
      expect.stringMatching(/^kernel@/),
      "policy@1.0.0:overlay/baseline@1.0.0"
    ]);
    expect(run.json?.data.explain[0]).toEqual({
      item: "risk_level:MEDIUM",
      from: "default:no-classification"
    });
  });

  it("takes the classification from --classification and matches the golden case (SCN-KRN-069)", async () => {
    const golden = JSON.parse(
      readFileSync(path.join(GOLDEN_DIR, "feature-high-adds-review", "expected.json"), "utf8")
    );
    const input = JSON.parse(
      readFileSync(path.join(GOLDEN_DIR, "feature-high-adds-review", "input.json"), "utf8")
    );
    // The record carries a different classification on purpose: the file wins.
    const root = project(["policy"], "demo", { classification: { profiles: ["chore"] } });
    write(root, "classification.json", input.classification);

    const run = await runCli(["resolve", "demo", "--explain", "--classification", "classification.json"], root, ENV);
    expect(run.status).toBe(0);
    const { hash, sources, ...rest } = run.json?.data as Record<string, unknown>;
    expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
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
    const root = project(["policy"], "demo", {});
    const run = await runCli(["resolve", "nosuch"], root, ENV);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CHANGE_NOT_FOUND");
    expect(run.json?.errors[0].path).toBe(".warrant/changes/nosuch.json");
  });

  it("reports CONFIG_MISSING outside a project (SCN-KRN-007)", async () => {
    const root = makeTempDir("warrant-resolve-bare-");
    tempDirs.push(root);
    const run = await runCli(["resolve", "demo"], root, ENV);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CONFIG_MISSING");
  });

  it("reports CONFIG_MISSING for a missing --classification file", async () => {
    const root = project(["policy"], "demo", {});
    const run = await runCli(["resolve", "demo", "--classification", "nope.json"], root, ENV);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CONFIG_MISSING");
  });

  it("rejects a --classification file that does not match the schema", async () => {
    const root = project(["policy"], "demo", {});
    write(root, "bad.json", { risk: { data_loss: "HIGH" } });
    const run = await runCli(["resolve", "demo", "--classification", "bad.json"], root, ENV);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("SCHEMA_VIOLATION");
    expect(run.json?.errors[0].path).toContain("bad.json");
  });
});
