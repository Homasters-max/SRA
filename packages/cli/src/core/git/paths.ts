/**
 * Project paths from git's output (A-16): git prints paths from the top of the
 * repository, WARRANT speaks of the project. `toProjectPaths` is the one owner
 * of cutting the project prefix (I-100); a local copy is an error of the
 * `helper` rule of `test/unit/meta/architecture.test.ts`.
 */
import type { Ctx } from "../ctx.js";
import { WarrantError } from "../errors.js";

/**
 * The lines inside the project, relative to it. `prefix` is the project's path
 * inside its repository as `git rev-parse --show-prefix` sees it (`""` at the
 * top, else `a/b` without a trailing slash): with `""` the lines are returned
 * as they are, else only `<prefix>/…`, without the prefix.
 */
export function toProjectPaths(prefix: string, lines: readonly string[]): string[] {
  if (prefix === "") return [...lines];
  const head = `${prefix}/`;
  return lines.filter((line) => line.startsWith(head)).map((line) => line.slice(prefix.length + 1));
}

/**
 * Изменённые пути из `git diff --name-only <base>...HEAD`.
 *
 * `git` печатает пути относительно корня репозитория, а classification живёт в
 * проекте, поэтому пути переносятся в систему координат проекта; всё, что вне
 * проекта, отбрасывается — policy проекта о нём ничего сказать не может.
 */
export async function changedFromGit(ctx: Pick<Ctx, "git" | "root">, base: string): Promise<string[]> {
  // The prefix as git sees it: a path spelled differently (symlink, 8.3 name) must not drop every line (I-100).
  const prefix = await ctx.git.prefix();
  if (prefix === null) {
    throw new WarrantError(
      "USAGE",
      `${ctx.root} is not a git repository`,
      { hint: "pass --paths <file> with one changed path per line" }
    );
  }
  const diff = await ctx.git.diffNames(base);
  if (!diff.ok) {
    throw new WarrantError(
      "USAGE",
      `git could not diff "${base}...HEAD": ${diff.detail}`,
      { hint: "pass an existing ref with --base or use --paths" }
    );
  }
  return toProjectPaths(prefix, diff.value);
}
