/**
 * Generates the simulated numbers shown on one dashboard image.
 *
 * Every value is drawn from its own configured range (inclusive), rounded to a
 * sensible number of decimals and checked to be a finite number. Values are
 * independent draws: nothing here pretends one figure is derived from another,
 * except the explicit "difference from baseline", which is computed from the
 * two displayed (rounded) numbers so the image is internally consistent.
 */
import type { CurrentValueSource } from '../config/env.js';
import type { DashboardItem, NumericRange } from '../data/types.js';
import type { Rng } from '../utils/rng.js';
import { streamRng } from '../utils/rng.js';
import { generateTrend, type TrendPoint } from './graph.js';

export interface SimulatedValue {
  value: number;
  decimals: number;
}

export interface SimulatedDashboard {
  itemId: string;
  seed: string;
  current: SimulatedValue;
  baseline?: SimulatedValue;
  /** Current − Baseline, only when both exist and are comparable. */
  difference?: SimulatedValue;
  volume24h?: SimulatedValue;
  output24h?: SimulatedValue;
  eventCount24h?: SimulatedValue;
  limit24h?: SimulatedValue;
  timeSinceUpdate: { minutes?: number; text?: string; simulated: boolean };
  trend: TrendPoint[];
}

export interface SimulationOptions {
  currentValueSource: CurrentValueSource;
  timeSinceUpdateMinMinutes: number;
  timeSinceUpdateMaxMinutes: number;
}

export class SimulationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimulationError';
  }
}

/** Number of decimals written in a number, e.g. 99.5 → 1. */
function decimalsOf(n: number): number {
  if (Number.isInteger(n)) return 0;
  const s = String(n);
  if (s.includes('e')) return 4;
  return Math.min(4, (s.split('.')[1] ?? '').length);
}

/** Two decimals for small figures, whole numbers for big ones, never fewer than the config uses. */
export function chooseDecimals(range: NumericRange): number {
  const magnitude = Math.max(Math.abs(range.min), Math.abs(range.max));
  const base = magnitude >= 1000 ? 0 : 2;
  return Math.min(4, Math.max(base, decimalsOf(range.min), decimalsOf(range.max)));
}

export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

function assertFinite(label: string, n: number): number {
  if (!Number.isFinite(n)) throw new SimulationError(`${label} produced an invalid number`);
  return n;
}

export function drawDecimal(rng: Rng, range: NumericRange, label: string): SimulatedValue {
  const decimals = chooseDecimals(range);
  const raw = rng.float(range.min, range.max);
  // Rounding can step just outside the range; clamp back (min/max themselves are representable).
  const value = Math.min(range.max, Math.max(range.min, roundTo(raw, decimals)));
  return { value: assertFinite(label, value), decimals };
}

export function drawInteger(rng: Rng, range: NumericRange, label: string): SimulatedValue {
  return { value: assertFinite(label, rng.int(range.min, range.max)), decimals: 0 };
}

/** Same kind of quantity on a similar scale → a difference makes sense. */
export function areComparable(a: NumericRange, b: NumericRange): boolean {
  const ma = Math.max(Math.abs(a.min), Math.abs(a.max));
  const mb = Math.max(Math.abs(b.min), Math.abs(b.max));
  if (ma === 0 || mb === 0) return ma === mb;
  const ratio = ma > mb ? ma / mb : mb / ma;
  return ratio <= 10;
}

export function simulateDashboard(item: DashboardItem, seed: string, opts: SimulationOptions): SimulatedDashboard {
  // One stream per component, so e.g. adding a card never changes the graph.
  const rngCurrent = streamRng(seed, 'metric:current');
  const rngBaseline = streamRng(seed, 'metric:baseline');
  const rngVolume = streamRng(seed, 'metric:volume');
  const rngOutput = streamRng(seed, 'metric:output');
  const rngEvents = streamRng(seed, 'metric:events');
  const rngLimit = streamRng(seed, 'metric:limit');
  const rngTime = streamRng(seed, 'metric:time-since');
  const rngGraph = streamRng(seed, 'graph');

  let current: SimulatedValue;
  if (opts.currentValueSource === 'sheet' && item.currentSheetValue !== undefined) {
    current = { value: item.currentSheetValue, decimals: Math.max(chooseDecimals(item.current), decimalsOf(item.currentSheetValue)) };
  } else {
    current = drawDecimal(rngCurrent, item.current, 'Current Value');
  }

  const baseline = item.baseline ? drawDecimal(rngBaseline, item.baseline, 'Baseline Value') : undefined;
  let difference: SimulatedValue | undefined;
  if (baseline && item.baseline && areComparable(item.current, item.baseline)) {
    const decimals = Math.max(current.decimals, baseline.decimals);
    difference = { value: assertFinite('Difference', roundTo(current.value - baseline.value, decimals)), decimals };
  }

  const volume24h = item.volume24h ? drawDecimal(rngVolume, item.volume24h, 'Volume (24H)') : undefined;
  const output24h = item.output24h ? drawDecimal(rngOutput, item.output24h, 'Output (24H)') : undefined;
  const eventCount24h = item.eventCount24h ? drawInteger(rngEvents, item.eventCount24h, 'Event Count (24H)') : undefined;
  const limit24h = item.limit24h ? drawDecimal(rngLimit, item.limit24h, 'Limit (24H)') : undefined;

  let timeSinceUpdate: SimulatedDashboard['timeSinceUpdate'];
  if (item.timeSinceUpdateMinutes !== undefined) timeSinceUpdate = { minutes: Math.round(item.timeSinceUpdateMinutes), simulated: false };
  else if (item.timeSinceUpdateText !== undefined) timeSinceUpdate = { text: item.timeSinceUpdateText, simulated: false };
  else timeSinceUpdate = { minutes: rngTime.int(opts.timeSinceUpdateMinMinutes, opts.timeSinceUpdateMaxMinutes), simulated: true };

  const trend = generateTrend(item.current, current.value, rngGraph);

  return { itemId: item.id, seed, current, baseline, difference, volume24h, output24h, eventCount24h, limit24h, timeSinceUpdate, trend };
}

/** Compact JSON for the database (graph points are not stored – they are reproducible from the seed). */
export function summarizeValues(sim: SimulatedDashboard): Record<string, number | string | null> {
  return {
    current: sim.current.value,
    baseline: sim.baseline?.value ?? null,
    difference: sim.difference?.value ?? null,
    volume_24h: sim.volume24h?.value ?? null,
    output_24h: sim.output24h?.value ?? null,
    event_count_24h: sim.eventCount24h?.value ?? null,
    limit_24h: sim.limit24h?.value ?? null,
    time_since_update: sim.timeSinceUpdate.text ?? (sim.timeSinceUpdate.minutes ?? null),
    trend_points: sim.trend.length,
  };
}
