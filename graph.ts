/** Simulated rolling 24-hour chart. Rightmost sample is NOW (image snapshot). */
import type { NumericRange } from '../data/types.js';
import type { Rng } from '../utils/rng.js';

export interface TrendPoint {
  /** Hours before snapshot, from -24 to 0. */
  hourOffset: number;
  value: number;
}

// 15-minute resolution gives events distinct positions throughout the day.
export const TREND_POINTS = 97;

/** eventCount is the number of simulated peak-and-drop events in the preceding 24h. */
export function generateTrend(range: NumericRange, finalValue: number, rng: Rng, points = TREND_POINTS, eventCount = 0): TrendPoint[] {
  if (points < 2) throw new Error('A trend needs at least 2 points');
  if (!(range.min <= finalValue && finalValue <= range.max)) throw new Error(`Final value ${finalValue} is outside ${range.min}–${range.max}`);
  if (!Number.isInteger(eventCount) || eventCount < 0) throw new Error('Event count must be a nonnegative integer');
  const span = range.max - range.min;
  const last = points - 1;
  const values: number[] = [];
  let level = rng.float(0.3, 0.6);
  for (let i = 0; i < points; i++) {
    level = Math.max(0.22, Math.min(0.67, level + rng.float(-0.065, 0.065)));
    values.push(level);
  }
  // Keep peak locations away from the two edges, and separate each event.
  // At least 3 samples per event: approach, peak, immediate drop.
  const candidates = Array.from({ length: Math.max(0, points - 6) }, (_, i) => i + 3);
  const chosen: number[] = [];
  for (let k = 0; k < eventCount; k++) {
    const available = candidates.filter(i => chosen.every(j => Math.abs(i - j) >= 4));
    if (!available.length) throw new Error(`Too many events (${eventCount}) for ${points} chart points`);
    chosen.push(available[rng.int(0, available.length - 1)]!);
  }
  for (const peak of chosen) {
    values[peak - 1] = rng.float(0.55, 0.7);
    values[peak] = rng.float(0.91, 0.99);
    values[peak + 1] = rng.float(0.07, 0.17);
    values[peak + 2] = rng.float(0.16, 0.34);
  }
  // Transition from last event into the current reading, without changing event count.
  const target = span === 0 ? 0 : (finalValue - range.min) / span;
  const tailStart = Math.max(0, last - 2);
  for (let i = tailStart; i < last; i++) {
    if (chosen.some(p => Math.abs(p - i) <= 2)) continue;
    const w = (i - tailStart + 1) / (last - tailStart + 1);
    values[i] = values[i]! * (1 - w) + target * w;
  }
  return values.map((u, i) => ({
    hourOffset: -24 + (24 * i) / last,
    value: i === last ? finalValue : range.min + Math.max(0, Math.min(1, u)) * span,
  }));
}
