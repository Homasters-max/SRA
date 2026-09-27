/**
 * The files of the project a judgement reads (R-21, design §3 of phase-4c):
 * the working tree for `warrant analyze`, or the evaluated commit for the gates
 * — on `transition MERGED` in an archive branch the working tree is not the
 * head of the impl-PR. Paths are POSIX, relative to the project root.
 */
import { readFileSync, statSync } from "node:fs";

import { absolutePath, reportPath, walkFiles } from "../fs.js";
import type { GitCtx } from "./facts.js";
import { toProjectPaths } from "./paths.js";

export interface ProjectFiles {
  /** The files under `rel` (a file or a directory), sorted; none when it is absent. */
  list(rel: string): string[];
  /** Text of the file `rel` (UTF-8), or undefined when it is absent or unreadable. */
  read(rel: string): string | undefined;
}


/** The files of the working tree of the project `root`. */
export function workingTreeFiles(root: string): ProjectFiles {
  return {
    list(rel) {
      const absolute = absolutePath(root, rel);
      let stat;
      try {
        stat = statSync(absolute);
      } catch {
        return [];
      }
      if (stat.isFile()) return [reportPath(absolute, root)];
      return stat.isDirectory() ? walkFiles(absolute).map((file) => reportPath(file, root)) : [];
    },
    read(rel) {
      try {
        return readFileSync(absolutePath(root, rel), "utf8");
      } catch {
        return undefined;
      }
    }
  };
}

/**
 * The files under `paths` (project-relative files or directories) as `commit`
 * holds them: one `git ls-tree` and one `git cat-file --batch`. Null when git
 * cannot list them (not a repository, an unknown commit).
 */
export async function commitFiles(ctx: GitCtx, commit: string, paths: readonly string[]): Promise<ProjectFiles | null> {
  const prefix = await ctx.git.prefix();
  if (prefix === null) return null;
  const listed = await ctx.git.files(commit, [...paths]);
  if (listed === null) return null;
  const files = [...new Set(toProjectPaths(prefix, listed))].sort();
  const contents = await ctx.git.contents(commit, files.map((file) => `./${file}`));
  const within = (file: string, rel: string): boolean => {
    const dir = rel.replace(/\/+$/, "");
    return dir === "" || dir === "." || file === dir || file.startsWith(`${dir}/`);
  };
  return {
    list: (rel) => files.filter((file) => within(file, rel)),
    read: (rel) => contents.get(`./${rel}`)
  };
}
