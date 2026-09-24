// e2e: output
/**
 * `warrant fmt` through the binary: stdout is exactly one envelope, the
 * diagnostics go to stderr (SCN-KRN-004), and `--check` of argv reaches the
 * command. Formatting itself (REQ-KRN-022; SCN-KRN-049, 050, 051, 004) is
 * tested in the test process: `test/app/commands/fmt.test.ts` (ADR-0025,
 * task 5.4).
 */
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

describe("warrant fmt (output)", () => {
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
});
