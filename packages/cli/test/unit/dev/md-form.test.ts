/**
 * Detector of `scripts/dev/md-form-lib.js` (ADR-0046): what is a line break inside a paragraph and what is a boundary
 * of structure; line addresses of Markdown files.
 */
import { describe, expect, it } from "vitest";

import { lineAddresses, wrapFindings } from "../../../../../scripts/dev/md-form-lib.js";

const md = (...lines: string[]) => lines.join("\n");
const kinds = (text: string) => wrapFindings(text).map((f) => `${f.line} ${f.kind}`);

describe("wrapFindings", () => {
  it("a paragraph broken by width is a wrap on each line but the last", () => {
    expect(kinds(md("# T", "", "Первая часть фразы", "и её конец,", "и ещё."))).toEqual(["3 wrap", "4 wrap"]);
  });

  it("a list item continued on the next line is a wrap; the next item and a nested item are not", () => {
    expect(kinds(md("- пункт один", "  продолжение", "- пункт два", "  - вложенный", "1. раз", "2. два"))).toEqual(["1 wrap"]);
  });

  it("headings, tables, fences, HTML comments and frontmatter hold no paragraph", () => {
    const text = md("---", "name: x", "description: y", "---", "# Заголовок", "Абзац.", "", "| a | b |", "|---|---|", "| 1 | 2 |", "", "```", "код", "код", "```", "", "<!-- комментарий", "на две строки -->");
    expect(kinds(text)).toEqual([]);
  });

  it("a quote broken by width is a wrap; a quote marker with a list is not", () => {
    expect(kinds(md("> цитата", "> продолжение", ">", "> - пункт"))).toEqual(["1 wrap"]);
  });

  it("a hard break (two spaces or a backslash) is reported apart", () => {
    expect(kinds(md("строка  ", "следующая", "", "строка\\", "следующая"))).toEqual(["1 hard-break", "4 hard-break"]);
  });

  it("an ordered item numbered other than 1 right after a paragraph is glued to it; inside a list it is an item", () => {
    expect(kinds(md("Абзац текста.", "4. пункт"))).toEqual(["1 list-in-paragraph"]);
    expect(kinds(md("Порядок:", "1. раз", "   продолжение", "2. два"))).toEqual(["2 wrap"]);
  });

  it("an inline tag inside a sentence is text, a block tag starts a block", () => {
    expect(kinds(md("команда", "<skill-result> -o file"))).toEqual(["1 wrap"]);
    expect(kinds(md("текст", "<details>"))).toEqual([]);
  });
});

describe("lineAddresses", () => {
  it("finds path.md:N and path.md:N-M, not a Cyrillic example or a code address", () => {
    const text = md("см. docs/04-lifecycle.md:12 и README.md:3-5", "пример `файл.md:42`, код src/a.ts:10");
    expect(lineAddresses(text).map((a) => `${a.line} ${a.ref}`)).toEqual(["1 docs/04-lifecycle.md:12", "1 README.md:3-5"]);
  });
});
