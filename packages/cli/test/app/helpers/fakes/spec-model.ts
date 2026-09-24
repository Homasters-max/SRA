/**
 * The requirements and scenarios of a Change or spec as one model (ADR-0025
 * п. 4, design §5, §6): `ProjectBuilder` renders it to Markdown on disk and
 * `FakeOpenSpec` answers `show` from it. The fake never reads the Markdown;
 * both sides are functions of the same object, and the contract (§7) checks
 * that the real `openspec show` of the Markdown gives the texts below.
 */

export interface ModelScenario {
  name: string;
  /** Stable id, written directly under the heading. */
  id?: string;
  /** The body; default one WHEN/THEN pair. */
  steps?: string;
}

export interface ModelRequirement {
  name: string;
  /** Stable id: directly under the heading, or after the body (`idAfterBody`), where it is not placed (check 5d). */
  id?: string;
  idAfterBody?: boolean;
  /** The body; default one SHALL sentence. */
  body?: string;
  scenarios?: ModelScenario[];
}

const bodyOf = (req: ModelRequirement): string => req.body ?? `The system SHALL ${req.name.toLowerCase()}.`;

const stepsOf = (scn: ModelScenario): string => scn.steps ?? "- **WHEN** it is asked\n- **THEN** it answers";

/** `requirement.text` of `openspec show --json`: the lines between the heading and the first scenario, trimmed. */
export function requirementText(req: ModelRequirement): string {
  if (req.id === undefined) return bodyOf(req);
  const comment = `<!-- id: ${req.id} -->`;
  return req.idAfterBody === true ? `${bodyOf(req)}\n${comment}` : `${comment}\n${bodyOf(req)}`;
}

/** `scenario.rawText` of `openspec show --json`: the lines under the heading, trimmed. */
export function scenarioText(scn: ModelScenario): string {
  return scn.id === undefined ? stepsOf(scn) : `<!-- id: ${scn.id} -->\n${stepsOf(scn)}`;
}

/** What `show` yields for requirements: each requirement text, then its scenarios' texts. */
export function shownTexts(reqs: readonly ModelRequirement[]): string[] {
  return reqs.flatMap((req) => [requirementText(req), ...(req.scenarios ?? []).map(scenarioText)]);
}

/** The Markdown of the requirements, `### Requirement:` blocks with `#### Scenario:` blocks. */
export function requirementsMarkdown(reqs: readonly ModelRequirement[]): string {
  return reqs
    .map((req) => {
      const scenarios = (req.scenarios ?? []).map((scn) => `#### Scenario: ${scn.name}\n${scenarioText(scn)}\n`);
      return [`### Requirement: ${req.name}\n${requirementText(req)}\n`, ...scenarios].join("\n");
    })
    .join("\n");
}

/** A main spec `openspec/specs/<id>/spec.md`. */
export function mainSpecMarkdown(id: string, purpose: string, reqs: readonly ModelRequirement[]): string {
  const body = reqs.length === 0 ? "" : `\n${requirementsMarkdown(reqs)}`;
  return `# ${id} Specification\n\n## Purpose\n${purpose}\n\n## Requirements\n${body}`;
}

/** A delta spec `openspec/changes/<change>/specs/<capability>/spec.md` that adds the requirements. */
export function deltaSpecMarkdown(reqs: readonly ModelRequirement[]): string {
  return `## ADDED Requirements\n\n${requirementsMarkdown(reqs)}`;
}

/** A proposal OpenSpec accepts for `show` (it needs the Why and What Changes sections). */
export function proposalMarkdown(why: string): string {
  return `# Proposal\n\n## Why\n${why}\n\n## What Changes\n- ${why}\n`;
}
