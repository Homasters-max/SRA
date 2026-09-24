/**
 * Port to OpenSpec (ADR-0025 п. 3, design §2): one method per `openspec` call
 * the commands make, nothing else. The adapter (`adapters/openspec-cli.ts`)
 * runs the binary, parses its `--json` output and turns failures into values;
 * a fake answers from its own model and parses nothing.
 */
import type { OpenspecStatusResult } from "../openspec/status.js";

/** Outcome of an `openspec` call that acts or judges: `output` is its stderr, else its stdout. */
export interface OpenspecAct {
  ok: boolean;
  output: string;
}

export interface OpenSpecPort {
  /** `openspec --version`: the version printed, or null when the binary is absent or prints none. */
  version(): Promise<string | null>;
  /** `openspec list --json`: names of the active changes; empty when the call fails. */
  listChanges(): Promise<string[]>;
  /** `openspec list --specs --json`: ids of the main specs; empty when the call fails. */
  listSpecs(): Promise<string[]>;
  /**
   * `openspec show <change> --json`: the text of every requirement and
   * scenario OpenSpec parsed (`text`, `rawText`), in the order it printed them;
   * empty when the call fails.
   */
  showChange(name: string): Promise<string[]>;
  /** `openspec show <spec> --type spec --json`, as {@link showChange}. */
  showSpec(id: string): Promise<string[]>;
  /** `openspec status --change <change> --json`; never throws (the warning says why it could not be read). */
  status(change: string): Promise<OpenspecStatusResult>;
  /** `openspec archive <change> --yes --json`. */
  archive(change: string): Promise<OpenspecAct>;
  /** `openspec new change <name> --schema <schema> --json`. */
  newChange(name: string, schema: string): Promise<OpenspecAct>;
  /** `openspec schema validate <schema> --json`: `ok` is false when the call fails or the body says `valid: false`. */
  schemaValidate(schema: string): Promise<OpenspecAct>;
}
