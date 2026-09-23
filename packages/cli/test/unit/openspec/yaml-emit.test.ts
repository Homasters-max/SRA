import { describe, expect, it } from "vitest";
import { parse, parseDocument } from "yaml";

import { GENERATED_MARKER, emitYaml, type YamlObject } from "../../../src/core/openspec/yaml-emit.js";

/** Emits, parses back with a real YAML reader and asserts nothing changed. */
function roundTrip(value: YamlObject): void {
  const text = emitYaml(value, { marker: true });
  expect(text.split("\n")[0]).toBe(GENERATED_MARKER);
  expect(text.endsWith("\n")).toBe(true);
  expect(text.endsWith("\n\n")).toBe(false);
  expect(text).not.toContain("\r");
  expect(parse(text)).toEqual(value);
}

describe("emitYaml", () => {
  it("puts the generation marker on the first line (SCN-KRN-063)", () => {
    const text = emitYaml({ schema: "warrant-sdd" }, { marker: true });
    expect(text).toBe(`${GENERATED_MARKER}\nschema: warrant-sdd\n`);
    // The dash is an em dash, exactly as ADR-0015 spells it.
    expect(GENERATED_MARKER).toContain("—");
  });

  it("omits the marker unless asked", () => {
    expect(emitYaml({ schema: "x" })).toBe("schema: x\n");
  });

  it("round-trips a config with a multi-line context", () => {
    roundTrip({
      schema: "warrant-sdd",
      context: "Language: Russian\nAll artifacts must be written in Russian.\n",
      rules: { proposal: ["State the non-goals explicitly"] }
    });
  });

  it("round-trips strings that contain `: ` and ` #`", () => {
    roundTrip({
      a: "Keep the Capabilities section: it names the spec files",
      b: "A delta for a new capability starts with ## Purpose",
      c: "trailing hash #",
      d: "colon at end:",
      e: "-leading dash",
      f: "*anchor-like",
      g: "@at-sign"
    });
  });

  it("round-trips the empty string and number-like or bool-like strings", () => {
    roundTrip({ empty: "", n: "123", f: "1e3", h: "0x1", p: ".5", t: "true", y: "yes", z: "null", tilde: "~" });
  });

  it("keeps real scalars scalar", () => {
    const text = emitYaml({ version: 1, ok: true, missing: null });
    expect(text).toBe("version: 1\nok: true\nmissing: null\n");
    expect(parse(text)).toEqual({ version: 1, ok: true, missing: null });
  });

  it("round-trips a list of mappings (the `artifacts` list)", () => {
    roundTrip({
      name: "warrant-sdd",
      version: 1,
      artifacts: [
        { id: "proposal", generates: "proposal.md", template: "proposal.md", requires: [] },
        { id: "specs", generates: "specs/**/*.md", template: "spec.md", requires: ["proposal"] }
      ],
      apply: { requires: ["tasks"], tracks: "tasks.md" }
    });
  });

  it("round-trips nested operations.apply.guidance", () => {
    roundTrip({
      operations: { apply: { guidance: ["Run warrant status before marking a task done", "Never edit an id"] } }
    });
  });

  it("chooses the chomping indicator so trailing newlines survive", () => {
    for (const [text, header] of [
      ["a\nb", "|-"],
      ["a\nb\n", "|"],
      ["a\nb\n\n", "|+"],
      ["a\nb\n\n\n", "|+"]
    ] as const) {
      const out = emitYaml({ k: text });
      expect(out.split("\n")[0]).toBe(`k: ${header}`);
      expect(parse(out)).toEqual({ k: text });
    }
  });

  it("keeps indented lines inside the literal block (ADR-0015 point 3)", () => {
    // Shaped like an `instruction` of packs/core-sdd: bullets with continuation
    // lines and blank lines between paragraphs.
    const instruction = [
      "Create the proposal document.",
      "",
      "Sections:",
      "- **Why**: one or two sentences.",
      "- **Capabilities**: which specs change:",
      "  - **New Capabilities**: each becomes `specs/<path>/spec.md`.",
      "  - **Modified Capabilities**: use the exact existing path.",
      "",
      "WARRANT rules for this artifact:",
      "",
      "- A stable ID is written as `<!-- id: REQ-AREA-NNN -->` directly under",
      "  its own heading.",
      ""
    ].join("\n");
    const text = emitYaml({ instruction });
    expect(text.split("\n")[0]).toBe("instruction: |");
    expect(text).toContain("\n    - **New Capabilities**");
    expect(parse(text)).toEqual({ instruction });
    roundTrip({ artifacts: [{ id: "proposal", instruction }] });
  });

  it("pins the indentation when the first content line starts with a space", () => {
    for (const text of ["  starts with space\nb\n", "\n  indented first content\nb", "\tstarts with tab\nb\n"]) {
      const out = emitYaml({ k: text });
      expect(out.split("\n")[0]).toMatch(/^k: \|2[-+]?$/);
      expect(parse(out)).toEqual({ k: text });
    }
  });

  it("falls back to double quotes only for what a block cannot hold", () => {
    // A CR (and any other control character) has no block representation, and
    // no reader preserves a line made only of whitespace.
    for (const text of ["a\r\nb\n", "a\n   \nb\n", "a\nb\n"]) {
      const out = emitYaml({ k: text });
      expect(out.startsWith('k: "')).toBe(true);
      expect(parse(out)).toEqual({ k: text });
    }
  });

  it("quotes keys that are not plain identifiers", () => {
    roundTrip({ "with space": "x", "a.b": "y", plain_key: "z", "kebab-key": "w" });
  });

  it("quotes keys a YAML reader would not keep as strings (B5, SCN-KRN-100)", () => {
    const value = { null: ["x"], true: "a", False: "b", yes: "c", no: "d", on: "e", off: "f", Null: "g" };
    const text = emitYaml(value);
    for (const key of Object.keys(value)) expect(text).toContain(`${JSON.stringify(key)}:`);
    for (const version of ["1.1", "1.2"] as const) {
      const doc = parseDocument(text, { version });
      const keys = (doc.contents as unknown as { items: { key: { value: unknown } }[] }).items.map(
        (pair) => pair.key.value
      );
      expect(keys).toEqual(Object.keys(value));
    }
    // Plain identifiers stay plain.
    expect(emitYaml({ nullable: "x", yesterday: "y" })).toBe("nullable: x\nyesterday: y\n");
  });

  it("emits empty containers inline", () => {
    const text = emitYaml({ list: [], map: {} });
    expect(text).toBe("list: []\nmap: {}\n");
    expect(parse(text)).toEqual({ list: [], map: {} });
  });

  it("refuses shapes it cannot represent deterministically", () => {
    expect(() => emitYaml({ nested: [[1, 2]] as never })).toThrow(/nested sequences/);
    expect(() => emitYaml({ bad: Number.NaN })).toThrow(/non-finite/);
  });
});
