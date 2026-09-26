/**
 * The human act of a transition with gate `human-approval` (P-17, A-29): who
 * may approve (roles of `approvals[]`), and the record of `ensureApproval`
 * (`core/evidence/approval.ts`) with what that module cannot import — the
 * pre-filter and the "waiver counts" of the gate engine that decide reuse
 * (they rank above it), and the id of a new record (a module cycle).
 */
import type { Ctx } from "../ctx.js";
import { WarrantError } from "../errors.js";
import { ensureApproval, type EnsureApprovalParams } from "../evidence/approval.js";
import { staleReason } from "../gates/prefilter.js";
import type { GitFacts } from "../git/facts.js";
import { allocateUlid } from "../ids/allocate.js";
import { gateDefinitions } from "../packs/objects.js";
import { approvalRoles, roleMembers } from "../roles.js";
import { readWaivers } from "../waivers/read.js";
import { countingWaiverIds } from "../waivers/status.js";
import type { Prepared } from "./evaluate.js";

/**
 * The `human-approval` record of `login` on `git`. `login` must be a member of
 * a role of `approvals[]` at the transition (fallback `maintainer`), else
 * `ROLE_REQUIRED`. An existing record the pre-filter admits — same commit and
 * base, the same "waiver counts" as the gate engine (A-14): roles,
 * `waivable`, `targets` included — is reused; otherwise a new one is written.
 */
export function humanApproval(
  ctx: Ctx,
  change: string,
  prepared: Prepared,
  git: GitFacts,
  login: string,
  ref: string
): ReturnType<typeof ensureApproval> {
  const { loaded, policy, transition } = prepared;
  const roles = approvalRoles(policy, transition);
  if (!roleMembers(loaded.config, roles).has(login)) {
    throw new WarrantError(
      "ROLE_REQUIRED",
      `${login} is not listed in roles ${roles.map((r) => `"${r}"`).join(", ")} of .warrant/warrant.json, required to approve ${transition}`,
      { path: ".warrant/warrant.json" }
    );
  }
  const approvers = roleMembers(loaded.config);
  const admit = {
    commit: git.commit,
    base: git.baseCommit,
    activeWaivers: countingWaiverIds(readWaivers(ctx.root), gateDefinitions(loaded), { today: ctx.clock.today(), approvers })
  };
  const params: EnsureApprovalParams = {
    ctx,
    change,
    env: prepared.env,
    loaded,
    policyHash: prepared.policy.hash,
    transition: prepared.transition,
    git,
    login,
    ref,
    admits: (json) => staleReason(json, admit) === null,
    newId: () => allocateUlid("EVID")
  };
  return ensureApproval(params);
}
