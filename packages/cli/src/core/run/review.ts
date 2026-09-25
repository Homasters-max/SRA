/**
 * The spec a `review` Run reads (REQ-ENF-002, ADR-0036 п. 3, design §4): the
 * `proposal.md` and `specs/**` of the Change as committed at `HEAD`. The Run
 * keeps their `spec_tree` — the hash `spec-approved` and the pre-filter
 * compare — so a review of files that differ from `HEAD` would prove a tree
 * nobody can name: `SPEC_UNCOMMITTED`. Dirty files are git's own answer
 * (`GitPort.dirty`), not a comparison of bytes, which CRLF checkouts break.
 */
import type { Ctx } from "../ctx.js";
import { WarrantError } from "../errors.js";
import { specTreeHash } from "../git/facts.js";
import { toProjectPaths } from "../git/paths.js";

/** Paths of the spec of `change` a review reads, relative to the project (ADR-0024). */
export function reviewedSpec(change: string): string[] {
  const dir = `openspec/changes/${change}`;
  return [`${dir}/proposal.md`, `${dir}/specs`];
}

function uncommitted(change: string, path: string, why: string): WarrantError {
  return new WarrantError("SPEC_UNCOMMITTED", `a review reads the committed spec of ${change}: ${why}`, {
    path,
    hint: `commit proposal.md and specs/** of the Change first (\`git add openspec/changes/${change} && git commit\`), then \`warrant run start ${change} --operation review\``
  });
}

/**
 * `spec_tree` of `change` at `HEAD`; `SPEC_UNCOMMITTED` when a file of its
 * spec differs from `HEAD` in the index or the work tree, is untracked, or
 * there is no `HEAD` to read it from.
 */
export async function committedSpecTree(ctx: Pick<Ctx, "git">, change: string): Promise<string> {
  const dir = `openspec/changes/${change}`;
  const prefix = await ctx.git.prefix();
  if (prefix === null) throw uncommitted(change, dir, "the project is not in a git work tree");
  const dirty = await ctx.git.dirty(reviewedSpec(change));
  if (!dirty.ok) throw uncommitted(change, dir, `git status failed: ${dirty.detail}`);
  const files = toProjectPaths(prefix, dirty.value);
  const first = files[0];
  if (first !== undefined) throw uncommitted(change, first, `${files.join(", ")} ${files.length === 1 ? "differs" : "differ"} from HEAD`);
  const tree = await specTreeHash(ctx, "HEAD", change);
  if (!tree.ok) throw uncommitted(change, dir, tree.reason);
  return tree.value;
}
