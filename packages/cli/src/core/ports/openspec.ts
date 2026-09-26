/**
 * Port to OpenSpec (ADR-0025 п. 3, design §2): one method per `openspec` call
 * the commands make, nothing else. The adapter (`adapters/openspec-cli.ts`)
 * runs the binary, parses its `--json` output and turns failures into values;
 * a fake answers from its own model and parses nothing.
 */
/** The four states an OpenSpec artifact can be in (`openspec status --json`, REQ-KRN-027). */
export const ARTIFACT_STATUSES = ["done", "ready", "blocked", "skipped"] as const;

export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number];

/** `{ proposal: "done", specs: "ready", ... }`, keyed by artifact id. */
export type ArtifactStatuses = Record<string, ArtifactStatus>;

export interface OpenspecStatusResult {
  artifacts: ArtifactStatuses;
  /** Set when the artifacts could not be read; the caller turns it into a stderr line. */
  warning?: string;
}

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
   * scenario OpenSpec parsed (`text`, `rawText`), in the order it printed them,
   * each distinct text once; empty when the call fails.
   */
  showChange(name: string): Promise<string[]>;
  /** `openspec show <spec> --type spec --json`, as {@link showChange}. */
  showSpec(id: string): Promise<string[]>;
  /** `openspec status --change <change> --json`; never throws (the warning says why it could not be read). */
  status(change: string): Promise<OpenspecStatusResult>;
  /**
   * `openspec archive <change> --yes --json` in the project, or in `root` — a
   * checkout of another commit (`GitPort.worktreeAt`) where `warrant ci`
   * repeats the archive of an archive-PR (R-16).
   */
  archive(change: string, root?: string): Promise<OpenspecAct>;
  /** `openspec new change <name> --schema <schema> --json`. */
  newChange(name: string, schema: string): Promise<OpenspecAct>;
  /** `openspec schema validate <schema> --json`: `ok` is false when the call fails or the body says `valid: false`. */
  schemaValidate(schema: string): Promise<OpenspecAct>;
}
