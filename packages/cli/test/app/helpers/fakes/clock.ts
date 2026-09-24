/**
 * `FakeClock` (ADR-0025 п. 3, design §5): a fixed date instead of the system
 * clock, so `expires_at`, archive names and year counters do not depend on
 * the day the tests run.
 */
import type { ClockPort } from "../../../../src/core/ports/clock.js";

export const FAKE_TODAY = "2026-09-24";

export class FakeClock implements ClockPort {
  constructor(private date: string = FAKE_TODAY) {
    FakeClock.check(date);
  }

  today(): string {
    return this.date;
  }

  set(date: string): this {
    FakeClock.check(date);
    this.date = date;
    return this;
  }

  private static check(date: string): void {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`FakeClock: ${date} is not YYYY-MM-DD`);
  }
}
