/**
 * The single way to hash content in the CLI (design D-3).
 *
 * JSON values are hashed through RFC 8785 (JSON Canonicalization Scheme) so the
 * hash does not depend on key order or on how the file happened to be written;
 * files that are not JSON (generated YAML, templates, skills) are hashed by
 * their raw bytes. Both produce `sha256:<64 hex>` so they fit the `sha256`
 * pattern of `warrant://common/1` and can sit side by side in the lock.
 */
import { createHash } from "node:crypto";

import canonicalizeCjs from "canonicalize";

// `canonicalize` is CommonJS with `export =`; NodeNext types it as a namespace
// while the ESM default import yields the callable value at runtime.
const canonicalize = canonicalizeCjs as unknown as (value: unknown) => string | undefined;

/** Prefix required by `warrant://common/1#/$defs/sha256`. */
export const HASH_PREFIX = "sha256:";

function digest(input: string | Uint8Array): string {
  return HASH_PREFIX + createHash("sha256").update(input).digest("hex");
}

/**
 * Hash of a JSON value, stable under key reordering (RFC 8785).
 * Used for the lock, `effective_policy.hash` and pack content hashes.
 */
export function canonicalHash(value: unknown): string {
  const canonical = canonicalize(value);
  if (canonical === undefined) {
    throw new TypeError("value is not representable as JSON and cannot be hashed");
  }
  return digest(canonical);
}

/** Hash of raw file bytes, for generated files, templates and skills. */
export function bytesHash(buffer: Uint8Array | string): string {
  return digest(buffer);
}
