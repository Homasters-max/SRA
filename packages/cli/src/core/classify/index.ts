/**
 * `classify` — чистая функция, вычисляющая `classification` Change из трёх
 * детерминированных источников (REQ-KRN-028, design Decision 4).
 *
 * Модуль ничего не читает с диска, кроме `warrant://common/1`: порядок значений
 * измерений — это его enum'ы, и дублировать их здесь значило бы завести вторую
 * норму. Всё остальное приходит входом, поэтому команда `warrant classify`
 * (файлы, git, record) и unit-тесты используют одну и ту же функцию.
 *
 * Три правила, которые делают повторный запуск безопасным:
 *   1. значение измерения = максимум по порядку enum из record, floor и proposer;
 *   2. при равенстве значений приоритет источника `record` > `floor` > `proposer`,
 *      поэтому повторный `classify` не переписывает `from`;
 *   3. profiles только объединяются — раз записанный profile не исчезает.
 *
 * A human source (`--set … --by <login>`, P-5) takes part in the same maximum
 * and wins ties (`from: human:<login>`); a human value below the floor is not
 * merged but reported in `belowFloor`, and the command refuses (`BELOW_FLOOR`).
 * A human value with `ref` (`--set … --ref <url>`, REQ-KRN-028) is an approved
 * value: the floor above it is set aside into `ignored` (`approved-below-floor`),
 * the value is written with its `ref`, and later runs keep it the same way
 * until a new `--set` of that dimension.
 *
 * `risk_level` не вычисляется и не пишется: это работа resolver'а.
 */
import picomatch from "picomatch";

import { readSchemaFile } from "../schemas/loader.js";
import { RISK_DIMENSIONS, type Classification, type RiskDimension, type RiskEntry } from "../resolve/types.js";
import type {
  BelowFloor,
  ClassifyInput,
  HumanValues,
  ClassifyResult,
  FloorRule,
  IgnoredValue,
  ProfileMatch,
  ProfileOrigin,
  Proposal
} from "./types.js";

export * from "./types.js";

/** Порядок значений каждого измерения, как их перечисляет `warrant://common/1` (05 §4). */
let valueOrder: Record<RiskDimension, string[]> | undefined;

function dimensionValues(): Record<RiskDimension, string[]> {
  if (valueOrder !== undefined) return valueOrder;
  const common = readSchemaFile("common") as { $defs?: Record<string, { enum?: unknown }> };
  const out = {} as Record<RiskDimension, string[]>;
  for (const dimension of RISK_DIMENSIONS) {
    const values = common.$defs?.[dimension]?.enum;
    out[dimension] = Array.isArray(values) ? values.filter((v): v is string => typeof v === "string") : [];
  }
  valueOrder = out;
  return out;
}

/**
 * Ранг значения в enum измерения. `UNKNOWN` — отсутствие знания, а не самая строгая
 * степень: любое известное значение сильнее него (I-53), поэтому `UNKNOWN` ранжируется
 * ниже всех, а незнакомое значение — ещё ниже.
 */
function rank(dimension: RiskDimension, value: string): number {
  if (value === "UNKNOWN") return -1;
  const index = dimensionValues()[dimension].indexOf(value);
  return index < 0 ? -2 : index;
}

/**
 * Путь в той форме, в которой его сравнивают glob'ы: POSIX-разделители,
 * без ведущего `./`. Windows-diff и `--paths`, написанный руками, приходят
 * с `\`, и без нормализации ни один шаблон pack'а не совпал бы.
 */
export function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Совпадает ли хотя бы один изменённый путь с одним из шаблонов.
 * `dot: true` — иначе `.warrant/**` не совпал бы ни с чем (05 §4).
 */
function anyMatch(changed: string[], patterns: string[]): boolean {
  if (patterns.length === 0 || changed.length === 0) return false;
  const isMatch = picomatch(patterns, { dot: true });
  return changed.some((p) => isMatch(p));
}

