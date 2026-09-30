/**
 * The `ref` of new `APPROVED` and `MERGED` transitions, verified through the
 * forge (REQ-VER-011 «Ref», ADR-0037 п. 5, N36): a merged pull request of this
 * repository, merged by a member of the role of `approvals[]` of the transition
 * — roles and approvals from the base of requirements (I-171) — and tied to
 * the Change: the spec-PR brought the transition `SPECIFIED`, the impl-PR is
 * the merge M of the head the CI records were made on. Agent identities are
 * `identities.agents` of the base (ADR-0044 п. 3): while it is empty, every
 * ref without a violation is the finding `SHARED_IDENTITY`, and `merged_by`
 * equal to the author the finding `APPROVER_IS_AUTHOR`; once it is not,
 * `merged_by` equal to the author or an agent is `REF_NOT_VERIFIED` (BL-44).
 *
 * The ref of `MERGED` is judged by M^1, the base of the impl-PR (design D3 of
 * agent-merge, `merge.ts`): its `roles`, agents and policy. Without gate
 * `human-approval` on `VERIFYING->MERGED` in that policy any member of `roles`
 * or an agent merges and INV-03 does not apply; the exception is closed —
 * with the finding `AGENT_MERGE_CLOSED` — when the current CLI does not compute
 * the policy by M^1 or the record on M^1 is past `SPECIFIED`.
 */
import type { WarrantConfig } from "../config.js";
import type { Ctx } from "../ctx.js";
import { cliError, type CliError } from "../errors.js";
import { HUMAN_APPROVAL } from "../evidence/approval.js";
import { MERGE_TRANSITION, type Finding } from "../gates/types.js";
import { isPlainObject } from "../json.js";
import type { CommentRef, PullRequest } from "../ports/forge.js";
import { confirmationOf, type Confirmation } from "../record/lifecycle.js";
import type { ChangeRecord } from "../record/read.js";
import { recordPath } from "../record/write.js";
import { approvalRoles, FALLBACK_ROLE, requiresHuman, roleMembers } from "../roles.js";
import { basePolicy, type BaseContext } from "./base.js";
import type { CiSubject } from "./kind.js";
import { ciHeads, locateMerge, mergeLaw, pastSpecified, transitionRecords, type MergeCommit } from "./merge.js";
import type { NewTransition } from "./record.js";

/** Reasons of `REF_NOT_VERIFIED` (REQ-VER-011); `decision` — the ref of a decision of an UNKNOWN (REQ-VER-013, `decisions.ts`). */
export type RefReason = "repository" | "merged" | "merged_by" | "change" | "merge_commit" | "by" | "decision";

/**
 * The tail of the finding `SHARED_IDENTITY` (REQ-VER-011, REQ-VER-013): with no
 * `identities.agents` in the base, an act of the maintainer cannot be told from
 * an act of an agent under the same account (ADR-0010 п. 4, ADR-0044 п. 3).
 */
export const SHARED_IDENTITY_NOTE = "an agent and the maintainer share the account, no identities.agents in the base (ADR-0010 п. 4)";

export interface RefJudgement {
  errors: CliError[];
  findings: Finding[];
}

/** `<owner>/<repo>` (lower case) and the number of a pull request URL, or null. */
export function parsePullUrl(ref: string): { repository: string; number: number } | null {
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return null;
  }
  const match = /^\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)\/?$/.exec(url.pathname);
  if (match === null) return null;
  return { repository: `${match[1] as string}/${match[2] as string}`.toLowerCase(), number: Number.parseInt(match[3] as string, 10) };
}

/**
 * The comment a pull request comment URL names (REQ-VER-013 `form`):
 * `https://<host>/<owner>/<repo>/pull/<N>#issuecomment-<id>` or
 * `…#pullrequestreview-<id>`, the repository in lower case; null for any other
 * URL — a review comment `#discussion_r…` included.
 */
export function parseCommentUrl(ref: string): CommentRef | null {
  let url: URL;
  try {
    url = new URL(ref);
  } catch {
    return null;
  }
  const pull = parsePullUrl(`${url.origin}${url.pathname}`);
  const anchor = /^#(issuecomment|pullrequestreview)-([1-9][0-9]*)$/.exec(url.hash);
  if (!/^https?:$/.test(url.protocol) || url.search !== "" || pull === null || anchor === null) return null;
  return {
    repository: pull.repository,
    pullRequest: pull.number,
    kind: anchor[1] === "issuecomment" ? "issue" : "review",
    id: Number.parseInt(anchor[2] as string, 10)
  };
}

