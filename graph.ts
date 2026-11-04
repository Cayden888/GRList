/**
 * Simulated 24-hour trend line.
 *
 * Builds 25 hourly points (24 hours ago … the moment the image was generated):
 * a handful of random control points are smoothly interpolated, a little
 * jitter is added, and the tail is bent so the final point lands exactly on
 * the displayed Current Value. Every point is clamped inside the configured
 * Current Value range. It is decoration, not history.
 */
import type { NumericRange } from '../data/types.js';
import type { Rng } from '../utils/rng.js';

export interface TrendPoint {
  /** Hours relative to generation time: -24 … 0. */
  hourOffset: number;
  value: number;
}

export const TREND_POINTS = 25;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

export function generateTrend(range: NumericRange, finalValue: number, rng: Rng, points = TREND_POINTS): TrendPoint[] {
  if (points < 2) throw new Error('A trend needs at least 2 points');
  if (!(range.min <= finalValue && finalValue <= range.max)) {
    throw new Error(`Final value ${finalValue} is outside ${range.min}–${range.max}`);
  }
  const offsets = Array.from({ length: points }, (_, i) => i - (points - 1));
  const spanHours = points - 1;
  const toHours = (i: number) => (offsets[i]! * 24) / spanHours;

  // Equal min and max: the only honest line is a flat one.
  if (range.min === range.max) {
    return offsets.map((_, i) => ({ hourOffset: toHours(i), value: range.min }));
  }

  const span = range.max - range.min;
  const target = (finalValue - range.min) / span; // 0..1

  // 1) Smooth base curve through 7 random control points.
  const controls = Array.from({ length: 7 }, () => rng.float(0.18, 0.82));
  const base: number[] = [];
  for (let i = 0; i < points; i++) {
    const pos = (i / (points - 1)) * (controls.length - 1);
    const k = Math.min(controls.length - 2, Math.floor(pos));
    const t = smoothstep(pos - k);
    base.push(controls[k]! * (1 - t) + controls[k + 1]! * t);
  }

  // 2) Gentle jitter so it doesn't look machine-perfect.
  for (let i = 0; i < points; i++) base[i] = base[i]! + rng.float(-0.035, 0.035);

  // 3) Bend the last ~third of the line towards the final value.
  const tailStart = Math.floor(points * 0.65);
  const gap = target - base[points - 1]!;
  for (let i = tailStart; i < points; i++) {
    const w = smoothstep((i - tailStart) / (points - 1 - tailStart));
    base[i] = base[i]! + gap * w;
  }

  const out = base.map((u, i) => {
    const v = range.min + Math.min(1, Math.max(0, u)) * span;
    return { hourOffset: toHours(i), value: Math.min(range.max, Math.max(range.min, v)) };
  });
  out[points - 1]!.value = finalValue; // exact, no floating-point drift
  return out;
}
