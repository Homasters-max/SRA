/**
 * The controller as a decision table (04 section 4, REQ-VER-005, design §11).
 *
 * Rules of every enabled pack are tried in load order (core-sdd first), each
 * pack's rules in file order; the first rule whose `when` matches the inputs
 * is the result. A matching rule that would `CONTINUE` past a worst verdict
 * `FAIL` or `BLOCKED` is skipped with finding `CONTROLLER_RULE_IGNORED` and
 * matching goes on (R-13): no rule can wave a transition through what the
 * gates refused. No match → `WAIT` with `next: "verify"` and rule
 * `verify-incomplete` when the worst verdict is `BLOCKED`, else `CONTINUE`
 * without `next`, `rule: null`. Pure: the same inputs and rules give the same
 * decision.
 *
 * `when` compares by type: a boolean equals the input; `">N"` holds when the
 * numeric input is greater than N; any other string equals the input (an enum
 * such as a verdict). An input the CLI does not compute (`open_tasks`,
 * `analyze_findings` of 04 section 4) never matches.
 */
import { EXIT, type ExitCode } from "../errors.js";
import type { Finding } from "../gates/types.js";
import type { LoadResult } from "../packs/types.js";
import type { ControllerInputs } from "./inputs.js";

export type ControllerAction = "CONTINUE" | "WAIT" | "STOP" | "ESCALATE";

export interface ControllerRule {
  id: string;
  when: Record<string, unknown>;
  action: ControllerAction;
  next?: string;
}

export interface ControllerDecision {
  controller_action: ControllerAction;
  next?: string;
  rule: string | null;
  /** `CONTROLLER_RULE_IGNORED` for every rule skipped on the way (R-13); absent when none was. */
  findings?: Finding[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rules of every `controller-rules` object, packs in load order, the project layer last. */
export function controllerRules(loaded: LoadResult): ControllerRule[] {
  const order = new Map(loaded.packs.map((pack, index) => [pack.id, index]));
  const rank = (pack: string): number => order.get(pack) ?? loaded.packs.length;
  const objects = loaded.objects
    .filter((o) => o.kind === "controller-rules")
    .map((o, index) => ({ o, index }))
    .sort((a, b) => rank(a.o.pack) - rank(b.o.pack) || a.index - b.index)
    .map(({ o }) => o);
  const rules: ControllerRule[] = [];
  for (const object of objects) {
    const list = isPlainObject(object.json) ? object.json["rules"] : undefined;
    if (!Array.isArray(list)) continue;
    for (const rule of list) {
      if (!isPlainObject(rule) || typeof rule["id"] !== "string" || typeof rule["action"] !== "string") continue;
      const entry: ControllerRule = {
        id: rule["id"],
        when: isPlainObject(rule["when"]) ? rule["when"] : {},
        action: rule["action"] as ControllerAction
      };
      if (typeof rule["next"] === "string") entry.next = rule["next"];
      rules.push(entry);
    }
  }
  return rules;
}

const GREATER_RE = /^>\s*(-?\d+(?:\.\d+)?)$/;

/** Whether one condition of `when` holds for the input value. */
export function conditionHolds(condition: unknown, value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof condition === "boolean") return value === condition;
  if (typeof condition === "number") return value === condition;
  if (typeof condition !== "string") return false;
  const greater = GREATER_RE.exec(condition);
  if (greater !== null) return typeof value === "number" && value > Number(greater[1]);
  return typeof value === "number" ? String(value) === condition : value === condition;
}

export function ruleMatches(rule: ControllerRule, inputs: ControllerInputs): boolean {
  const values = inputs as unknown as Record<string, unknown>;
  for (const [key, condition] of Object.entries(rule.when)) {
    if (key === "$comment") continue;
    if (!conditionHolds(condition, values[key])) return false;
  }
  return true;
}

/** Worst verdicts no rule may answer with `CONTINUE` (R-13). */
const NOT_CONTINUABLE: ReadonlySet<unknown> = new Set(["FAIL", "BLOCKED"]);

export function evaluateController(rules: readonly ControllerRule[], inputs: ControllerInputs): ControllerDecision {
  const findings: Finding[] = [];
  const withFindings = (decision: ControllerDecision): ControllerDecision =>
    findings.length === 0 ? decision : { ...decision, findings };
  for (const rule of rules) {
    if (!ruleMatches(rule, inputs)) continue;
    if (rule.action === "CONTINUE" && NOT_CONTINUABLE.has(inputs.gate_verdict)) {
      findings.push({
        code: "CONTROLLER_RULE_IGNORED",
        rule: rule.id,
        message: `controller rule ${rule.id} would CONTINUE past gate_verdict ${String(inputs.gate_verdict)}; it is skipped`
      });
      continue;
    }
    const decision: ControllerDecision = { controller_action: rule.action, rule: rule.id };
    if (rule.next !== undefined) decision.next = rule.next;
    return withFindings(decision);
  }
  // Kernel fallback (P-7, I-91): a transition whose worst verdict is BLOCKED is
  // not ready, whatever the packs say; the verdicts need more input, not a human.
  if (inputs.gate_verdict === "BLOCKED") {
    return withFindings({ controller_action: "WAIT", next: "verify", rule: VERIFY_INCOMPLETE });
  }
  return withFindings({ controller_action: "CONTINUE", rule: null });
}

/** Id of the kernel fallback rule: no pack rule matched, and a gate is BLOCKED. */
export const VERIFY_INCOMPLETE = "verify-incomplete";

/** Exit code of `gate` and `verify` (P-20): CONTINUE 0, STOP 1, WAIT and ESCALATE 2. */
export function exitCodeOf(action: ControllerAction): ExitCode {
  switch (action) {
    case "CONTINUE":
      return EXIT.OK;
    case "STOP":
      return EXIT.FAIL;
    default:
      return EXIT.WAIT;
  }
}
