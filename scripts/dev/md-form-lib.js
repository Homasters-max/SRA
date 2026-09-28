/**
 * Form of Markdown in the repository (ADR-0044): a paragraph and a list item are one line — no line breaks by width,
 * no hard breaks; a place is addressed by id → section → file, never by line number (`file.md:42`).
 * Pure: text in, findings out; the walk over files and the exceptions live in `test/unit/meta/md-form.test.ts`.
 *
 * The detector needs no Markdown parser: inside a paragraph (outside frontmatter, fenced code, tables, HTML) two
 * adjacent non-blank lines are one paragraph unless the second one starts a block (heading, list item, quote marker
 * with a block, table row, fence, thematic break, HTML block, link definition). Checked against the Prettier parser
 * of md-wrap on the whole repository before and after the cleanup of 2026-09-28 (ADR-0044 Context).
 */

/** A line that starts a block of its own: it can never be the continuation of the previous paragraph. */
const BLOCK_START = /^(#{1,6}\s|[-*+]\s|\||```|~~~|\[[^\]]+\]:\s|(?:[-*_]\s*){3,}$)/;
/** HTML that interrupts a paragraph (CommonMark blocks 1–6); `<skill-result> …` inside a sentence does not. */
const HTML_BLOCK =
  /^<(!--|\/?(address|article|aside|blockquote|details|dialog|div|dl|fieldset|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul|script|style)\b)/i;
/** An ordered item; one numbered other than 1 does not interrupt a paragraph outside a list (CommonMark 5.2). */
const ORDERED = /^(\d{1,9})[.)]\s/;
const LIST_ITEM = /^\s*([-*+]|\d{1,9}[.)])\s/;
const FENCE = /^\s*(```|~~~)/;
/** `path.md:N`, `path.md:N-M`: a line address of a Markdown file (ASCII path, so the rule's own `файл.md:42` passes). */
const LINE_ADDRESS = /[\w./-]*\w\.md:\d+(?:-\d+)?/g;

/** Strips the blockquote markers of a line: `> > text` → `text`; returns the depth too. */
function unquote(line) {
  const m = /^\s*((?:>\s?)+)/.exec(line);
  if (!m) return { depth: 0, rest: line.trim() };
  return { depth: (m[1].match(/>/g) || []).length, rest: line.slice(m[0].length).trim() };
}

const isItem = (line) => LIST_ITEM.test(line) || LIST_ITEM.test(unquote(line).rest);

/** Lines with their 1-based numbers; frontmatter and fenced code become blank (they hold no paragraphs). */
function proseLines(text) {
  const all = String(text).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  if (all[0] === "---") {
    const end = all.indexOf("---", 1);
    if (end > 0) {
      for (; i <= end; i++) out.push({ n: i + 1, text: "" });
    }
  }
  let fenced = false, comment = false;
  for (; i < all.length; i++) {
    const line = all[i];
    if (!fenced && (comment || /^\s*<!--/.test(line))) {
      // an HTML comment block (CommonMark block 2) runs to the line holding `-->`
      comment = !line.includes("-->");
      out.push({ n: i + 1, text: "" });
      continue;
    }
    if (FENCE.test(line) || FENCE.test(unquote(line).rest)) {
      fenced = !fenced;
      out.push({ n: i + 1, text: "" });
      continue;
    }
    out.push({ n: i + 1, text: fenced ? "" : line });
  }
  return out;
}

/**
 * Whether line `k` is inside a list: the block back to the blank line before it starts with an item or an indent, or
 * a list begins inside it (a bullet or an item numbered 1 — those interrupt a paragraph).
 */
function inList(lines, k) {
  let s = k;
  while (s > 0 && lines[s - 1].text.trim() !== "") s--;
  if (isItem(lines[s].text) || /^\s{2,}\S/.test(lines[s].text)) return true;
  for (let j = s + 1; j <= k; j++) {
    const rest = unquote(lines[j].text).rest;
    if (/^[-*+]\s/.test(rest) || /^1[.)]\s/.test(rest)) return true;
  }
  return false;
}

/**
 * Line breaks inside a paragraph or a list item; an ordered list glued to a paragraph (`list-in-paragraph`: an item
 * numbered other than 1 right after a paragraph renders as the paragraph's text — it needs a blank line before it).
 * @returns {{ line: number, kind: "wrap" | "hard-break" | "list-in-paragraph" }[]} `line` — the line ending with the break
 */
export function wrapFindings(text) {
  const lines = proseLines(text);
  const out = [];
  for (let k = 0; k + 1 < lines.length; k++) {
    const cur = lines[k].text, next = lines[k + 1].text;
    if (cur.trim() === "" || next.trim() === "") continue;
    const a = unquote(cur), b = unquote(next);
    if (a.rest === "" || b.rest === "") continue;
    if (/^(#{1,6}\s|\|)/.test(a.rest) || HTML_BLOCK.test(a.rest)) continue;
    if (BLOCK_START.test(b.rest) || HTML_BLOCK.test(b.rest)) continue;
    if (b.depth > a.depth) continue; // a deeper quote starts a block
    const ordered = ORDERED.exec(b.rest);
    if (ordered && (ordered[1] === "1" || inList(lines, k))) continue;
    out.push({ line: lines[k].n, kind: ordered ? "list-in-paragraph" : / {2,}$|\\$/.test(cur) ? "hard-break" : "wrap" });
  }
  return out;
}

/** Line addresses of Markdown files (`path.md:N`) anywhere in the text, code included. */
export function lineAddresses(text) {
  const out = [];
  String(text)
    .replace(/\r\n/g, "\n")
    .split("\n")
    .forEach((line, i) => {
      for (const m of line.matchAll(LINE_ADDRESS)) out.push({ line: i + 1, ref: m[0] });
    });
  return out;
}
