/**
 * Requirements of a delta spec by section (design §3, REQ-VER-010): the
 * `## ADDED|MODIFIED|REMOVED|RENAMED Requirements` sections of
 * `openspec/changes/<change>/specs/<capability>/spec.md`, each requirement with
 * the scenarios under it. Ids are the `<!-- id: ... -->` comments of the owner
 * of the format (`ID_COMMENT_RE`, `core/ids/scan.ts`); inline code spans are
 * blanked first, as the scanner does (I-44). Not a Markdown parser: a line
 * `## …` opens or closes a section, a REQ id opens a requirement, an SCN id
 * belongs to the last requirement of the section.
 */
import { blankCodeSpans, ID_COMMENT_RE } from "../ids/scan.js";

export const DELTA_SECTIONS = ["ADDED", "MODIFIED", "REMOVED", "RENAMED"] as const;

export type DeltaSection = (typeof DELTA_SECTIONS)[number];

export interface DeltaRequirement {
  section: DeltaSection;
  /** REQ id of the requirement. */
  req: string;
  /** SCN ids declared under it, in order. */
  scenarios: string[];
}

const SECTION_RE = /^##\s+(ADDED|MODIFIED|REMOVED|RENAMED)\s+Requirements\s*$/;
const HEADING_2_RE = /^##(?!#)/;

/** The requirements of one delta spec text, in order of appearance. */
export function parseDelta(text: string): DeltaRequirement[] {
  const out: DeltaRequirement[] = [];
  let section: DeltaSection | null = null;
  let current: DeltaRequirement | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (HEADING_2_RE.test(line)) {
      const m = SECTION_RE.exec(line);
      section = m === null ? null : (m[1] as DeltaSection);
      current = null;
      continue;
    }
    if (section === null) continue;
    for (const m of blankCodeSpans(line).matchAll(new RegExp(ID_COMMENT_RE.source, "g"))) {
      const [, prefix = "", area = "", nnn = ""] = m;
      const id = `${prefix}-${area}-${nnn}`;
      if (prefix === "REQ") {
        current = { section, req: id, scenarios: [] };
        out.push(current);
      } else if (prefix === "SCN" && current !== null) {
        current.scenarios.push(id);
      }
    }
  }
  return out;
}
