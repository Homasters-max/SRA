/**
 * `blocking-unknowns-resolved`: the record has no `unknowns[]` entry with
 * `blocking: true` and no `resolution` (REQ-VER-004, SCN-VER-022).
 */
import { isPlainObject } from "../../json.js";
import { pass, type Calculator } from "./types.js";

/** Ids of the open blocking UNKNOWNs of a record, in record order. */
export function openBlockingUnknowns(unknowns: readonly unknown[]): string[] {
  const open: string[] = [];
  for (const entry of unknowns) {
    if (!isPlainObject(entry) || entry["blocking"] !== true) continue;
    const resolution = entry["resolution"];
    if (typeof resolution === "string" && resolution.trim() !== "") continue;
    open.push(typeof entry["id"] === "string" ? entry["id"] : "(no id)");
  }
  return open;
}

export const blockingUnknownsResolved: Calculator = (ctx) => {
  const open = openBlockingUnknowns(ctx.signals.unknowns);
  if (open.length === 0) return pass();
  return {
    verdict: "FAIL",
    findings: [
      {
        code: "BLOCKING_UNKNOWN",
        gate: ctx.gate,
        items: open,
        message: `blocking UNKNOWNs without resolution: ${open.join(", ")}`
      }
    ]
  };
};
