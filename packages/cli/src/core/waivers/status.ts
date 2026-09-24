/**
 * The one predicate "this waiver counts" (design §1, REQ-VER-003, R-2, R-8).
 *
 * Step 4 of the verdict, `evidence-complete` and the pre-filter all ask the
 * same question of a waiver and must get the same answer: two copies of the
 * rule drifted apart once (R-8), so there is exactly one. The checks run in
 * this order and the first failing one is the reason:
 *
 * 1. `state` — `waiver_state` is not `ACTIVE`;
 * 2. `expired` — `expires_at` is before today (UTC date, I-75);
 * 3. `approver` — `approved_by` is not a login of `roles` (R-2);
 * 4. `waivable` — the gate is not declared, or not `waivable: true`;
 * 5. `targets` — the waiver carries `targets[]`: partial waivers have no
 *    semantics yet (D-10, phase 5), so they never waive the whole gate.
 *
 * Whether the waiver is about this gate and this Change is the caller's
 * business: the predicate judges the waiver against the gate it names.
 * Owner: `core/waivers` (ADR-0030 п. 1, R2; A-7), moved from `core/gates/waivers.ts`.
 */

/** Login of a waiver's `approved_by`, without the `human:` prefix. */
export function approverLogin(waiver: Record<string, unknown>): string {
  return String(waiver["approved_by"]).replace(/^human:/, "");
}

export type WaiverIgnoredReason = "state" | "expired" | "approver" | "waivable" | "targets";

export type WaiverStatus = { counts: true } | { counts: false; reason: WaiverIgnoredReason };

export interface WaiverContext {
  /** UTC calendar date `YYYY-MM-DD`; a waiver is in force while `expires_at >= today`. */
  today: string;
  /** Logins of `roles` of `warrant.json`; absent — not checked (pure unit input). */
  approvers?: ReadonlySet<string> | undefined;
}

/** Whether `waiver` counts for the gate document it names (`undefined` — no such gate). */
export function waiverStatus(
  waiver: Record<string, unknown>,
  gate: Record<string, unknown> | undefined,
  ctx: WaiverContext
): WaiverStatus {
  if (waiver["waiver_state"] !== "ACTIVE") return { counts: false, reason: "state" };
  const expires = waiver["expires_at"];
  if (typeof expires !== "string" || expires < ctx.today) return { counts: false, reason: "expired" };
  if (ctx.approvers !== undefined && !ctx.approvers.has(approverLogin(waiver))) return { counts: false, reason: "approver" };
  if (gate?.["waivable"] !== true) return { counts: false, reason: "waivable" };
  const targets = waiver["targets"];
  if (Array.isArray(targets) && targets.length > 0) return { counts: false, reason: "targets" };
  return { counts: true };
}
