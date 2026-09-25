/** Формы модуля `classify` (design Decision 4, REQ-KRN-028). */
import type { Classification, RiskDimension } from "../resolve/types.js";

/** Одно floor-правило `warrant://risk-floor/1`, с местом, откуда оно взято. */
export interface FloorRule {
  /** Pack, объявивший правило. */
  pack: string;
  /** Индекс правила в массиве `floors` его файла — часть `from`. */
  index: number;
  /** Glob-шаблоны по изменённым путям. */
  paths: string[];
  /** Минимумы измерений, которые правило навязывает. */
  set: Partial<Record<RiskDimension, string>>;
}

/** Profile с `match.paths`, предлагающий себя по изменённым путям. */
export interface ProfileMatch {
  pack: string;
  id: string;
  paths: string[];
}

/** `--propose <json>`: значения от proposer'а. */
export interface Proposal {
  profiles?: string[];
  risk?: Partial<Record<RiskDimension, string>>;
}

/** `--set <dim>=<value>` / `--set profile=<id>` with `--by <login>`: values of a human (P-5). */
export interface HumanValues {
  /** Login of the human; the source is written as `human:<login>`. */
  login: string;
  profiles?: string[];
  risk?: Partial<Record<RiskDimension, string>>;
  /**
   * `--ref <url>`: the approval of these values. A risk value carrying it is an
   * approved value: it may go below the floor, is written with `ref` and keeps
   * winning over the floor on later runs until a new `--set` of its dimension.
   */
  ref?: string;
}

export interface ClassifyInput {
  /** Изменённые пути, POSIX, относительно корня проекта. */
  changed: string[];
  /**
   * Собственное состояние Change (`ownState` из `core/run/state.ts`, N27): такие пути из `changed`
   * не сверяются ни с floor rules, ни с `match.paths` (REQ-KRN-028). Без него — никакие.
   */
  own?: (path: string) => boolean;
  floors: FloorRule[];
  profiles: ProfileMatch[];
  propose?: Proposal;
  /** `classification` уже записанной record. */
  previous?: Classification;
  /** Values set by a human; they may raise or confirm, never go below the floor. */
  human?: HumanValues;
}

/** Предложенное значение, которое не попало в classification. */
export interface IgnoredValue {
  dimension: RiskDimension;
  proposed: string;
  kept: string;
  /**
   * Почему предложение отклонено: победитель пришёл из floor, из record, от human или (для human) от proposer;
   * `approved-below-floor` — это floor, уступивший значению human с `ref` (REQ-KRN-028).
   */
  reason: "below-floor" | "below-record" | "below-human" | "below-proposer" | "approved-below-floor";
  /**
   * Present for a human value (`human:<login>`) and for a floor set aside by an
   * approved value (`floor:<pack>:<rule-index>`); a proposer's value has no `from` here.
   */
  from?: string;
}

/** A human value below the floor: `classify` refuses the whole call (`BELOW_FLOOR`). */
export interface BelowFloor {
  dimension: RiskDimension;
  value: string;
  floor: string;
  /** `floor:<pack>:<rule-index>` of the floor. */
  from: string;
}

/** Profile итоговой classification вместе с источником (схема record хранит только id). */
export interface ProfileOrigin {
  id: string;
  /** `record`, `human:<login>`, `match:<pack>:<profile>` или `proposer`. */
  from: string;
}

export interface ClassifyResult {
  /** То, что пишется в record: `risk_level` здесь не появляется никогда. */
  classification: Classification;
  /** Те же profiles, но с источником — для `data`. */
  profiles: ProfileOrigin[];
  ignored: IgnoredValue[];
  /** Human values below the floor; non-empty means the result must not be written. */
  belowFloor: BelowFloor[];
}
