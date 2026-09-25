/**
 * Pure helpers behind `warrant init` (REQ-KRN-023).
 *
 * Everything here is a decision about names and file contents; nothing touches
 * the file system, so the rules are unit-testable without a temp project.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { WarrantError } from "../errors.js";
import { findChangeDir } from "../openspec/changes.js";
import { bundledPacksDir } from "../packs/loader.js";

/** Pack enabled by a fresh project: the baseline spec-driven workflow. */
export const DEFAULT_PACK = "core-sdd";

/** Sub-directories of `.warrant/` that a project always has, each kept by a `.gitkeep`. */
export const KEPT_DIRS = ["changes", "waivers", "evidence", "runs"] as const;

/** Change names are kebab ids, exactly as `warrant://common/1#/$defs/kebab_id` spells them. */
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isChangeName(value: string): boolean {
  return KEBAB_RE.test(value);
}

/**
 * Version range written into `warrant.json.openspec`.
 *
 * A caret range on the exact binary would accept a different minor, which may
 * generate a different `config.yaml` shape; `<major>.<minor>.x` pins the line
 * that was verified while still allowing patch upgrades, and matches the
 * example in the config schema.
 */
export function openspecRange(version: string): string {
  const parts = version.split(".");
  return `${parts[0] ?? "0"}.${parts[1] ?? "0"}.x`;
}

/** Version of a bundled pack, read from its `pack.json`. */
export function bundledPackVersion(packId: string, packsDir: string = bundledPacksDir()): string {
  const manifest = path.join(packsDir, packId, "pack.json");
  try {
    const json = JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown };
    if (typeof json.version === "string" && json.version !== "") return json.version;
  } catch (cause) {
    throw new WarrantError("INTERNAL", `cannot read the bundled pack ${packId}: ${(cause as Error).message}`, {
      path: `packs/${packId}/pack.json`
    });
  }
  throw new WarrantError("INTERNAL", `bundled pack ${packId} declares no version`, {
    path: `packs/${packId}/pack.json`
  });
}

/**
 * Contents of `.warrant/warrant.json` for a fresh project; `frontends` only
 * when `init --frontend` named one (REQ-KRN-033).
 */
export function configDocument(
  kernel: string,
  openspecVersion: string,
  packVersion: string,
  frontends: readonly string[] = []
): Record<string, unknown> {
  return {
    $schema: "warrant://config/1",
    kernel,
    openspec: openspecRange(openspecVersion),
    packs: { [DEFAULT_PACK]: { version: `^${packVersion}` } },
    ...(frontends.length > 0 ? { frontends: [...frontends] } : {})
  };
}

/** `.gitignore` entry for the raw check output, which is never committed (REQ-VER-001, P-19). */
export const RAW_EVIDENCE_IGNORE = ".warrant/evidence/**/raw/";

/**
 * `.gitignore` text with {@link RAW_EVIDENCE_IGNORE} present, or null when the
 * current text (null: no file) already has it. Existing lines are kept as they are.
 */
export function gitignoreWithRawEvidence(current: string | null): string | null {
  const text = current ?? "";
  if (text.split(/\r?\n/).some((line) => line.trim() === RAW_EVIDENCE_IGNORE)) return null;
  const separator = text === "" || text.endsWith("\n") ? "" : "\n";
  return `${text}${separator}${RAW_EVIDENCE_IGNORE}\n`;
}

/** Empty but valid AREA registry. */
export function areasDocument(): Record<string, unknown> {
  return { $schema: "warrant://areas/1" };
}

/** Empty but valid project rules layer (ADR-0015 point 2). */
export function rulesDocument(): Record<string, unknown> {
  return { $schema: "warrant://openspec-rules/1" };
}

/** The record a new Change starts with: PROPOSED, one transition, no classification. */
export function changeRecord(change: string, at: string = new Date().toISOString()): Record<string, unknown> {
  return {
    $schema: "warrant://change-record/1",
    change,
    change_state: "PROPOSED",
    transitions: [{ to: "PROPOSED", at, by: "cli:local" }]
  };
}

/**
 * Name of the OpenSpec workflow schema declared by `openspec/config.yaml`.
 *
 * `sync` emits the file with `schema: <name>` on the first content line, so a
 * line-anchored match is enough and avoids pulling a YAML parser into the
 * runtime dependencies.
 */
export function schemaFromConfigYaml(text: string): string | null {
  const match = /^schema:[ \t]*(?:"([^"]+)"|'([^']+)'|([^\s#]+))[ \t]*$/m.exec(text);
  if (match === null) return null;
  return match[1] ?? match[2] ?? match[3] ?? null;
}

/**
 * Why a change name cannot be used, or null when it is free (ADR-0012 section 6).
 *
 * Archived changes keep their name forever: reusing one would make the stable
 * ids of two different Changes point at the same directory name.
 */
export function changeNameConflict(root: string, name: string): string | null {
  const record = path.join(root, ".warrant", "changes", `${name}.json`);
  if (existsSync(record)) return `.warrant/changes/${name}.json`;
  return findChangeDir(root, name)?.path ?? null;
}
