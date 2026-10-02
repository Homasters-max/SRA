/**
 * `ctx.writes` (design §10, REQ-KRN-034): the one way a command that changes
 * state touches files — the record, evidence, waivers, the Change directory.
 * Normally it performs the write; under `--dry-run` it only collects the path,
 * so the command runs every check and prints the same JSON with
 * `data.would_write[]`, and no file changes. Under `warrant ci --no-record`
 * it performs and puts every target back at the end ({@link restoringWrites}).
 */
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { WarrantError } from "./errors.js";

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

/** What a target was before the first write of a {@link restoringWrites}. */
type Snapshot =
  | { target: string; absolute: string; kind: "absent"; created: string[] }
  | { target: string; absolute: string; kind: "file"; bytes: Buffer }
  | { target: string; absolute: string; kind: "dir"; copy: string };

/** A writer that performs and puts every target back as it was before its first write (REQ-VER-017). */
export interface RestoringWrites extends Writes {
  /**
   * Puts the targets back, the latest first: a created one is removed with
   * the empty directories made for it, a changed or removed one restored
   * byte for byte, a file atomically (REQ-KRN-036). Once; returns the targets
   * it could not put back.
   */
  restore(): string[];
}

/**
 * The writer of `warrant ci --no-record` (REQ-VER-017, design D1 of
 * ci-local): every write is performed, and before the first write of a
 * target its state — absent, a file, a directory — is kept. A state that
 * cannot be kept stops the command before that write (`INTERNAL`).
 * `absoluteOf` turns a target (a project path or a `file://` URI) into its
 * absolute path; `writeAtomic` puts a file back atomically (REQ-KRN-036) —
 * the caller passes `writeFileAtomic` of `core/canon`, above this module.
 */
export function restoringWrites(absoluteOf: (target: string) => string, writeAtomic: (absolute: string, bytes: Uint8Array) => void): RestoringWrites {
  const snapshots: Snapshot[] = [];
  const seen = new Set<string>();
  let store: string | undefined;
  let restored: string[] | undefined;

  const keep = (target: string): void => {
    if (seen.has(target)) return;
    let absolute = target;
    try {
      absolute = absoluteOf(target);
      if (!existsSync(absolute)) {
        const created: string[] = [];
        for (let dir = path.dirname(absolute); !existsSync(dir); dir = path.dirname(dir)) {
          created.push(dir);
          if (path.dirname(dir) === dir) break;
        }
        snapshots.push({ target, absolute, kind: "absent", created });
      } else if (statSync(absolute).isDirectory()) {
        store ??= mkdtempSync(path.join(tmpdir(), "warrant-no-record-"));
        const copy = path.join(store, String(snapshots.length));
        cpSync(absolute, copy, { recursive: true });
        snapshots.push({ target, absolute, kind: "dir", copy });
      } else {
        snapshots.push({ target, absolute, kind: "file", bytes: readFileSync(absolute) });
      }
    } catch (thrown) {
      throw new WarrantError("INTERNAL", `--no-record could not keep the state of ${target} before writing it: ${(thrown as Error).message}`, {
        path: target
      });
    }
    seen.add(target);
  };

  const putBack = (snapshot: Snapshot): void => {
    if (snapshot.kind === "file") {
      // Atomic (REQ-KRN-036): the file is replaced by `writeAtomic`, never removed first; a directory in its place goes first.
      if (existsSync(snapshot.absolute) && statSync(snapshot.absolute).isDirectory()) rmSync(snapshot.absolute, { recursive: true, force: true });
      writeAtomic(snapshot.absolute, snapshot.bytes);
      return;
    }
    rmSync(snapshot.absolute, { recursive: true, force: true });
    if (snapshot.kind === "dir") cpSync(snapshot.copy, snapshot.absolute, { recursive: true });
    else {
      for (const dir of [...snapshot.created].sort((x, y) => y.length - x.length)) {
        if (existsSync(dir) && readdirSync(dir).length === 0) rmdirSync(dir);
      }
    }
  };

  return {
    dryRun: false,
    write<T>(target: string | readonly string[], perform: () => T): T {
      for (const one of typeof target === "string" ? [target] : target) keep(one);
      return perform();
    },
    collected: () => [],
    restore(): string[] {
      if (restored !== undefined) return restored;
      const failed: string[] = [];
      for (const snapshot of [...snapshots].reverse()) {
        try {
          putBack(snapshot);
        } catch {
          failed.push(snapshot.target);
        }
      }
      if (store !== undefined) rmSync(store, { recursive: true, force: true });
      restored = failed.sort();
      return restored;
    }
  };
}
