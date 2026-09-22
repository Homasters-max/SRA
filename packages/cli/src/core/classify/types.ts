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

export interface ClassifyInput {
  /** Изменённые пути, POSIX, относительно корня проекта. */
  changed: string[];
  floors: FloorRule[];
  profiles: ProfileMatch[];
  propose?: Proposal;
  /** `classification` уже записанной record. */
  previous?: Classification;
}

/** Предложенное значение, которое не попало в classification. */
export interface IgnoredValue {
  dimension: RiskDimension;
  proposed: string;
  kept: string;
  /** Почему предложение отклонено: победитель пришёл из floor или из record. */
  reason: "below-floor" | "below-record";
}

/** Profile итоговой classification вместе с источником (схема record хранит только id). */
export interface ProfileOrigin {
  id: string;
  /** `record`, `match:<pack>:<profile>` или `proposer`. */
  from: string;
}

export interface ClassifyResult {
  /** То, что пишется в record: `risk_level` здесь не появляется никогда. */
  classification: Classification;
  /** Те же profiles, но с источником — для `data`. */
  profiles: ProfileOrigin[];
  ignored: IgnoredValue[];
}
