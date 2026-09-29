/**
 * The decisions of UNKNOWNs through the forge (REQ-VER-013, ADR-0040 п. 3,
 * design slice-fixes §4): every blocking element of `unknowns[]` of the record
 * on HEAD closed as `decision` names by `ref` a comment of a pull request of
 * this repository, written by a member of `roles.maintainer` of the base of
 * requirements (ADR-0038) who is not in its `identities.agents` (ADR-0044
 * п. 3), whose text names the id of the UNKNOWN, in the
 * pull request `<N>` of the ref by the answer of the forge (I-189) — and, in a
 * pull request that brings a new `APPROVED`, `<N>` is the spec-PR of its ref.
 *
 * Only there does the decision judge a transition: a violation is
 * `REF_NOT_VERIFIED` with the reason `decision`, the forge unavailable is
 * `FORGE_UNAVAILABLE` (exit 3). Elsewhere a violation — and the forge
 * unavailable, detail `forge` — is the finding `DECISION_NOT_VERIFIED`, which
 * does not change the exit code. With no `identities.agents` in the base, a
 * decision without a violation is the finding `SHARED_IDENTITY` in every kind
 * of pull request: the comment of the maintainer cannot be told from one of an
 * agent under the same account.
 */
import type { Ctx } from "../ctx.js";
import { cliError, WarrantError } from "../errors.js";
import { isPlainObject } from "../json.js";
import type { ChangeRecord } from "../record/read.js";
import { recordPath } from "../record/write.js";
import { DECISION_ROLE, roleMembers } from "../roles.js";
import { unknownsOf } from "../unknowns/state.js";
import type { BaseContext } from "./base.js";
import type { CiSubject } from "./kind.js";
import { parseCommentUrl, parsePullUrl, SHARED_IDENTITY_NOTE, type RefJudgement } from "./refs.js";

/** Details of a decision that does not hold (REQ-VER-013); `forge` — only as a finding. */
export type DecisionDetail = "form" | "repository" | "missing" | "author" | "text" | "pull_request" | "forge";

/**
 * Judges the decisions of the record `record` of the Change of `subject`.
 * `approvedPr` — undefined when the pull request brings no new `APPROVED`;
 * otherwise the number of the pull request its ref names, null when it names
 * none (`judgeRefs` reports that ref). Throws `FORGE_UNAVAILABLE` only with a
 * new `APPROVED`.
 */
export async function judgeDecisions(
  ctx: Pick<Ctx, "forge">,
  subject: CiSubject,
  base: BaseContext,
  record: ChangeRecord,
  approvedPr?: number | null
): Promise<RefJudgement> {
  const change = subject.change as string;
  const out: RefJudgement = { errors: [], findings: [] };
  const judged = approvedPr !== undefined;
  const maintainers = roleMembers(base.loaded.config, [DECISION_ROLE]);
  const agents = base.loaded.config.agents;

  const unknowns = unknownsOf(record);
  for (const [index, entry] of unknowns.entries()) {
    if (!isPlainObject(entry) || entry["blocking"] !== true || entry["resolved_as"] !== "decision") continue;
    const id = typeof entry["id"] === "string" ? entry["id"] : "(no id)";
    const ref = typeof entry["ref"] === "string" ? entry["ref"] : "";
    const where = `unknowns/${index} (${id}) ref ${ref === "" ? "(none)" : ref}: decision`;
    const fail = (detail: DecisionDetail, text: string): void => {
      const message = `${where}: ${detail}: ${text}`;
      if (judged) out.errors.push(cliError("REF_NOT_VERIFIED", message, { path: `${recordPath(change)}#/unknowns/${index}/ref` }));
      else out.findings.push({ code: "DECISION_NOT_VERIFIED", message });
    };

    const parsed = parseCommentUrl(ref);
    if (parsed === null) {
      fail("form", "the ref is not the URL of a pull request comment: …/pull/<N>#issuecomment-<id> or …/pull/<N>#pullrequestreview-<id>");
      continue;
    }
    try {
      const pr = await ctx.forge.pullRequest(parsed.pullRequest);
      const own = pr === null ? null : parsePullUrl(pr.url);
      if (own === null || own.repository !== parsed.repository) {
        fail("repository", `no pull request ${parsed.pullRequest} of ${parsed.repository} in the repository of the forge${own === null ? "" : ` (${own.repository})`}`);
        continue;
      }
      const comment = await ctx.forge.comment(parsed);
      if (comment === null) {
        fail("missing", `the forge has no ${parsed.kind === "issue" ? "issue comment" : "review"} ${parsed.id} of pull request ${parsed.pullRequest}`);
        continue;
      }
      if (!maintainers.has(comment.author)) {
        fail("author", `${comment.author} wrote the comment, not a member of roles ${DECISION_ROLE} of the base`);
        continue;
      }
      if (agents.includes(comment.author)) {
        fail("author", `${comment.author} wrote the comment and is an agent identity (identities.agents of the base)`);
        continue;
      }
      if (!comment.body.includes(id)) {
        fail("text", `the text of the comment does not name ${id}`);
        continue;
      }
      if (comment.pullRequest !== parsed.pullRequest) {
        fail("pull_request", `the comment belongs to pull request ${comment.pullRequest}, not to ${parsed.pullRequest} of the ref`);
        continue;
      }
      if (approvedPr !== undefined && approvedPr !== null && parsed.pullRequest !== approvedPr) {
        fail("pull_request", `the comment is in pull request ${parsed.pullRequest}, not in ${approvedPr}, the spec-PR of the ref of APPROVED`);
        continue;
      }
      if (agents.length === 0) {
        out.findings.push({ code: "SHARED_IDENTITY", message: `${where}: written by ${comment.author}: ${SHARED_IDENTITY_NOTE}` });
      }
    } catch (error) {
      if (judged || !(error instanceof WarrantError) || error.code !== "FORGE_UNAVAILABLE") throw error;
      fail("forge", error.message);
    }
  }
  return out;
}
