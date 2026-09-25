/**
 * `ctx.writes` (design §10, REQ-KRN-034): the one way a command that changes
 * state touches files — the record, evidence, waivers, the Change directory.
 * Normally it performs the write; under `--dry-run` it only collects the path,
 * so the command runs every check and prints the same JSON with
 * `data.would_write[]`, and no file changes.
 */

export interface Writes {
  readonly dryRun: boolean;
  /**
   * Performs `perform`, which creates, rewrites, moves or removes `target` —
   * paths relative to the project root, POSIX, or `file://` URIs outside it —
   * and returns what it returns; in dry-run only collects `target` and
   * returns undefined.
   */
  write<T>(target: string | readonly string[], perform: () => T): T | undefined;
  /** The targets collected in dry-run: sorted, without duplicates; empty otherwise. */
  collected(): string[];
}

/** The writer of `ctx.writes`: performing, or collecting under `--dry-run`. */
export function createWrites(dryRun: boolean): Writes {
  const targets = new Set<string>();
  return {
    dryRun,
    write<T>(target: string | readonly string[], perform: () => T): T | undefined {
      if (!dryRun) return perform();
      for (const one of typeof target === "string" ? [target] : target) targets.add(one);
      return undefined;
    },
    collected: () => [...targets].sort()
  };
}
