/**
 * Stable-ID scanner and check (5) of `validate` (design D-5, ADR-0012, 02 section 3).
 *
 * The scanner is deliberately not a Markdown parser: the `<!-- id: ... -->`
 * comment belongs to WARRANT, not to OpenSpec, so a regular expression over the
 * raw bytes is the contract.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import type { Ctx } from "../ctx.js";
import type { CliError } from "../errors.js";
import { openspecAvailable } from "../openspec/version.js";

/** Prefixes that use the `PREFIX-AREA-NNN` form (ADR-0012 point 1). */
export const SPEC_LEVEL_PREFIXES = ["REQ", "SCN", "TASK", "UNK", "ASM"] as const;

/** Well-formed id comment (design D-5). */
export const ID_COMMENT_RE = /<!--\s*id:\s*(REQ|SCN|TASK|UNK|ASM)-([A-Z]{2,5})-(\d{3})\s*-->/g;

/** Any `<!-- id: ... -->` comment, well-formed or not, so malformed ones can be reported. */
export const ANY_ID_COMMENT_RE = /<!--\s*id:\s*([^>]*?)\s*-->/g;

const WELL_FORMED_PAYLOAD = /^(REQ|SCN|TASK|UNK|ASM)-[A-Z]{2,5}-\d{3}$/;

/**
 * Where an id was found (B6, design D-6): `specs` — `openspec/specs/**`,
 * `changes` — an active change (and `.warrant/changes/*.json` records),
 * `archive` — `openspec/changes/archive/<dir>/**`.
 */
export type IdOrigin = "specs" | "changes" | "archive";

export interface FoundId {
  id: string;
  prefix: string;
  area: string;
  nnn: number;
  /** Path relative to the project root, POSIX separators. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Origin of the declaration (B6). */
  origin: IdOrigin;
  /**
   * For `origin: "archive"`, the archive directory the file belongs to
   * (`openspec/changes/archive/<dir>`); `null` otherwise. Two declarations in
   * the same archive directory are still duplicates of each other.
   */
  archiveDir: string | null;
}

function posix(p: string): string {
  return p.split(path.sep).join("/");
}

const ARCHIVE_RE = /^openspec\/changes\/archive\/([^/]+)\//;

/** Origin of a project-relative POSIX path (B6). */
export function originOf(file: string): { origin: IdOrigin; archiveDir: string | null } {
  const m = ARCHIVE_RE.exec(file);
  if (m !== null) return { origin: "archive", archiveDir: `openspec/changes/archive/${m[1] as string}` };
  if (file.startsWith("openspec/specs/")) return { origin: "specs", archiveDir: null };
  return { origin: "changes", archiveDir: null };
}

/**
 * Inline code spans (`...` on one line) are blanked before scanning so an id
 * comment quoted in prose — a spec describing the format — is neither an id
 * nor a placement error (I-44). Lengths are kept so indices and lines hold.
 */
