/**
 * Check (9) under `validate --files` (REQ-KRN-032, I-159): `checkImmutableFiles`
 * asks the git port only `contents` with `./`-relative paths, and only for the
 * paths in the scope of the check. The port is a stub: no process.
 */
import { afterAll, describe, expect, it } from "vitest";

import { checkImmutableFiles } from "../../../src/core/ids/immutable.js";
import type { GitPort } from "../../../src/core/ports/git.js";
import type { RecordFile } from "../../../src/core/record/read.js";
import { makeTempDir, removeDir } from "../../helpers/cli.js";
import { write } from "../../helpers/synced.js";

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) removeDir(dir);
});

/** A git port that answers `contents` from `head` and fails the test on any other question. */
function stubGit(head: Record<string, string>): { git: GitPort; asked: string[][] } {
  const asked: string[][] = [];
  const git = new Proxy({} as GitPort, {
    get: (_target, name) => {
      if (name !== "contents") throw new Error(`git.${String(name)} must not be called under --files`);
      return async (rev: string, paths: string[]) => {
        asked.push([rev, ...paths]);
        return new Map(paths.filter((p) => head[p] !== undefined).map((p) => [p, head[p] as string]));
      };
    }
  });
  return { git, asked };
}

function record(change: string, state: string): [string, RecordFile] {
  return [change, { change, path: `.warrant/changes/${change}.json`, json: { change, change_state: state } }];
}

describe("checkImmutableFiles", () => {
  const spec = "openspec/specs/search/spec.md";
  const approved = "openspec/changes/add-search/specs/search/spec.md";
  const proposed = "openspec/changes/early/specs/search/spec.md";

  it("compares each path in scope with HEAD:./<path>; a path out of scope is not asked", async () => {
    const root = makeTempDir("warrant-immutable-files-");
    tempDirs.push(root);
    write(root, spec, "## Requirements\n\n### Requirement: Search\n<!-- id: REQ-SRC-009 -->\nText.\n");
    write(root, approved, "### Requirement: Search\n<!-- id: REQ-SRC-001 -->\nText.\n");
    write(root, proposed, "### Requirement: Early\nText.\n");
    const { git, asked } = stubGit({
      [`./${spec}`]: "## Requirements\n\n### Requirement: Search\n<!-- id: REQ-SRC-001 -->\nText.\n",
      [`./${approved}`]: "### Requirement: Search\n<!-- id: REQ-SRC-001 -->\nText.\n",
      [`./${proposed}`]: "### Requirement: Early\n<!-- id: REQ-SRC-002 -->\nText.\n"
    });
    const records = new Map([record("add-search", "APPROVED"), record("early", "PROPOSED")]);

    const errors = await checkImmutableFiles({ root, git }, records, [spec, approved, proposed]);
    expect(asked).toEqual([["HEAD", `./${spec}`, `./${approved}`]]);
    expect(errors).toEqual([expect.objectContaining({ code: "ID_IMMUTABLE", path: spec })]);
    expect(errors[0]?.message).toContain("REQ-SRC-001");
  });

  it("asks nothing when no path is in scope; a file new since HEAD has no finding", async () => {
    const root = makeTempDir("warrant-immutable-files-");
    tempDirs.push(root);
    write(root, spec, "<!-- id: REQ-SRC-001 -->\n");
    const none = stubGit({});
    expect(await checkImmutableFiles({ root, git: none.git }, new Map(), [proposed])).toEqual([]);
    expect(none.asked).toEqual([]);
    expect(await checkImmutableFiles({ root, git: none.git }, new Map(), [spec])).toEqual([]);
    expect(none.asked).toEqual([["HEAD", `./${spec}`]]);
  });
});
