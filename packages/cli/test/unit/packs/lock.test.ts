import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkLock, packContentHash } from "../../../src/core/packs/hash.js";
import { loadPacks } from "../../../src/core/packs/loader.js";
import { CLI_VERSION } from "../../../src/version.js";
import { CLI_ROOT, makeTempDir, removeDir } from "../../helpers/cli.js";

const FIXTURE_PACKS = path.join(CLI_ROOT, "test", "fixtures", "packs");
const tempDirs: string[] = [];

function project(): string {
  const root = makeTempDir("warrant-lock-");
  tempDirs.push(root);
  mkdirSync(path.join(root, ".warrant", "local"), { recursive: true });
  writeFileSync(
    path.join(root, ".warrant", "warrant.json"),
    JSON.stringify({
      $schema: "warrant://config/1",
      kernel: "0.1",
      openspec: "1.13.x",
      packs: { base: { version: "^1.0" } }
    })
  );
  return root;
}

function writeLock(root: string, hash: string): void {
  writeFileSync(
    path.join(root, ".warrant", "warrant.lock.json"),
    JSON.stringify({
      $schema: "warrant://lock/1",
      kernel: CLI_VERSION,
      openspec: "1.13.1",
      packs: { base: { version: "1.0.0", source: "bundled", hash } }
    })
  );
}

beforeAll(() => {
  process.env["WARRANT_PACKS_DIR"] = FIXTURE_PACKS;
});

afterAll(() => {
  delete process.env["WARRANT_PACKS_DIR"];
  for (const dir of tempDirs) removeDir(dir);
});

describe("packContentHash", () => {
  it("is stable and changes when a file of the pack changes", () => {
    const dir = path.join(FIXTURE_PACKS, "base");
    const first = packContentHash(dir);
    expect(packContentHash(dir)).toBe(first);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(packContentHash(path.join(FIXTURE_PACKS, "dup-gate"))).not.toBe(first);
  });
});

describe("checkLock", () => {
  it("reports LOCK_MISMATCH when the lock is missing", () => {
    const root = project();
    const loaded = loadPacks(root);
    const errors = checkLock({ projectRoot: root, config: loaded.config, packs: loaded.packs });
    expect(errors.map((e) => e.code)).toEqual(["LOCK_MISMATCH"]);
    expect(errors[0]?.message).toMatch(/warrant sync/);
  });

  it("accepts a lock that matches the packs on disk", () => {
    const root = project();
    const loaded = loadPacks(root);
    writeLock(root, packContentHash(path.join(FIXTURE_PACKS, "base")));
    expect(checkLock({ projectRoot: root, config: loaded.config, packs: loaded.packs })).toEqual([]);
  });

  it("reports LOCK_MISMATCH when a pack file changed after the lock was written", () => {
    const root = project();
    const loaded = loadPacks(root);
    writeLock(root, packContentHash(path.join(FIXTURE_PACKS, "base")));

    // Simulate a modified pack by pointing the loader at a copy with an extra file.
    const copied = makeTempDir("warrant-packs-");
    tempDirs.push(copied);
    const dir = path.join(copied, "base");
    mkdirSync(path.join(dir, "gates"), { recursive: true });
    for (const rel of ["pack.json", "gates/tests-passed.json", "profiles/feature.json"]) {
      const target = path.join(dir, rel);
      mkdirSync(path.dirname(target), { recursive: true });
      copyFileSync(path.join(FIXTURE_PACKS, "base", rel), target);
    }
    writeFileSync(path.join(dir, "gates", "extra.txt"), "changed after sync\n");

    const errors = checkLock({
      projectRoot: root,
      config: loaded.config,
      packs: [{ ...(loaded.packs[0] as never), dir } as never]
    });
    expect(errors.map((e) => e.code)).toEqual(["LOCK_MISMATCH"]);
    expect(errors[0]?.path).toBe(".warrant/warrant.lock.json#/packs/base/hash");
  });

  it("reports a generated file whose bytes drifted", () => {
    const root = project();
    const loaded = loadPacks(root);
    mkdirSync(path.join(root, "openspec"), { recursive: true });
    writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: warrant-sdd\n");
    writeFileSync(
      path.join(root, ".warrant", "warrant.lock.json"),
      JSON.stringify({
        $schema: "warrant://lock/1",
        kernel: CLI_VERSION,
        openspec: "1.13.1",
        packs: { base: { version: "1.0.0", source: "bundled", hash: packContentHash(path.join(FIXTURE_PACKS, "base")) } },
        generated: { "openspec/config.yaml": `sha256:${"0".repeat(64)}` }
      })
    );
    const errors = checkLock({ projectRoot: root, config: loaded.config, packs: loaded.packs });
    expect(errors.map((e) => e.code)).toEqual(["LOCK_MISMATCH"]);
    expect(errors[0]?.path).toBe(".warrant/warrant.lock.json#/generated/openspec/config.yaml");
  });

  it("reports a pack the lock records but warrant.json no longer enables (B3, SCN-KRN-094)", () => {
    const root = project();
    const loaded = loadPacks(root);
    const hash = packContentHash(path.join(FIXTURE_PACKS, "base"));
    writeFileSync(
      path.join(root, ".warrant", "warrant.lock.json"),
      JSON.stringify({
        $schema: "warrant://lock/1",
        kernel: CLI_VERSION,
        openspec: "1.13.1",
        packs: {
          base: { version: "1.0.0", source: "bundled", hash },
          "bdd-tdd": { version: "0.1.0", source: "bundled", hash }
        }
      })
    );
    const errors = checkLock({ projectRoot: root, config: loaded.config, packs: loaded.packs });
    expect(errors.map((e) => [e.code, e.path])).toEqual([["LOCK_MISMATCH", ".warrant/warrant.lock.json#/packs/bdd-tdd"]]);
  });
});
