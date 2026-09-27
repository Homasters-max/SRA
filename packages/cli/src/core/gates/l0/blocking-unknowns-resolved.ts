/**
 * `blocking-unknowns-resolved` (REQ-VER-004): the record has no `unknowns[]`
 * entry with `blocking: true` and no `resolution` (`BLOCKING_UNKNOWN`,
 * SCN-VER-022), and no blocking entry closed by anything but the maintainer's
 * decision with a ref (`DECISION_WITHOUT_REF`, SCN-VER-110): the answer is
 * written, its proof is not. Who wrote the ref is `warrant ci`'s business.
 */
import type { Finding } from "../types.js";
import { decisionsWithoutRef, openBlockingUnknowns } from "../../unknowns/state.js";
import { pass, type Calculator } from "./types.js";

export const blockingUnknownsResolved: Calculator = (ctx) => {
  const open = openBlockingUnknowns(ctx.signals.unknowns);
  const withoutRef = decisionsWithoutRef(ctx.signals.unknowns);
  if (open.length === 0 && withoutRef.length === 0) return pass();
  const findings: Finding[] = [];
  if (open.length > 0) {
    findings.push({
      code: "BLOCKING_UNKNOWN",
      gate: ctx.gate,
      items: open,
      message: `blocking UNKNOWNs without resolution: ${open.join(", ")}`
    });
  }
  if (withoutRef.length > 0) {
    findings.push({
      code: "DECISION_WITHOUT_REF",
      gate: ctx.gate,
      items: withoutRef,
      message: `blocking UNKNOWNs closed without the maintainer's decision with a ref: ${withoutRef.join(", ")}`
    });
  }
  return { verdict: "FAIL", findings };
};
