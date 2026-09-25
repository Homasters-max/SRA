/**
 * Roles of `.warrant/warrant.json` and who is asked for at a transition
 * (ADR-0030 п. 1: `core/roles`, R2; A-7): the logins of a role, the roles of
 * `approvals[]` at a transition, and the `--ref` of the act a role performs.
 * `classify`, `gate`, `transition`, `waive` and the waiver checks share them.
 */
import type { WarrantConfig } from "./config.js";
import { WarrantError } from "./errors.js";

/** Role asked for when the policy names none at the transition (design §10). */
export const FALLBACK_ROLE = "maintainer";

/** Role whose members activate and revoke waivers (05 section 7). */
export const WAIVER_ROLE = "maintainer";

/**
 * Logins named in `roles` of `warrant.json`: of the given roles only, or of
 * every role when `only` is omitted.
 */
export function roleMembers(config: WarrantConfig, only?: readonly string[]): Set<string> {
  const members = new Set<string>();
  for (const [role, logins] of config.roles) {
    if (only !== undefined && !only.includes(role)) continue;
    for (const login of logins) members.add(login);
  }
  return members;
}

/**
 * What {@link approvalRoles} reads of an effective policy (`EffectivePolicy` of
 * `core/resolve` fits): the approvals alone, so `core/roles` imports no policy
 * module (I-146).
 */
export interface ApprovalsOf {
  readonly approvals: readonly { readonly role: string; readonly at: string }[];
}

/** Roles of `approvals[]` at the transition; `maintainer` when there is none. */
export function approvalRoles(policy: ApprovalsOf, transition: string): string[] {
  const roles = [...new Set(policy.approvals.filter((a) => a.at === transition).map((a) => a.role))].sort();
  return roles.length > 0 ? roles : [FALLBACK_ROLE];
}

/** `USAGE` unless `ref` is an http(s) URL (the forge act); also `classify --ref`. */
export function checkRef(ref: string): void {
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    throw new WarrantError("USAGE", `--ref ${JSON.stringify(ref)} is not a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new WarrantError("USAGE", `--ref ${JSON.stringify(ref)} is not an http(s) URL of the forge`);
  }
}
