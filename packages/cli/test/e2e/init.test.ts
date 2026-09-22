import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { openspecAvailable, runOpenspec } from "../../src/core/openspec/cli.js";
import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const tempDirs: string[] = [];
const hasOpenspec = openspecAvailable();

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

/** An empty temp project with OpenSpec initialised but no `.warrant/`. */
function project(init = true): string {
  const root = makeTempDir("warrant-init-");
  tempDirs.push(root);
  if (init) expect(runOpenspec(["init", "--tools", "none"], root).ok).toBe(true);
  return root;
}

/** PATH key as Windows spells it, so the override replaces rather than duplicates it. */
const PATH_KEY = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";

/**
 * A directory holding a fake `openspec` that only records that it was called.
 * Both spellings are written, so it works whichever shell cross-spawn picks.
 */
function fakeOpenspec(marker: string): string {
  const dir = makeTempDir("warrant-fake-openspec-");
  tempDirs.push(dir);
  const cmdMarker = marker.replace(/\//g, "\\");
  writeFileSync(path.join(dir, "openspec.cmd"), `@echo called > "${cmdMarker}"\r\n@echo 1.13.1\r\n`, "utf8");
  writeFileSync(path.join(dir, "openspec"), `#!/bin/sh\necho called > "${marker}"\necho 1.13.1\n`, "utf8");
  try {
    chmodSync(path.join(dir, "openspec"), 0o755);
  } catch {
    // Permissions do not exist on Windows; the .cmd is used there.
  }
  return dir;
}

describe("warrant init", () => {
  it.skipIf(!hasOpenspec)(
    "creates the project skeleton and leaves it valid (SCN-KRN-042, SCN-KRN-052)",
    async () => {
      const root = project();
      const run = await runCli(["init"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);

      const created = run.json?.data.created as string[];
      expect(created.length).toBeGreaterThan(0);
      for (const rel of [
        ".warrant/warrant.json",
        ".warrant/local/areas.json",
        ".warrant/local/openspec/rules.json",
        ".warrant/changes/.gitkeep",
        ".warrant/waivers/.gitkeep",
        ".warrant/evidence/.gitkeep",
        ".warrant/runs/.gitkeep",
        ".warrant/warrant.lock.json",
        "openspec/config.yaml"
      ]) {
        expect(created).toContain(rel);
        expect(existsSync(path.join(root, ...rel.split("/")))).toBe(true);
      }
      // The schema copies come from `sync`, not from `init` itself.
      expect(existsSync(path.join(root, ".warrant", "schemas", "config.1.schema.json"))).toBe(true);

      const config = JSON.parse(readFileSync(path.join(root, ".warrant", "warrant.json"), "utf8")) as {
        openspec: string;
        packs: Record<string, { version: string }>;
      };
      expect(config.openspec).toMatch(/^\d+\.\d+\.x$/);
      expect(config.packs["core-sdd"]?.version).toMatch(/^\^/);

      const validate = await runCli(["validate"], root);
      expect(validate.json?.errors).toEqual([]);
      expect(validate.json?.ok).toBe(true);
      expect(validate.status).toBe(0);

      // A second sync changes nothing: `init` left a fully synced project.
      expect((await runCli(["sync", "--check"], root)).status).toBe(0);
    },
    120_000
  );

  it("refuses a second init without --force, without calling openspec (SCN-KRN-053)", async () => {
    const root = project(false);
    mkdirSync(path.join(root, ".warrant"), { recursive: true });
    const configAbs = path.join(root, ".warrant", "warrant.json");
    const before = '{\n  "$schema": "warrant://config/1"\n}\n';
    writeFileSync(configAbs, before, "utf8");

    const marker = path.join(root, "openspec-was-called.txt");
    const run = await runCli(["init"], root, { [PATH_KEY]: fakeOpenspec(marker) + path.delimiter + (process.env[PATH_KEY] ?? "") });
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("ALREADY_INITIALIZED");
    expect(readFileSync(configAbs, "utf8")).toBe(before);
    expect(existsSync(marker)).toBe(false);
  });

  it.skipIf(!hasOpenspec)(
    "rewrites the files it owns with --force (SCN-KRN-053)",
    async () => {
      const root = project();
      expect((await runCli(["init"], root)).status).toBe(0);
      const configAbs = path.join(root, ".warrant", "warrant.json");
      writeFileSync(configAbs, '{\n  "$schema": "warrant://config/1"\n}\n', "utf8");

      const forced = await runCli(["init", "--force"], root);
      expect(forced.json?.errors).toEqual([]);
      expect(forced.status).toBe(0);
      expect(forced.json?.data.created).toContain(".warrant/warrant.json");
      const config = JSON.parse(readFileSync(configAbs, "utf8")) as { packs?: Record<string, unknown> };
      expect(config.packs?.["core-sdd"]).toBeDefined();
      expect((await runCli(["validate"], root)).json?.ok).toBe(true);
    },
    120_000
  );

  it("fails with OPENSPEC_FAILED and writes nothing when openspec is absent", async () => {
    const root = project(false);
    const empty = makeTempDir("warrant-no-openspec-");
    tempDirs.push(empty);
    const run = await runCli(["init"], root, { [PATH_KEY]: empty });
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("OPENSPEC_FAILED");
    expect(existsSync(path.join(root, ".warrant"))).toBe(false);
  });

  it("rejects an unknown sub-command", async () => {
    const root = project(false);
    const run = await runCli(["init", "foo"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("USAGE");
  });
});

describe("warrant init change", () => {
  it.skipIf(!hasOpenspec)(
    "creates the OpenSpec change and a PROPOSED record (SCN-KRN-054)",
    async () => {
      const root = project();
      expect((await runCli(["init"], root)).status).toBe(0);

      const run = await runCli(["init", "change", "add-search"], root);
      expect(run.json?.errors).toEqual([]);
      expect(run.status).toBe(0);
      expect(run.json?.change).toBe("add-search");
      expect(run.json?.data.record).toBe(".warrant/changes/add-search.json");

      expect(existsSync(path.join(root, "openspec", "changes", "add-search", ".openspec.yaml"))).toBe(true);
      const record = JSON.parse(readFileSync(path.join(root, ".warrant", "changes", "add-search.json"), "utf8")) as {
        change_state: string;
        classification?: unknown;
        transitions: { to: string; by: string }[];
      };
      expect(record.change_state).toBe("PROPOSED");
      expect(record.classification).toBeUndefined();
      expect(record.transitions).toHaveLength(1);
      expect(record.transitions[0]?.by).toBe("cli:local");
      expect(record.transitions[0]?.to).toBe("PROPOSED");

      // Its own name is now taken.
      const again = await runCli(["init", "change", "add-search"], root);
      expect(again.status).toBe(3);
      expect(again.json?.errors[0].code).toBe("CHANGE_NAME_TAKEN");
    },
    120_000
  );

  it("refuses a name held by the archive before calling openspec (SCN-KRN-055)", async () => {
    const root = project(false);
    mkdirSync(path.join(root, ".warrant"), { recursive: true });
    writeFileSync(
      path.join(root, ".warrant", "warrant.json"),
      JSON.stringify({ $schema: "warrant://config/1", kernel: "0.1", openspec: "1.13.x", packs: {} }, null, 2) + "\n",
      "utf8"
    );
    mkdirSync(path.join(root, "openspec", "changes", "archive", "2026-09-01-add-search"), { recursive: true });
    writeFileSync(path.join(root, "openspec", "config.yaml"), "schema: warrant-sdd\n", "utf8");

    const marker = path.join(root, "openspec-was-called.txt");
    const run = await runCli(["init", "change", "add-search"], root, {
      [PATH_KEY]: fakeOpenspec(marker) + path.delimiter + (process.env[PATH_KEY] ?? "")
    });
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CHANGE_NAME_TAKEN");
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(path.join(root, "openspec", "changes", "add-search"))).toBe(false);
  });

  it("rejects a name that is not kebab-case", async () => {
    const root = project(false);
    mkdirSync(path.join(root, ".warrant"), { recursive: true });
    writeFileSync(path.join(root, ".warrant", "warrant.json"), "{}\n", "utf8");
    const run = await runCli(["init", "change", "Add_Search"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("USAGE");
  });
});
