/**
 * `warrant fmt` in the test process (REQ-KRN-022, SCN-KRN-049, 050, 051, 004):
 * the canonical form of WARRANT JSON files, `--check`, explicit paths and the
 * files it skips. Moved from e2e (ADR-0025, task 5.4); stdout as exactly one
 * envelope and the diagnostics on stderr (SCN-KRN-004) stay in
 * `e2e/fmt.test.ts` — here a diagnostic is what the command gives `ctx.warn`,
 * not the result.
 *
 * Each project is an empty temporary directory (`ProjectBuilder` without its
 * base files).
 */
import { describe, expect, it } from "vitest";

import { runFmt, type FmtOptions } from "../../../src/commands/fmt.js";
import type { CommandResult } from "../../../src/io/output.js";
import { invoke } from "../helpers/invoke.js";
import { useProjectBuilder, type ProjectBuilder } from "../helpers/project-builder.js";

const builder = useProjectBuilder();

/** The data of a result, read as the envelope is. */
type Data = Record<string, any>;
type Result = CommandResult & { data: Data };

function fmt(p: ProjectBuilder, paths: string[] = [], opts: FmtOptions = {}): Promise<Result> {
  return invoke(() => runFmt(p.ctx, paths, opts));
}

/** An empty project directory. */
function project(): ProjectBuilder {
  return builder().remove(".warrant").remove("openspec");
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
    const p = project().write(".warrant/warrant.json", CANONICAL_CONFIG);

    const run = await fmt(p);
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(true);
    expect(run.errors).toEqual([]);
    expect(run.data["changed"]).toEqual([]);
    expect(run.data["checked"]).toBe(1);
    expect(p.read(".warrant/warrant.json")).toBe(CANONICAL_CONFIG);
  });

  it("reorders keys without changing values (SCN-KRN-050)", async () => {
    const p = project().write(".warrant/warrant.json", SHUFFLED_CONFIG);

    const run = await fmt(p);
    expect(run.exitCode).toBe(0);
    expect(run.ok).toBe(true);
    expect(run.data["changed"]).toEqual([".warrant/warrant.json"]);

    const text = p.read(".warrant/warrant.json");
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(keys).toEqual(["$schema", "kernel", "openspec", "packs", "paths"]);
    expect(keys.indexOf("packs")).toBeLessThan(keys.indexOf("paths"));
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).not.toContain("\r");
    // Values survive the reordering.
    expect(JSON.parse(text)).toEqual(JSON.parse(SHUFFLED_CONFIG));

    // Formatting again is a no-op: the command is idempotent.
    const again = await fmt(p);
    expect(again.data["changed"]).toEqual([]);
  });

  it("--check reports the path and exits 3 without writing (SCN-KRN-051)", async () => {
    const p = project().write(".warrant/warrant.json", SHUFFLED_CONFIG);

    const run = await fmt(p, [], { check: true });
    expect(run.exitCode).toBe(3);
    expect(run.ok).toBe(false);
    expect(run.data["changed"]).toEqual([".warrant/warrant.json"]);
    expect(run.errors[0]?.code).toBe("NOT_CANONICAL");
    expect(run.errors[0]?.path).toBe(".warrant/warrant.json");
    expect(p.read(".warrant/warrant.json")).toBe(SHUFFLED_CONFIG);
  });

  it("--check on canonical files gives ok: true and the data of the envelope (SCN-KRN-004)", async () => {
    const p = project().write(".warrant/warrant.json", CANONICAL_CONFIG);

    const run = await fmt(p, [], { check: true });
    expect(run.exitCode).toBe(0);
    expect(run).toEqual({ ok: true, data: { checked: 1, changed: [] }, errors: [], exitCode: 0 });
  });

  it("warns through ctx.warn for a file without $schema and keeps the result to the envelope (SCN-KRN-004)", async () => {
    const p = project().write(".warrant/warrant.json", CANONICAL_CONFIG).write(".warrant/local/notes.json", '{\n  "b": 1,\n  "a": 2\n}\n');

    const run = await fmt(p);
    expect(run.exitCode).toBe(0);
    expect(p.warnings.join("")).toContain(".warrant/local/notes.json: no known $schema");
    expect(JSON.stringify(run)).not.toContain("no known $schema");
    expect(p.read(".warrant/local/notes.json")).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
    expect(run.ok).toBe(true);
  });

  it("skips .warrant/schemas/** (decision I-4)", async () => {
    const copy = '{\n  "type": "object",\n  "$id": "warrant://config/1"\n}\n';
    const p = project().write(".warrant/warrant.json", CANONICAL_CONFIG).write(".warrant/schemas/config.1.schema.json", copy);

    const run = await fmt(p);
    expect(run.data["checked"]).toBe(1);
    expect(p.read(".warrant/schemas/config.1.schema.json")).toBe(copy);
  });

  it("formats explicit paths, files and directories, with no .warrant/ present", async () => {
    const p = project()
      .write("docs/a.json", '{\n  "b": 1,\n  "a": 2\n}\n')
      .write("docs/nested/b.json", '{\n  "d": 1,\n  "c": 2\n}\n')
      .write("other/c.json", '{\n  "f": 1,\n  "e": 2\n}\n');

    const run = await fmt(p, ["docs", "other/c.json"]);
    expect(run.exitCode).toBe(0);
    expect(run.data["changed"]).toEqual(["docs/a.json", "docs/nested/b.json", "other/c.json"]);
    expect(p.read("docs/a.json")).toBe('{\n  "a": 2,\n  "b": 1\n}\n');
  });

  it("reports CONFIG_MISSING with no paths and no .warrant/", async () => {
    const run = await fmt(project());
    expect(run.exitCode).toBe(3);
    expect(run.errors[0]?.code).toBe("CONFIG_MISSING");
  });

  it("reports CONFIG_INVALID for unparsable JSON and keeps going", async () => {
    const p = project().write(".warrant/warrant.json", SHUFFLED_CONFIG).write(".warrant/local/broken.json", "{ not json");

    const run = await fmt(p);
    expect(run.exitCode).toBe(3);
    expect(run.errors.map((e) => e.code)).toEqual(["CONFIG_INVALID"]);
    expect(run.errors[0]?.path).toBe(".warrant/local/broken.json");
    // The readable file was still formatted.
    expect(run.data["changed"]).toEqual([".warrant/warrant.json"]);
    expect(p.read(".warrant/warrant.json")).not.toBe(SHUFFLED_CONFIG);
  });
});