/** Кандидат на значение измерения: значение, источник и приоритет при равенстве. */
interface Candidate {
  value: string;
  from: string;
  /** Меньше — важнее: human / approved (-1), floor (0), record (1), proposer (2). */
  priority: number;
  /** URL of the approval: set on an approved value only (human with `ref`). */
  ref?: string;
  /** For a recorded value: the `from` it was stored with. */
  origin?: string;
}

function floorCandidates(
  changed: string[],
  floors: FloorRule[]
): Partial<Record<RiskDimension, Candidate>> {
  const out: Partial<Record<RiskDimension, Candidate>> = {};
  for (const rule of floors) {
    if (!anyMatch(changed, rule.paths)) continue;
    for (const dimension of RISK_DIMENSIONS) {
      const value = rule.set[dimension];
      if (value === undefined) continue;
      const candidate: Candidate = { value, from: `floor:${rule.pack}:${rule.index}`, priority: 0 };
      const current = out[dimension];
      // Несколько сработавших правил: берётся самое строгое, при равенстве — первое.
      if (current === undefined || rank(dimension, value) > rank(dimension, current.value)) {
        out[dimension] = candidate;
      }
    }
  }
  return out;
}

function previousCandidate(previous: Classification | undefined, dimension: RiskDimension): Candidate | undefined {
  const entry = previous?.risk?.[dimension];
  if (entry === undefined || typeof entry.value !== "string") return undefined;
  const origin = typeof entry.from === "string" ? entry.from : "record";
  // An approved value (human + ref) is kept as written, source and ref included (REQ-KRN-028).
  if (origin.startsWith("human:") && typeof entry.ref === "string") {
    return { value: entry.value, from: origin, priority: -1, ref: entry.ref, origin };
  }
  return { value: entry.value, from: "record", priority: 1, origin };
}

function proposedCandidate(propose: Proposal | undefined, dimension: RiskDimension): Candidate | undefined {
  const value = propose?.risk?.[dimension];
  if (typeof value !== "string") return undefined;
  return { value, from: "proposer", priority: 2 };
}

/** A human's value wins every tie: setting the value already there confirms it under the human's name. */
function humanCandidate(human: HumanValues | undefined, dimension: RiskDimension): Candidate | undefined {
  const value = human?.risk?.[dimension];
  if (human === undefined || typeof value !== "string") return undefined;
  const candidate: Candidate = { value, from: `human:${human.login}`, priority: -1 };
  if (human.ref !== undefined) candidate.ref = human.ref;
  return candidate;
}

/** Values of a dimension in the order of 05 section 4, as `warrant://common/1` lists them. */
export function dimensionValueOrder(dimension: RiskDimension): string[] {
  return [...dimensionValues()[dimension]];
}

/**
 * Победитель: максимум по enum, при равенстве — источник с меньшим `priority`:
 * floor (детерминирован и выводится заново каждый прогон) > record > proposer (I-56),
 * поэтому повторный прогон не меняет `from`, пока floor всё ещё совпадает по путям.
 */
function best(dimension: RiskDimension, candidates: Candidate[]): Candidate | undefined {
  let winner: Candidate | undefined;
  for (const candidate of candidates) {
    if (winner === undefined) {
      winner = candidate;
      continue;
    }
    const delta = rank(dimension, candidate.value) - rank(dimension, winner.value);
    if (delta > 0 || (delta === 0 && candidate.priority < winner.priority)) winner = candidate;
  }
  return winner;
}

