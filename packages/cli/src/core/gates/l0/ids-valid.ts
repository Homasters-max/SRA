/**
 * `ids-valid`: check (5) of `validate` has no finding — format, AREA and
 * uniqueness of stable ids over `scanIds` (design §8: placement through
 * `openspec show` is `validate`'s, not the gate's).
 */
import { noInput, pass, type Calculator } from "./types.js";

export const idsValid: Calculator = (ctx) => {
  if (!ctx.signals.ids.ok) return noInput(ctx.gate, `stable ids not scanned: ${ctx.signals.ids.reason}`);
  const errors = ctx.signals.ids.value;
  if (errors.length === 0) return pass();
  return {
    verdict: "FAIL",
    findings: errors.map((error) => {
      const finding = { code: error.code as string, gate: ctx.gate, message: error.message };
      return error.path === undefined ? finding : { ...finding, paths: [error.path] };
    })
  };
};
