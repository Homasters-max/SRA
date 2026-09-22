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
 * `risk_level` не вычисляется и не пишется: это работа resolver'а.
 */
import picomatch from "picomatch";

import { readSchemaFile } from "../schemas/loader.js";
import { RISK_DIMENSIONS, type Classification, type RiskDimension, type RiskEntry } from "../resolve/types.js";
import type {
  ClassifyInput,
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
  /** Меньше — важнее: record (0), floor (1), proposer (2). */
  priority: number;
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
  return { value: entry.value, from: "record", priority: 1 };
}

function proposedCandidate(propose: Proposal | undefined, dimension: RiskDimension): Candidate | undefined {
  const value = propose?.risk?.[dimension];
  if (typeof value !== "string") return undefined;
  return { value, from: "proposer", priority: 2 };
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

/** Profiles: объединение record ∪ match ∪ propose, источник — у первого, кто их внёс. */
function collectProfiles(
  changed: string[],
  matches: ProfileMatch[],
  propose: Proposal | undefined,
  previous: Classification | undefined
): ProfileOrigin[] {
  const out = new Map<string, string>();
  const take = (id: string, from: string): void => {
    if (!out.has(id)) out.set(id, from);
  };

  for (const id of previous?.profiles ?? []) take(id, "record");
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
  const risk: Partial<Record<RiskDimension, RiskEntry>> = {};

  for (const dimension of RISK_DIMENSIONS) {
    const previous = previousCandidate(input.previous, dimension);
    const floor = floors[dimension];
    const proposed = proposedCandidate(input.propose, dimension);
    const winner = best(dimension, [previous, floor, proposed].filter((c): c is Candidate => c !== undefined));
    if (winner === undefined) continue;
    risk[dimension] = { value: winner.value, from: winner.from };

    // Отклоняется только предложение извне: record и floor не «предлагают»,
    // а задают минимум, и максимум их и так не теряет.
    if (proposed !== undefined && rank(dimension, proposed.value) < rank(dimension, winner.value)) {
      ignored.push({
        dimension,
        proposed: proposed.value,
        kept: winner.value,
        reason: winner.from.startsWith("floor") ? "below-floor" : "below-record"
      });
    }
  }

  const profiles = collectProfiles(changed, input.profiles, input.propose, input.previous);

  const classification: Classification = {};
  if (profiles.length > 0) classification.profiles = profiles.map((p) => p.id);
  if (Object.keys(risk).length > 0) classification.risk = risk;

  return { classification, profiles, ignored };
}
