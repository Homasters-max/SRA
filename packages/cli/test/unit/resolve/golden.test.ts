/**
 * Golden cases of the resolver (design D-6, SCN-KRN-065/066/069).
 *
 * `input.json` describes a project — which fixture packs it enables, the
 * classification and any `.warrant/local/` documents — and `expected.json`
 * holds the full result minus `hash`, or the `POLICY_CONFLICT` shape. The
 * expected files are written by hand from 05 section 5: they are the contract,
 * not a recording of the implementation.
 */
import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadPacks } from "../../../src/core/packs/loader.js";
import { resolveForProject, type Classification } from "../../../src/core/resolve/index.js";
import { CLI_VERSION } from "../../../src/version.js";
import { CLI_ROOT, makeTempDir, removeDir } from "../../helpers/cli.js";
import { write } from "../../helpers/synced.js";
import { readJsonFile } from "../../helpers/json.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const GOLDEN_DIR = path.join(CLI_ROOT, "test", "golden", "resolve");
const tempDirs: string[] = [];

interface GoldenInput {
  packs: string[];
  classification?: Classification;
  local?: Record<string, object>;
}

beforeAll(() => {
  process.env["WARRANT_PACKS_DIR"] = FIXTURE_PACKS;
});

afterAll(() => {
  delete process.env["WARRANT_PACKS_DIR"];
  for (const dir of tempDirs) removeDir(dir);
});

/** A temporary project matching one golden `input.json`. */
export function buildProject(input: GoldenInput): string {
  const root = makeTempDir("warrant-golden-");
  tempDirs.push(root);
  write(root, ".warrant/warrant.json", {
    $schema: "warrant://config/1",
    kernel: "0.1",
    openspec: "1.13.x",
    packs: Object.fromEntries(input.packs.map((id) => [id, { version: "^1.0" }]))
  });
  for (const [rel, json] of Object.entries(input.local ?? {})) {
    write(root, path.join(".warrant/local", rel), json);
  }
  return root;
}

/** Local sources carry a content hash; the golden file records the shape only. */
function normaliseSources(sources: string[]): string[] {
  return sources.map((s) =>
    s.replace(/sha256:[0-9a-f]{64}/, "sha256:<hash>").replace(CLI_VERSION, "{CLI_VERSION}")
  );
}

const cases = readdirSync(GOLDEN_DIR).sort();

describe("resolver golden cases", () => {
  for (const name of cases) {
    it(name, () => {
      const input = readJsonFile(path.join(GOLDEN_DIR, name, "input.json")) as GoldenInput;
      const expected = readJsonFile(path.join(GOLDEN_DIR, name, "expected.json"));
      const root = buildProject(input);
      const loaded = loadPacks(root);
      expect(loaded.errors).toEqual([]);

      const { result, errors } = resolveForProject(loaded, input.classification);
      expect(errors).toEqual([]);

      if (expected.code === "POLICY_CONFLICT") {
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.conflict).toEqual(expected);
        return;
      }

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const { hash, sources, ...rest } = result.policy;
      expect(hash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect({ sources: normaliseSources(sources), ...rest }).toEqual(expected);
    });
  }

  it("expects every golden case listed in design D-6", () => {
    expect(cases).toEqual([
      "extends-chain",
      "feature-high-adds-review",
      "feature-medium",
      "local-override-strengthens",
      "no-classification",
      "policy-conflict",
      "two-profiles-union"
    ]);
  });
});

describe("hash stability (SCN-KRN-065)", () => {
  const input = readJsonFile(path.join(GOLDEN_DIR, "feature-medium", "input.json")) as GoldenInput;

  it("is identical across two runs on the same inputs", () => {
    const rootA = buildProject(input);
    const rootB = buildProject(input);
    const a = resolveForProject(loadPacks(rootA), input.classification).result;
    const b = resolveForProject(loadPacks(rootB), input.classification).result;
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.policy.hash).toBe(b.policy.hash);
  });

  it("changes when the classification changes", () => {
    const root = buildProject(input);
    const loaded = loadPacks(root);
    const medium = resolveForProject(loaded, input.classification).result;
    const high = resolveForProject(loaded, {
      profiles: ["feature"],
      risk: { data_loss: { value: "HIGH", from: "human:kat" } }
    }).result;
    expect(medium.ok && high.ok).toBe(true);
    if (!medium.ok || !high.ok) return;
    expect(medium.policy.hash).not.toBe(high.policy.hash);
  });

  it("does not depend on the order of profiles in the classification", () => {
    const root = buildProject({ packs: ["policy"] });
    const loaded = loadPacks(root);
    const a = resolveForProject(loaded, { profiles: ["feature", "chore"] }).result;
    const b = resolveForProject(loaded, { profiles: ["chore", "feature"] }).result;
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.policy).toEqual(b.policy);
  });
});