/** Profiles: объединение record ∪ human ∪ match ∪ propose, источник — у первого, кто их внёс. */
function collectProfiles(
  changed: string[],
  matches: ProfileMatch[],
  propose: Proposal | undefined,
  previous: Classification | undefined,
  human: HumanValues | undefined
): ProfileOrigin[] {
  const out = new Map<string, string>();
  const take = (id: string, from: string): void => {
    if (!out.has(id)) out.set(id, from);
  };

  for (const id of previous?.profiles ?? []) take(id, "record");
  if (human !== undefined) for (const id of human.profiles ?? []) take(id, `human:${human.login}`);
  for (const profile of [...matches].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (anyMatch(changed, profile.paths)) take(profile.id, `match:${profile.pack}:${profile.id}`);
  }
  for (const id of propose?.profiles ?? []) take(id, "proposer");

  return [...out.entries()]
    .map(([id, from]) => ({ id, from }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Вычисляет classification. Измерение без единого кандидата остаётся
 * отсутствующим — resolver трактует такое измерение как `UNKNOWN`.
 */
export function classify(input: ClassifyInput): ClassifyResult {
  const changed = input.changed.map(normalizePath).filter((p) => p !== "");
  const floors = floorCandidates(changed, input.floors);
  const ignored: IgnoredValue[] = [];
  const belowFloor: BelowFloor[] = [];
  const risk: Partial<Record<RiskDimension, RiskEntry>> = {};

  for (const dimension of RISK_DIMENSIONS) {
    let previous = previousCandidate(input.previous, dimension);
    let floor = floors[dimension];
    const proposed = proposedCandidate(input.propose, dimension);
    const human = humanCandidate(input.human, dimension);

    // A new `--set` of the dimension ends an earlier approval: the recorded value is then an ordinary one.
    if (human !== undefined && previous?.ref !== undefined) previous = { value: previous.value, from: "record", priority: 1, origin: previous.from };
    // An approved value (this call's `--set … --ref`, or one recorded earlier) wins over the floor (REQ-KRN-028).
    const approved = human?.ref !== undefined ? human : previous?.ref !== undefined ? previous : undefined;
    let setAside: Candidate | undefined;
    if (approved !== undefined) {
      if (floor !== undefined && rank(dimension, floor.value) > rank(dimension, approved.value)) {
        setAside = floor;
        floor = undefined;
      }
      // The floor remembered by an earlier run is the same floor: it gives way too.
      if (approved === human && previous?.origin?.startsWith("floor:") === true && rank(dimension, previous.value) > rank(dimension, approved.value)) {
        setAside ??= { value: previous.value, from: previous.origin, priority: 0 };
        previous = undefined;
      }
    }

    const winner = best(dimension, [previous, floor, proposed, human].filter((c): c is Candidate => c !== undefined));
    if (winner === undefined) continue;
    const entry: RiskEntry = { value: winner.value, from: winner.from };
    if (winner.ref !== undefined) entry.ref = winner.ref;
    risk[dimension] = entry;

    if (setAside !== undefined) {
      ignored.push({ dimension, proposed: setAside.value, kept: winner.value, reason: "approved-below-floor", from: setAside.from });
    }

    // A human may raise or confirm, never go below the floor (P-5) without an approval: a refusal, not an ignored value.
    if (human !== undefined && floor !== undefined && rank(dimension, human.value) < rank(dimension, floor.value)) {
      belowFloor.push({ dimension, value: human.value, floor: floor.value, from: floor.from });
    } else if (human !== undefined && rank(dimension, human.value) < rank(dimension, winner.value)) {
      // Below the record or the proposer: monotonicity keeps the higher value.
      ignored.push({
        dimension,
        proposed: human.value,
        kept: winner.value,
        reason: winner.from === "record" ? "below-record" : "below-proposer",
        from: human.from
      });
    }

    // Отклоняется только предложение извне: record и floor не «предлагают»,
    // а задают минимум, и максимум их и так не теряет.
    if (proposed !== undefined && rank(dimension, proposed.value) < rank(dimension, winner.value)) {
      ignored.push({
        dimension,
        proposed: proposed.value,
        kept: winner.value,
        reason: winner.from.startsWith("floor")
          ? "below-floor"
          : winner.from.startsWith("human:")
            ? "below-human"
            : "below-record"
      });
    }
  }

  const profiles = collectProfiles(changed, input.profiles, input.propose, input.previous, input.human);

  const classification: Classification = {};
  if (profiles.length > 0) classification.profiles = profiles.map((p) => p.id);
  if (Object.keys(risk).length > 0) classification.risk = risk;

  return { classification, profiles, ignored, belowFloor };
}
