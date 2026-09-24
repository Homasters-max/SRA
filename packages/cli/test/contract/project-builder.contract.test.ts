/**
 * `ProjectBuilder.synced()` against the e2e base (ADR-0025 п. 6, design §6,
 * task 4.2): the project the builder makes and syncs in the test process with
 * fake ports has, file for file and byte for byte, what `useSyncedProject`
 * makes with the real `openspec init` and the `warrant` binary (I-131).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { useSyncedProject } from "../helpers/synced.js";
import { useProjectBuilder } from "../app/helpers/project-builder.js";

const synced = useSyncedProject();
const project = useProjectBuilder();

/** Every file under `root` with its content, POSIX paths. */
function files(root: string, rel = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const child = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) Object.assign(out, files(root, child));
    else out[child] = readFileSync(path.join(root, child), "utf8");
  }
  return out;
}

describe("ProjectBuilder.synced() is the e2e synced project", () => {
  it("same files, same bytes", async () => {
    const real = files(synced());
    const built = files((await project().synced()).root);
    expect(Object.keys(built).sort()).toEqual(Object.keys(real).sort());
    for (const [rel, content] of Object.entries(real)) expect(built[rel], rel).toBe(content);
  });
});
