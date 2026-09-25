/**
 * Registry of kernel JSON Schemas (REQ-KRN-001, design D-2).
 *
 * Only the names listed in {@link DOCUMENT_SCHEMAS} may appear in the `$schema`
 * field of a WARRANT file. `common` is deliberately absent: it holds shared
 * `$defs` only, so `"$schema": "warrant://common/1"` is `SCHEMA_UNKNOWN`.
 */

/** Schema shipped with the CLI but not usable as a document `$schema`. */
export const SHARED_SCHEMAS = ["common"] as const;

/** Document schemas, in the dependency order used when writing them (design D-2). */
export const DOCUMENT_SCHEMAS = [
  "config",
  "lock",
  "areas",
  "pack",
  "profile",
  "overlay",
  "gate",
  "check",
  "change-record",
  "evidence",
  "evidence-manifest",
  "controller-rules",
  "risk-floor",
  "risk-levels",
  "openspec-rules",
  "openspec-schema",
  "waiver",
  "rule",
  "run"
] as const;

export type DocumentSchemaName = (typeof DOCUMENT_SCHEMAS)[number];

/** Major version of every kernel schema in phase 1. */
export const KERNEL_MAJOR = 1;

/** All schema files shipped in `packages/cli/schemas`, as `<name>.<major>`. */
export const ALL_SCHEMAS: readonly string[] = [...SHARED_SCHEMAS, ...DOCUMENT_SCHEMAS];

/** Reference to a schema by name and major version. */
export interface SchemaRef {
  name: string;
  major: number;
}

const URI_RE = /^warrant:\/\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(\d+)$/;

/** Parses `warrant://<name>/<major>`; returns null when the string is not such a URI. */
export function parseSchemaUri(uri: unknown): SchemaRef | null {
  if (typeof uri !== "string") return null;
  const m = URI_RE.exec(uri);
  if (m === null) return null;
  const name = m[1] as string;
  const major = Number.parseInt(m[2] as string, 10);
  return { name, major };
}

/** True when the URI names a document schema the CLI can validate a file against. */
export function isDocumentSchema(uri: unknown): boolean {
  const ref = parseSchemaUri(uri);
  if (ref === null) return false;
  return (
    ref.major === KERNEL_MAJOR && (DOCUMENT_SCHEMAS as readonly string[]).includes(ref.name)
  );
}

/** Builds the canonical `$schema` URI for a document schema. */
export function schemaUri(name: string, major: number = KERNEL_MAJOR): string {
  return `warrant://${name}/${major}`;
}

/** File name of a schema inside `packages/cli/schemas`. */
export function schemaFileName(name: string, major: number = KERNEL_MAJOR): string {
  return `${name}.${major}.schema.json`;
}
