/**
 * Merge of `openspec/rules.json` layers (task 7.3, ADR-0015 point 2).
 *
 * Layers arrive in load order: packs in topological order, then the project
 * layer `.warrant/local/openspec/rules.json`. Merging only ever adds, so a
 * project can extend the rules of a pack but never drop one of them.
 */

/** One `warrant://openspec-rules/1` document, reduced to the fields that merge. */
export interface OpenspecRules {
  context?: string | undefined;
  rules?: Record<string, string[]> | undefined;
  operations?: Record<string, { guidance?: string[] | undefined }> | undefined;
}

/** Ordered union: first occurrence wins, exact duplicates dropped. */
function unionLists(lists: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const item of list) {
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Folds the layers into one rules document.
 *
 * `context` is concatenated with a blank line between non-empty parts; the
 * per-artifact rules and the operation guidance are ordered unions.
 */
export function mergeRules(layers: readonly OpenspecRules[]): OpenspecRules {
  const contexts: string[] = [];
  const ruleKeys: string[] = [];
  const ruleLists = new Map<string, string[][]>();
  const opKeys: string[] = [];
  const opLists = new Map<string, string[][]>();

  for (const layer of layers) {
    const context = typeof layer.context === "string" ? layer.context.trim() : "";
    if (context !== "") contexts.push(context);

    for (const [artifact, list] of Object.entries(layer.rules ?? {})) {
      if (artifact === "$comment") continue;
      if (!ruleLists.has(artifact)) {
        ruleLists.set(artifact, []);
        ruleKeys.push(artifact);
      }
      (ruleLists.get(artifact) as string[][]).push(stringList(list));
    }

    for (const [op, body] of Object.entries(layer.operations ?? {})) {
      if (op === "$comment") continue;
      if (!opLists.has(op)) {
        opLists.set(op, []);
        opKeys.push(op);
      }
      (opLists.get(op) as string[][]).push(stringList(body?.guidance));
    }
  }

  const merged: OpenspecRules = {};
  if (contexts.length > 0) merged.context = contexts.join("\n\n");

  if (ruleKeys.length > 0) {
    const rules: Record<string, string[]> = {};
    for (const artifact of ruleKeys) {
      const list = unionLists(ruleLists.get(artifact) as string[][]);
      if (list.length > 0) rules[artifact] = list;
    }
    if (Object.keys(rules).length > 0) merged.rules = rules;
  }

  if (opKeys.length > 0) {
    const operations: Record<string, { guidance?: string[] }> = {};
    for (const op of opKeys) {
      const list = unionLists(opLists.get(op) as string[][]);
      if (list.length > 0) operations[op] = { guidance: list };
    }
    if (Object.keys(operations).length > 0) merged.operations = operations;
  }

  return merged;
}