/** The merged pull request of this repository the ref of `t` names, or undefined. */
async function mergedPullOf(ctx: Pick<Ctx, "forge">, t: NewTransition): Promise<PullRequest | undefined> {
  const parsed = parsePullUrl(typeof t.entry["ref"] === "string" ? t.entry["ref"] : "");
  if (parsed === null) return undefined;
  const pr = await ctx.forge.pullRequest(parsed.number);
  const own = pr === null ? null : parsePullUrl(pr.url);
  if (pr === null || own?.repository !== parsed.repository || !pr.merged || pr.mergeCommit === null) return undefined;
  return pr;
}

/**
 * M of a new `MERGED` for the rule `verdicts` of the record (design D4): by
 * its CI records, else by the pull request of its ref; undefined — M is not
 * found (the rule `merge_commit` of the ref reports it).
 */
export async function mergeOfMerged(
  ctx: Pick<Ctx, "git" | "forge">,
  subject: CiSubject,
  t: NewTransition,
  evidence: ReadonlyMap<string, Record<string, unknown>>
): Promise<MergeCommit | undefined> {
  const records = transitionRecords(t, evidence);
  const pr = ciHeads(records).length > 0 ? undefined : await mergedPullOf(ctx, t);
  const located = await locateMerge(ctx, subject, t, records, pr);
  return located.ok ? located.merge : undefined;
}

/** Who may merge the pull request of a confirmed transition (REQ-VER-011 «Ref», design D3). */
interface Merger {
  /** `warrant.json` whose `roles` and `identities.agents` judge the merger: the base, for `MERGED` — M^1. */
  config: WarrantConfig;
  /** Roles of approval; not read under the exception. */
  roles: string[];
  /** The exception of D3: any login of `roles` or an agent identity merges, INV-03 not applied. */
  exception: boolean;
  /** Why the exception is closed other than by gate `human-approval` (finding `AGENT_MERGE_CLOSED`). */
  closed?: string;
  /** Where `roles` and agents come from, in messages. */
  of: string;
}

/**
 * The merger of the ref of `MERGED` by the law of M^1 (design D3): without gate
 * `human-approval` in the policy by M^1 a merge is no act of approval — any
 * member of `roles` or an agent of M^1 merges; fail-closed — the policy not
 * computed (the role `maintainer` of M^1) or the record on M^1 past `SPECIFIED`.
 */
async function mergedByLaw(ctx: Pick<Ctx, "git" | "root">, change: string, merge: MergeCommit, env: NodeJS.ProcessEnv): Promise<Merger> {
  const law = await mergeLaw(ctx, change, merge, env);
  const of = `M^1 ${merge.first}`;
  if (!law.policy.ok) {
    return { config: law.config, roles: [FALLBACK_ROLE], exception: false, closed: `the policy by ${of} is not computed by this CLI: ${law.policy.reason}`, of };
  }
  const roles = approvalRoles(law.policy.value, MERGE_TRANSITION);
  if (requiresHuman(law.policy.value, MERGE_TRANSITION)) return { config: law.config, roles, exception: false, of };
  if (pastSpecified(law.stateAtBase)) {
    return {
      config: law.config,
      roles,
      exception: false,
      closed: `the record of ${change} is ${String(law.stateAtBase)} on ${of}: the implementation was not merged by one impl-PR`,
      of
    };
  }
  return { config: law.config, roles, exception: true, of };
}

/**
 * Verifies the `ref` of every new `APPROVED` and `MERGED` of `transitions`.
 * Throws `FORGE_UNAVAILABLE` (exit 3) when the forge cannot be read.
 */
