/**
 * Clock (ADR-0025 п. 3): the former `today` parameter. No process behind it,
 * so the system clock lives here, not in `adapters/`.
 */

export interface ClockPort {
  /** Today as the UTC calendar date `YYYY-MM-DD`, the unit of `waiver.expires_at` (I-75). */
  today(): string;
}

export const systemClock: ClockPort = {
  today: () => new Date().toISOString().slice(0, 10)
};
