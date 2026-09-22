/**
 * Canonical key order for WARRANT JSON documents (design D-3, REQ-KRN-022).
 *
 * The order is derived from the raw JSON Schema on disk rather than from the
 * Ajv-compiled form: Ajv keeps no record of the authored `properties` order and
 * the loader injects `$comment` everywhere, which would pollute the order. So
 * this module walks the schema JSON itself and only needs two things from it —
 * the order of `properties` and enough `$ref` resolution to follow it.
 *
 * `$ref` support is deliberately narrow: local `#/...` pointers and
 * `warrant://common/1#/...`, which is all the kernel schemas use. An
 * unresolvable `$ref` degrades to alphabetical order, never to an error: `fmt`
 * must be able to format a file even when its schema says something we do not
 * model.
 */
import { readSchemaFile, type Json } from "../schemas/loader.js";
import { KERNEL_MAJOR, parseSchemaUri } from "../schemas/registry.js";

export type JsonObject = Record<string, unknown>;

/** Keys that always come first, in this order, whatever the schema says. */
const LEADING_KEYS = ["$schema", "$comment"] as const;

/** Guard against `$ref` cycles and pathologically deep documents. */
const MAX_DEPTH = 64;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

let commonCache: JsonObject | null | undefined;

/** `warrant://common/1`, loaded once; `null` when it cannot be read. */
function commonSchema(): JsonObject | null {
  if (commonCache === undefined) {
    try {
      commonCache = readSchemaFile("common", KERNEL_MAJOR);
    } catch {
      commonCache = null;
    }
  }
  return commonCache;
}

/** Resolves an RFC 6901 JSON Pointer inside a document. */
function resolvePointer(document: JsonObject, pointer: string): unknown {
  if (pointer === "" || pointer === "#") return document;
  const body = pointer.startsWith("#") ? pointer.slice(1) : pointer;
  if (!body.startsWith("/")) return undefined;
  let current: unknown = document;
  for (const rawSegment of body.slice(1).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      current = Number.isNaN(index) ? undefined : current[index];
    } else if (isPlainObject(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
    if (current === undefined) return undefined;
  }
  return current;
}

/** Context carried through the walk: the document's own schema, for `#/...` refs. */
interface Ctx {
  root: JsonObject | undefined;
}

/**
 * Follows `$ref` until a concrete schema object is reached.
 * Only `#/...` (within `root`) and `warrant://common/1#/...` are understood.
 */
function deref(node: unknown, ctx: Ctx, depth: number): JsonObject | undefined {
  let current = node;
  for (let i = 0; i < 8; i += 1) {
    if (!isPlainObject(current)) return undefined;
    const ref = current["$ref"];
    if (typeof ref !== "string") return current;
    if (depth > MAX_DEPTH) return undefined;
    if (ref.startsWith("#")) {
      current = ctx.root === undefined ? undefined : resolvePointer(ctx.root, ref);
      continue;
    }
    const hash = ref.indexOf("#");
    const uri = hash === -1 ? ref : ref.slice(0, hash);
    const pointer = hash === -1 ? "" : ref.slice(hash);
    const parsed = parseSchemaUri(uri);
    if (parsed !== null && parsed.name === "common") {
      const common = commonSchema();
      current = common === null ? undefined : resolvePointer(common, pointer);
      continue;
    }
    // A `$ref` to another document schema is not followed: WARRANT documents
    // never nest one document inside another, so this cannot appear in practice.
    return undefined;
  }
  return undefined;
}

/** Branch keywords whose `properties` are merged, in order, into the parent's. */
const BRANCHES = ["allOf", "anyOf", "oneOf"] as const;

/**
 * Names of the schema's declared properties, in authored order.
 * Branches contribute after the object's own properties; duplicates keep their
 * first position, so the result is a stable order for a stable schema.
 */
function declaredOrder(schema: JsonObject | undefined, ctx: Ctx, depth: number): string[] {
  if (schema === undefined || depth > MAX_DEPTH) return [];
  const out: string[] = [];
  const add = (name: string): void => {
    if (!out.includes(name)) out.push(name);
  };
  const own = schema["properties"];
  if (isPlainObject(own)) for (const name of Object.keys(own)) add(name);
  for (const keyword of BRANCHES) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      for (const name of declaredOrder(deref(branch, ctx, depth + 1), ctx, depth + 1)) add(name);
    }
  }
  return out;
}

