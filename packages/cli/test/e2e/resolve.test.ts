// e2e: argv
/**
 * `warrant resolve` through the binary: `<change>`, `--explain` and
 * `--classification` of argv reach the command, and the exit code is 0 on
 * success, 2 on a policy conflict (SCN-KRN-067) and 3 on a missing Change. The
 * resolution itself (REQ-KRN-026; SCN-KRN-065..069, 115) is tested in the test
 * process: `test/app/commands/resolve.test.ts` (ADR-0025, task 5.4).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { canonicalText } from "../../src/core/canon/format-json.js";
import { CLI_ROOT, makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const GOLDEN_DIR = path.join(CLI_ROOT, "test", "golden", "resolve", "feature-high-adds-review");
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

describe("warrant resolve (argv)", () => {
  it("maps <change>, --explain and --classification; exit 0, 2 on a policy conflict, 3 on a missing Change (SCN-KRN-067, SCN-KRN-069)", async () => {
    const root = makeTempDir("warrant-resolve-");
    tempDirs.push(root);
    const config = (packs: string[]): object => ({
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: Object.fromEntries(packs.map((id) => [id, { version: "^1.0" }]))
    });
    write(root, ".warrant/warrant.json", config(["policy"]));
    write(root, ".warrant/changes/demo.json", {
      $schema: "warrant://change-record/1",
      change: "demo",
      change_state: "SPECIFIED",
      classification: { profiles: ["chore"] }
    });
    const golden = JSON.parse(readFileSync(path.join(GOLDEN_DIR, "expected.json"), "utf8"));
    write(root, "classification.json", JSON.parse(readFileSync(path.join(GOLDEN_DIR, "input.json"), "utf8")).classification);

    const run = await runCli(["resolve", "demo", "--explain", "--classification", "classification.json"], root, ENV);
    expect(run.json?.errors).toEqual([]);
    expect(run.status).toBe(0);
    expect(run.json?.change).toBe("demo");
    expect(run.json?.data.risk_level).toBe(golden.risk_level);
    expect(run.json?.data.explain).toEqual(golden.explain);

    const plain = await runCli(["resolve", "demo"], root, ENV);
    expect(plain.status).toBe(0);
    expect(plain.json?.data).not.toHaveProperty("explain");

    const missing = await runCli(["resolve", "nosuch"], root, ENV);
    expect(missing.json?.errors[0].code).toBe("CHANGE_NOT_FOUND");
    expect(missing.status).toBe(3);

    write(root, ".warrant/warrant.json", config(["policy", "policy-conflict"]));
    write(root, ".warrant/changes/demo.json", {
      $schema: "warrant://change-record/1",
      change: "demo",
      change_state: "SPECIFIED",
      classification: { profiles: ["feature"], risk: { data_loss: { value: "HIGH", from: "human:kat" } } }
    });
    const conflict = await runCli(["resolve", "demo"], root, ENV);
    expect(conflict.json?.errors[0].code).toBe("POLICY_CONFLICT");
    expect(conflict.json?.data.controller_action).toBe("ESCALATE");
    expect(conflict.status).toBe(2);
  }, 60_000);
});