export function blankCodeSpans(text: string): string {
  return text.replace(/`[^`\n]*`/g, (span) => " ".repeat(span.length));
}

function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/** Markdown files under a directory, recursively. */
function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  const visit = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = path.join(current, name);
      let stat;
      try {
        stat = statSync(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory()) visit(abs);
      else if (stat.isFile() && name.toLowerCase().endsWith(".md")) out.push(abs);
    }
  };
  visit(dir);
  return out;
}

/** Ids found in one Markdown text. */
export function scanMarkdown(text: string, file: string): FoundId[] {
  const found: FoundId[] = [];
  const re = new RegExp(ID_COMMENT_RE.source, "g");
  const scanned = blankCodeSpans(text);
  const { origin, archiveDir } = originOf(file);
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned)) !== null) {
    const [, prefix = "", area = "", nnn = "000"] = m;
    found.push({
      id: `${prefix}-${area}-${nnn}`,
      prefix,
      area,
      nnn: Number.parseInt(nnn, 10),
      file,
      line: lineOf(text, m.index),
      origin,
      archiveDir
    });
  }
  return found;
}

/** Malformed `<!-- id: ... -->` comments in one Markdown text (check 5a). */
export function scanMalformed(text: string, file: string): CliError[] {
  const errors: CliError[] = [];
  const re = new RegExp(ANY_ID_COMMENT_RE.source, "g");
  const scanned = blankCodeSpans(text);
  let m: RegExpExecArray | null;
  while ((m = re.exec(scanned)) !== null) {
    const payload = m[1] ?? "";
    if (WELL_FORMED_PAYLOAD.test(payload)) continue;
    errors.push({
      code: "ID_FORMAT",
      message: `"${payload}" is not a stable id of the form PREFIX-AREA-NNN (line ${lineOf(text, m.index)})`,
      path: file
    });
  }
  return errors;
}

export interface ScanResult {
  ids: FoundId[];
  /** ID_FORMAT findings from malformed comments. */
  malformed: CliError[];
  /** Files actually read, as project-relative POSIX paths. */
  files: string[];
}

/**
 * Scans `openspec/specs/**`, `openspec/changes/**` (archive included) and the
 * `unknowns[]` / `assumptions[]` of `.warrant/changes/*.json`.
 */
export function scanIds(projectRoot: string): ScanResult {
  const ids: FoundId[] = [];
  const malformed: CliError[] = [];
  const files: string[] = [];

  for (const rel of ["openspec/specs", "openspec/changes"]) {
    const dir = path.join(projectRoot, rel);
    if (!existsSync(dir)) continue;
    for (const absolute of markdownFiles(dir)) {
      const reported = posix(path.relative(projectRoot, absolute));
      files.push(reported);
      const text = readFileSync(absolute, "utf8");
      ids.push(...scanMarkdown(text, reported));
      malformed.push(...scanMalformed(text, reported));
    }
  }

  const recordsDir = path.join(projectRoot, ".warrant", "changes");
  if (existsSync(recordsDir)) {
    for (const name of readdirSync(recordsDir).sort()) {
      if (!name.toLowerCase().endsWith(".json")) continue;
      const absolute = path.join(recordsDir, name);
      const reported = posix(path.relative(projectRoot, absolute));
      files.push(reported);
      let json: unknown;
      try {
        json = JSON.parse(readFileSync(absolute, "utf8"));
      } catch {
        continue;
      }
      if (typeof json !== "object" || json === null) continue;
      const record = json as Record<string, unknown>;
      for (const field of ["unknowns", "assumptions"] as const) {
        const list = record[field];
        if (!Array.isArray(list)) continue;
        list.forEach((entry, i) => {
          if (typeof entry !== "object" || entry === null) return;
          const id = (entry as Record<string, unknown>)["id"];
          if (typeof id !== "string") return;
          const m = /^(REQ|SCN|TASK|UNK|ASM)-([A-Z]{2,5})-(\d{3})$/.exec(id);
          if (m === null) {
            malformed.push({
              code: "ID_FORMAT",
              message: `"${id}" is not a stable id of the form PREFIX-AREA-NNN`,
              path: `${reported}#/${field}/${i}/id`
            });
            return;
          }
          ids.push({
            id,
            prefix: m[1] as string,
            area: m[2] as string,
            nnn: Number.parseInt(m[3] as string, 10),
            file: reported,
            line: 0,
            origin: "changes",
            archiveDir: null
          });
        });
      }
    }
  }

  return { ids, malformed, files };
}

/** AREA codes declared in `.warrant/local/areas.json`. */
export function loadAreas(projectRoot: string): Set<string> {
  const absolute = path.join(projectRoot, ".warrant", "local", "areas.json");
  if (!existsSync(absolute)) return new Set();
  try {
    const json = JSON.parse(readFileSync(absolute, "utf8")) as Record<string, unknown>;
    return new Set(Object.keys(json).filter((k) => /^[A-Z]{2,5}$/.test(k)));
  } catch {
    return new Set();
  }
}

/** Check 5b: every AREA used is declared (SCN-KRN-047). */
export function checkAreas(ids: FoundId[], areas: Set<string>): CliError[] {
  const seen = new Set<string>();
  const errors: CliError[] = [];
  for (const found of ids) {
    if (areas.has(found.area)) continue;
    const key = `${found.area} ${found.file}`;
    if (seen.has(key)) continue;
    seen.add(key);
    errors.push({
      code: "AREA_UNKNOWN",
      message: `AREA "${found.area}" of ${found.id} is not declared in .warrant/local/areas.json`,
      path: found.file
    });
  }
  return errors;
}

/**
 * Check 5c: an id appears in exactly one place — within `specs ∪ changes`, or
 * within one archive directory (B6, design D-6). `specs × archive` and
 * `archive × archive` across different directories are history, not a second
 * declaration; `warrant id` still counts them as taken (`highestNumber`).
 */
export function checkDuplicates(ids: FoundId[]): CliError[] {
  /**
   * Declarations that compete with each other share this scope: all of
   * `openspec/specs/**`, all active changes together, and each archive
   * directory on its own. A `MODIFIED`/`REMOVED` delta of an active change
   * repeats the id of the main spec it edits, which is the same declaration
   * moving, not a second one (I-46).
   */
  const scopeOf = (found: FoundId): string => found.archiveDir ?? found.origin;
  const byId = new Map<string, Map<string, FoundId[]>>();
  for (const found of ids) {
    let scopes = byId.get(found.id);
    if (scopes === undefined) {
      scopes = new Map<string, FoundId[]>();
      byId.set(found.id, scopes);
    }
    const scope = scopeOf(found);
    const list = scopes.get(scope);
    if (list === undefined) scopes.set(scope, [found]);
    else list.push(found);
  }
  const errors: CliError[] = [];
  for (const [id, scopes] of [...byId.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    for (const scope of [...scopes.keys()].sort()) {
      const list = scopes.get(scope) as FoundId[];
      if (list.length < 2) continue;
      const where = list.map((f) => (f.line > 0 ? `${f.file}:${f.line}` : f.file)).join(", ");
      errors.push({
        code: "ID_DUPLICATE",
        message: `${id} is declared more than once: ${where}`,
        path: (list[1] as FoundId).file
      });
    }
  }
  return errors;
}

/**
 * Placement is checked only for spec files of active changes and for main specs:
 * those are what `openspec show --json` reparses. `tasks.md` and the other
 * artifacts carry ids that `show` does not return at all, and archive is
 * immutable, so both are checked for format and uniqueness only (design D-5).
 */
function isPlacementChecked(file: string): boolean {
  if (file.startsWith("openspec/changes/archive/")) return false;
  if (file.startsWith("openspec/specs/")) return file.endsWith(".md");
  return /^openspec\/changes\/[^/]+\/specs\/.+\.md$/.test(file);
}

function firstLineId(text: unknown): string | null {
  if (typeof text !== "string") return null;
  const lines = text.split(/\r?\n/);
  const first = (lines[0] ?? "").trim();
  const m = /^<!--\s*id:\s*([A-Z]{3,4}-[A-Z]{2,5}-\d{3})\s*-->$/.exec(first);
  if (m === null) return null;
  const body = lines.slice(1).join("\n").trim();
  if (body.length === 0) return null;
  return m[1] as string;
}

/** Ids placed as the first line of the requirement and scenario texts `show` returned. */
function collectPlaced(texts: readonly string[], into: Set<string>): void {
  for (const text of texts) {
    const id = firstLineId(text);
    if (id !== null) into.add(id);
  }
}

/**
 * Check 5d: an id found by the scanner in an active change spec or in a main
 * spec must come back from `openspec show --json` as the first line of its
 * requirement or scenario, with a non-empty body after it (SCN-KRN-046).
 */
export async function checkPlacement(ctx: Ctx, ids: FoundId[]): Promise<{ errors: CliError[]; skipped: boolean }> {
  const relevant = ids.filter((f) => isPlacementChecked(f.file) && (f.prefix === "REQ" || f.prefix === "SCN"));
  if (relevant.length === 0) return { errors: [], skipped: false };
  if (!(await openspecAvailable(ctx.openspec))) return { errors: [], skipped: true };

  const placed = new Set<string>();
  for (const name of await ctx.openspec.listChanges()) collectPlaced(await ctx.openspec.showChange(name), placed);
  for (const id of await ctx.openspec.listSpecs()) collectPlaced(await ctx.openspec.showSpec(id), placed);

  const errors: CliError[] = [];
  for (const found of relevant) {
    if (placed.has(found.id)) continue;
    errors.push({
      code: "ID_PLACEMENT",
      message: `${found.id} (line ${found.line}) is not directly under its own heading with a non-empty body after it (ADR-0012 section 7)`,
      path: found.file
    });
  }
  return { errors, skipped: false };
}

/**
 * Check (5) as a whole. `skipped` is true when `openspec` is not on PATH.
 * `ids` are the declarations scanned, reused by check (13) (`ID_DANGLING`).
 */
export async function checkIds(ctx: Ctx): Promise<{
  errors: CliError[];
  files: string[];
  ids: FoundId[];
  placementSkipped: boolean;
}> {
  const scan = scanIds(ctx.root);
  const areas = loadAreas(ctx.root);
  const errors: CliError[] = [
    ...scan.malformed,
    ...checkAreas(scan.ids, areas),
    ...checkDuplicates(scan.ids)
  ];
  const placement = await checkPlacement(ctx, scan.ids);
  errors.push(...placement.errors);
  return { errors, files: scan.files, ids: scan.ids, placementSkipped: placement.skipped };
}