export async function judgeRefs(
  ctx: Pick<Ctx, "git" | "forge" | "root">,
  subject: CiSubject,
  base: BaseContext,
  transitions: readonly NewTransition[],
  evidence: ReadonlyMap<string, Record<string, unknown>>,
  env: NodeJS.ProcessEnv
): Promise<RefJudgement> {
  const change = subject.change as string;
  const out: RefJudgement = { errors: [], findings: [] };
  const verified = transitions.filter((t) => confirmationOf(t.to) !== undefined);
  if (verified.length === 0) return out;
  const resolved = basePolicy(base, change, subject.record as ChangeRecord);

  for (const t of verified) {
    const ref = typeof t.entry["ref"] === "string" ? t.entry["ref"] : "";
    const where = `transition ${t.index} (${t.to}) ref ${ref === "" ? "(none)" : ref}`;
    const fail = (reason: RefReason, detail: string): void => {
      out.errors.push(cliError("REF_NOT_VERIFIED", `${where}: ${reason}: ${detail}`, { path: `${recordPath(change)}#/transitions/${t.index}/ref` }));
    };
    const parsed = parsePullUrl(ref);
    if (parsed === null) {
      fail("repository", "the ref is not the URL of a pull request");
      continue;
    }
    const pr = await ctx.forge.pullRequest(parsed.number);
    const own = pr === null ? null : parsePullUrl(pr.url);
    if (pr === null || own === null || own.repository !== parsed.repository) {
      fail("repository", `no pull request ${parsed.number} of ${parsed.repository} in the repository of the forge${own === null ? "" : ` (${own.repository})`}`);
      continue;
    }
    if (!pr.merged || pr.mergedBy === null || pr.mergeCommit === null) {
      fail("merged", `pull request ${pr.number} is not merged`);
      continue;
    }
    const transition = (confirmationOf(t.to) as Confirmation).transition;
    const records = transitionRecords(t, evidence);

    // The ref of MERGED is judged by M^1, so M comes first (design D3); the ref of APPROVED — by the base.
    let merger: Merger;
    if (t.to === "MERGED") {
      const located = await locateMerge(ctx, subject, t, records, pr);
      if (!located.ok) {
        fail(located.reason, located.detail);
        continue;
      }
      merger = await mergedByLaw(ctx, change, located.merge, env);
      if (merger.closed !== undefined) {
        out.findings.push({ code: "AGENT_MERGE_CLOSED", message: `${where}: a merge by an agent is not admitted: ${merger.closed}` });
      }
    } else {
      const roles = resolved.ok ? approvalRoles(resolved.policy, transition) : approvalRoles({ approvals: [] }, transition);
      merger = { config: base.loaded.config, roles, exception: false, of: "the base" };
    }
    const agents = merger.config.agents;
    if (merger.exception) {
      // Without human-approval a merge is no act of approval (ADR-0050 п. 2, ADR-0051 п. 4): INV-03 does not apply.
      if (!roleMembers(merger.config).has(pr.mergedBy) && !agents.includes(pr.mergedBy)) {
        fail("merged_by", `${pr.mergedBy} merged pull request ${pr.number}, neither a member of roles nor an agent identity of ${merger.of}`);
        continue;
      }
    } else {
      if (!roleMembers(merger.config, merger.roles).has(pr.mergedBy)) {
        fail("merged_by", `${pr.mergedBy} merged pull request ${pr.number}, not a member of roles ${merger.roles.join(", ")} of ${merger.of}`);
        continue;
      }
      // With agent identities, a self-merge and a merge by an agent are refused (INV-03, ADR-0044 п. 3).
      if (agents.includes(pr.mergedBy)) {
        fail("merged_by", `${pr.mergedBy} merged pull request ${pr.number} and is an agent identity (identities.agents of ${merger.of})`);
        continue;
      }
      if (agents.length > 0 && pr.mergedBy === pr.author) {
        fail("merged_by", `${pr.mergedBy} merged pull request ${pr.number} they authored (INV-03)`);
        continue;
      }
    }
    if (t.to !== "MERGED") {
      const located = await locateMerge(ctx, subject, t, records, pr);
      if (!located.ok) {
        fail(located.reason, located.detail);
        continue;
      }
    }

    const approval = records.find((json) => json["kind"] === HUMAN_APPROVAL);
    const producedBy = isPlainObject(approval?.["produced_by"]) ? approval["produced_by"] : undefined;
    if (approval !== undefined && producedBy?.["id"] !== pr.mergedBy) {
      fail("by", `the ${HUMAN_APPROVAL} record names ${String(producedBy?.["id"])}, the pull request was merged by ${pr.mergedBy}`);
      continue;
    }
    if (agents.length > 0) continue;
    out.findings.push({ code: "SHARED_IDENTITY", message: `${where}: merged by ${pr.mergedBy}: ${SHARED_IDENTITY_NOTE}` });
    if (pr.mergedBy === pr.author) {
      out.findings.push({
        code: "APPROVER_IS_AUTHOR",
        message: `${where}: ${pr.mergedBy} merged pull request ${pr.number} they authored (INV-03 in full needs identities.agents, BL-44)`
      });
    }
  }
  return out;
}
