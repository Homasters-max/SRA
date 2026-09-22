/**
 * Parser `openspec-validate` → kind `spec-report` (design §5).
 *
 * Reads the stdout of `openspec validate <change> --strict --json`. OpenSpec
 * 1.13.1 prints (exit 1 when an item is invalid):
 *
 *   { "items": [ { "id", "type", "valid": bool,
 *                  "issues": [ { "level": "ERROR" | "WARNING" | …, "path", "message" } ],
 *                  "durationMs" } ],
 *     "summary": { "totals": { "items", "passed", "failed" }, "byType": { … } },
 *     "version": "1.0", "root": { … } }
 *
 * and, for an unknown item, `{ "status": [ { "severity", "code", "message" } ] }`
 * with no `items`. The flat form `{ "valid", "issues" }` (design §5, the fake
 * `openspec` of the golden runs) is read as one item.
 *
 * `metrics.issues` counts every issue of every item, warnings included; any
 * invalid item or any `ERROR` issue → NOT_PROVEN. No item at all → INCONCLUSIVE.
 */
import type { ParseResult } from "./types.js";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The JSON body of the output; OpenSpec may print warnings before it. */
function jsonBody(stdout: string): unknown {
  const start = stdout.search(/[[{]/);
  if (start < 0) return undefined;
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    return undefined;
  }
}

export function parseOpenspecValidate(stdout: string): ParseResult {
  const body = jsonBody(stdout);
  if (!isPlainObject(body)) {
    return { status: "INCONCLUSIVE", limitations: ["openspec-validate: output is not a JSON report"] };
  }

  const items: Record<string, unknown>[] = Array.isArray(body["items"])
    ? body["items"].filter(isPlainObject)
    : "valid" in body
      ? [body]
      : [];

  if (items.length === 0) {
    const status = Array.isArray(body["status"]) ? body["status"] : [];
    const first = status.find(isPlainObject);
    const reason = typeof first?.["message"] === "string" ? `: ${first["message"]}` : "";
    return {
      status: "INCONCLUSIVE",
      metrics: { issues: status.length },
      limitations: [`openspec-validate: no item validated${reason}`]
    };
  }

  let issues = 0;
  let failed = false;
  for (const item of items) {
    const list = Array.isArray(item["issues"]) ? item["issues"] : [];
    issues += list.length;
    if (item["valid"] !== true) failed = true;
    if (list.some((issue) => isPlainObject(issue) && issue["level"] === "ERROR")) failed = true;
  }
  return { status: failed ? "NOT_PROVEN" : "PROVEN", metrics: { issues }, limitations: [] };
}