/** Sub-schema governing one key: `properties`, then `patternProperties`, then `additionalProperties`. */
function schemaForKey(
  schema: JsonObject | undefined,
  key: string,
  ctx: Ctx,
  depth: number
): JsonObject | undefined {
  if (schema === undefined || depth > MAX_DEPTH) return undefined;

  const own = schema["properties"];
  if (isPlainObject(own) && Object.prototype.hasOwnProperty.call(own, key)) {
    return deref(own[key], ctx, depth + 1);
  }

  const patterns = schema["patternProperties"];
  if (isPlainObject(patterns)) {
    for (const [pattern, sub] of Object.entries(patterns)) {
      let re: RegExp;
      try {
        re = new RegExp(pattern, "u");
      } catch {
        continue;
      }
      if (re.test(key)) return deref(sub, ctx, depth + 1);
    }
  }

  const additional = schema["additionalProperties"];
  if (isPlainObject(additional)) return deref(additional, ctx, depth + 1);

  for (const keyword of BRANCHES) {
    const branches = schema[keyword];
    if (!Array.isArray(branches)) continue;
    for (const branch of branches) {
      const found = schemaForKey(deref(branch, ctx, depth + 1), key, ctx, depth + 1);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

/** Sub-schema for array element `index`: `prefixItems[index]`, else `items`. */
function schemaForItem(
  schema: JsonObject | undefined,
  index: number,
  ctx: Ctx,
  depth: number
): JsonObject | undefined {
  if (schema === undefined || depth > MAX_DEPTH) return undefined;
  const prefix = schema["prefixItems"];
  if (Array.isArray(prefix) && index < prefix.length) return deref(prefix[index], ctx, depth + 1);
  if ("items" in schema) return deref(schema["items"], ctx, depth + 1);
  return undefined;
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Key order for one object: `$schema`, `$comment`, then the keys the schema
 * declares (in its own order), then everything else alphabetically. A
 * dictionary object declares no matching properties, so all of its keys fall
 * into the alphabetical tail — which is exactly the rule D-3 asks for.
 */
function orderedKeys(value: JsonObject, schema: JsonObject | undefined, ctx: Ctx, depth: number): string[] {
  const present = new Set(Object.keys(value));
  const out: string[] = [];

  for (const key of LEADING_KEYS) {
    if (present.delete(key)) out.push(key);
  }
  for (const key of declaredOrder(schema, ctx, depth)) {
    if (present.delete(key)) out.push(key);
  }
  out.push(...[...present].sort(compareKeys));
  return out;
}

function walk(value: unknown, schema: JsonObject | undefined, ctx: Ctx, depth: number): unknown {
  if (Array.isArray(value)) {
    // Element order is data and is preserved; only each element is reordered.
    return value.map((item, index) => walk(item, schemaForItem(schema, index, ctx, depth), ctx, depth + 1));
  }
  if (!isPlainObject(value)) return value;
  if (depth > MAX_DEPTH) return { ...value };

  const out: JsonObject = {};
  for (const key of orderedKeys(value, schema, ctx, depth)) {
    out[key] = walk(value[key], schemaForKey(schema, key, ctx, depth), ctx, depth + 1);
  }
  return out;
}

/**
 * Deep copy of `value` with object keys in canonical order.
 * Without a schema (or with one that says nothing about a key) the order is
 * alphabetical, after `$schema` and `$comment`.
 */
export function orderKeys(value: Json, schema?: JsonObject | undefined): Json {
  const ctx: Ctx = { root: schema };
  return walk(value, schema, ctx, 0);
}
