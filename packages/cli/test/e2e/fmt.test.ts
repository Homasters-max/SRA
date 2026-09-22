import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { makeTempDir, removeDir, runCli } from "../helpers/cli.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

function project(): string {
  const root = makeTempDir("warrant-fmt-");
  tempDirs.push(root);
  return root;
}

function write(root: string, rel: string, text: string): void {
  const absolute = path.join(root, rel);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, text, "utf8");
}

function read(root: string, rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

const CANONICAL_CONFIG = [
  "{",
  '  "$schema": "warrant://config/1",',
  '  "kernel": "0.1",',
  '  "openspec": "1.13.x",',
  '  "packs": {',
  '    "core-sdd": {',
  '      "version": "^0.1"',
  "    }",
  "  }",
  "}",
  ""
].join("\n");

/** The same document with `paths` before `packs` and `$schema` last (SCN-KRN-050). */
const SHUFFLED_CONFIG = [
  "{",
  '  "paths": {',
  '    "tests": "packages/cli/test"',
  "  },",
  '  "packs": {',
  '    "core-sdd": {',
  '      "version": "^0.1"',
  "    }",
  "  },",
  '  "openspec": "1.13.x",',
  '  "kernel": "0.1",',
  '  "$schema": "warrant://config/1"',
  "}",
  ""
].join("\n");

describe("warrant fmt", () => {
  it("leaves a canonical file untouched and reports no change (SCN-KRN-049)", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", CANONICAL_CONFIG);

    const run = await runCli(["fmt"], root);
    expect(run.status).toBe(0);
    expect(run.json?.command).toBe("fmt");
    expect(run.json?.ok).toBe(true);
    expect(run.json?.errors).toEqual([]);
    expect(run.json?.data.changed).toEqual([]);
    expect(run.json?.data.checked).toBe(1);
    expect(read(root, ".warrant/warrant.json")).toBe(CANONICAL_CONFIG);
  });

  it("reorders keys without changing values (SCN-KRN-050)", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", SHUFFLED_CONFIG);

    const run = await runCli(["fmt"], root);
    expect(run.status).toBe(0);
    expect(run.json?.ok).toBe(true);
    expect(run.json?.data.changed).toEqual([".warrant/warrant.json"]);

    const text = read(root, ".warrant/warrant.json");
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(keys).toEqual(["$schema", "kernel", "openspec", "packs", "paths"]);
    expect(keys.indexOf("packs")).toBeLessThan(keys.indexOf("paths"));
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toContain("\r");
    // Values survive the reordering.
    expect(JSON.parse(text)).toEqual(JSON.parse(SHUFFLED_CONFIG));

    // Formatting again is a no-op: the command is idempotent.
    const again = await runCli(["fmt"], root);
    expect(again.json?.data.changed).toEqual([]);
  });

  it("--check reports the path and exits 1 without writing (SCN-KRN-051)", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", SHUFFLED_CONFIG);

    const run = await runCli(["fmt", "--check"], root);
    expect(run.status).toBe(1);
    expect(run.json?.ok).toBe(false);
    expect(run.json?.data.changed).toEqual([".warrant/warrant.json"]);
    expect(run.json?.errors[0].code).toBe("NOT_CANONICAL");
    expect(run.json?.errors[0].path).toBe(".warrant/warrant.json");
    expect(read(root, ".warrant/warrant.json")).toBe(SHUFFLED_CONFIG);
  });

  it("--check on canonical files prints one envelope with ok: true (SCN-KRN-004)", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", CANONICAL_CONFIG);

    const run = await runCli(["fmt", "--check"], root);
    expect(run.status).toBe(0);
    expect(run.json).toEqual({ command: "fmt", ok: true, data: { checked: 1, changed: [] }, errors: [] });
    expect(run.stdout.trim().split("\n}").length).toBe(2); // exactly one object
  });

  it("warns on stderr for a file without $schema and keeps stdout to the envelope (SCN-KRN-004)", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", CANONICAL_CONFIG);
    write(root, ".warrant/local/notes.json", '{\n  "b": 1,\n  "a": 2\n}\n');

    const run = await runCli(["fmt"], root);
    expect(run.status).toBe(0);
    expect(run.stderr).toContain(".warrant/local/notes.json: no known $schema");
    expect(read(root, ".warrant/local/notes.json")).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
    // stdout is exactly one JSON object.
    expect(run.stdout.trim().startsWith("{")).toBe(true);
    expect(run.stdout.trim().endsWith("}")).toBe(true);
    expect(run.json?.ok).toBe(true);
  });

  it("skips .warrant/schemas/** (decision I-4)", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", CANONICAL_CONFIG);
    const copy = '{\n  "type": "object",\n  "$id": "warrant://config/1"\n}\n';
    write(root, ".warrant/schemas/config.1.schema.json", copy);

    const run = await runCli(["fmt"], root);
    expect(run.json?.data.checked).toBe(1);
    expect(read(root, ".warrant/schemas/config.1.schema.json")).toBe(copy);
  });

  it("formats explicit paths, files and directories, with no .warrant/ present", async () => {
    const root = project();
    write(root, "docs/a.json", '{\n  "b": 1,\n  "a": 2\n}\n');
    write(root, "docs/nested/b.json", '{\n  "d": 1,\n  "c": 2\n}\n');
    write(root, "other/c.json", '{\n  "f": 1,\n  "e": 2\n}\n');

    const run = await runCli(["fmt", "docs", "other/c.json"], root);
    expect(run.status).toBe(0);
    expect(run.json?.data.changed).toEqual(["docs/a.json", "docs/nested/b.json", "other/c.json"]);
    expect(read(root, "docs/a.json")).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });

  it("reports CONFIG_MISSING with no paths and no .warrant/", async () => {
    const root = project();
    const run = await runCli(["fmt"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors[0].code).toBe("CONFIG_MISSING");
  });

  it("reports CONFIG_INVALID for unparsable JSON and keeps going", async () => {
    const root = project();
    write(root, ".warrant/warrant.json", SHUFFLED_CONFIG);
    write(root, ".warrant/local/broken.json", "{ not json");

    const run = await runCli(["fmt"], root);
    expect(run.status).toBe(3);
    expect(run.json?.errors.map((e: { code: string }) => e.code)).toEqual(["CONFIG_INVALID"]);
    expect(run.json?.errors[0].path).toBe(".warrant/local/broken.json");
    // The readable file was still formatted.
    expect(run.json?.data.changed).toEqual([".warrant/warrant.json"]);
    expect(read(root, ".warrant/warrant.json")).not.toBe(SHUFFLED_CONFIG);
  });
});
