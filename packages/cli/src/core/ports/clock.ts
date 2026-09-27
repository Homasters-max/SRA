/**
 * Clock (ADR-0025 п. 3): the former `today` parameter. No process behind it,
 * so the system clock lives here, not in `adapters/`.
 */

export interface ClockPort {
  /** Today as the UTC calendar date `YYYY-MM-DD`, the unit of `waiver.expires_at` (I-75). */
  today(): string;
  /**
   * Today as the calendar date `YYYY-MM-DD` in the time zone of the process:
   * the date `openspec archive` names its directory by (`formatLocalDate`,
   * REQ-KRN-034, BL-64).
   */
  localToday(): string;
}

/** `YYYY-MM-DD` of `at` in the time zone of the process (`getFullYear` / `getMonth` / `getDate`, as OpenSpec). */
export function localDate(at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

export const systemClock: ClockPort = {
  today: () => new Date().toISOString().slice(0, 10),
  localToday: () => localDate(new Date())
};
