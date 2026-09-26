/**
 * The `ref` of new `APPROVED` and `MERGED` transitions, verified through the
 * forge (REQ-VER-011 «Ref», ADR-0037 п. 5, N36): a merged pull request of this
 * repository, merged by a member of the role of `approvals[]` of the transition
 * — roles and approvals from the base of requirements (I-171) — and tied to
 * the Change: the spec-PR brought the transition `SPECIFIED`, the impl-PR is
 * the merge M of the head the CI records were made on. `merged_by` equal to the
 * author is a finding (`APPROVER_IS_AUTHOR`), not a violation, until a bot
 * identity (BL-44).
 */
import type { Ctx } from "../ctx.js";
import { cliError, type CliError } from "../errors.js";
import { HUMAN_APPROVAL } from "../evidence/approval.js";
import { subjectOf } from "../evidence/record.js";
import type { Finding } from "../gates/types.js";
import { mergeOfHead } from "../git/facts.js";
import { isPlainObject, strings } from "../json.js";
import type { ChangeRecord } from "../record/read.js";
import { approvalRoles, roleMembers } from "../roles.js";
import { basePolicy, type BaseContext } from "./base.js";
import { jsonAt, recordRel, type CiSubject } from "./kind.js";
import type { NewTransition } from "./record.js";

/** Reasons of `REF_NOT_VERIFIED` (REQ-VER-011). */
export type RefReason = "repository" | "merged" | "merged_by" | "change" | "merge_commit" | "by";

/** The transition whose approval each verified target records. */
const APPROVAL_AT: Readonly<Record<string, string>> = { APPROVED: "SPECIFIED->APPROVED", MERGED: "VERIFYING->MERGED" };

/** The transition the pull request of the ref brings into the record: the spec-PR `SPECIFIED`, the impl-PR `VERIFYING`. */
const BROUGHT_BY_PR: Readonly<Record<string, string>> = { APPROVED: "SPECIFIED", MERGED: "VERIFYING" };

export interface RefJudgement {
  errors: CliError[];
  findings: Finding[];
}

/** `<owner>/<repo>` and the number of a pull request URL, or null. */
function parsePullUrl(ref: string): { repository: string; number: number } | null {
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

/** Targets of the transitions `rev` adds to the record of `change` against its first parent. */
async function broughtTransitions(ctx: Pick<Ctx, "git">, rev: string, change: string): Promise<string[]> {
  const parent = (await ctx.git.parents(rev))[0];
  const after = await jsonAt(ctx, rev, recordRel(change));
  const before = parent === undefined ? undefined : await jsonAt(ctx, parent, recordRel(change));
  const list = (r: unknown): unknown[] => (isPlainObject(r) && Array.isArray(r["transitions"]) ? r["transitions"] : []);
  return list(after)
    .slice(list(before).length)
    .flatMap((t) => (isPlainObject(t) && typeof t["to"] === "string" ? [t["to"]] : []));
}

/**
 * Verifies the `ref` of every new `APPROVED` and `MERGED` of `transitions`.
 * Throws `FORGE_UNAVAILABLE` (exit 3) when the forge cannot be read.
 */
export async function judgeRefs(
  ctx: Pick<Ctx, "git" | "forge">,
  subject: CiSubject,
  base: BaseContext,
  transitions: readonly NewTransition[],
  evidence: ReadonlyMap<string, Record<string, unknown>>
): Promise<RefJudgement> {
  const change = subject.change as string;
  const out: RefJudgement = { errors: [], findings: [] };
  const verified = transitions.filter((t) => APPROVAL_AT[t.to] !== undefined);
  if (verified.length === 0) return out;
  const line = new Set((await ctx.git.firstParents(subject.base)) ?? []);
  const resolved = basePolicy(base, change, subject.record as ChangeRecord);

  for (const t of verified) {
    const ref = typeof t.entry["ref"] === "string" ? t.entry["ref"] : "";
    const where = `transition ${t.index} (${t.to}) ref ${ref === "" ? "(none)" : ref}`;
    const fail = (reason: RefReason, detail: string): void => {
      out.errors.push(cliError("REF_NOT_VERIFIED", `${where}: ${reason}: ${detail}`, { path: `${recordRel(change)}#/transitions/${t.index}/ref` }));
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
    const transition = APPROVAL_AT[t.to] as string;
    const roles = resolved.ok ? approvalRoles(resolved.policy, transition) : approvalRoles({ approvals: [] }, transition);
    if (!roleMembers(base.loaded.config, roles).has(pr.mergedBy)) {
      fail("merged_by", `${pr.mergedBy} merged pull request ${pr.number}, not a member of roles ${roles.join(", ")} of the base`);
      continue;
    }

    const records = strings(t.entry["evidence"]).flatMap((id) => {
      const json = evidence.get(id);
      return json === undefined ? [] : [json];
    });
    const ci = records.filter((json) => isPlainObject(json["attestation"]) && json["attestation"]["type"] === "ci");
    const heads = [...new Set(ci.map((json) => subjectOf(json)?.commit ?? ""))];
    if (t.to === "MERGED" && heads.length > 0) {
      if (heads.length > 1) {
        fail("merge_commit", `the CI records of the transition name ${heads.length} commits: ${heads.join(", ")}`);
        continue;
      }
      const m = await mergeOfHead(ctx, heads[0] as string, subject.base);
      const parents = m === null ? [] : await ctx.git.parents(m);
      if (m === null || pr.mergeCommit !== m || pr.headSha !== parents[1]) {
        fail(
          "merge_commit",
          m === null
            ? `no merge commit on the first-parent line of the base has ${heads[0] as string}, the commit of the CI records, as its head`
            : `pull request ${pr.number} was merged by ${pr.mergeCommit} with head ${pr.headSha}, not by M ${m} with head ${String(parents[1])}`
        );
        continue;
      }
    } else {
      if (!line.has(pr.mergeCommit)) {
        fail("merge_commit", `merge commit ${pr.mergeCommit} of pull request ${pr.number} is not on the first-parent line of the base`);
        continue;
      }
      const brought = BROUGHT_BY_PR[t.to] as string;
      if (!(await broughtTransitions(ctx, pr.mergeCommit, change)).includes(brought)) {
        fail("change", `merge commit ${pr.mergeCommit} of pull request ${pr.number} does not bring the transition ${brought} into the record of ${change}`);
        continue;
      }
    }

    const approval = records.find((json) => json["kind"] === HUMAN_APPROVAL);
    const producedBy = isPlainObject(approval?.["produced_by"]) ? approval["produced_by"] : undefined;
    if (approval !== undefined && producedBy?.["id"] !== pr.mergedBy) {
      fail("by", `the ${HUMAN_APPROVAL} record names ${String(producedBy?.["id"])}, the pull request was merged by ${pr.mergedBy}`);
      continue;
    }
    if (pr.mergedBy === pr.author) {
      out.findings.push({
        code: "APPROVER_IS_AUTHOR",
        message: `${where}: ${pr.mergedBy} merged pull request ${pr.number} they authored (INV-03 in full needs a bot identity, BL-44)`
      });
    }
  }
  return out;
}
